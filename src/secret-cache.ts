import type { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';

const REDACTED = '[SecretCache redacted]';

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

export enum CacheRetention {
  Never = 'never',
  Forever = 'forever',
  Ttl = 'ttl',
}

export type CachePolicy =
  | { readonly retention: CacheRetention.Never }
  | { readonly retention: CacheRetention.Forever }
  | { readonly retention: CacheRetention.Ttl; readonly ttlMs: number };

export function cachePolicyFrom({
  cacheEnabled,
  cacheTTL,
}: Pick<SecretManagerModuleOptions, 'cacheEnabled' | 'cacheTTL'>): CachePolicy {
  if (cacheEnabled === false) {
    return { retention: CacheRetention.Never };
  }
  if (cacheTTL === undefined) {
    return { retention: CacheRetention.Ttl, ttlMs: DEFAULT_CACHE_TTL_MS };
  }
  if (cacheTTL === 0) {
    return { retention: CacheRetention.Forever };
  }
  if (!Number.isFinite(cacheTTL) || cacheTTL < 0) {
    throw new Error(
      `Invalid cacheTTL: ${cacheTTL}. Must be a non-negative finite number (or 0 / undefined).`,
    );
  }
  return { retention: CacheRetention.Ttl, ttlMs: cacheTTL };
}

export interface SecretAddress {
  readonly backend: string;
  readonly name: string;
  readonly version: string;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly cachedAt: number;
}

export class SecretCache<T> {
  readonly #policy: CachePolicy;
  readonly #copy: (value: T) => T;
  readonly #values = new Map<string, CacheEntry<T>>();
  readonly #inFlight = new Map<string, Promise<T>>();
  #generation = 0;

  constructor(policy: CachePolicy, copy: (value: T) => T = (value) => value) {
    this.#policy = policy;
    this.#copy = copy;
  }

  async read(address: SecretAddress, load: () => Promise<T>): Promise<T> {
    const key = `${address.backend}:${address.name}:${address.version}`;
    const hit = this.#fresh(key);
    if (hit !== undefined) {
      return this.#copy(hit);
    }

    let pending = this.#inFlight.get(key);
    if (pending === undefined) {
      const generation = this.#generation;
      const fetched = (async () => {
        const owned = this.#copy(await load());
        if (generation === this.#generation) {
          this.#store(key, owned);
        }
        return owned;
      })().finally(() => {
        const ownsKey = this.#inFlight.get(key) === fetched;
        if (ownsKey) {
          this.#inFlight.delete(key);
        }
      });
      this.#inFlight.set(key, fetched);
      pending = fetched;
    }
    return this.#copy(await pending);
  }

  clear(): void {
    this.#values.clear();
    this.#inFlight.clear();
    this.#generation += 1;
  }

  #fresh(key: string): T | undefined {
    const entry = this.#values.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (
      this.#policy.retention === CacheRetention.Ttl &&
      Date.now() - entry.cachedAt > this.#policy.ttlMs
    ) {
      this.#values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  #store(key: string, value: T): void {
    if (this.#policy.retention !== CacheRetention.Never) {
      this.#values.set(key, { value, cachedAt: Date.now() });
    }
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
