import { Injectable, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import {
  InMemorySecretBackend,
  InjectSecret,
  InjectSecretBytes,
  SecretManagerModule,
  SecretManagerService,
  SecretNotFoundError,
} from '../src';
import type {
  SecretAccessor,
  SecretBackend,
  SecretBytesAccessor,
} from '../src';
import { SECRET_MANAGER_OPTIONS, secretRegistry } from '../src/testing';
import { CountingBackend } from './support/counting-backend';

describe('SecretManagerService', () => {
  let service: SecretManagerService;
  let module: TestingModule;
  let memoryBackend: InMemorySecretBackend;

  beforeEach(async () => {
    secretRegistry.clear();

    memoryBackend = new InMemorySecretBackend({
      'api-key': 'test-api-key-value',
      'db-password': 'test-db-password',
    });

    module = await Test.createTestingModule({
      providers: [
        SecretManagerService,
        {
          provide: SECRET_MANAGER_OPTIONS,
          useValue: {
            defaultBackend: 'memory',
            backends: [memoryBackend],
            cacheEnabled: true,
          },
        },
      ],
    }).compile();

    service = module.get<SecretManagerService>(SecretManagerService);
  });

  afterEach(async () => {
    await module.close();
    secretRegistry.clear();
  });

  describe('get', () => {
    it('should retrieve a secret from in-memory backend', async () => {
      const value = await service.get({ name: 'api-key' });
      expect(value).toBe('test-api-key-value');
    });

    it('should retrieve another secret', async () => {
      const value = await service.get({ name: 'db-password' });
      expect(value).toBe('test-db-password');
    });

    it('should throw SecretNotFoundError for non-existent secret', async () => {
      await expect(service.get({ name: 'non-existent' })).rejects.toThrow(
        SecretNotFoundError,
      );
    });

    it('should cache secret values', async () => {
      await service.get({ name: 'api-key' });

      memoryBackend.set('api-key', 'modified-value');

      const cachedValue = await service.get({ name: 'api-key' });
      expect(cachedValue).toBe('test-api-key-value');
    });

    it('should return fresh value after cache is cleared', async () => {
      await service.get({ name: 'api-key' });

      memoryBackend.set('api-key', 'modified-value');
      service.clearCache();

      const freshValue = await service.get({ name: 'api-key' });
      expect(freshValue).toBe('modified-value');
    });
  });

  describe('getBytes', () => {
    it('returns UTF-8 bytes for string-stored secrets', async () => {
      const bytes = await service.getBytes({ name: 'api-key' });
      expect(new TextDecoder().decode(bytes)).toBe('test-api-key-value');
    });

    it('preserves non-UTF-8 binary payloads', async () => {
      const binary = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0xff]);
      memoryBackend.set('signing-key', binary);
      expect(await service.getBytes({ name: 'signing-key' })).toEqual(binary);
    });

    it('caches the bytes view independently of the string view', async () => {
      // First fetch primes the bytes cache.
      await service.getBytes({ name: 'api-key' });

      // Mutate the underlying backend; cached bytes should still win.
      memoryBackend.set('api-key', 'mutated');
      const bytes = await service.getBytes({ name: 'api-key' });
      expect(new TextDecoder().decode(bytes)).toBe('test-api-key-value');
    });

    it('clearCache flushes both views', async () => {
      await service.get({ name: 'api-key' });
      await service.getBytes({ name: 'api-key' });
      memoryBackend.set('api-key', 'fresh');
      service.clearCache();

      expect(await service.get({ name: 'api-key' })).toBe('fresh');
      expect(
        new TextDecoder().decode(await service.getBytes({ name: 'api-key' })),
      ).toBe('fresh');
    });

    it('throws SecretNotFoundError for missing bytes', async () => {
      await expect(service.getBytes({ name: 'nope' })).rejects.toThrow(
        SecretNotFoundError,
      );
    });

    it('mutating returned bytes does not corrupt the cache', async () => {
      const first = await service.getBytes({ name: 'api-key' });
      first.fill(0); // attempt to corrupt
      const second = await service.getBytes({ name: 'api-key' });
      expect(new TextDecoder().decode(second)).toBe('test-api-key-value');
    });
  });

  describe('custom backends', () => {
    it('reads through a backend that implements only get and getBytes', async () => {
      const vault: SecretBackend = {
        name: 'vault',
        get: async (name, version) => `${name}@${version}`,
        getBytes: async (name) => new TextEncoder().encode(name),
      };
      const vaultService = new SecretManagerService({
        defaultBackend: 'vault',
        backends: [vault],
      });

      await expect(vaultService.get({ name: 'api-key' })).resolves.toBe(
        'api-key@latest',
      );
      expect(
        new TextDecoder().decode(await vaultService.getBytes({ name: 'blob' })),
      ).toBe('blob');
    });

    it('should resolve secrets from a non-default backend', async () => {
      const customBackend = new InMemorySecretBackend({
        'custom-secret': 'custom-value',
      });
      Object.defineProperty(customBackend, 'name', { value: 'custom' });

      const customModule = await Test.createTestingModule({
        providers: [
          SecretManagerService,
          {
            provide: SECRET_MANAGER_OPTIONS,
            useValue: {
              defaultBackend: 'memory',
              backends: [new InMemorySecretBackend(), customBackend],
            },
          },
        ],
      }).compile();
      const customService = customModule.get(SecretManagerService);

      const value = await customService.get({
        name: 'custom-secret',
        backend: 'custom',
      });
      expect(value).toBe('custom-value');

      await customModule.close();
    });
  });

  describe('unknown backend', () => {
    it('should throw error for unknown backend', async () => {
      await expect(
        service.get({ name: 'api-key', backend: 'unknown' }),
      ).rejects.toThrow("Unknown secret backend: 'unknown'");
    });
  });

  describe('redaction', () => {
    it('toJSON returns a redacted placeholder', async () => {
      await service.get({ name: 'api-key' });
      expect(JSON.stringify(service)).toBe('"[SecretManagerService redacted]"');
    });

    it('util.inspect hides internal state', async () => {
      await service.get({ name: 'api-key' });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { inspect } = require('node:util') as typeof import('node:util');
      const inspected = inspect(service);
      expect(inspected).toBe('[SecretManagerService redacted]');
      expect(inspected).not.toContain('test-api-key-value');
    });

    it('private fields are unreachable as properties', async () => {
      await service.get({ name: 'api-key' });
      const visible = Object.keys(service);
      expect(visible).not.toContain('cache');
      expect(visible).not.toContain('backends');
      expect(visible).not.toContain('options');
    });
  });
});

