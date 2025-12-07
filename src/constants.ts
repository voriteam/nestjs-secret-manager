import { InjectSecretOptions } from './interfaces/secret-manager-options.interface';

/**
 * Injection token for the SecretManagerModuleOptions.
 */
export const SECRET_MANAGER_OPTIONS = Symbol('SECRET_MANAGER_OPTIONS');

/**
 * Prefix for secret injection tokens.
 */
export const SECRET_TOKEN_PREFIX = 'SECRET';

/**
 * Represents a registered secret requirement.
 */
export interface SecretRequirement {
  name: string;
  version?: string;
  backend?: string;
  token: string;
}

/**
 * Registry of all secrets that need to be validated at startup
 * and provided as injectable dependencies.
 */
class SecretRegistry {
  private readonly secrets = new Map<string, SecretRequirement>();

  /**
   * Register a secret requirement.
   */
  register(name: string, options?: InjectSecretOptions): SecretRequirement {
    const token = getSecretToken(name, options);
    const requirement: SecretRequirement = {
      name,
      version: options?.version,
      backend: options?.backend,
      token,
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
 * Generate a unique injection token for a secret.
 */
export function getSecretToken(
  name: string,
  options?: InjectSecretOptions,
): string {
  const backend = options?.backend ?? 'default';
  const version = options?.version ?? 'latest';
  return `${SECRET_TOKEN_PREFIX}_${backend}_${name}_${version}`;
}
