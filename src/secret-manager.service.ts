import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';

import { GcpSecretManagerBackend } from './backends/gcp-secret-manager.backend';
import { InMemorySecretBackend } from './backends/in-memory.backend';
import { SECRET_MANAGER_OPTIONS, secretRegistry } from './constants';
import { SecretBackend } from './interfaces/secret-backend.interface';
import { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';
import { SecretCache } from './secret-cache';

/**
 * Service for accessing secrets from configured backends.
 *
 * Features:
 * - Cache-first lookup to minimize backend calls
 * - Startup validation of all registered secrets
 * - OpenTelemetry tracing
 * - Multiple backend support
 */
@Injectable()
export class SecretManagerService implements OnModuleInit {
  private readonly logger = new Logger(SecretManagerService.name);
  private readonly backends = new Map<string, SecretBackend>();
  private readonly cache: SecretCache;
  private readonly tracer = trace.getTracer('secret-manager');

  constructor(
    @Inject(SECRET_MANAGER_OPTIONS)
    private readonly options: SecretManagerModuleOptions,
  ) {
    // Initialize cache
    const cacheEnabled = options.cacheEnabled !== false;
    this.cache = new SecretCache(cacheEnabled ? options.cacheTTL : undefined);

    // Initialize backends
    this.initializeBackends();
  }

  private initializeBackends(): void {
    // Initialize GCP backend if project ID is provided
    if (this.options.gcpProjectId) {
      this.backends.set(
        'gcp',
        new GcpSecretManagerBackend(this.options.gcpProjectId),
      );
      this.logger.log('GCP Secret Manager backend initialized');
    }

    // Initialize in-memory backend
    const memoryBackend = new InMemorySecretBackend(
      this.options.inMemorySecrets,
    );
    this.backends.set('memory', memoryBackend);

    if (this.options.inMemorySecrets) {
      const secretCount = Object.keys(this.options.inMemorySecrets).length;
      this.logger.log(
        `In-memory backend initialized with ${secretCount} secret(s)`,
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.options.validateOnStartup !== false) {
      await this.validateAllSecrets();
    }
  }

  /**
   * Validate all registered secrets are accessible.
   * Called during application startup if validateOnStartup is enabled.
   */
  private async validateAllSecrets(): Promise<void> {
    const secrets = secretRegistry.getAll();

    if (secrets.length === 0) {
      this.logger.log('No secrets registered for validation');
      return;
    }

    this.logger.log(`Validating ${secrets.length} registered secret(s)...`);

    const errors: Error[] = [];

    for (const secret of secrets) {
      try {
        await this.get(secret.name, secret.version, secret.backend);
        this.logger.log(`Secret validated: ${secret.name}`);
      } catch (error) {
        errors.push(error as Error);
        this.logger.error(`Secret validation failed: ${secret.name}`, error);
      }
    }

    if (errors.length > 0) {
      const errorMessages = errors.map((e) => `  - ${e.message}`).join('\n');
      throw new Error(
        `Failed to validate ${errors.length} secret(s):\n${errorMessages}`,
      );
    }

    this.logger.log(`All ${secrets.length} secret(s) validated successfully`);
  }

  /**
   * Get a secret value.
   *
   * @param name - Secret name
   * @param version - Optional version (defaults to 'latest')
   * @param backendName - Optional backend name (uses default if not specified)
   * @returns The secret value
   */
  async get(
    name: string,
    version?: string,
    backendName?: string,
  ): Promise<string> {
    const backend = this.getBackend(backendName);
    const resolvedVersion = version ?? 'latest';

    return this.tracer.startActiveSpan('secret.get', async (span) => {
      span.setAttribute('secret.name', name);
      span.setAttribute('secret.version', resolvedVersion);
      span.setAttribute('secret.backend', backend.name);

      try {
        const value = await this.getInternal(name, resolvedVersion, backend);
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

  private async getInternal(
    name: string,
    version: string,
    backend: SecretBackend,
  ): Promise<string> {
    // Check cache first
    if (this.options.cacheEnabled !== false) {
      const cached = this.cache.get(backend.name, name, version);
      if (cached !== undefined) {
        if (this.options.debug) {
          this.logger.debug(`Cache hit for secret: ${name}`);
        }
        return cached;
      }
    }

    // Fetch from backend
    this.logger.log({
      msg: 'Fetching secret',
      backend: backend.name,
      name,
      version,
    });

    const value = await backend.get(name, version);

    // Cache the result
    if (this.options.cacheEnabled !== false) {
      this.cache.set(backend.name, name, value, version);
    }

    return value;
  }

  /**
   * Get the latest version of a secret.
   *
   * @param name - Secret name
   * @param backendName - Optional backend name
   * @returns The secret value
   */
  async getLatest(name: string, backendName?: string): Promise<string> {
    return this.get(name, 'latest', backendName);
  }

  /**
   * Get a backend by name.
   * Falls back to the default backend if not specified.
   */
  private getBackend(name?: string): SecretBackend {
    const backendName = name ?? this.options.defaultBackend;
    const backend = this.backends.get(backendName);

    if (!backend) {
      throw new Error(
        `Unknown secret backend: '${backendName}'. Available backends: ${Array.from(this.backends.keys()).join(', ')}`,
      );
    }

    return backend;
  }

  /**
   * Get the in-memory backend.
   * Useful for test setup.
   */
  getInMemoryBackend(): InMemorySecretBackend {
    return this.backends.get('memory') as InMemorySecretBackend;
  }

  /**
   * Clear the secret cache.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Secret cache cleared');
  }

  /**
   * Register a custom backend.
   *
   * @param backend - Backend implementation
   */
  registerBackend(backend: SecretBackend): void {
    this.backends.set(backend.name, backend);
    this.logger.log(`Registered custom backend: ${backend.name}`);
  }
}
