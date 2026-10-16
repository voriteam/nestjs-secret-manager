import { Inject, Injectable, Module } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import {
  InjectSecret,
  InjectSecretBytes,
  SecretManagerModule,
  SecretManagerService,
  collectInjectedSecrets,
} from '../src';
import type { SecretAccessor, SecretBytesAccessor } from '../src';
import { secretRegistry } from '../src/testing';

describe('collectInjectedSecrets', () => {
  beforeEach(() => {
    secretRegistry.clear();
  });

  afterEach(() => {
    secretRegistry.clear();
  });

  it('orders entries by name, backend, version, then kind', async () => {
    @Injectable()
    class Zeta {
      constructor(@InjectSecret('zeta') readonly getZeta: SecretAccessor) {}
    }

    @Injectable()
    class Alpha {
      constructor(
        @InjectSecret('alpha', { version: '2' }) readonly v2: SecretAccessor,
        @InjectSecret('alpha', { backend: 'other' })
        readonly other: SecretAccessor,
        @InjectSecret('alpha') readonly latest: SecretAccessor,
        @InjectSecretBytes('alpha') readonly bytes: SecretBytesAccessor,
      ) {}
    }

    const moduleRef = await Test.createTestingModule({
      imports: [SecretManagerModule.forTesting()],
      providers: [Zeta, Alpha],
    }).compile();

    expect(collectInjectedSecrets(moduleRef.get(ModulesContainer))).toEqual([
      {
        requirement: {
          name: 'alpha',
          token: 'SECRET_BYTES_default_alpha_latest',
          kind: 'bytes',
        },
        consumers: ['Alpha'],
      },
      {
        requirement: {
          name: 'alpha',
          token: 'SECRET_default_alpha_latest',
          kind: 'string',
        },
        consumers: ['Alpha'],
      },
      {
        requirement: {
          name: 'alpha',
          version: '2',
          token: 'SECRET_default_alpha_2',
          kind: 'string',
        },
        consumers: ['Alpha'],
      },
      {
        requirement: {
          name: 'alpha',
          backend: 'other',
          token: 'SECRET_other_alpha_latest',
          kind: 'string',
        },
        consumers: ['Alpha'],
      },
      {
        requirement: {
          name: 'zeta',
          token: 'SECRET_default_zeta_latest',
          kind: 'string',
        },
        consumers: ['Zeta'],
      },
    ]);

    await moduleRef.close();
  });

  it('lists each consumer once, sorted, however often it injects the secret', async () => {
    @Injectable()
    class Beta {
      constructor(@InjectSecret('shared') readonly getShared: SecretAccessor) {}
    }

    @Injectable()
    class Alpha {
      constructor(
        @InjectSecret('shared') readonly first: SecretAccessor,
        @InjectSecret('shared') readonly second: SecretAccessor,
      ) {}
    }

    @Module({ providers: [Alpha] })
    class ChildModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [SecretManagerModule.forTesting(), ChildModule],
      providers: [Beta, Alpha],
    }).compile();

    expect(collectInjectedSecrets(moduleRef.get(ModulesContainer))).toEqual([
      {
        requirement: {
          name: 'shared',
          token: 'SECRET_default_shared_latest',
          kind: 'string',
        },
        consumers: ['Alpha', 'Beta'],
      },
    ]);

    await moduleRef.close();
  });

  it('follows the injector when a subclass re-declares a constructor slot', async () => {
    @Injectable()
    class Base {
      constructor(
        @InjectSecret('base-secret') readonly getBase: SecretAccessor,
      ) {}
    }

    @Injectable()
    class Overrides extends Base {
      constructor(
        @Inject(SecretManagerService) readonly service: SecretManagerService,
      ) {
        super(async () => 'unused');
      }
    }

    @Injectable()
    class Inherits extends Base {}

    const moduleRef = await Test.createTestingModule({
      imports: [SecretManagerModule.forTesting({ 'base-secret': 'value' })],
      providers: [Overrides, Inherits],
    }).compile();

    expect(moduleRef.get(Overrides).service).toBeInstanceOf(
      SecretManagerService,
    );
    await expect(moduleRef.get(Inherits).getBase()).resolves.toBe('value');
    expect(collectInjectedSecrets(moduleRef.get(ModulesContainer))).toEqual([
      {
        requirement: {
          name: 'base-secret',
          token: 'SECRET_default_base-secret_latest',
          kind: 'string',
        },
        consumers: ['Inherits'],
      },
    ]);

    await moduleRef.close();
  });

  it('reads a preview-mode graph, which instantiates nothing', async () => {
    let constructed = 0;

    @Injectable()
    class ConsumerService {
      constructor(
        @InjectSecret('preview-secret') readonly get: SecretAccessor,
      ) {
        constructed += 1;
      }
    }

    @Module({
      imports: [SecretManagerModule.forTesting()],
      providers: [ConsumerService],
    })
    class AppModule {}

    const app = await NestFactory.createApplicationContext(AppModule, {
      preview: true,
      logger: false,
    });

    expect(collectInjectedSecrets(app.get(ModulesContainer))).toEqual([
      {
        requirement: {
          name: 'preview-secret',
          token: 'SECRET_default_preview-secret_latest',
          kind: 'string',
        },
        consumers: ['ConsumerService'],
      },
    ]);
    expect(constructed).toBe(0);

    await app.close();
  });
});
