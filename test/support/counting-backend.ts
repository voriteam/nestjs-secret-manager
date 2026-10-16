import { InMemorySecretBackend } from '../../src';

export class CountingBackend extends InMemorySecretBackend {
  readonly calls: [
    method: 'get' | 'getBytes',
    name: string,
    version?: string,
  ][] = [];

  override async get(name: string, version?: string): Promise<string> {
    this.calls.push(['get', name, version]);
    return await super.get(name, version);
  }

  override async getBytes(name: string, version?: string): Promise<Uint8Array> {
    this.calls.push(['getBytes', name, version]);
    return await super.getBytes(name, version);
  }
}
