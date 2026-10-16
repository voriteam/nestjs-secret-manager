import { SecretKind } from '../constants';

/** One injected secret that startup validation could not read. */
export interface SecretValidationFailure {
  readonly name: string;
  /** `'latest'` when the consumer pinned no version. */
  readonly version: string;
  /** The configured `defaultBackend` when the consumer named none. */
  readonly backend: string;
  /** Sorted and unique, the same strings as `InjectedSecret.consumers`. */
  readonly consumers: readonly string[];
  /** Why the read failed, usually SecretNotFoundError or SecretAccessDeniedError. */
  readonly error: Error;
}

/**
 * Thrown from `onModuleInit` under `StartupValidation.Enforce`. Under `Warn`
 * the module logs this error's message instead, so both modes print the same
 * list:
 *
 * ```
 * Failed to validate 2 injected secret(s):
 *   - payments-api-key (backend: gcp, version: latest), needed by BillingService, PaymentsController: Secret 'payments-api-key' not found in backend 'gcp' (version: latest)
 *   - signing-key (backend: gcp, version: 3, bytes), needed by TokenSigner: Access denied to secret 'signing-key' in backend 'gcp': ...
 * ```
 */
export class SecretValidationError extends Error {
  public readonly name = 'SecretValidationError';
  public readonly failures: readonly SecretValidationFailure[];

  constructor(
    failed: readonly {
      readonly failure: SecretValidationFailure;
      readonly kind: SecretKind;
    }[],
  ) {
    super(
      [
        `Failed to validate ${failed.length} injected secret(s):`,
        ...failed.map(
          ({ failure: { name, backend, version, consumers, error }, kind }) =>
            `  - ${name} (backend: ${backend}, version: ${version}${kind === SecretKind.Bytes ? ', bytes' : ''}), needed by ${consumers.join(', ')}: ${error.message}`,
        ),
      ].join('\n'),
    );
    this.failures = failed.map(({ failure }) => failure);
  }
}