describe('SecretManagerService without caching', () => {
  let service: SecretManagerService;
  let module: TestingModule;
  let memoryBackend: InMemorySecretBackend;

  beforeEach(async () => {
    secretRegistry.clear();

    memoryBackend = new InMemorySecretBackend({ 'api-key': 'initial-value' });

    module = await Test.createTestingModule({
      providers: [
        SecretManagerService,
        {
          provide: SECRET_MANAGER_OPTIONS,
          useValue: {
            defaultBackend: 'memory',
            backends: [memoryBackend],
            cacheEnabled: false,
          },
        },
      ],
    }).compile();

    service = module.get<SecretManagerService>(SecretManagerService);
  });

  afterEach(async () => {
    await module.close();
    secretRegistry.clear();
  });

  it('should not cache when caching is disabled', async () => {
    await service.get({ name: 'api-key' });

    memoryBackend.set('api-key', 'modified-value');

    const value = await service.get({ name: 'api-key' });
    expect(value).toBe('modified-value');
  });
});

describe('SecretManagerService cacheTTL defaults', () => {
  beforeEach(() => {
    secretRegistry.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    secretRegistry.clear();
  });

  it('expires entries after the 15 min default when cacheTTL is unset', async () => {
    const backend = new InMemorySecretBackend({ 'api-key': 'v1' });
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
    });

    expect(await service.get({ name: 'api-key' })).toBe('v1');

    // Mutate the source. Cache hit means we still see v1.
    backend.set('api-key', 'v2');
    expect(await service.get({ name: 'api-key' })).toBe('v1');

    // 16 minutes later — past the default 15 min TTL — the cache entry
    // is expired and we re-fetch from the backend.
    jest.advanceTimersByTime(16 * 60 * 1000);
    expect(await service.get({ name: 'api-key' })).toBe('v2');
  });

  it('expires entries after an explicit cacheTTL', async () => {
    const backend = new InMemorySecretBackend({ 'api-key': 'v1' });
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
      cacheTTL: 1000,
    });

    expect(await service.get({ name: 'api-key' })).toBe('v1');
    backend.set('api-key', 'v2');
    jest.advanceTimersByTime(1000);
    expect(await service.get({ name: 'api-key' })).toBe('v1');
    jest.advanceTimersByTime(1);
    expect(await service.get({ name: 'api-key' })).toBe('v2');
  });

  it('treats cacheTTL: 0 as never-expire (escape hatch)', async () => {
    const backend = new InMemorySecretBackend({ 'api-key': 'v1' });
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
      cacheTTL: 0,
    });

    expect(await service.get({ name: 'api-key' })).toBe('v1');

    backend.set('api-key', 'v2');
    jest.advanceTimersByTime(24 * 60 * 60 * 1000); // a day
    expect(await service.get({ name: 'api-key' })).toBe('v1');
  });

  it.each([-1, -0.5, NaN, Infinity, -Infinity])(
    'rejects invalid cacheTTL: %p',
    (ttl) => {
      expect(
        () =>
          new SecretManagerService({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
            cacheTTL: ttl,
          }),
      ).toThrow(/Invalid cacheTTL/);
    },
  );
});

