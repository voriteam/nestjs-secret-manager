import { ModuleMetadata, Type } from '@nestjs/common';

import { SecretBackend } from './secret-backend.interface';

/**
 * What boot does with the secrets the built Nest graph injects. Only classes
 * and factories Nest constructs count, so a decorated class that is imported
 * but never provided is not probed.
 */
export enum StartupValidation {
  /** Probe every injected secret and fail boot with SecretValidationError if any read fails. */
  Enforce = 'enforce',
  /** Probe every injected secret, log the failures once at warn level, and keep booting. */
  Warn = 'warn',
  /** Probe nothing. */
  Off = 'off',
}

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
   * Cache TTL in milliseconds. Secrets older than this are re-fetched on the
   * next access, bounding rotation lag and the steady-state in-memory
   * footprint.
   *
   * - Unset (`undefined`) → 15 minutes (`15 * 60 * 1000`).
   * - `0` → never expire (process-lifetime cache; explicit escape hatch).
   * - Positive number → milliseconds.
   */
  cacheTTL?: number;

  /**
   * What `onModuleInit` does with the secrets the application's graph injects.
   * @default StartupValidation.Enforce
   */
  startupValidation?: StartupValidation;

  /**
   * Whether to enable debug logging for secret access.
   * @default false
   */
  debug?: boolean;

  /**
   * Skip loading secrets entirely. Every read returns the placeholder
   * `{"_placeholder":true,"key":"<name>"}` (UTF-8 encoded for bytes), and
   * validation is skipped. Useful for CLI tools and environments without
   * secret backend access.
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
 * Options for `SecretManagerModule.forTesting`.
 */
export interface SecretManagerTestingOptions {
  /**
   * Value for any secret the test did not seed. Without it, reading an
   * unseeded secret throws SecretNotFoundError.
   */
  fallback?: (name: string) => string;
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
