import { ModuleMetadata, Type } from '@nestjs/common';

/**
 * Options for configuring the SecretManagerModule.
 */
export interface SecretManagerModuleOptions {
  /**
   * Default backend to use when not specified in @InjectSecret.
   * Must match a registered backend name (e.g., 'gcp', 'memory').
   */
  defaultBackend: string;

  /**
   * Whether to enable in-memory caching of secrets.
   * @default true
   */
  cacheEnabled?: boolean;

  /**
   * Cache TTL in milliseconds.
   * If not set, secrets are cached indefinitely within the process lifetime.
   */
  cacheTTL?: number;

  /**
   * Whether to validate all registered secrets on application startup.
   * When enabled, the application will fail to start if any secret is inaccessible.
   * @default true
   */
  validateOnStartup?: boolean;

  /**
   * GCP project ID for the GCP Secret Manager backend.
   * Required if using the 'gcp' backend.
   */
  gcpProjectId?: string;

  /**
   * Secrets to preload into the in-memory backend.
   * Useful for testing and local development.
   * Format: { 'secret-name': 'secret-value' }
   */
  inMemorySecrets?: Record<string, string>;

  /**
   * Whether to enable debug logging for secret access.
   * @default false
   */
  debug?: boolean;
}

/**
 * Factory interface for creating SecretManagerModuleOptions.
 */
export interface SecretManagerOptionsFactory {
  createSecretManagerOptions():
    | Promise<SecretManagerModuleOptions>
    | SecretManagerModuleOptions;
}

/**
 * Options for asynchronous module configuration.
 */
export interface SecretManagerModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Existing provider to use for options.
   */
  useExisting?: Type<SecretManagerOptionsFactory>;

  /**
   * Class to instantiate for options.
   */
  useClass?: Type<SecretManagerOptionsFactory>;

  /**
   * Factory function to create options.
   */
  useFactory?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
  ) => Promise<SecretManagerModuleOptions> | SecretManagerModuleOptions;

  /**
   * Dependencies to inject into the factory function.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inject?: any[];
}

/**
 * Options for the @InjectSecret decorator.
 */
export interface InjectSecretOptions {
  /**
   * Specific version of the secret to fetch.
   * @default 'latest'
   */
  version?: string;

  /**
   * Backend to use for this secret.
   * Overrides the default backend.
   */
  backend?: string;
}
