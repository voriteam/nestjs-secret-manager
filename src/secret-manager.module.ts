import { DynamicModule, Global, Module, Provider } from '@nestjs/common';

import { SECRET_MANAGER_OPTIONS, secretRegistry } from './constants';
import {
  SecretManagerModuleAsyncOptions,
  SecretManagerModuleOptions,
  SecretManagerOptionsFactory,
} from './interfaces/secret-manager-options.interface';
import { SecretManagerService } from './secret-manager.service';

/**
 * NestJS module for secret management.
 *
 * Provides:
 * - SecretManagerService for programmatic access to secrets
 * - @InjectSecret decorator for dependency injection of secret values
 * - Startup validation to fail fast if secrets are inaccessible
 * - In-memory caching to reduce backend calls
 *
 * @example
 * ```typescript
 * // app.module.ts
 * @Module({
 *   imports: [
 *     SecretManagerModule.forRoot({
 *       defaultBackend: 'gcp',
 *       gcpProjectId: 'my-project',
 *       validateOnStartup: true,
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
 *         gcpProjectId: config.get('GCP_PROJECT_ID'),
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
  static forRoot(options: SecretManagerModuleOptions): DynamicModule {
    const secretProviders = this.createSecretProviders();

    return {
      module: SecretManagerModule,
      providers: [
        {
          provide: SECRET_MANAGER_OPTIONS,
          useValue: options,
        },
        SecretManagerService,
        ...secretProviders,
      ],
      exports: [SecretManagerService, ...secretProviders],
    };
  }

  /**
   * Configure the module with async options.
   */
  static forRootAsync(options: SecretManagerModuleAsyncOptions): DynamicModule {
    const secretProviders = this.createSecretProviders();

    return {
      module: SecretManagerModule,
      imports: options.imports ?? [],
      providers: [
        ...this.createAsyncProviders(options),
        SecretManagerService,
        ...secretProviders,
      ],
      exports: [SecretManagerService, ...secretProviders],
    };
  }

  /**
   * Configure the module for testing with in-memory secrets.
   *
   * @param secrets - Map of secret names to values
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
  static forTesting(secrets: Record<string, string> = {}): DynamicModule {
    // Clear registry to avoid pollution between tests
    secretRegistry.clear();

    return this.forRoot({
      defaultBackend: 'memory',
      inMemorySecrets: secrets,
      validateOnStartup: false,
      cacheEnabled: false,
    });
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
   * Create providers for all registered secrets.
   * Each secret gets its own provider that resolves to its value.
   */
  private static createSecretProviders(): Provider[] {
    const secrets = secretRegistry.getAll();

    return secrets.map((secret) => ({
      provide: secret.token,
      useFactory: async (service: SecretManagerService): Promise<string> => {
        return service.get(secret.name, secret.version, secret.backend);
      },
      inject: [SecretManagerService],
    }));
  }
}
