import { SecretNotFoundError } from '../errors/secret-not-found.error';
import { SecretBackend } from '../interfaces/secret-backend.interface';

/**
 * In-memory backend for testing and local development.
 *
 * Secrets can be preloaded via the constructor or set dynamically
 * using the `set()` method.
 */
export class InMemorySecretBackend implements SecretBackend {
  readonly name = 'memory';

  // Map of secret name -> Map of version -> value
  private readonly secrets = new Map<string, Map<string, string>>();

  /**
   * Create an in-memory backend with optional initial secrets.
   *
   * @param initialSecrets - Map of secret names to values (stored as 'latest' version)
   */
  constructor(initialSecrets?: Record<string, string>) {
    if (initialSecrets) {
      for (const [name, value] of Object.entries(initialSecrets)) {
        this.set(name, value);
      }
    }
  }

  /**
   * Set a secret value.
   *
   * @param name - Secret name
   * @param value - Secret value
   * @param version - Version identifier (defaults to 'latest')
   */
  set(name: string, value: string, version = 'latest'): void {
    if (!this.secrets.has(name)) {
      this.secrets.set(name, new Map());
    }
    this.secrets.get(name)!.set(version, value);
  }

  async get(name: string, version?: string): Promise<string> {
    const secretVersions = this.secrets.get(name);

    if (!secretVersions) {
      throw new SecretNotFoundError(name, this.name, version);
    }

    const versionId = version ?? 'latest';
    const value = secretVersions.get(versionId);

    if (value === undefined) {
      throw new SecretNotFoundError(name, this.name, version);
    }

    return value;
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name, 'latest');
  }

  /**
   * Check if a secret exists.
   *
   * @param name - Secret name
   * @param version - Version identifier (defaults to 'latest')
   * @returns True if the secret exists
   */
  has(name: string, version = 'latest'): boolean {
    const secretVersions = this.secrets.get(name);
    return secretVersions?.has(version) ?? false;
  }

  /**
   * Delete a secret.
   *
   * @param name - Secret name
   * @param version - Version to delete, or undefined to delete all versions
   * @returns True if something was deleted
   */
  delete(name: string, version?: string): boolean {
    if (version === undefined) {
      return this.secrets.delete(name);
    }

    const secretVersions = this.secrets.get(name);
    if (!secretVersions) {
      return false;
    }

    const deleted = secretVersions.delete(version);

    // Clean up empty version maps
    if (secretVersions.size === 0) {
      this.secrets.delete(name);
    }

    return deleted;
  }

  /**
   * Clear all secrets.
   */
  clear(): void {
    this.secrets.clear();
  }

  /**
   * Get the number of secrets stored.
   */
  get size(): number {
    return this.secrets.size;
  }

  /**
   * Get all secret names.
   */
  getSecretNames(): string[] {
    return Array.from(this.secrets.keys());
  }
}
