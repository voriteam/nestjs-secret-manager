import { SecretKind } from '../constants';

/** One injected secret that startup validation could not read. */
export interface SecretValidationFailure {
  readonly name: string;
  readonly version: string;
  /** `'none'` when neither the injection nor the module names a backend. */
  readonly backend: string;
  readonly kind: SecretKind;
  /** Names of the providers that inject the secret. */
  readonly consumers: readonly string[];
  readonly error: Error;
}

/**
 * Thrown from `onModuleInit` under `StartupValidation.Enforce`, and logged
 * under `StartupValidation.Warn`.
 */
export class SecretValidationError extends Error {
  public readonly name = 'SecretValidationError';

  constructor(public readonly failures: readonly SecretValidationFailure[]) {
    super(
      [
        `Failed to validate ${failures.length} injected secret(s):`,
        ...failures.map(
          ({ name, backend, version, kind, consumers, error }) =>
            `  - ${name} (backend: ${backend}, version: ${version}${kind === SecretKind.Bytes ? ', bytes' : ''}), needed by ${consumers.join(', ')}: ${error.message}`,
        ),
      ].join('\n'),
    );
  }
}
