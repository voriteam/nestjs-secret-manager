// Module
export { SecretManagerModule } from './secret-manager.module';

// Service
export { SecretManagerService } from './secret-manager.service';

// Decorators
export {
  InjectSecret,
  InjectSecretBytes,
} from './decorators/inject-secret.decorator';
export type {
  SecretAccessor,
  SecretBytesAccessor,
} from './decorators/inject-secret.decorator';

// Interfaces
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

// Backends
export { GcpSecretManagerBackend } from './backends/gcp-secret-manager.backend';
export { InMemorySecretBackend } from './backends/in-memory.backend';

// Cache (for advanced use cases)
export { SecretCache } from './secret-cache';
