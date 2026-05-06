/**
 * Interface for secret storage backends.
 *
 * Implement this interface to add support for additional secret providers
 * (e.g., AWS Secrets Manager, HashiCorp Vault, Azure Key Vault).
 */
export interface SecretBackend {
  /**
   * Unique name identifying this backend.
   * Used as part of the cache key and for logging.
   */
  readonly name: string;

  /**
   * Fetch a secret by name and optional version.
   *
   * @param name - The secret name/identifier
   * @param version - Optional version (defaults to 'latest')
   * @returns The secret value as a string
   * @throws SecretNotFoundError if the secret doesn't exist
   * @throws SecretAccessDeniedError if access is denied
   */
  get(name: string, version?: string): Promise<string>;

  /**
   * Fetch the latest version of a secret.
   * Convenience method equivalent to `get(name, 'latest')`.
   *
   * @param name - The secret name/identifier
   * @returns The secret value as a string
   */
  getLatest(name: string): Promise<string>;

  /**
   * Fetch a secret as raw bytes. Use this for binary secrets (e.g.,
   * private keys, encryption material) where UTF-8 decoding would be lossy.
   *
   * @param name - The secret name/identifier
   * @param version - Optional version (defaults to 'latest')
   * @returns The secret value as a Uint8Array
   * @throws SecretNotFoundError if the secret doesn't exist
   * @throws SecretAccessDeniedError if access is denied
   */
  getBytes(name: string, version?: string): Promise<Uint8Array>;

  /**
   * Fetch the latest version of a secret as raw bytes.
   * Convenience method equivalent to `getBytes(name, 'latest')`.
   */
  getLatestBytes(name: string): Promise<Uint8Array>;
}
