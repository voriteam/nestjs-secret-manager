export { SecretManagerModule } from './secret-manager.module';

export { SecretManagerService } from './secret-manager.service';

export { SecretKind } from './constants';
export type { SecretRequirement } from './constants';
export { collectInjectedSecrets } from './injected-secrets';
export type { InjectedSecret } from './injected-secrets';

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

export { StartupValidation } from './interfaces/secret-manager-options.interface';
export type { SecretBackend } from './interfaces/secret-backend.interface';
export type {
  SecretManagerModuleOptions,
  SecretManagerModuleAsyncOptions,
  SecretManagerOptionsFactory,
  InjectSecretOptions,
} from './interfaces/secret-manager-options.interface';

export { SecretNotFoundError } from './errors/secret-not-found.error';
export { SecretAccessDeniedError } from './errors/secret-access-denied.error';
export { SecretValidationError } from './errors/secret-validation.error';
export type { SecretValidationFailure } from './errors/secret-validation.error';

export { GcpSecretManagerBackend } from './backends/gcp-secret-manager.backend';
export { InMemorySecretBackend } from './backends/in-memory.backend';
export type { InMemorySecretBackendOptions } from './backends/in-memory.backend';
