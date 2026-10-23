// Module
export { SecretManagerModule } from './secret-manager.module';

// Service
export { SecretManagerService } from './secret-manager.service';

// Decorators
export {
  InjectSecret,
  InjectSecretBytes,
  secretAccessorToken,
  secretBytesAccessorToken,
} from './decorators/inject-secret.decorator';
export type {
  SecretAccessor,
  SecretBytesAccessor,
} from './decorators/inject-secret.decorator';

// Interfaces
export { SecretKind } from './constants';
export { StartupValidation } from './interfaces/secret-manager-options.interface';
export type { SecretBackend } from './interfaces/secret-backend.interface';
export type {
  SecretManagerModuleOptions,
  SecretManagerModuleAsyncOptions,
  SecretManagerOptionsFactory,
  InjectSecretOptions,
} from './interfaces/secret-manager-options.interface';

// Errors
export { SecretNotFoundError } from './errors/secret-not-found.error';
export { SecretAccessDeniedError } from './errors/secret-access-denied.error';
export { SecretValidationError } from './errors/secret-validation.error';
export type { SecretValidationFailure } from './errors/secret-validation.error';
export { collectInjectedSecrets } from './secret-startup-validator';
export type { InjectedSecret } from './secret-startup-validator';

// Backends
export { GcpSecretManagerBackend } from './backends/gcp-secret-manager.backend';
export { InMemorySecretBackend } from './backends/in-memory.backend';

// Cache (for advanced use cases)
export { SecretCache } from './secret-cache';
