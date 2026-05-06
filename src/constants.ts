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
 * The two payload kinds a registered secret can be exposed as.
 */
export type SecretInjectionKind = 'string' | 'bytes';

/**
 * Represents a registered secret requirement.
 */
export interface SecretRequirement {
  name: string;
  version?: string;
  backend?: string;
  /** The injection token (kind-specific). */
  token: string;
  /** Whether the consumer requested a string accessor or a bytes accessor. */
  kind: SecretInjectionKind;
}

/**
 * Registry of all secrets that need to be validated at startup
 * and provided as injectable dependencies.
 */
class SecretRegistry {
  private readonly secrets = new Map<string, SecretRequirement>();

  /**
   * Register a secret requirement. Idempotent on (name, version, backend, kind).
   */
  register(
    name: string,
    options?: InjectSecretOptions,
    kind: SecretInjectionKind = 'string',
  ): SecretRequirement {
    const token =
      kind === 'bytes'
        ? getSecretBytesToken(name, options)
        : getSecretToken(name, options);
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

/**
 * Generate a unique injection token for a string-typed secret.
 */
export function getSecretToken(
  name: string,
  options?: InjectSecretOptions,
): string {
  const backend = options?.backend ?? 'default';
  const version = options?.version ?? 'latest';
  return `${SECRET_TOKEN_PREFIX}_${backend}_${name}_${version}`;
}

/**
 * Generate a unique injection token for a bytes-typed secret.
 */
export function getSecretBytesToken(
  name: string,
  options?: InjectSecretOptions,
): string {
  const backend = options?.backend ?? 'default';
  const version = options?.version ?? 'latest';
  return `${SECRET_BYTES_TOKEN_PREFIX}_${backend}_${name}_${version}`;
}
