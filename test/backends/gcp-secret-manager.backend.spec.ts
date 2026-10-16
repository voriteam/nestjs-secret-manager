import { GcpSecretManagerBackend } from '../../src';

describe('GcpSecretManagerBackend', () => {
  it('builds a client when the optional peer is installed', () => {
    expect(new GcpSecretManagerBackend('my-project').name).toBe('gcp');
  });

  it('keeps its client out of what Nest serializes into a module key', () => {
    expect(
      Object.keys(new GcpSecretManagerBackend('my-project')).sort(),
    ).toEqual(['logger', 'name', 'projectId']);
  });

  it('loads the package without the optional peer and fails only when built', () => {
    const missing = Object.assign(
      new Error("Cannot find module '@google-cloud/secret-manager'"),
      { code: 'MODULE_NOT_FOUND' },
    );

    jest.isolateModules(() => {
      jest.doMock('@google-cloud/secret-manager', () => {
        throw missing;
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- reloads the package after mocking the peer away
      const pkg = require('../../src') as typeof import('../../src');

      expect(() => new pkg.GcpSecretManagerBackend('my-project')).toThrow(
        missing,
      );
    });
  });
});
