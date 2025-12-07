# @vori/nestjs-secret-manager

A NestJS module for accessing secrets via dependency injection, with startup validation, in-memory caching, and pluggable backends.

## Why use this?

We created this package to solve a few repeated issues:

**IAM misconfiguration**

Secrets were added in code, but service accounts were not updated to access these secrets. These misconfigurations surfaced at runtime instead of sooner. This module solves this by verifying that all registered secrets are accessible at startup. Inaccessible secrets fail startup, which prevents misconfigurations from entering production.

**Repeated loading**

Some of our secrets are accessed frequently, especially at startup time. These repeated accesses are now cached in memory, reducing overall latency to retrieve secrets.

**Usage tracking**

"Is this secret actually used?" We can now more definitively answer this question via telemetry—spans for each secret access—and dependency injection (e.g., tracing the dependency map).

## Features

- `@InjectSecret` **decorator** — inject secret values directly into services as constructor parameters
- **Startup validation** — fail fast on boot if any registered secret is inaccessible
- **In-memory caching** — cache-first lookups with optional TTL to reduce backend calls
- **Multiple backends** — Google Cloud Secret Manager and in-memory (for testing/local dev)
- **Custom backends** — extend via the `SecretBackend` interface
- **OpenTelemetry tracing** — spans on every secret fetch with `secret.name`, `secret.version`, and `secret.backend` attributes
- **Global module** — register once in `AppModule`, available everywhere without re-importing

## Requirements

- Node.js &gt;= 24
- NestJS `^11.0.0`

## Installation

```bash
pnpm add @vori/nestjs-secret-manager
```

## Quick start

### 1. Register the module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { SecretManagerModule } from '@vori/nestjs-secret-manager';

@Module({
  imports: [
    SecretManagerModule.forRoot({
      defaultBackend: 'gcp',
      gcpProjectId: 'my-gcp-project',
      validateOnStartup: true,
    }),
  ],
})
export class AppModule {}
```

### 2. Inject secrets into services

```typescript
// my.service.ts
import { Injectable } from '@nestjs/common';
import { InjectSecret } from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(
    @InjectSecret('api-key') private readonly apiKey: string,
    @InjectSecret('db-password', { version: '2' }) private readonly dbPassword: string,
  ) {}
}
```

Secrets are fetched during application initialization and injected as plain strings. If `validateOnStartup` is enabled (the default), the application will refuse to start if any registered secret cannot be fetched.

## Configuration

### `forRoot` — static configuration

```typescript
SecretManagerModule.forRoot({
  // Required: which backend to use when none is specified in @InjectSecret
  defaultBackend: 'gcp',

  // Required when using the 'gcp' backend
  gcpProjectId: 'my-project',

  // Fail startup if any registered secret is inaccessible (default: true)
  validateOnStartup: true,

  // Enable in-memory caching (default: true)
  cacheEnabled: true,

  // Cache TTL in milliseconds; omit to cache for the lifetime of the process
  cacheTTL: 60_000,

  // Preload secrets into the in-memory backend
  inMemorySecrets: {
    'local-secret': 'local-value',
  },

  // Enable verbose debug logging for cache hits (default: false)
  debug: false,
});
```

### `forRootAsync` — async/factory configuration

Use this when options depend on other providers, such as `ConfigService`:

```typescript
SecretManagerModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    defaultBackend: 'gcp',
    gcpProjectId: config.get('GCP_PROJECT_ID'),
    validateOnStartup: config.get('NODE_ENV') === 'production',
  }),
  inject: [ConfigService],
});
```

`useExisting` and `useClass` (via the `SecretManagerOptionsFactory` interface) are also supported.

## Decorator options

```typescript
// Fetch the latest version from the default backend
@InjectSecret('secret-name')

// Fetch a specific version
@InjectSecret('secret-name', { version: '3' })

// Use a non-default backend
@InjectSecret('secret-name', { backend: 'memory' })
```

## Programmatic access

Inject `SecretManagerService` directly when you need runtime secret lookups:

```typescript
import { Injectable } from '@nestjs/common';
import { SecretManagerService } from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(private readonly secrets: SecretManagerService) {}

  async getConnectionString() {
    // Fetch the latest version
    return this.secrets.get({ name: 'db-connection-string' });

    // Fetch a specific version
    // return this.secrets.get({ name: 'db-connection-string', version: '3' });

    // Fetch from a specific backend
    // return this.secrets.get({ name: 'db-connection-string', backend: 'memory' });
  }
}
```

### Additional service methods

| Method | Description |
| --- | --- |
| `get({ name, version?, backend? })` | Fetch a secret; defaults to `'latest'` version and the configured default backend |
| `getLatest({ name, backend? })` | Alias for `get({ name, version: 'latest', backend })` |
| `clearCache()` | Flush all cached entries |
| `registerBackend(backend)` | Register a custom `SecretBackend` implementation at runtime |
| `getInMemoryBackend()` | Access the in-memory backend directly (useful for test setup) |

## Testing

`forTesting` configures the module with the in-memory backend and disables startup validation, making test setup lightweight:

```typescript
import { Test } from '@nestjs/testing';
import { SecretManagerModule } from '@vori/nestjs-secret-manager';

describe('MyService', () => {
  let service: MyService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        SecretManagerModule.forTesting({
          'api-key': 'test-api-key',
          'db-password': 'test-password',
        }),
      ],
      providers: [MyService],
    }).compile();

    service = module.get<MyService>(MyService);
  });

  it('should use test secrets', async () => {
    // ...
  });
});
```

`forTesting` also clears the internal secret registry between calls to prevent pollution across test suites.

## Custom backends

Implement `SecretBackend` to integrate any secret provider:

```typescript
import { SecretBackend } from '@vori/nestjs-secret-manager';

class VaultBackend implements SecretBackend {
  readonly name = 'vault';

  async get(name: string, version?: string): Promise<string> {
    // Fetch from HashiCorp Vault, AWS Secrets Manager, etc.
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name);
  }
}

// Register at runtime
secretManagerService.registerBackend(new VaultBackend());

// Then use via decorator or service
@InjectSecret('my-secret', { backend: 'vault' })
```

## Error handling

The module throws typed errors you can catch and handle specifically:

```typescript
import {
  SecretNotFoundError,
  SecretAccessDeniedError,
} from '@vori/nestjs-secret-manager';

try {
  await secrets.get({ name: 'my-secret' });
} catch (error) {
  if (error instanceof SecretNotFoundError) {
    // error.secretName, error.backend, error.version
    console.error('Secret does not exist:', error.secretName);
  } else if (error instanceof SecretAccessDeniedError) {
    // error.secretName, error.backend, error.reason
    console.error('Permission denied:', error.reason);
  }
}
```

Here is how Google Secret Manager gRPC statuses are mapped:

| gRPC status | Code | Error thrown |
| --- | --- | --- |
| `NOT_FOUND` | 5 | `SecretNotFoundError` |
| `PERMISSION_DENIED` | 7 | `SecretAccessDeniedError` |

## GCP authentication

The GCP backend uses [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials). No explicit credential configuration is required when running on GCP (Cloud Run, GKE, etc.). For local development, authenticate with:

```bash
gcloud auth application-default login
```

## OpenTelemetry

Every secret fetch creates a `secret.get` span with the following attributes:

| Attribute | Description |
| --- | --- |
| `secret.name` | The name of the secret |
| `secret.version` | The resolved version (e.g. `latest` or `3`) |
| `secret.backend` | The backend used (e.g. `gcp`, `memory`) |

Errors are recorded on the span and the span status is set to `ERROR`.