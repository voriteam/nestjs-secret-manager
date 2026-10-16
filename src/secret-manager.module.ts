import {
  DynamicModule,
  Global,
  Module,
  ModuleMetadata,
  Provider,
} from '@nestjs/common';

import { InMemorySecretBackend } from './backends/in-memory.backend';
import type { InMemorySecretBackendOptions } from './backends/in-memory.backend';
import {
  SECRET_MANAGER_OPTIONS,
  SecretKind,
  secretRegistry,
  unknownSecretKind,
} from './constants';
import {
  SecretAccessor,
  SecretBytesAccessor,
} from './decorators/inject-secret.decorator';
import {
  SecretManagerModuleAsyncOptions,
  SecretManagerModuleOptions,
  SecretManagerOptionsFactory,
  StartupValidation,
} from './interfaces/secret-manager-options.interface';
import { SecretManagerService } from './secret-manager.service';
import { SecretStartupValidator } from './secret-startup-validator';

/**
 * NestJS module for secret management.
 *
 * Provides:
 * - SecretManagerService for programmatic access to secrets
 * - @InjectSecret decorator for dependency injection of secret values
 * - Startup validation of the secrets the application's graph injects
 * - In-memory caching to reduce backend calls
 *
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [
 *     SecretManagerModule.forRoot({
 *       defaultBackend: 'gcp',
 *       backends: [new GcpSecretManagerBackend('my-project')],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * ```typescript
 * // Async configuration
 * @Module({
 *   imports: [
 *     SecretManagerModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (config: ConfigService) => ({
 *         defaultBackend: 'gcp',
 *         backends: [
 *           new GcpSecretManagerBackend(config.get('GCP_PROJECT_ID')),
 *         ],
 *         startupValidation: StartupValidation.Warn,
 *       }),
 *       inject: [ConfigService],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({})
export class SecretManagerModule {
  /**
   * Configure the module with static options.
   */
  public static forRoot(options: SecretManagerModuleOptions): DynamicModule {
    return this.build([{ provide: SECRET_MANAGER_OPTIONS, useValue: options }]);
  }

  /**
   * Configure the module with async options.
   */
  public static forRootAsync(
    options: SecretManagerModuleAsyncOptions,
  ): DynamicModule {
    return this.build(this.createAsyncProviders(options), options.imports);
  }

  /**
   * Configure the module for testing with in-memory secrets. Nothing is
   * cached and nothing is probed at boot.
   *
   * @param secrets - Map of secret names to values
   * @param options.fallback - Value for any secret the test did not seed
   *
   * @example
   * ```typescript
   * // test setup
   * const moduleRef = await Test.createTestingModule({
   *   imports: [
   *     SecretManagerModule.forTesting({
   *       'api-key': 'test-api-key',
   *       'db-password': 'test-password',
   *     }),
   *   ],
   * }).compile();
   * ```
   */
  public static forTesting(
    secrets: Record<string, string | Uint8Array> = {},
    options: InMemorySecretBackendOptions = {},
  ): DynamicModule {
    return this.forRoot({
      defaultBackend: 'memory',
      backends: [new InMemorySecretBackend(secrets, options)],
      startupValidation: StartupValidation.Off,
      cacheEnabled: false,
    });
  }

  /**
   * Configure the module to skip all secret loading. Every read returns
   * `{"_placeholder":true,"key":"<name>"}` and nothing is probed at boot.
   * Useful for CLI tools and environments without secret backend access.
   */
  public static forSkipLoading(): DynamicModule {
    return this.forRoot({ skipLoading: true });
  }

  private static build(
    optionsProviders: Provider[],
    imports: ModuleMetadata['imports'] = [],
  ): DynamicModule {
    let secretProviders: Provider[] | undefined;
    // NestJS 10 rehashes this metadata when it links imports, and a provider
    // list that differs between those two passes breaks the link.
    const accessorsAtFirstScan = (): Provider[] =>
      (secretProviders ??= this.createSecretProviders());

    return {
      module: SecretManagerModule,
      imports,
      get providers() {
        return [
          ...optionsProviders,
          SecretManagerService,
          SecretStartupValidator,
          ...accessorsAtFirstScan(),
        ];
      },
      get exports() {
        return [SecretManagerService, ...accessorsAtFirstScan()];
      },
    };
  }

  /**
   * Create providers for async options configuration.
   */
  private static createAsyncProviders(
    options: SecretManagerModuleAsyncOptions,
  ): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (options.useClass) {
      return [
        this.createAsyncOptionsProvider(options),
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }

    throw new Error(
      'Invalid SecretManagerModuleAsyncOptions: must provide useExisting, useClass, or useFactory',
    );
  }

  /**
   * Create the async options provider.
   */
  private static createAsyncOptionsProvider(
    options: SecretManagerModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: SECRET_MANAGER_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject ?? [],
      };
    }

    const injectToken = options.useExisting ?? options.useClass;

    if (!injectToken) {
      throw new Error(
        'Invalid SecretManagerModuleAsyncOptions: must provide useExisting or useClass',
      );
    }

    return {
      provide: SECRET_MANAGER_OPTIONS,
      useFactory: (factory: SecretManagerOptionsFactory) =>
        factory.createSecretManagerOptions(),
      inject: [injectToken],
    };
  }

  /**
   * Create one accessor provider per registered secret.
   *
   * `@InjectSecret` registrations get a `SecretAccessor` (`() => Promise<string>`),
   * `@InjectSecretBytes` registrations get a `SecretBytesAccessor`
   * (`() => Promise<Uint8Array>`). The value is fetched on demand and not
   * held on the consumer's instance.
   */
  private static createSecretProviders(): Provider[] {
    const requirements = secretRegistry.getAll();

    return requirements.map((requirement) => {
      const fetchOptions = {
        name: requirement.name,
        version: requirement.version,
        backend: requirement.backend,
      };

      switch (requirement.kind) {
        case SecretKind.String:
          return {
            provide: requirement.token,
            useFactory:
              (service: SecretManagerService): SecretAccessor =>
              () =>
                service.get(fetchOptions),
            inject: [SecretManagerService],
          };
        case SecretKind.Bytes:
          return {
            provide: requirement.token,
            useFactory:
              (service: SecretManagerService): SecretBytesAccessor =>
              () =>
                service.getBytes(fetchOptions),
            inject: [SecretManagerService],
          };
        default:
          return unknownSecretKind(requirement.kind);
      }
    });
  }
}
