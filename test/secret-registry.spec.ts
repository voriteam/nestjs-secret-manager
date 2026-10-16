import { InjectSecret, InjectSecretBytes, SecretKind } from '../src';
import { secretRegistry } from '../src/testing';

describe('secretRegistry', () => {
  beforeEach(() => {
    secretRegistry.clear();
  });

  afterEach(() => {
    secretRegistry.clear();
  });

  it('get returns the requirement a decorator registered under its token', () => {
    InjectSecret('api-key', { version: '3', backend: 'gcp' });
    InjectSecretBytes('signing-key');

    expect(secretRegistry.get('SECRET_gcp_api-key_3')).toEqual({
      name: 'api-key',
      version: '3',
      backend: 'gcp',
      token: 'SECRET_gcp_api-key_3',
      kind: 'string',
    });
    expect(
      secretRegistry.get('SECRET_BYTES_default_signing-key_latest'),
    ).toEqual({
      name: 'signing-key',
      version: undefined,
      backend: undefined,
      token: 'SECRET_BYTES_default_signing-key_latest',
      kind: 'bytes',
    });
  });

  it('get returns undefined for a token nothing registered', () => {
    InjectSecret('api-key');

    expect(secretRegistry.get('SECRET_default_api-key_latest')?.name).toBe(
      'api-key',
    );
    expect(secretRegistry.get('SECRET_default_other_latest')).toBeUndefined();
  });

  it('register takes a SecretKind', () => {
    const requirement = secretRegistry.register(
      'blob',
      undefined,
      SecretKind.Bytes,
    );

    expect(requirement).toEqual({
      name: 'blob',
      version: undefined,
      backend: undefined,
      token: 'SECRET_BYTES_default_blob_latest',
      kind: 'bytes',
    });
  });
});
