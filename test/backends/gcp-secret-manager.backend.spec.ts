import { GcpSecretManagerBackend } from '../../src';

describe('GcpSecretManagerBackend', () => {
  afterEach(() => {
    jest.resetModules();
  });

  it('constructs a client when the optional peer is installed', () => {
    expect(new GcpSecretManagerBackend('my-project').name).toBe('gcp');
  });

  it('loads without the optional peer and names it when a GCP backend is built', () => {
    jest.isolateModules(() => {
      jest.doMock('@google-cloud/secret-manager', () => {
        const error: NodeJS.ErrnoException = new Error(
          "Cannot find module '@google-cloud/secret-manager' from 'src/backends/gcp-secret-manager.backend.ts'",
        );
        error.code = 'MODULE_NOT_FOUND';
        throw error;
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../src') as typeof import('../../src');

      expect(() => new pkg.GcpSecretManagerBackend('my-project')).toThrow(
        'GcpSecretManagerBackend needs the optional peer dependency @google-cloud/secret-manager (^5 || ^6). Install it beside @vori/nestjs-secret-manager.',
      );
    });
  });
});
