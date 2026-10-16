import { CacheRetention, SecretCache } from '../src/secret-cache';
import type { CachePolicy } from '../src/secret-cache';

const address = { backend: 'gcp', name: 'api-key', version: 'latest' };
const forever: CachePolicy = { retention: CacheRetention.Forever };
const never: CachePolicy = { retention: CacheRetention.Never };

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('SecretCache', () => {
  describe('read', () => {
    it('loads on a miss and serves the stored value afterwards', async () => {
      const cache = new SecretCache<string>(forever);
      const loads: string[] = [];

      const first = await cache.read(address, async () => {
        loads.push('first');
        return 'v1';
      });
      const second = await cache.read(address, async () => {
        loads.push('second');
        return 'v2';
      });

      expect([first, second]).toEqual(['v1', 'v1']);
      expect(loads).toEqual(['first']);
    });

    it('keeps backends, names and versions apart', async () => {
      const cache = new SecretCache<string>(forever);
      const addresses = [
        address,
        { ...address, backend: 'memory' },
        { ...address, name: 'other' },
        { ...address, version: '2' },
      ];

      for (const [i, a] of addresses.entries()) {
        await cache.read(a, async () => `value-${i}`);
      }
      const values = await Promise.all(
        addresses.map((a) => cache.read(a, async () => 'reloaded')),
      );

      expect(values).toEqual(['value-0', 'value-1', 'value-2', 'value-3']);
    });

    it.each([
      ['Forever', forever],
      ['Never', never],
    ])('shares one load among concurrent misses (%s)', async (_, policy) => {
      const cache = new SecretCache<string>(policy);
      let loads = 0;

      const values = await Promise.all(
        Array.from({ length: 5 }, () =>
          cache.read(address, async () => {
            loads += 1;
            return 'value';
          }),
        ),
      );

      expect(values).toEqual(Array(5).fill('value'));
      expect(loads).toBe(1);
    });

    it('stores nothing under Never retention', async () => {
      const cache = new SecretCache<string>(never);
      const loads: string[] = [];

      await cache.read(address, async () => {
        loads.push('first');
        return 'v1';
      });
      const second = await cache.read(address, async () => {
        loads.push('second');
        return 'v2';
      });

      expect(second).toBe('v2');
      expect(loads).toEqual(['first', 'second']);
    });

    it('rejects every joiner of a failed load and never stores the failure', async () => {
      const cache = new SecretCache<string>(forever);
      let loads = 0;
      const failing = async (): Promise<string> => {
        loads += 1;
        throw new Error('backend down');
      };

      const settled = await Promise.allSettled([
        cache.read(address, failing),
        cache.read(address, failing),
      ]);

      expect(settled).toEqual([
        { status: 'rejected', reason: new Error('backend down') },
        { status: 'rejected', reason: new Error('backend down') },
      ]);
      expect(loads).toBe(1);
      await expect(cache.read(address, async () => 'recovered')).resolves.toBe(
        'recovered',
      );
    });

    it('turns a synchronous throw from load into a rejection', async () => {
      const cache = new SecretCache<string>(forever);

      await expect(
        cache.read(address, () => {
          throw new Error('sync failure');
        }),
      ).rejects.toThrow('sync failure');
      await expect(cache.read(address, async () => 'next')).resolves.toBe(
        'next',
      );
    });

    it('hands every caller its own copy and keeps the stored copy private', async () => {
      const cache = new SecretCache<Uint8Array>(
        forever,
        (bytes) => new Uint8Array(bytes),
      );
      const source = new Uint8Array([1, 2, 3]);

      const [x, y] = await Promise.all([
        cache.read(address, async () => source),
        cache.read(address, async () => source),
      ]);
      x.fill(0);
      source.fill(9);

      expect([...y]).toEqual([1, 2, 3]);
      expect([
        ...(await cache.read(address, async () => new Uint8Array())),
      ]).toEqual([1, 2, 3]);
    });
  });

  describe('clear', () => {
    it('empties stored values', async () => {
      const cache = new SecretCache<string>(forever);
      await cache.read(address, async () => 'v1');

      cache.clear();

      await expect(cache.read(address, async () => 'v2')).resolves.toBe('v2');
    });

    it('lets an earlier load answer its callers without storing or evicting a newer load', async () => {
      const cache = new SecretCache<string>(forever);
      const beforeLoad = deferred<string>();
      const afterLoad = deferred<string>();
      let loads = 0;

      const before = cache.read(address, () => {
        loads += 1;
        return beforeLoad.promise;
      });
      cache.clear();
      const after = cache.read(address, () => {
        loads += 1;
        return afterLoad.promise;
      });

      beforeLoad.resolve('stale');
      await expect(before).resolves.toBe('stale');

      const joiner = cache.read(address, async () => {
        loads += 1;
        return 'third';
      });
      afterLoad.resolve('fresh');

      await expect(after).resolves.toBe('fresh');
      await expect(joiner).resolves.toBe('fresh');
      await expect(cache.read(address, async () => 'unused')).resolves.toBe(
        'fresh',
      );
      expect(loads).toBe(2);
    });
  });

  describe('TTL', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('reloads once an entry is older than the TTL', async () => {
      const cache = new SecretCache<string>({
        retention: CacheRetention.Ttl,
        ttlMs: 1000,
      });
      await cache.read(address, async () => 'v1');

      jest.advanceTimersByTime(1000);
      const withinTtl = await cache.read(address, async () => 'v2');
      jest.advanceTimersByTime(1);
      const pastTtl = await cache.read(address, async () => 'v3');

      expect([withinTtl, pastTtl]).toEqual(['v1', 'v3']);
    });
  });

  describe('redaction', () => {
    it('toJSON returns a redacted placeholder', async () => {
      const cache = new SecretCache<string>(forever);
      await cache.read(address, async () => 'super-secret-value');

      expect(JSON.stringify({ cache })).toBe(
        '{"cache":"[SecretCache redacted]"}',
      );
    });

    it('util.inspect.custom hides contents from console.log / loggers', async () => {
      const cache = new SecretCache<string>(forever);
      await cache.read(address, async () => 'super-secret-value');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { inspect } = require('node:util') as typeof import('node:util');

      expect(inspect(cache)).toBe('[SecretCache redacted]');
    });

    it('exposes no enumerable state', async () => {
      const cache = new SecretCache<string>(forever);
      await cache.read(address, async () => 'super-secret-value');

      expect(Object.keys(cache)).toEqual([]);
    });
  });
});
