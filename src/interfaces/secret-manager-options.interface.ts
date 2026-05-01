import { ModuleMetadata, Type } from '@nestjs/common';

import { SecretBackend } from './secret-backend.interface';

/**
 * Options for configuring the SecretManagerModule.
 */
export interface SecretManagerModuleOptions {
  /**
   * Default backend to use when @InjectSecret does not specify one.
   * Must match the `name` of one of the configured backends.
   * Required unless `skipLoading` is true.
   */
  defaultBackend?: string;

  /**
   * Backends available for secret resolution. Each backend brings its own
   * configuration via its constructor; the module is agnostic to which
   * backends exist.
   *
   * Required unless `skipLoading` is true.
   */
  backends?: SecretBackend[];

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
   * Whether to enable debug logging for secret access.
   * @default false
   */
  debug?: boolean;

  /**
   * Skip loading secrets entirely. @InjectSecret injects placeholder
   * strings (`SECRET_NOT_LOADED:<name>`) and validation is skipped.
   * Useful for CLI tools and environments without secret backend access.
   * @default false
   */
  skipLoading?: boolean;
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
