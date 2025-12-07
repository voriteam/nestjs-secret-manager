import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Logger } from '@nestjs/common';

import { SecretAccessDeniedError } from '../errors/secret-access-denied.error';
import { SecretNotFoundError } from '../errors/secret-not-found.error';
import { SecretBackend } from '../interfaces/secret-backend.interface';

/**
 * Backend implementation for Google Cloud Secret Manager.
 *
 * Uses Application Default Credentials (ADC) for authentication.
 * No explicit credentials configuration is needed when running on GCP.
 */
export class GcpSecretManagerBackend implements SecretBackend {
  readonly name = 'gcp';
  private readonly client: SecretManagerServiceClient;
  private readonly logger = new Logger(GcpSecretManagerBackend.name);

  constructor(private readonly projectId: string) {
    this.client = new SecretManagerServiceClient({ projectId });
  }

  async get(name: string, version?: string): Promise<string> {
    const versionId = version ?? 'latest';
    const secretPath = `projects/${this.projectId}/secrets/${name}/versions/${versionId}`;
    let payload;

    try {
      this.logger.debug(
        `Fetching secret from GCP: ${name} (version: ${versionId})`,
      );

      const [response] = await this.client.accessSecretVersion({
        name: secretPath,
      });

      payload = response.payload?.data;
    } catch (error: unknown) {
      // Handle gRPC errors from GCP
      const grpcError = error as { code?: number; message?: string };

      // gRPC status codes:
      // 5 = NOT_FOUND
      // 7 = PERMISSION_DENIED
      if (grpcError.code === 5) {
        throw new SecretNotFoundError(name, this.name, version);
      }

      if (grpcError.code === 7) {
        throw new SecretAccessDeniedError(name, this.name, grpcError.message);
      }

      // Log and re-throw unexpected errors
      this.logger.error(
        `Unexpected error fetching secret '${name}': ${grpcError.message}`,
        error,
      );
      throw error;
    }

    if (!payload) {
      throw new SecretNotFoundError(name, this.name, version);
    }

    // Handle both Buffer and Uint8Array
    const value =
      typeof payload === 'string'
        ? payload
        : Buffer.from(payload).toString('utf-8');

    return value;
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name, 'latest');
  }
}
