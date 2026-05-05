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

  private async fetchPayload(
    name: string,
    version?: string,
  ): Promise<Buffer | Uint8Array | string> {
    const versionId = version ?? 'latest';
    const secretPath = `projects/${this.projectId}/secrets/${name}/versions/${versionId}`;

    try {
      this.logger.debug(
        `Fetching secret from GCP: ${name} (version: ${versionId})`,
      );

      const [response] = await this.client.accessSecretVersion({
        name: secretPath,
      });

      const payload = response.payload?.data;

      if (!payload) {
        throw new SecretNotFoundError(name, this.name, version);
      }

      return payload;
    } catch (error: unknown) {
      if (error instanceof SecretNotFoundError) {
        throw error;
      }

      // gRPC status codes: 5 = NOT_FOUND, 7 = PERMISSION_DENIED
      const grpcError = error as { code?: number; message?: string };

      if (grpcError.code === 5) {
        throw new SecretNotFoundError(name, this.name, version);
      }

      if (grpcError.code === 7) {
        throw new SecretAccessDeniedError(name, this.name, grpcError.message);
      }

      this.logger.error(
        `Unexpected error fetching secret '${name}': ${grpcError.message}`,
        error,
      );
      throw error;
    }
  }

  async get(name: string, version?: string): Promise<string> {
    const payload = await this.fetchPayload(name, version);
    return typeof payload === 'string'
      ? payload
      : Buffer.from(payload).toString('utf-8');
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name, 'latest');
  }

  async getBytes(name: string, version?: string): Promise<Uint8Array> {
    const payload = await this.fetchPayload(name, version);
    if (typeof payload === 'string') {
      return new TextEncoder().encode(payload);
    }
    // Buffer is already a Uint8Array; return without re-allocation.
    return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  }

  async getLatestBytes(name: string): Promise<Uint8Array> {
    return this.getBytes(name, 'latest');
  }
}
