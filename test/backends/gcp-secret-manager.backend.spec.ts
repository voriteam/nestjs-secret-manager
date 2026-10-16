import { GcpSecretManagerBackend } from '../../src';

function moduleNotFound(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = 'MODULE_NOT_FOUND';
  return error;
}

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
        throw moduleNotFound(
          "Cannot find module '@google-cloud/secret-manager' from 'src/backends/gcp-secret-manager.backend.ts'",
        );
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../src') as typeof import('../../src');

      expect(() => new pkg.GcpSecretManagerBackend('my-project')).toThrow(
        'GcpSecretManagerBackend needs the optional peer dependency @google-cloud/secret-manager (^5 || ^6). Install it beside @vori/nestjs-secret-manager.',
      );
    });
  });

  it('rethrows when the installed peer cannot load one of its own dependencies', () => {
    const missingDependency = moduleNotFound(
      [
        "Cannot find module 'google-gax'",
        'Require stack:',
        '- /app/node_modules/@google-cloud/secret-manager/build/src/v1/secret_manager_service_client.js',
        '- /app/node_modules/@google-cloud/secret-manager/build/src/index.js',
      ].join('\n'),
    );

    jest.isolateModules(() => {
      jest.doMock('@google-cloud/secret-manager', () => {
        throw missingDependency;
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../src') as typeof import('../../src');

      let thrown: unknown;
      try {
        new pkg.GcpSecretManagerBackend('my-project');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(missingDependency);
    });
  });
});
