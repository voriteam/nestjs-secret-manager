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
