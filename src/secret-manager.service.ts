import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_MANAGER_OPTIONS, SecretKind } from './constants';
import type { SecretBackend } from './interfaces/secret-backend.interface';
import type { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';
import { SecretAddress, SecretCache, cachePolicyFrom } from './secret-cache';

const REDACTED = '[SecretManagerService redacted]';

/**
 * Service for accessing secrets from configured backends.
 *
 * Features:
 * - Cache-first lookup to minimize backend calls
 * - Concurrent reads of one secret share a single backend fetch
 * - Multiple backend support
 *
 * Internal state (backends map, cache, options) is held in JS `#private`
 * fields so it is unreachable via property access. `toJSON` and
 * `util.inspect.custom` redact the instance to prevent secret leakage when
 * a service holding the cache is accidentally serialized.
 */
@Injectable()
export class SecretManagerService {
  readonly #logger = new Logger(SecretManagerService.name);
  readonly #backends = new Map<string, SecretBackend>();
  readonly #stringCache: SecretCache<string>;
  readonly #bytesCache: SecretCache<Uint8Array>;
  readonly #options: SecretManagerModuleOptions;

  constructor(
    @Inject(SECRET_MANAGER_OPTIONS) options: SecretManagerModuleOptions,
  ) {
    this.#options = options;
    const policy = cachePolicyFrom(options);
    this.#stringCache = new SecretCache<string>(policy);
    this.#bytesCache = new SecretCache<Uint8Array>(
      policy,
      (bytes) => new Uint8Array(bytes),
    );
    this.#initializeBackends();
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

  /**
   * Get a secret value.
   *
   * @param options.name - Secret name
   * @param options.version - Optional version (defaults to 'latest')
   * @param options.backend - Optional backend name (uses the configured default if omitted)
   * @returns The secret value
   */
  public async get({
    name,
    version = 'latest',
    backend,
  }: {
    name: string;
    version?: string;
    backend?: string;
  }): Promise<string> {
    if (this.#options.skipLoading) {
      return `SECRET_NOT_LOADED:${name}`;
    }

    const source = this.#getBackend(backend);
    const address = { backend: source.name, name, version };
    return await this.#stringCache.read(address, () => {
      this.#logFetch(SecretKind.String, address);
      return source.get(name, version);
    });
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
  public async getBytes({
    name,
    version = 'latest',
    backend,
  }: {
    name: string;
    version?: string;
    backend?: string;
  }): Promise<Uint8Array> {
    if (this.#options.skipLoading) {
      return new TextEncoder().encode(`SECRET_NOT_LOADED:${name}`);
    }

    const source = this.#getBackend(backend);
    const address = { backend: source.name, name, version };
    return await this.#bytesCache.read(address, () => {
      this.#logFetch(SecretKind.Bytes, address);
      return source.getBytes(name, version);
    });
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

  /** Logged from inside the loader, so only a read that reaches the backend logs. */
  #logFetch(kind: SecretKind, address: SecretAddress): void {
    this.#logger.debug({ msg: 'Fetching secret', kind, ...address });
  }

  /**
   * Clear the secret cache (both string and bytes views). A fetch already in
   * flight still answers its callers but is not cached.
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
