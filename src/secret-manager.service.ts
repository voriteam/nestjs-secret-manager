import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import type { Tracer } from '@opentelemetry/api';

import { SECRET_MANAGER_OPTIONS, secretRegistry } from './constants';
import type { SecretBackend } from './interfaces/secret-backend.interface';
import type { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';
import { SecretCache } from './secret-cache';

/** Default cache TTL when none is configured: 15 minutes. */
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

const REDACTED = '[SecretManagerService redacted]';

/**
 * Service for accessing secrets from configured backends.
 *
 * Features:
 * - Cache-first lookup to minimize backend calls
 * - Startup validation of all registered secrets
 * - OpenTelemetry tracing
 * - Multiple backend support
 *
 * Internal state (backends map, cache, options) is held in JS `#private`
 * fields so it is unreachable via property access. `toJSON` and
 * `util.inspect.custom` redact the instance to prevent secret leakage when
 * a service holding the cache is accidentally serialized.
 */
@Injectable()
export class SecretManagerService implements OnModuleInit {
  readonly #logger = new Logger(SecretManagerService.name);
  readonly #backends = new Map<string, SecretBackend>();
  readonly #stringCache: SecretCache<string>;
  readonly #bytesCache: SecretCache<Uint8Array>;
  readonly #tracer: Tracer = trace.getTracer('secret-manager');
  readonly #options: SecretManagerModuleOptions;

  constructor(
    @Inject(SECRET_MANAGER_OPTIONS) options: SecretManagerModuleOptions,
  ) {
    this.#options = options;
    const ttl = this.#resolveCacheTtl(options);
    this.#stringCache = new SecretCache<string>(ttl);
    this.#bytesCache = new SecretCache<Uint8Array>(ttl);
    this.#initializeBackends();
  }

  #resolveCacheTtl(options: SecretManagerModuleOptions): number | undefined {
    if (options.cacheEnabled === false) {
      return undefined;
    }
    if (options.cacheTTL === undefined) {
      return DEFAULT_CACHE_TTL_MS;
    }
    // Treat explicit 0 as "never expire" — the documented escape hatch.
    if (options.cacheTTL === 0) {
      return undefined;
    }
    if (!Number.isFinite(options.cacheTTL) || options.cacheTTL < 0) {
      throw new Error(
        `Invalid cacheTTL: ${options.cacheTTL}. Must be a non-negative finite number (or 0 / undefined).`,
      );
    }
    return options.cacheTTL;
  }

  #initializeBackends(): void {
    if (this.#options.skipLoading) {
      return;
    }

    const backends = this.#options.backends ?? [];

    if (backends.length === 0) {
      throw new Error(
        'SecretManagerModule requires at least one backend in `backends`, or `skipLoading: true`.',
      );
    }

    for (const backend of backends) {
      if (this.#backends.has(backend.name)) {
        throw new Error(
          `Duplicate backend name: '${backend.name}'. Each backend must have a unique name.`,
        );
      }
      this.#backends.set(backend.name, backend);
      this.#logger.log(`Registered backend: ${backend.name}`);
    }

    if (
      this.#options.defaultBackend &&
      !this.#backends.has(this.#options.defaultBackend)
    ) {
      throw new Error(
        `defaultBackend '${this.#options.defaultBackend}' is not among the configured backends: ${Array.from(this.#backends.keys()).join(', ')}`,
      );
    }
  }

  public async onModuleInit(): Promise<void> {
    if (
      this.#options.skipLoading ||
      this.#options.validateOnStartup === false
    ) {
      return;
    }
    await this.#validateAllSecrets();
  }

  /**
   * Validate all registered secrets are accessible.
   * Called during application startup if validateOnStartup is enabled.
   */
  async #validateAllSecrets(): Promise<void> {
    const secrets = secretRegistry.getAll();

    if (secrets.length === 0) {
      this.#logger.log('No secrets registered for validation');
      return;
    }

    this.#logger.log(`Validating ${secrets.length} registered secret(s)...`);

    const errors: Error[] = [];

    for (const secret of secrets) {
      try {
        // Use the same kind of fetch the consumer registered with — for
        // truly binary secrets, decoding to UTF-8 silently substitutes
        // replacement characters but doesn't throw, so probing via the
        // matching method gives the most accurate validation.
        if (secret.kind === 'bytes') {
          await this.getBytes({
            name: secret.name,
            version: secret.version,
            backend: secret.backend,
          });
        } else {
          await this.get({
            name: secret.name,
            version: secret.version,
            backend: secret.backend,
          });
        }
        this.#logger.log(`Secret validated: ${secret.name}`);
      } catch (error) {
        errors.push(error as Error);
        this.#logger.error(`Secret validation failed: ${secret.name}`, error);
      }
    }

    if (errors.length > 0) {
      const errorMessages = errors.map((e) => `  - ${e.message}`).join('\n');
      throw new Error(
        `Failed to validate ${errors.length} secret(s):\n${errorMessages}`,
      );
    }

    this.#logger.log(`All ${secrets.length} secret(s) validated successfully`);
  }

  /**
   * Get a secret value.
   *
   * @param options.name - Secret name
   * @param options.version - Optional version (defaults to 'latest')
   * @param options.backend - Optional backend name (uses the configured default if omitted)
   * @returns The secret value
   */
  public async get(options: {
    name: string;
    version?: string;
    backend?: string;
  }): Promise<string> {
    const { name, version, backend: backendName } = options;

    if (this.#options.skipLoading) {
      return `SECRET_NOT_LOADED:${name}`;
    }

    const backend = this.#getBackend(backendName);
    const resolvedVersion = version ?? 'latest';

    return this.#tracer.startActiveSpan('secret.get', async (span) => {
      span.setAttribute('secret.name', name);
      span.setAttribute('secret.version', resolvedVersion);
      span.setAttribute('secret.backend', backend.name);

      try {
        const value = await this.#getInternal(name, resolvedVersion, backend);
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async #getInternal(
    name: string,
    version: string,
    backend: SecretBackend,
  ): Promise<string> {
    if (this.#options.cacheEnabled !== false) {
      const cached = this.#stringCache.get(backend.name, name, version);
      if (cached !== undefined) {
        if (this.#options.debug) {
          this.#logger.debug(`Cache hit for secret: ${name}`);
        }
        return cached;
      }
    }

    this.#logger.log({
      msg: 'Fetching secret',
      backend: backend.name,
      name,
      version,
    });

    const value = await backend.get(name, version);

    if (this.#options.cacheEnabled !== false) {
      this.#stringCache.set(backend.name, name, value, version);
    }

    return value;
  }

  /**
   * Get the latest version of a secret.
   */
  public async getLatest(options: {
    name: string;
    backend?: string;
  }): Promise<string> {
    return this.get({
      name: options.name,
      version: 'latest',
      backend: options.backend,
    });
  }

  /**
   * Get a secret as raw bytes. Use this for binary secrets where UTF-8
   * decoding would be lossy (e.g. private keys, encryption material).
   *
   * @param options.name - Secret name
   * @param options.version - Optional version (defaults to 'latest')
   * @param options.backend - Optional backend name (uses the configured default if omitted)
   * @returns The secret value as a Uint8Array
   */
  public async getBytes(options: {
    name: string;
    version?: string;
    backend?: string;
  }): Promise<Uint8Array> {
    const { name, version, backend: backendName } = options;

    if (this.#options.skipLoading) {
      return new TextEncoder().encode(`SECRET_NOT_LOADED:${name}`);
    }

    const backend = this.#getBackend(backendName);
    const resolvedVersion = version ?? 'latest';

    return this.#tracer.startActiveSpan('secret.getBytes', async (span) => {
      span.setAttribute('secret.name', name);
      span.setAttribute('secret.version', resolvedVersion);
      span.setAttribute('secret.backend', backend.name);

      try {
        const value = await this.#getBytesInternal(
          name,
          resolvedVersion,
          backend,
        );
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        span.recordException(error as Error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  async #getBytesInternal(
    name: string,
    version: string,
    backend: SecretBackend,
  ): Promise<Uint8Array> {
    if (this.#options.cacheEnabled !== false) {
      const cached = this.#bytesCache.get(backend.name, name, version);
      if (cached !== undefined) {
        if (this.#options.debug) {
          this.#logger.debug(`Cache hit for secret bytes: ${name}`);
        }
        return cached;
      }
    }

    this.#logger.log({
      msg: 'Fetching secret bytes',
      backend: backend.name,
      name,
      version,
    });

    const value = await backend.getBytes(name, version);

    if (this.#options.cacheEnabled !== false) {
      this.#bytesCache.set(backend.name, name, value, version);
    }

    return value;
  }

  /**
   * Get the latest version of a secret as raw bytes.
   */
  public async getLatestBytes(options: {
    name: string;
    backend?: string;
  }): Promise<Uint8Array> {
    return this.getBytes({
      name: options.name,
      version: 'latest',
      backend: options.backend,
    });
  }

  /**
   * Get a backend by name. Falls back to the configured default if no name
   * is given. Throws if the backend isn't configured.
   */
  #getBackend(name?: string): SecretBackend {
    const backendName = name ?? this.#options.defaultBackend;

    if (!backendName) {
      throw new Error(
        'No backend specified and no defaultBackend configured. ' +
          'Pass `backend` to get(), or set `defaultBackend` in module options.',
      );
    }

    const backend = this.#backends.get(backendName);

    if (!backend) {
      throw new Error(
        `Unknown secret backend: '${backendName}'. Available backends: ${Array.from(this.#backends.keys()).join(', ')}`,
      );
    }

    return backend;
  }

  /**
   * Clear the secret cache (both string and bytes views).
   */
  public clearCache(): void {
    this.#stringCache.clear();
    this.#bytesCache.clear();
    this.#logger.log('Secret cache cleared');
  }

  /** Redact when serialized via JSON. */
  public toJSON(): string {
    return REDACTED;
  }

  /** Redact when inspected by util.inspect / console.log / pino / winston. */
  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
