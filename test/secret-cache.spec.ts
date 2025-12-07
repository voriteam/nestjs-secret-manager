import { SecretCache } from '../src/secret-cache';

describe('SecretCache', () => {
  let cache: SecretCache;

  beforeEach(() => {
    cache = new SecretCache();
  });

  describe('get/set', () => {
    it('should store and retrieve a secret', () => {
      cache.set('gcp', 'api-key', 'secret-value');
      expect(cache.get('gcp', 'api-key')).toBe('secret-value');
    });

    it('should return undefined for non-existent secrets', () => {
      expect(cache.get('gcp', 'non-existent')).toBeUndefined();
    });

    it('should handle different backends separately', () => {
      cache.set('gcp', 'api-key', 'gcp-value');
      cache.set('memory', 'api-key', 'memory-value');

      expect(cache.get('gcp', 'api-key')).toBe('gcp-value');
      expect(cache.get('memory', 'api-key')).toBe('memory-value');
    });

    it('should handle different versions separately', () => {
      cache.set('gcp', 'api-key', 'v1-value', '1');
      cache.set('gcp', 'api-key', 'v2-value', '2');
      cache.set('gcp', 'api-key', 'latest-value');

      expect(cache.get('gcp', 'api-key', '1')).toBe('v1-value');
      expect(cache.get('gcp', 'api-key', '2')).toBe('v2-value');
      expect(cache.get('gcp', 'api-key')).toBe('latest-value');
    });

    it('should default version to latest', () => {
      cache.set('gcp', 'api-key', 'latest-value');
      expect(cache.get('gcp', 'api-key', 'latest')).toBe('latest-value');
      expect(cache.get('gcp', 'api-key')).toBe('latest-value');
    });
  });

  describe('has', () => {
    it('should return true for cached secrets', () => {
      cache.set('gcp', 'api-key', 'value');
      expect(cache.has('gcp', 'api-key')).toBe(true);
    });

    it('should return false for non-existent secrets', () => {
      expect(cache.has('gcp', 'non-existent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete a cached secret', () => {
      cache.set('gcp', 'api-key', 'value');
      expect(cache.delete('gcp', 'api-key')).toBe(true);
      expect(cache.get('gcp', 'api-key')).toBeUndefined();
    });

    it('should return false when deleting non-existent secret', () => {
      expect(cache.delete('gcp', 'non-existent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cached secrets', () => {
      cache.set('gcp', 'key1', 'value1');
      cache.set('gcp', 'key2', 'value2');
      cache.set('memory', 'key3', 'value3');

      cache.clear();

      expect(cache.get('gcp', 'key1')).toBeUndefined();
      expect(cache.get('gcp', 'key2')).toBeUndefined();
      expect(cache.get('memory', 'key3')).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return the number of cached entries', () => {
      expect(cache.size).toBe(0);

      cache.set('gcp', 'key1', 'value1');
      expect(cache.size).toBe(1);

      cache.set('gcp', 'key2', 'value2');
      expect(cache.size).toBe(2);
    });
  });

  describe('TTL', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should expire entries after TTL', () => {
      const ttlCache = new SecretCache(1000); // 1 second TTL

      ttlCache.set('gcp', 'api-key', 'value');
      expect(ttlCache.get('gcp', 'api-key')).toBe('value');

      // Advance time past TTL
      jest.advanceTimersByTime(1001);

      expect(ttlCache.get('gcp', 'api-key')).toBeUndefined();
    });

    it('should not expire entries before TTL', () => {
      const ttlCache = new SecretCache(1000);

      ttlCache.set('gcp', 'api-key', 'value');

      // Advance time but not past TTL
      jest.advanceTimersByTime(500);

      expect(ttlCache.get('gcp', 'api-key')).toBe('value');
    });

    it('should not expire entries when TTL is undefined', () => {
      cache.set('gcp', 'api-key', 'value');

      // Advance time significantly
      jest.advanceTimersByTime(1000000);

      expect(cache.get('gcp', 'api-key')).toBe('value');
    });
  });
});
