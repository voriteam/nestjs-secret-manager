/**
 * Error thrown when access to a secret is denied.
 */
export class SecretAccessDeniedError extends Error {
  public readonly name = 'SecretAccessDeniedError';

  constructor(
    public readonly secretName: string,
    public readonly backend: string,
    public readonly reason?: string,
  ) {
    const reasonInfo = reason ? `: ${reason}` : '';
    super(
      `Access denied to secret '${secretName}' in backend '${backend}'${reasonInfo}`,
    );
  }
}
