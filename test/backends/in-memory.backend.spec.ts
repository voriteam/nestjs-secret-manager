import { InMemorySecretBackend } from '../../src/backends/in-memory.backend';
import { SecretNotFoundError } from '../../src/errors/secret-not-found.error';

describe('InMemorySecretBackend', () => {
  let backend: InMemorySecretBackend;

  beforeEach(() => {
    backend = new InMemorySecretBackend();
  });

  describe('constructor', () => {
    it('should initialize with empty secrets', () => {
      expect(backend.size).toBe(0);
    });

    it('should initialize with provided secrets', () => {
      const backendWithSecrets = new InMemorySecretBackend({
        'api-key': 'secret-value',
        'db-password': 'db-secret',
      });

      expect(backendWithSecrets.size).toBe(2);
    });
  });

  describe('name', () => {
    it('should return "memory"', () => {
      expect(backend.name).toBe('memory');
    });
  });

  describe('set/get', () => {
    it('should store and retrieve a secret', async () => {
      backend.set('api-key', 'secret-value');
      const value = await backend.get('api-key');
      expect(value).toBe('secret-value');
    });

    it('should store and retrieve a secret with version', async () => {
      backend.set('api-key', 'v1-value', '1');
      backend.set('api-key', 'v2-value', '2');

      expect(await backend.get('api-key', '1')).toBe('v1-value');
      expect(await backend.get('api-key', '2')).toBe('v2-value');
    });

    it('should throw SecretNotFoundError for non-existent secret', async () => {
      await expect(backend.get('non-existent')).rejects.toThrow(
        SecretNotFoundError,
      );
    });

    it('should throw SecretNotFoundError for non-existent version', async () => {
      backend.set('api-key', 'value');

      await expect(backend.get('api-key', '999')).rejects.toThrow(
        SecretNotFoundError,
      );
    });

    it('should include backend name in error', async () => {
      try {
        await backend.get('non-existent');
        fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SecretNotFoundError);
        expect((error as SecretNotFoundError).backend).toBe('memory');
        expect((error as SecretNotFoundError).secretName).toBe('non-existent');
      }
    });
  });

  describe('getLatest', () => {
    it('should retrieve the latest version', async () => {
      backend.set('api-key', 'latest-value');
      const value = await backend.getLatest('api-key');
      expect(value).toBe('latest-value');
    });
  });

  describe('getBytes / getLatestBytes', () => {
    it('returns bytes for a string-set secret (UTF-8 encoded)', async () => {
      backend.set('api-key', 'hello');
      const bytes = await backend.getBytes('api-key');
      expect(bytes).toEqual(new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('round-trips a Uint8Array set with non-UTF-8 bytes', async () => {
      const binary = new Uint8Array([0xff, 0x00, 0x80, 0xfe, 0x42]);
      backend.set('private-key', binary);
      const bytes = await backend.getBytes('private-key');
      expect(bytes).toEqual(binary);
    });

    it('getLatestBytes is equivalent to getBytes(name, "latest")', async () => {
      backend.set('api-key', 'v');
      expect(await backend.getLatestBytes('api-key')).toEqual(
        await backend.getBytes('api-key'),
      );
    });

    it('throws SecretNotFoundError for missing bytes', async () => {
      await expect(backend.getBytes('nope')).rejects.toThrow(
        SecretNotFoundError,
      );
    });

    it('initial-secrets accept Uint8Array values', async () => {
      const seeded = new InMemorySecretBackend({
        binary: new Uint8Array([1, 2, 3]),
        text: 'hi',
      });
      expect(await seeded.getBytes('binary')).toEqual(
        new Uint8Array([1, 2, 3]),
      );
      expect(await seeded.get('text')).toBe('hi');
    });
  });

  describe('has', () => {
    it('should return true for existing secret', () => {
      backend.set('api-key', 'value');
      expect(backend.has('api-key')).toBe(true);
    });

    it('should return false for non-existent secret', () => {
      expect(backend.has('non-existent')).toBe(false);
    });

    it('should check specific version', () => {
      backend.set('api-key', 'value', '1');

      expect(backend.has('api-key', '1')).toBe(true);
      expect(backend.has('api-key', '2')).toBe(false);
      expect(backend.has('api-key', 'latest')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete all versions of a secret', () => {
      backend.set('api-key', 'v1', '1');
      backend.set('api-key', 'v2', '2');

      expect(backend.delete('api-key')).toBe(true);
      expect(backend.has('api-key', '1')).toBe(false);
      expect(backend.has('api-key', '2')).toBe(false);
    });

    it('should delete specific version', () => {
      backend.set('api-key', 'v1', '1');
      backend.set('api-key', 'v2', '2');

      expect(backend.delete('api-key', '1')).toBe(true);
      expect(backend.has('api-key', '1')).toBe(false);
      expect(backend.has('api-key', '2')).toBe(true);
    });

    it('should return false for non-existent secret', () => {
      expect(backend.delete('non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all secrets', () => {
      backend.set('key1', 'value1');
      backend.set('key2', 'value2');

      backend.clear();

      expect(backend.size).toBe(0);
      expect(backend.has('key1')).toBe(false);
      expect(backend.has('key2')).toBe(false);
    });
  });

  describe('getSecretNames', () => {
    it('should return all secret names', () => {
      backend.set('api-key', 'value1');
      backend.set('db-password', 'value2');

      const names = backend.getSecretNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('api-key');
      expect(names).toContain('db-password');
    });
  });
});
