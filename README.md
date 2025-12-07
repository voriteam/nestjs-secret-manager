# @vori/nestjs-secret-manager

A NestJS module for managing secrets with dependency injection, startup validation, and caching.

## Features

- **`@InjectSecret` decorator** - Inject secrets directly into your services
- **Startup validation** - Fail fast if secrets are inaccessible
- **In-memory caching** - Reduce backend API calls
- **Multiple backends** - GCP Secret Manager, in-memory (for testing)
- **OpenTelemetry support** - Tracing spans for secret access

## Installation

```bash
pnpm add @vori/nestjs-secret-manager
```

## Quick Start

### 1. Import the module

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

### 2. Inject secrets into your services

```typescript
// my.service.ts
import { Injectable } from '@nestjs/common';
import { InjectSecret } from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(
    @InjectSecret('api-key') private readonly apiKey: string,
    @InjectSecret('db-password') private readonly dbPassword: string,
  ) {}

  async doSomething() {
    // Use your secrets
    console.log('API Key:', this.apiKey);
  }
}
```

## Configuration

### Static configuration with `forRoot`

```typescript
SecretManagerModule.forRoot({
  // Required: which backend to use by default
  defaultBackend: 'gcp',

  // Required for GCP backend
  gcpProjectId: 'my-project',

  // Optional: fail startup if secrets can't be fetched (default: true)
  validateOnStartup: true,

  // Optional: cache fetched secrets (default: true)
  cacheEnabled: true,

  // Optional: cache TTL in milliseconds (default: unlimited)
  cacheTTL: 60000,

  // Optional: preload secrets for in-memory backend
  inMemorySecrets: {
    'local-secret': 'local-value',
  },

  // Optional: enable debug logging (default: false)
  debug: false,
});
```

### Async configuration with `forRootAsync`

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

## Testing

Use `forTesting` for easy test setup:

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

  it('should use test secrets', () => {
    // Your tests here
  });
});
```

## Decorator Options

```typescript
@InjectSecret('secret-name')                           // Basic usage
@InjectSecret('secret-name', { version: '2' })         // Specific version
@InjectSecret('secret-name', { backend: 'memory' })    // Specific backend
```

## Programmatic Access

You can also use `SecretManagerService` directly:

```typescript
import { Injectable } from '@nestjs/common';
import { SecretManagerService } from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(private readonly secrets: SecretManagerService) {}

  async getSecret() {
    // Get latest version
    const value = await this.secrets.get('my-secret');

    // Get specific version
    const v2 = await this.secrets.get('my-secret', '2');

    // Get from specific backend
    const local = await this.secrets.get('my-secret', undefined, 'memory');

    return value;
  }
}
```

## Custom Backends

Implement the `SecretBackend` interface to add custom providers:

```typescript
import { SecretBackend } from '@vori/nestjs-secret-manager';

class MyCustomBackend implements SecretBackend {
  readonly name = 'custom';

  async get(name: string, version?: string): Promise<string> {
    // Your implementation
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name, 'latest');
  }
}

// Register in your service
secretManagerService.registerBackend(new MyCustomBackend());
```

## Error Handling

The module throws specific errors you can catch:

```typescript
import {
  SecretNotFoundError,
  SecretAccessDeniedError,
} from '@vori/nestjs-secret-manager';

try {
  await secrets.get('my-secret');
} catch (error) {
  if (error instanceof SecretNotFoundError) {
    console.log('Secret does not exist:', error.secretName);
  } else if (error instanceof SecretAccessDeniedError) {
    console.log('Access denied:', error.reason);
  }
}
```

## OpenTelemetry Support

The module creates spans for all secret fetches:

- Span name: `secret.get`
- Attributes: `secret.name`, `secret.version`, `secret.backend`

## License

MIT
