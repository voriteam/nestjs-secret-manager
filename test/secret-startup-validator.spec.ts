import {
  CanActivate,
  Controller,
  Get,
  Injectable,
  Logger,
  ModuleMetadata,
  UseGuards,
} from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
  InMemorySecretBackend,
  InjectSecret,
  InjectSecretBytes,
  SecretManagerModule,
  SecretValidationError,
  StartupValidation,
  collectInjectedSecrets,
} from '../src';
import type {
  SecretAccessor,
  SecretBackend,
  SecretBytesAccessor,
  SecretManagerModuleOptions,
} from '../src';

@Injectable()
class BillingService {
  constructor(
    @InjectSecret('payments-api-key') readonly getKey: SecretAccessor,
  ) {}
}

@Injectable()
class TokenSigner {
  constructor(
    @InjectSecretBytes('signing-key', { version: '3' })
    readonly getKey: SecretBytesAccessor,
  ) {}
}

@Injectable()
class PresentReader {
  constructor(@InjectSecret('present-key') readonly getKey: SecretAccessor) {}
}

@Injectable()
class LegacyBillingService {
  constructor(
    @InjectSecret('legacy-payments-key') readonly getKey: SecretAccessor,
  ) {}
}

@Injectable()
class RotatedBillingService extends LegacyBillingService {
  constructor(@InjectSecret('payments-api-key') getKey: SecretAccessor) {
    super(getKey);
  }
}

@Injectable()
class ApiKeyGuard implements CanActivate {
  constructor(@InjectSecret('guard-key') readonly getKey: SecretAccessor) {}

  canActivate(): boolean {
    return true;
  }
}

@Controller('reports')
class ReportsController {
  constructor(
    @InjectSecret('controller-key') readonly getKey: SecretAccessor,
  ) {}

  @Get()
  @UseGuards(ApiKeyGuard)
  list(): string[] {
    return [];
  }
}

const billingFailure =
  "  - payments-api-key (backend: memory, version: latest), needed by BillingService: Secret 'payments-api-key' not found in backend 'memory' (version: latest)";

async function boot(
  metadata: ModuleMetadata,
  options: Partial<SecretManagerModuleOptions> = {},
): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    imports: [
      SecretManagerModule.forRoot({
        defaultBackend: 'memory',
        backends: [new InMemorySecretBackend({ 'present-key': 'value' })],
        ...options,
      }),
    ],
  }).compile();
  try {
    await moduleRef.init();
  } finally {
    await moduleRef.close();
  }
}

async function bootError(
  metadata: ModuleMetadata,
  options: Partial<SecretManagerModuleOptions> = {},
): Promise<unknown> {
  return await boot(metadata, options).then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('startup validation', () => {
  it('fails boot with every unreadable injected secret and its consumers', async () => {
    const error = await bootError({
      providers: [BillingService, TokenSigner, PresentReader],
      controllers: [ReportsController],
    });

    expect(error).toBeInstanceOf(SecretValidationError);
    expect((error as Error).message).toBe(
      [
        'Failed to validate 4 injected secret(s):',
        billingFailure,
        "  - signing-key (backend: memory, version: 3, bytes), needed by TokenSigner: Secret 'signing-key' not found in backend 'memory' (version: 3)",
        "  - guard-key (backend: memory, version: latest), needed by ApiKeyGuard: Secret 'guard-key' not found in backend 'memory' (version: latest)",
        "  - controller-key (backend: memory, version: latest), needed by ReportsController: Secret 'controller-key' not found in backend 'memory' (version: latest)",
      ].join('\n'),
    );
  });

  it('probes only the secret a subclass injects in place of its parent', async () => {
    const error = await bootError({ providers: [RotatedBillingService] });

    expect((error as Error).message).toBe(
      "Failed to validate 1 injected secret(s):\n  - payments-api-key (backend: memory, version: latest), needed by RotatedBillingService: Secret 'payments-api-key' not found in backend 'memory' (version: latest)",
    );
  });

  it('reports what a backend rejects with when it is not an Error', async () => {
    const sealed: SecretBackend = {
      name: 'memory',
      get: () => Promise.reject('vault sealed'),
      getBytes: () => Promise.reject('vault sealed'),
    };

    const error = await bootError(
      { providers: [BillingService] },
      { backends: [sealed] },
    );

    expect((error as Error).message).toBe(
      'Failed to validate 1 injected secret(s):\n  - payments-api-key (backend: memory, version: latest), needed by BillingService: vault sealed',
    );
  });

  it('logs how many injected secrets it read and how long that took', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      await boot({ providers: [PresentReader] });

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^Validated 1 injected secret\(s\) in \d+ms$/),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('logs only the failures of provided classes and keeps booting under Warn', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    try {
      await boot(
        { providers: [BillingService] },
        { startupValidation: StartupValidation.Warn },
      );

      expect(warn).toHaveBeenCalledWith(
        `Failed to validate 1 injected secret(s):\n${billingFailure}`,
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('probes nothing under Off', async () => {
    const get = jest.spyOn(InMemorySecretBackend.prototype, 'get');
    try {
      await boot(
        { providers: [BillingService] },
        { startupValidation: StartupValidation.Off },
      );

      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });
});

describe('collectInjectedSecrets', () => {
  it('lists each injected secret with the classes that inject it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SecretManagerModule.forRoot({ skipLoading: true })],
      providers: [BillingService, PresentReader],
    }).compile();
    try {
      const injected = collectInjectedSecrets(moduleRef.get(ModulesContainer));

      expect(
        injected.map(({ requirement, consumers }) => [
          requirement.name,
          consumers,
        ]),
      ).toEqual([
        ['payments-api-key', ['BillingService']],
        ['present-key', ['PresentReader']],
      ]);
    } finally {
      await moduleRef.close();
    }
  });
});
