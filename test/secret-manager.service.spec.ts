import { Test, TestingModule } from '@nestjs/testing';

import {
  InMemorySecretBackend,
  SecretManagerService,
  SecretNotFoundError,
} from '../src';
import { SECRET_MANAGER_OPTIONS, secretRegistry } from '../src/testing';

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
            validateOnStartup: false,
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

  describe('getLatest', () => {
    it('should retrieve the latest version of a secret', async () => {
      const value = await service.getLatest({ name: 'api-key' });
      expect(value).toBe('test-api-key-value');
    });
  });

  describe('custom backends', () => {
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
              validateOnStartup: false,
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

describe('SecretManagerService with validation', () => {
  beforeEach(() => {
    secretRegistry.clear();
  });

  afterEach(() => {
    secretRegistry.clear();
  });

  it('should validate secrets on startup when enabled', async () => {
    secretRegistry.register('api-key');

    const module = await Test.createTestingModule({
      providers: [
        SecretManagerService,
        {
          provide: SECRET_MANAGER_OPTIONS,
          useValue: {
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend({ 'api-key': 'value' })],
            validateOnStartup: true,
          },
        },
      ],
    }).compile();

    await module.init();
    await module.close();
  });

  it('should fail startup when secret is missing', async () => {
    secretRegistry.register('missing-secret');

    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [new InMemorySecretBackend()],
      validateOnStartup: true,
    });

    await expect(service.onModuleInit()).rejects.toThrow(
      /Failed to validate 1 secret[\s\S]*missing-secret/,
    );
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
            validateOnStartup: false,
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
      validateOnStartup: false,
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

  it('treats cacheTTL: 0 as never-expire (escape hatch)', async () => {
    const backend = new InMemorySecretBackend({ 'api-key': 'v1' });
    const service = new SecretManagerService({
      defaultBackend: 'memory',
      backends: [backend],
      validateOnStartup: false,
      cacheTTL: 0,
    });

    expect(await service.get({ name: 'api-key' })).toBe('v1');

    backend.set('api-key', 'v2');
    jest.advanceTimersByTime(24 * 60 * 60 * 1000); // a day
    expect(await service.get({ name: 'api-key' })).toBe('v1');
  });
});
