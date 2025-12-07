import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  InjectSecret,
  SecretManagerModule,
  SecretManagerService,
} from '../../src';
import { secretRegistry } from '../../src/testing';

describe('SecretManagerModule (e2e)', () => {
  beforeEach(() => {
    secretRegistry.clear();
  });

  afterEach(() => {
    secretRegistry.clear();
  });

  describe('forRoot', () => {
    it('should configure the module with static options', async () => {
      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            inMemorySecrets: {
              'test-secret': 'test-value',
            },
            validateOnStartup: false,
          }),
        ],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'test-secret' });

      expect(value).toBe('test-value');

      await module.close();
    });
  });

  describe('forTesting', () => {
    it('should configure the module for testing', async () => {
      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forTesting({
            'api-key': 'test-api-key',
            'db-password': 'test-password',
          }),
        ],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);

      expect(await service.get({ name: 'api-key' })).toBe('test-api-key');
      expect(await service.get({ name: 'db-password' })).toBe('test-password');

      await module.close();
    });

    it('should work with empty secrets', async () => {
      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forTesting()],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);
      expect(service).toBeDefined();

      await module.close();
    });
  });

  describe('service injection', () => {
    it('should inject SecretManagerService into other services', async () => {
      @Injectable()
      class TestService {
        constructor(private readonly secretManager: SecretManagerService) {}

        async getApiKey() {
          return this.secretManager.get({ name: 'api-key' });
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forTesting({
            'api-key': 'injected-api-key',
          }),
        ],
        providers: [TestService],
      }).compile();

      const testService = module.get<TestService>(TestService);
      const apiKey = await testService.getApiKey();

      expect(apiKey).toBe('injected-api-key');

      await module.close();
    });
  });

  describe('forRootAsync', () => {
    it('should configure the module with async options', async () => {
      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRootAsync({
            useFactory: () => ({
              defaultBackend: 'memory',
              inMemorySecrets: {
                'async-secret': 'async-value',
              },
              validateOnStartup: false,
            }),
          }),
        ],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'async-secret' });

      expect(value).toBe('async-value');

      await module.close();
    });

    it('should support injected dependencies via extraProviders', async () => {
      const CONFIG_TOKEN = 'CONFIG';

      @Module({
        providers: [
          {
            provide: CONFIG_TOKEN,
            useValue: { projectId: 'test-project' },
          },
        ],
        exports: [CONFIG_TOKEN],
      })
      class ConfigModule {}

      const module = await Test.createTestingModule({
        imports: [
          ConfigModule,
          SecretManagerModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (config: { projectId: string }) => ({
              defaultBackend: 'memory',
              inMemorySecrets: {
                'project-secret': config.projectId,
              },
              validateOnStartup: false,
            }),
            inject: [CONFIG_TOKEN],
          }),
        ],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'project-secret' });

      expect(value).toBe('test-project');

      await module.close();
    });
  });

  describe('global module', () => {
    it('should be available globally without re-importing', async () => {
      @Injectable()
      class ChildService {
        constructor(private readonly secretManager: SecretManagerService) {}

        async getSecret(name: string) {
          return this.secretManager.get({ name });
        }
      }

      @Module({
        providers: [ChildService],
        exports: [ChildService],
      })
      class ChildModule {}

      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forTesting({
            'global-secret': 'global-value',
          }),
          ChildModule,
        ],
      }).compile();

      const childService = module.get<ChildService>(ChildService);
      const value = await childService.getSecret('global-secret');

      expect(value).toBe('global-value');

      await module.close();
    });
  });

  describe('in-memory backend manipulation', () => {
    it('should allow adding secrets after module creation', async () => {
      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forTesting()],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);

      // Add a secret dynamically
      service.getInMemoryBackend().set('dynamic-secret', 'dynamic-value');

      const value = await service.get({ name: 'dynamic-secret' });
      expect(value).toBe('dynamic-value');

      await module.close();
    });
  });

  describe('forSkipLoading', () => {
    it('should inject placeholder strings via SecretManagerService', async () => {
      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forSkipLoading()],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'any-secret' });

      expect(value).toBe('SECRET_NOT_LOADED:any-secret');

      await module.close();
    });

    it('should inject placeholder strings via @InjectSecret', async () => {
      // Register the secret before creating the module
      // (normally done at decorator evaluation time)
      secretRegistry.clear();

      @Injectable()
      class TestService {
        constructor(
          @InjectSecret('my-api-key') public readonly apiKey: string,
        ) {}
      }

      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forSkipLoading()],
        providers: [TestService],
      }).compile();

      const testService = module.get<TestService>(TestService);
      expect(testService.apiKey).toBe('SECRET_NOT_LOADED:my-api-key');

      await module.close();
    });

    it('should not fail startup even without backend access', async () => {
      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'gcp',
            gcpProjectId: 'nonexistent-project',
            skipLoading: true,
          }),
        ],
      }).compile();

      // Should not throw during init
      await expect(module.init()).resolves.not.toThrow();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'any-secret' });
      expect(value).toBe('SECRET_NOT_LOADED:any-secret');

      await module.close();
    });
  });
});