describe('SecretManagerService concurrent reads', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('makes one backend call for ten concurrent reads of a cold key', async () => {
    const backend = new CountingBackend({ 'api-key': 'value' });
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
    });

    const values = await Promise.all(
      Array.from({ length: 10 }, () => service.get({ name: 'api-key' })),
    );

    expect(values).toEqual(Array(10).fill('value'));
    expect(backend.calls).toEqual([['get', 'api-key', 'latest']]);
  });

  it('shares a rejected fetch with its joiners and retries on the next call', async () => {
    const backend = new CountingBackend();
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
    });

    const settled = await Promise.allSettled(
      Array.from({ length: 3 }, () => service.get({ name: 'api-key' })),
    );
    expect(settled.map(({ status }) => status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
    ]);
    expect(backend.calls).toEqual([['get', 'api-key', 'latest']]);

    backend.set('api-key', 'value');

    await expect(service.get({ name: 'api-key' })).resolves.toBe('value');
    expect(backend.calls).toEqual([
      ['get', 'api-key', 'latest'],
      ['get', 'api-key', 'latest'],
    ]);
  });

  it('does not cache a fetch that was in flight when clearCache ran', async () => {
    class DeferredBackend extends InMemorySecretBackend {
      readonly pending: ((value: string) => void)[] = [];

      override get(): Promise<string> {
        return new Promise((resolve) => this.pending.push(resolve));
      }
    }

    const backend = new DeferredBackend();
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
      cacheTTL: 0,
    });

    const beforeClear = service.get({ name: 'api-key' });
    service.clearCache();
    backend.pending[0]?.('stale');
    await expect(beforeClear).resolves.toBe('stale');

    const afterClear = service.get({ name: 'api-key' });
    expect(backend.pending).toHaveLength(2);
    backend.pending[1]?.('fresh');
    await expect(afterClear).resolves.toBe('fresh');
  });

  it('logs each backend fetch at debug level and no cache hits', async () => {
    const debug = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const backend = new InMemorySecretBackend({ 'api-key': 'value' });
    backend.set('api-key', 'v2', '2');
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
    });

    await service.get({ name: 'api-key' });
    await service.get({ name: 'api-key' });
    await service.getBytes({ name: 'api-key', version: '2' });

    expect(debug.mock.calls).toEqual([
      [
        {
          msg: 'Fetching secret',
          kind: 'string',
          backend: 'memory',
          name: 'api-key',
          version: 'latest',
        },
      ],
      [
        {
          msg: 'Fetching secret',
          kind: 'bytes',
          backend: 'memory',
          name: 'api-key',
          version: '2',
        },
      ],
    ]);
  });
});

describe('SecretManagerService with skipLoading', () => {
  it('returns a JSON placeholder naming the secret for string reads', async () => {
    const service = new SecretManagerService({ skipLoading: true });

    const value = await service.get({ name: 'api-key' });

    expect(JSON.parse(value)).toEqual({ _placeholder: true, key: 'api-key' });
  });

  it('returns the same placeholder UTF-8 encoded for bytes reads', async () => {
    const service = new SecretManagerService({ skipLoading: true });

    const bytes = await service.getBytes({ name: 'signing-key' });

    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
      _placeholder: true,
      key: 'signing-key',
    });
  });
});

describe('SecretManagerModule.forTesting with a fallback', () => {
  beforeEach(() => {
    secretRegistry.clear();
  });

  afterEach(() => {
    secretRegistry.clear();
  });

  it('serves unseeded names through the fallback', async () => {
    @Injectable()
    class ConsumerService {
      constructor(
        @InjectSecret('unseeded-key') readonly getKey: SecretAccessor,
        @InjectSecretBytes('unseeded-blob')
        readonly getBlob: SecretBytesAccessor,
      ) {}
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        SecretManagerModule.forTesting(
          { seeded: 'real' },
          { fallback: (name) => `fake-${name}` },
        ),
      ],
      providers: [ConsumerService],
    }).compile();
    await moduleRef.init();
    const service = moduleRef.get(SecretManagerService);
    const consumer = moduleRef.get(ConsumerService);

    await expect(service.get({ name: 'seeded' })).resolves.toBe('real');
    await expect(service.get({ name: 'seeded', version: '7' })).resolves.toBe(
      'fake-seeded',
    );
    await expect(consumer.getKey()).resolves.toBe('fake-unseeded-key');
    expect(new TextDecoder().decode(await consumer.getBlob())).toBe(
      'fake-unseeded-blob',
    );

    await moduleRef.close();
  });

  it('throws SecretNotFoundError for an unseeded name without a fallback', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SecretManagerModule.forTesting({ seeded: 'real' })],
    }).compile();
    const service = moduleRef.get(SecretManagerService);

    await expect(service.get({ name: 'seeded' })).resolves.toBe('real');
    await expect(service.get({ name: 'unseeded' })).rejects.toThrow(
      SecretNotFoundError,
    );

    await moduleRef.close();
  });
});
