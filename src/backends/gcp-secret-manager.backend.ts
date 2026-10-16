import { Logger } from '@nestjs/common';

import { SecretAccessDeniedError } from '../errors/secret-access-denied.error';
import { SecretNotFoundError } from '../errors/secret-not-found.error';
import { SecretBackend } from '../interfaces/secret-backend.interface';

/**
 * The one client call this backend makes. The clients of both supported
 * majors (5.x and 6.x) satisfy it.
 */
interface SecretVersionClient {
  accessSecretVersion(request: {
    name: string;
  }): Promise<
    [{ payload?: { data?: Uint8Array | string | null } | null }, ...unknown[]]
  >;
}

const GCP_PEER = '@google-cloud/secret-manager';

/**
 * Loads the optional peer when a GCP backend is constructed, so an
 * application that never builds one does not need it installed. The
 * `typeof import(...)` annotation is erased, so neither the emitted JS nor
 * the emitted typings reference the peer.
 */
function loadSecretVersionClient(projectId: string): SecretVersionClient {
  let sdk: typeof import('@google-cloud/secret-manager');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred so the peer stays optional
    sdk = require('@google-cloud/secret-manager');
  } catch (cause) {
    const missing =
      (cause as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND' &&
      String((cause as Error).message).startsWith(
        `Cannot find module '${GCP_PEER}'`,
      );
    if (!missing) {
      throw cause;
    }
    throw new Error(
      `GcpSecretManagerBackend needs the optional peer dependency ${GCP_PEER} (^5 || ^6). Install it beside @vori/nestjs-secret-manager.`,
      { cause },
    );
  }
  return new sdk.SecretManagerServiceClient({ projectId });
}

/**
 * Backend implementation for Google Cloud Secret Manager.
 *
 * Uses Application Default Credentials (ADC) for authentication.
 * No explicit credentials configuration is needed when running on GCP.
 */
export class GcpSecretManagerBackend implements SecretBackend {
  readonly name = 'gcp';
  readonly #client: SecretVersionClient;
  private readonly logger = new Logger(GcpSecretManagerBackend.name);

  /** @throws if the optional peer `@google-cloud/secret-manager` is not installed. */
  constructor(private readonly projectId: string) {
    this.#client = loadSecretVersionClient(projectId);
  }

  private async fetchPayload(
    name: string,
    version?: string,
  ): Promise<Uint8Array | string> {
    const versionId = version ?? 'latest';
    const secretPath = `projects/${this.projectId}/secrets/${name}/versions/${versionId}`;

    try {
      const [response] = await this.#client.accessSecretVersion({
        name: secretPath,
      });

      const payload = response.payload?.data;

      // Distinguish "absent" from "empty" — an empty string/buffer is a
      // legitimate (if unusual) secret payload and must not be reported as
      // missing.
      if (payload == null) {
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

  async getBytes(name: string, version?: string): Promise<Uint8Array> {
    const payload = await this.fetchPayload(name, version);
    if (typeof payload === 'string') {
      return new TextEncoder().encode(payload);
    }
    return payload;
  }
}
