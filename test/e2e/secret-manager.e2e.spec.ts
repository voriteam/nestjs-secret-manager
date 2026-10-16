import {
  CanActivate,
  Controller,
  Get,
  Injectable,
  Logger,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  InMemorySecretBackend,
  InjectSecret,
  InjectSecretBytes,
  SecretKind,
  SecretManagerModule,
  SecretManagerService,
  SecretNotFoundError,
  SecretValidationError,
  StartupValidation,
} from '../../src';
import type {
  SecretAccessor,
  SecretBackend,
  SecretBytesAccessor,
} from '../../src';
import { secretRegistry } from '../../src/testing';
import { CountingBackend } from '../support/counting-backend';

async function initError(init: Promise<unknown>): Promise<unknown> {
  return await init.then(
    () => undefined,
    (error: unknown) => error,
  );
}

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
            backends: [
              new InMemorySecretBackend({ 'test-secret': 'test-value' }),
            ],
            startupValidation: StartupValidation.Off,
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
              backends: [
                new InMemorySecretBackend({ 'async-secret': 'async-value' }),
              ],
              startupValidation: StartupValidation.Off,
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
              backends: [
                new InMemorySecretBackend({
                  'project-secret': config.projectId,
                }),
              ],
              startupValidation: StartupValidation.Off,
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
      const memoryBackend = new InMemorySecretBackend();

      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [memoryBackend],
            startupValidation: StartupValidation.Off,
            cacheEnabled: false,
          }),
        ],
      }).compile();

      const service = module.get<SecretManagerService>(SecretManagerService);

      // Mutate the backend reference held by the test
      memoryBackend.set('dynamic-secret', 'dynamic-value');

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

      expect(value).toBe('{"_placeholder":true,"key":"any-secret"}');

      await module.close();
    });

    it('should inject accessor returning placeholder strings via @InjectSecret', async () => {
      // Register the secret before creating the module
      // (normally done at decorator evaluation time)
      secretRegistry.clear();

      @Injectable()
      class TestService {
        constructor(
          @InjectSecret('my-api-key')
          public readonly getApiKey: SecretAccessor,
        ) {}
      }

      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forSkipLoading()],
        providers: [TestService],
      }).compile();

      const testService = module.get<TestService>(TestService);
      await expect(testService.getApiKey()).resolves.toBe(
        '{"_placeholder":true,"key":"my-api-key"}',
      );

      await module.close();
    });

    it('should not fail startup even without backend access', async () => {
      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            // skipLoading short-circuits backend initialization, so
            // no backends need to be configured.
            skipLoading: true,
          }),
        ],
      }).compile();

      // Should not throw during init
      await expect(module.init()).resolves.not.toThrow();

      const service = module.get<SecretManagerService>(SecretManagerService);
      const value = await service.get({ name: 'any-secret' });
      expect(value).toBe('{"_placeholder":true,"key":"any-secret"}');

      await module.close();
    });
  });

  describe('@InjectSecret', () => {
    it('injects a SecretAccessor function (not the raw value)', async () => {
      @Injectable()
      class TestService {
        constructor(
          @InjectSecret('lazy-key')
          public readonly getApiKey: SecretAccessor,
        ) {}
      }

      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forTesting({ 'lazy-key': 'lazy-value' })],
        providers: [TestService],
      }).compile();

      const testService = module.get(TestService);

      // The injected member is a function — the secret value is never held
      // on the instance.
      expect(typeof testService.getApiKey).toBe('function');
      expect(testService.getApiKey as unknown as string).not.toBe('lazy-value');

      // Calling it returns the value.
      await expect(testService.getApiKey()).resolves.toBe('lazy-value');

      await module.close();
    });

    it('startup validation fails when a secret is missing', async () => {
      @Injectable()
      class TestService {
        constructor(
          @InjectSecret('does-not-exist')
          public readonly getMissing: SecretAccessor,
        ) {}
      }

      await expect(
        Test.createTestingModule({
          imports: [
            SecretManagerModule.forRoot({
              defaultBackend: 'memory',
              backends: [new InMemorySecretBackend()],
            }),
          ],
          providers: [TestService],
        })
          .compile()
          .then((m) => m.init()),
      ).rejects.toThrow(/Failed to validate.*does-not-exist/s);
    });
  });

  describe('startup validation', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('does not probe a decorated class the graph does not build', async () => {
      @Injectable()
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- declared only so its decorator registers the secret
      class UnwiredService {
        constructor(
          @InjectSecret('unwired-secret') readonly getKey: SecretAccessor,
        ) {}
      }

      @Injectable()
      class WiredService {
        constructor(
          @InjectSecret('wired-secret') readonly getKey: SecretAccessor,
        ) {}
      }

      const backend = new CountingBackend({ 'wired-secret': 'value' });
      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [backend],
          }),
        ],
        providers: [WiredService],
      }).compile();

      await moduleRef.init();

      expect(
        secretRegistry.get('SECRET_default_unwired-secret_latest'),
      ).toEqual({
        name: 'unwired-secret',
        token: 'SECRET_default_unwired-secret_latest',
        kind: 'string',
      });
      expect(backend.calls).toEqual([['get', 'wired-secret', 'latest']]);

      await moduleRef.close();
    });

    it('throws SecretValidationError naming the secret and its consumer', async () => {
      @Injectable()
      class ConsumerService {
        constructor(
          @InjectSecret('payments-api-key') readonly getKey: SecretAccessor,
        ) {}
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
            startupValidation: StartupValidation.Enforce,
          }),
        ],
        providers: [ConsumerService],
      }).compile();

      const error = await initError(moduleRef.init());

      expect(error).toBeInstanceOf(SecretValidationError);
      expect((error as SecretValidationError).name).toBe(
        'SecretValidationError',
      );
      expect((error as SecretValidationError).failures).toEqual([
        {
          name: 'payments-api-key',
          version: 'latest',
          backend: 'memory',
          kind: SecretKind.String,
          consumers: ['ConsumerService'],
          error: new SecretNotFoundError(
            'payments-api-key',
            'memory',
            'latest',
          ),
        },
      ]);
      expect((error as SecretValidationError).message).toBe(
        [
          'Failed to validate 1 injected secret(s):',
          "  - payments-api-key (backend: memory, version: latest), needed by ConsumerService: Secret 'payments-api-key' not found in backend 'memory' (version: latest)",
        ].join('\n'),
      );
    });

    it('lists every failure with all of its consumers', async () => {
      @Injectable()
      class BillingService {
        constructor(
          @InjectSecret('payments-api-key') readonly getKey: SecretAccessor,
        ) {}
      }

      @Injectable()
      class RefundService {
        constructor(
          @InjectSecret('payments-api-key') readonly getKey: SecretAccessor,
        ) {}
      }

      @Injectable()
      class TokenSigner {
        constructor(
          @InjectSecret('signing-key') readonly getKey: SecretAccessor,
        ) {}
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
            startupValidation: StartupValidation.Enforce,
          }),
        ],
        providers: [TokenSigner, RefundService, BillingService],
      }).compile();

      const error = await initError(moduleRef.init());

      expect((error as SecretValidationError).message).toBe(
        [
          'Failed to validate 2 injected secret(s):',
          "  - payments-api-key (backend: memory, version: latest), needed by BillingService, RefundService: Secret 'payments-api-key' not found in backend 'memory' (version: latest)",
          "  - signing-key (backend: memory, version: latest), needed by TokenSigner: Secret 'signing-key' not found in backend 'memory' (version: latest)",
        ].join('\n'),
      );
    });

    it('starts every probe before any read settles', async () => {
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      class GatedBackend implements SecretBackend {
        readonly name = 'memory';
        readonly started: string[] = [];
        release: () => void = () => undefined;
        readonly #gate = new Promise<void>((resolve) => {
          this.release = resolve;
        });

        async get(name: string): Promise<string> {
          this.started.push(name);
          await this.#gate;
          return 'value';
        }

        async getBytes(name: string): Promise<Uint8Array> {
          return new TextEncoder().encode(await this.get(name));
        }
      }

      @Injectable()
      class ConsumerService {
        constructor(
          @InjectSecret('first') readonly getFirst: SecretAccessor,
          @InjectSecret('second') readonly getSecond: SecretAccessor,
          @InjectSecret('third') readonly getThird: SecretAccessor,
        ) {}
      }

      const backend = new GatedBackend();
      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [backend],
          }),
        ],
        providers: [ConsumerService],
      }).compile();

      const init = moduleRef.init();
      await new Promise((resolve) => setImmediate(resolve));

      expect(backend.started).toEqual(['first', 'second', 'third']);

      backend.release();
      await init;

      expect(log.mock.calls).toContainEqual([
        expect.stringMatching(/^Validated 3 injected secret\(s\) in \d+ms$/),
      ]);

      await moduleRef.close();
    });

    it('reports the version and backend a consumer pinned', async () => {
      @Injectable()
      class VaultClient {
        constructor(
          @InjectSecret('vault-token', { version: '3', backend: 'vault' })
          readonly getToken: SecretAccessor,
        ) {}
      }

      const vault = new InMemorySecretBackend();
      Object.defineProperty(vault, 'name', { value: 'vault' });
      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend(), vault],
          }),
        ],
        providers: [VaultClient],
      }).compile();

      const error = await initError(moduleRef.init());

      expect((error as SecretValidationError).failures).toEqual([
        {
          name: 'vault-token',
          version: '3',
          backend: 'vault',
          kind: SecretKind.String,
          consumers: ['VaultClient'],
          error: new SecretNotFoundError('vault-token', 'vault', '3'),
        },
      ]);
    });

    it('reports every failure before a consumer two imports deep reads its secret in onModuleInit', async () => {
      @Injectable()
      class EagerReader implements OnModuleInit {
        constructor(
          @InjectSecret('eager-secret') readonly getKey: SecretAccessor,
        ) {}

        async onModuleInit(): Promise<void> {
          await this.getKey();
        }
      }

      @Injectable()
      class ConsumerService {
        constructor(
          @InjectSecret('other-secret') readonly getKey: SecretAccessor,
        ) {}
      }

      @Module({ providers: [EagerReader] })
      class DeepModule {}

      @Module({ imports: [DeepModule] })
      class FeatureModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
            startupValidation: StartupValidation.Enforce,
          }),
          FeatureModule,
        ],
        providers: [ConsumerService],
      }).compile();

      const error = await initError(moduleRef.init());

      expect(error).toBeInstanceOf(SecretValidationError);
      expect(
        (error as SecretValidationError).failures.map(
          ({ name, consumers }) => ({ name, consumers }),
        ),
      ).toEqual([
        { name: 'eager-secret', consumers: ['EagerReader'] },
        { name: 'other-secret', consumers: ['ConsumerService'] },
      ]);
    });

    it('marks a failed bytes injection in the message', async () => {
      @Injectable()
      class TokenSigner {
        constructor(
          @InjectSecretBytes('signing-key')
          readonly getKey: SecretBytesAccessor,
        ) {}
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
          }),
        ],
        providers: [TokenSigner],
      }).compile();

      const error = await initError(moduleRef.init());

      expect((error as SecretValidationError).message).toBe(
        [
          'Failed to validate 1 injected secret(s):',
          "  - signing-key (backend: memory, version: latest, bytes), needed by TokenSigner: Secret 'signing-key' not found in backend 'memory' (version: latest)",
        ].join('\n'),
      );
    });

    it('probes a bytes injection through getBytes', async () => {
      @Injectable()
      class TokenSigner {
        constructor(
          @InjectSecretBytes('signing-key')
          readonly getKey: SecretBytesAccessor,
        ) {}
      }

      const backend = new CountingBackend({
        'signing-key': new Uint8Array([0xff, 0x01]),
      });
      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [backend],
          }),
        ],
        providers: [TokenSigner],
      }).compile();

      await moduleRef.init();

      expect(backend.calls).toEqual([['getBytes', 'signing-key', 'latest']]);
      await expect(moduleRef.get(TokenSigner).getKey()).resolves.toEqual(
        new Uint8Array([0xff, 0x01]),
      );

      await moduleRef.close();
    });

    it("counts a factory provider's inject, in both forms", async () => {
      const plain = secretRegistry.register('factory-secret');
      const objectForm = secretRegistry.register('object-form-secret');

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
          }),
        ],
        providers: [
          {
            provide: 'FACTORY_CONSUMER',
            useFactory: (getKey: SecretAccessor) => getKey,
            inject: [plain.token],
          },
          {
            provide: 'OBJECT_FORM_CONSUMER',
            useFactory: (getKey: SecretAccessor) => getKey,
            inject: [{ token: objectForm.token, optional: true }],
          },
        ],
      }).compile();

      const error = await initError(moduleRef.init());

      expect(
        (error as SecretValidationError).failures.map(
          ({ name, consumers }) => ({ name, consumers }),
        ),
      ).toEqual([
        { name: 'factory-secret', consumers: ['FACTORY_CONSUMER'] },
        { name: 'object-form-secret', consumers: ['OBJECT_FORM_CONSUMER'] },
      ]);
    });

    it('counts a guard applied with @UseGuards', async () => {
      @Injectable()
      class SecretGuard implements CanActivate {
        constructor(
          @InjectSecret('guard-secret') readonly getKey: SecretAccessor,
        ) {}

        canActivate(): boolean {
          return true;
        }
      }

      @Controller('guarded')
      @UseGuards(SecretGuard)
      class GuardedController {
        @Get()
        read(): string {
          return 'ok';
        }
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
          }),
        ],
        controllers: [GuardedController],
      }).compile();

      const error = await initError(moduleRef.init());

      expect(
        (error as SecretValidationError).failures.map(
          ({ name, consumers }) => ({ name, consumers }),
        ),
      ).toEqual([{ name: 'guard-secret', consumers: ['SecretGuard'] }]);
    });

    it('counts a middleware applied in configure()', async () => {
      @Injectable()
      class SecretMiddleware implements NestMiddleware {
        constructor(
          @InjectSecret('middleware-secret') readonly getKey: SecretAccessor,
        ) {}

        use(_req: unknown, _res: unknown, next: () => void): void {
          next();
        }
      }

      @Module({})
      class AppModule implements NestModule {
        configure(consumer: MiddlewareConsumer): void {
          consumer.apply(SecretMiddleware).forRoutes('secured');
        }
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
          }),
          AppModule,
        ],
      }).compile();
      const app = moduleRef.createNestApplication({ logger: false });

      const error = await initError(app.init());

      expect(
        (error as SecretValidationError).failures.map((f) => f.consumers),
      ).toEqual([['SecretMiddleware']]);
      await app.close();
    });

    it('logs the failures once at warn level under Warn, and boots', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const log = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);

      @Injectable()
      class ConsumerService {
        constructor(
          @InjectSecret('payments-api-key') readonly getKey: SecretAccessor,
        ) {}
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [new InMemorySecretBackend()],
            startupValidation: StartupValidation.Warn,
          }),
        ],
        providers: [ConsumerService],
      }).compile();

      await moduleRef.init();

      expect(warn.mock.calls).toEqual([
        [
          [
            'Failed to validate 1 injected secret(s):',
            "  - payments-api-key (backend: memory, version: latest), needed by ConsumerService: Secret 'payments-api-key' not found in backend 'memory' (version: latest)",
          ].join('\n'),
        ],
      ]);
      expect(log.mock.calls).toContainEqual([
        expect.stringMatching(
          /^Validated 1 injected secret\(s\) in \d+ms, 1 failed$/,
        ),
      ]);

      await moduleRef.close();
    });

    it('probes nothing under Off', async () => {
      @Injectable()
      class ConsumerService {
        constructor(
          @InjectSecret('off-secret') readonly getKey: SecretAccessor,
        ) {}
      }

      const backend = new CountingBackend({ 'off-secret': 'value' });
      const moduleRef = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [backend],
            startupValidation: StartupValidation.Off,
          }),
        ],
        providers: [ConsumerService],
      }).compile();

      await moduleRef.init();
      expect(backend.calls).toEqual([]);

      await expect(moduleRef.get(ConsumerService).getKey()).resolves.toBe(
        'value',
      );
      expect(backend.calls).toEqual([['get', 'off-secret', 'latest']]);

      await moduleRef.close();
    });

    it('rejects an unknown startupValidation value', async () => {
      await expect(
        Test.createTestingModule({
          imports: [
            SecretManagerModule.forRoot({
              defaultBackend: 'memory',
              backends: [new InMemorySecretBackend()],
              startupValidation: 'strict' as StartupValidation,
            }),
          ],
        }).compile(),
      ).rejects.toThrow(
        "Invalid startupValidation: 'strict'. Expected one of: enforce, warn, off.",
      );
    });
  });

  describe('@InjectSecretBytes', () => {
    it('injects a SecretBytesAccessor that returns Uint8Array', async () => {
      @Injectable()
      class TestService {
        constructor(
          @InjectSecretBytes('signing-key')
          public readonly getSigningKey: SecretBytesAccessor,
        ) {}
      }

      const binary = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      const memoryBackend = new InMemorySecretBackend();
      memoryBackend.set('signing-key', binary);

      const module = await Test.createTestingModule({
        imports: [
          SecretManagerModule.forRoot({
            defaultBackend: 'memory',
            backends: [memoryBackend],
            startupValidation: StartupValidation.Off,
            cacheEnabled: false,
          }),
        ],
        providers: [TestService],
      }).compile();

      const testService = module.get(TestService);
      expect(typeof testService.getSigningKey).toBe('function');
      const bytes = await testService.getSigningKey();
      expect(bytes).toEqual(binary);

      await module.close();
    });

    it('coexists with @InjectSecret on the same secret name', async () => {
      @Injectable()
      class TestService {
        constructor(
          @InjectSecret('shared')
          public readonly getStr: SecretAccessor,
          @InjectSecretBytes('shared')
          public readonly getBytes: SecretBytesAccessor,
        ) {}
      }

      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forTesting({ shared: 'hello' })],
        providers: [TestService],
      }).compile();

      const testService = module.get(TestService);
      await expect(testService.getStr()).resolves.toBe('hello');
      const bytes = await testService.getBytes();
      expect(new TextDecoder().decode(bytes)).toBe('hello');

      await module.close();
    });

    it('returns a placeholder under skipLoading', async () => {
      @Injectable()
      class TestService {
        constructor(
          @InjectSecretBytes('any-key')
          public readonly getKey: SecretBytesAccessor,
        ) {}
      }

      const module = await Test.createTestingModule({
        imports: [SecretManagerModule.forSkipLoading()],
        providers: [TestService],
      }).compile();

      const testService = module.get(TestService);
      const bytes = await testService.getKey();
      expect(new TextDecoder().decode(bytes)).toBe(
        '{"_placeholder":true,"key":"any-key"}',
      );

      await module.close();
    });
  });
});
