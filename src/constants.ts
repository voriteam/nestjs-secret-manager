import { InjectSecretOptions } from './interfaces/secret-manager-options.interface';

/**
 * Injection token for the SecretManagerModuleOptions.
 */
export const SECRET_MANAGER_OPTIONS = Symbol('SECRET_MANAGER_OPTIONS');

/**
 * Prefix for string-typed secret injection tokens (`@InjectSecret`).
 */
export const SECRET_TOKEN_PREFIX = 'SECRET';

/**
 * Prefix for bytes-typed secret injection tokens (`@InjectSecretBytes`).
 */
export const SECRET_BYTES_TOKEN_PREFIX = 'SECRET_BYTES';

/**
 * How a consumer asked to receive a secret, through `@InjectSecret` (string)
 * or `@InjectSecretBytes` (bytes).
 */
export enum SecretKind {
  String = 'string',
  Bytes = 'bytes',
}

export function unknownSecretKind(kind: never): never {
  throw new Error(`Unknown secret kind: '${String(kind)}'`);
}

/**
 * One `@InjectSecret` / `@InjectSecretBytes` declaration.
 */
export interface SecretRequirement {
  readonly name: string;
  readonly version?: string;
  readonly backend?: string;
  /** The injection token (kind-specific). */
  readonly token: string;
  readonly kind: SecretKind;
}

/**
 * Every secret a decorator has declared in this process, filled at decorator
 * evaluation time. The module creates one accessor provider per entry.
 */
class SecretRegistry {
  private readonly secrets = new Map<string, SecretRequirement>();

  /**
   * Register a secret requirement. Idempotent on (name, version, backend, kind).
   */
  register(
    name: string,
    options?: InjectSecretOptions,
    kind: SecretKind = SecretKind.String,
  ): SecretRequirement {
    const token = [
      tokenPrefix(kind),
      options?.backend ?? 'default',
      name,
      options?.version ?? 'latest',
    ].join('_');
    const existing = this.secrets.get(token);
    if (existing) {
      return existing;
    }

    const requirement: SecretRequirement = {
      name,
      version: options?.version,
      backend: options?.backend,
      token,
      kind,
    };

    this.secrets.set(token, requirement);
    return requirement;
  }

  /**
   * The requirement registered under an injection token, if any.
   */
  get(token: string): SecretRequirement | undefined {
    return this.secrets.get(token);
  }

  /**
   * Get all registered secrets.
   */
  getAll(): SecretRequirement[] {
    return Array.from(this.secrets.values());
  }

  /**
   * Clear all registered secrets.
   * Useful for testing.
   */
  clear(): void {
    this.secrets.clear();
  }

  /**
   * Get the number of registered secrets.
   */
  get size(): number {
    return this.secrets.size;
  }
}

// Global singleton registry
export const secretRegistry = new SecretRegistry();

function tokenPrefix(kind: SecretKind): string {
  switch (kind) {
    case SecretKind.String:
      return SECRET_TOKEN_PREFIX;
    case SecretKind.Bytes:
      return SECRET_BYTES_TOKEN_PREFIX;
    default:
      return unknownSecretKind(kind);
  }
}
