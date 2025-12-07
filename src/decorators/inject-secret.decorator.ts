import { Inject } from '@nestjs/common';

import { secretRegistry } from '../constants';
import { InjectSecretOptions } from '../interfaces/secret-manager-options.interface';

/**
 * Parameter decorator to inject a secret value.
 *
 * The secret will be fetched from the configured backend during application
 * initialization and injected as a string value.
 *
 * @param name - The secret name/identifier
 * @param options - Optional configuration (version, backend)
 *
 * @example
 * ```typescript
 * @Injectable()
 * class MyService {
 *   constructor(
 *     @InjectSecret('api-key') private readonly apiKey: string,
 *     @InjectSecret('db-password', { version: '2' }) private readonly dbPassword: string,
 *     @InjectSecret('legacy-key', { backend: 'memory' }) private readonly legacyKey: string,
 *   ) {}
 * }
 * ```
 */
export function InjectSecret(
  name: string,
  options?: InjectSecretOptions,
): ParameterDecorator {
  // Register this secret for startup validation and provider creation
  const requirement = secretRegistry.register(name, options);

  // Use NestJS Inject with the unique token
  return Inject(requirement.token);
}
