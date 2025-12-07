/**
 * Error thrown when a secret is not found in the backend.
 */
export class SecretNotFoundError extends Error {
  public readonly name = 'SecretNotFoundError';

  constructor(
    public readonly secretName: string,
    public readonly backend: string,
    public readonly version?: string,
  ) {
    const versionInfo = version ? ` (version: ${version})` : '';
    super(
      `Secret '${secretName}' not found in backend '${backend}'${versionInfo}`,
    );
  }
}
