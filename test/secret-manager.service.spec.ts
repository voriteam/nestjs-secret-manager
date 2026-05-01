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
