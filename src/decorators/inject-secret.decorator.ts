import { Inject } from '@nestjs/common';

import { secretRegistry } from '../constants';
import { InjectSecretOptions } from '../interfaces/secret-manager-options.interface';

/**
 * A function that fetches a secret on demand. The value is fetched
 * cache-first from the configured backend each time the accessor is called.
 *
 * `@InjectSecret` resolves to a `SecretAccessor` instead of a `string` so
 * the secret value never has to live as an instance field on the consumer
 * service. See the **Security considerations** section of the README for
 * the full rationale.
 */
export type SecretAccessor = () => Promise<string>;

/**
 * Parameter decorator to inject a lazy accessor for a secret.
 *
 * Resolves to a `() => Promise<string>` that fetches the secret on demand
 * (cache-first). Startup validation still applies — the secret is probed at
 * boot if `validateOnStartup` is enabled — so misconfigured access fails
 * fast even though no value is stored on the consumer.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class PartnerClient {
 *   constructor(
 *     @InjectSecret('partner-api-token')
 *     private readonly getPartnerToken: SecretAccessor,
 *   ) {}
 *
 *   async fetchInvoice(invoiceId: string) {
 *     const token = await this.getPartnerToken();
 *     return fetch(`https://api.partner.example.com/invoices/${invoiceId}`, {
 *       headers: { Authorization: `Bearer ${token}` },
 *     });
 *     // token goes out of scope here.
 *   }
 * }
 * ```
 */
export function InjectSecret(
  name: string,
  options?: InjectSecretOptions,
): ParameterDecorator {
  const requirement = secretRegistry.register(name, options, 'string');
  return Inject(requirement.token);
}

/**
 * A function that fetches a secret on demand and returns the raw bytes,
 * bypassing UTF-8 decoding. Use this for binary secrets such as private
 * keys, encryption keys, or signed binary blobs where decoding to a string
 * would be lossy.
 */
export type SecretBytesAccessor = () => Promise<Uint8Array>;

/**
 * Parameter decorator to inject a lazy accessor that returns a secret as
 * raw bytes (`Uint8Array`).
 *
 * Mirrors `@InjectSecret` in every other respect — the value is fetched
 * cache-first on each call and never lives as an instance field on the
 * consumer. Use this instead of `@InjectSecret` when the secret payload is
 * binary (e.g. PEM/DER private keys, AEAD keys, packed credential blobs).
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class TokenSigner {
 *   constructor(
 *     @InjectSecretBytes('signing-key')
 *     private readonly getSigningKey: SecretBytesAccessor,
 *   ) {}
 *
 *   async sign(payload: Uint8Array) {
 *     const key = await this.getSigningKey();
 *     // …use the key bytes (e.g. crypto.subtle.importKey(...))
 *   }
 * }
 * ```
 */
export function InjectSecretBytes(
  name: string,
  options?: InjectSecretOptions,
): ParameterDecorator {
  const requirement = secretRegistry.register(name, options, 'bytes');
  return Inject(requirement.token);
}
