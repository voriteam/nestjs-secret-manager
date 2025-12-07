import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { secretRegistry } from '../../src/constants';
import { SecretManagerModule } from '../../src/secret-manager.module';
import { SecretManagerService } from '../../src/secret-manager.service';

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
      const value = await service.get('test-secret');

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

      expect(await service.get('api-key')).toBe('test-api-key');
      expect(await service.get('db-password')).toBe('test-password');

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
          return this.secretManager.get('api-key');
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
      const value = await service.get('async-secret');

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
      const value = await service.get('project-secret');

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
          return this.secretManager.get(name);
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

      const value = await service.get('dynamic-secret');
      expect(value).toBe('dynamic-value');

      await module.close();
    });
  });
});
