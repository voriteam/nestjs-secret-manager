import { Inject } from '@nestjs/common';

import { SecretKind, secretRegistry } from '../constants';
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
 * The token `@InjectSecret(name, options)` injects, for a factory provider's
 * `inject` list. Startup validation probes the secret wherever the token is
 * injected.
 */
export function secretAccessorToken(
  name: string,
  options?: InjectSecretOptions,
): string {
  return secretRegistry.register(name, options, SecretKind.String).token;
}

/**
 * Injects a lazy accessor for a secret into a constructor parameter or a
 * property.
 *
 * Resolves to a `() => Promise<string>` that fetches the secret on demand
 * (cache-first). When Nest builds the decorated class, startup validation
 * probes the secret at boot unless `startupValidation` is `Off` or loading is
 * skipped, so misconfigured access fails fast even though no value is stored
 * on the consumer.
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
): PropertyDecorator & ParameterDecorator {
  return Inject(secretAccessorToken(name, options));
}

/**
 * A function that fetches a secret on demand and returns the raw bytes,
 * bypassing UTF-8 decoding. Use this for binary secrets such as private
 * keys, encryption keys, or signed binary blobs where decoding to a string
 * would be lossy.
 */
export type SecretBytesAccessor = () => Promise<Uint8Array<ArrayBuffer>>;

/** The token `@InjectSecretBytes(name, options)` injects. */
export function secretBytesAccessorToken(
  name: string,
  options?: InjectSecretOptions,
): string {
  return secretRegistry.register(name, options, SecretKind.Bytes).token;
}

/**
 * Injects a lazy accessor that returns a secret as raw bytes (`Uint8Array`)
 * into a constructor parameter or a property.
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
): PropertyDecorator & ParameterDecorator {
  return Inject(secretBytesAccessorToken(name, options));
}
