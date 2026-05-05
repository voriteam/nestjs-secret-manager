import { SecretNotFoundError } from '../errors/secret-not-found.error';
import { SecretBackend } from '../interfaces/secret-backend.interface';

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
const utf8Encoder = new TextEncoder();

/**
 * In-memory backend for testing and local development.
 *
 * Stores secrets natively as bytes; string values are encoded as UTF-8 on
 * `set` and decoded on `get`. Pass `Uint8Array` (or `Buffer`) directly to
 * preserve binary data.
 */
export class InMemorySecretBackend implements SecretBackend {
  readonly name = 'memory';

  // Map of secret name -> Map of version -> bytes
  private readonly secrets = new Map<string, Map<string, Uint8Array>>();

  /**
   * Create an in-memory backend with optional initial secrets.
   *
   * @param initialSecrets - Map of secret names to values (string or bytes;
   *   stored as the 'latest' version).
   */
  constructor(initialSecrets?: Record<string, string | Uint8Array>) {
    if (initialSecrets) {
      for (const [name, value] of Object.entries(initialSecrets)) {
        this.set(name, value);
      }
    }
  }

  /**
   * Set a secret value. Strings are encoded as UTF-8.
   */
  set(name: string, value: string | Uint8Array, version = 'latest'): void {
    if (!this.secrets.has(name)) {
      this.secrets.set(name, new Map());
    }
    const bytes = typeof value === 'string' ? utf8Encoder.encode(value) : value;
    this.secrets.get(name)!.set(version, bytes);
  }

  private getRaw(name: string, version?: string): Uint8Array {
    const versions = this.secrets.get(name);
    if (!versions) {
      throw new SecretNotFoundError(name, this.name, version);
    }
    const versionId = version ?? 'latest';
    const value = versions.get(versionId);
    if (value === undefined) {
      throw new SecretNotFoundError(name, this.name, version);
    }
    return value;
  }

  async get(name: string, version?: string): Promise<string> {
    return utf8Decoder.decode(this.getRaw(name, version));
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name, 'latest');
  }

  async getBytes(name: string, version?: string): Promise<Uint8Array> {
    return this.getRaw(name, version);
  }

  async getLatestBytes(name: string): Promise<Uint8Array> {
    return this.getBytes(name, 'latest');
  }

  /**
   * Check if a secret exists.
   */
  has(name: string, version = 'latest'): boolean {
    return this.secrets.get(name)?.has(version) ?? false;
  }

  /**
   * Delete a secret.
   *
   * @param version - Version to delete, or undefined to delete all versions.
   * @returns True if something was deleted.
   */
  delete(name: string, version?: string): boolean {
    if (version === undefined) {
      return this.secrets.delete(name);
    }

    const versions = this.secrets.get(name);
    if (!versions) {
      return false;
    }

    const deleted = versions.delete(version);
    if (versions.size === 0) {
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
