import Module from 'node:module';

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

  it('fails only when built without the optional peer', () => {
    const missing = Object.assign(
      new Error("Cannot find module '@google-cloud/secret-manager'"),
      { code: 'MODULE_NOT_FOUND' },
    );
    const { require: load } = Module.prototype;
    vi.spyOn(Module.prototype, 'require').mockImplementation(function (
      this: Module,
      id: string,
    ) {
      if (id === '@google-cloud/secret-manager') {
        throw missing;
      }
      return load.call(this, id);
    });

    try {
      expect(() => new GcpSecretManagerBackend('my-project')).toThrow(missing);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
