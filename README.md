# @vori/nestjs-secret-manager

A NestJS module for accessing secrets via dependency injection, with startup validation, in-memory caching, and
pluggable backends.

## Why use this?

We created this package to solve a few repeated issues:

**IAM misconfiguration**

Secrets were added in code, but service accounts were not updated to access these secrets. These misconfigurations
surfaced at runtime instead of sooner. This module mitigates that by probing every secret declared via `@InjectSecret`
at boot — inaccessible secrets fail startup, which prevents misconfigurations from entering production. Secrets fetched
only via `service.get(...)` (without a corresponding decorator) fall outside this guarantee; see
[Startup validation scope](#startup-validation-scope) for the full caveat.

**Repeated loading**

Some of our secrets are accessed frequently, especially at startup time. These repeated accesses are now cached in
memory, reducing overall latency to retrieve secrets.

**Usage tracking**

"Is this secret actually used?" We can now more definitively answer this question via telemetry—spans for each secret
access—and dependency injection (e.g., tracing the dependency map).

## Features

- `@InjectSecret` **decorator** — inject secret values directly into services as constructor parameters
- **Startup validation** — fail fast on boot if any registered secret is inaccessible
- **In-memory caching** — cache-first lookups with optional TTL to reduce backend calls
- **Multiple backends** — Google Cloud Secret Manager and in-memory (for testing/local dev)
- **Custom backends** — extend via the `SecretBackend` interface
- **OpenTelemetry tracing** — spans on every secret fetch with `secret.name`, `secret.version`, and `secret.backend`
  attributes
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
import {Module} from '@nestjs/common';
import {
  GcpSecretManagerBackend,
  SecretManagerModule,
} from '@vori/nestjs-secret-manager';

@Module({
  imports: [
    SecretManagerModule.forRoot({
      defaultBackend: 'gcp',
      backends: [new GcpSecretManagerBackend('my-gcp-project')],
      validateOnStartup: true,
    }),
  ],
})
export class AppModule {
}
```

Each backend is responsible for its own configuration — the module itself is agnostic to which backends exist. Add as
many as you need; `defaultBackend` selects the one used when `@InjectSecret` doesn't specify a backend.

### 2. Inject secrets into services

```typescript
// my.service.ts
import { Injectable } from '@nestjs/common';
import {
  InjectSecret,
  type SecretAccessor,
} from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(
    @InjectSecret('api-key')
    private readonly getApiKey: SecretAccessor,
    @InjectSecret('db-password', { version: '2' })
    private readonly getDbPassword: SecretAccessor,
  ) {}

  async loadConfig() {
    const apiKey = await this.getApiKey();
    const dbPassword = await this.getDbPassword();
    // …use here; the values fall out of scope when this method returns.
  }
}
```

`@InjectSecret` resolves to a `SecretAccessor` (`() => Promise<string>`) — calling it fetches the value cache-first from the configured backend. The secret value is **never stored on the consumer's instance**; see [Security considerations](#security-considerations) for why this is the only injection mode.

If `validateOnStartup` is enabled (the default), the application refuses to start when any registered secret can't be fetched, so misconfigured access fails at boot rather than at first call. **Only secrets declared via `@InjectSecret` are probed** — see [Startup validation scope](#startup-validation-scope) for what this excludes.

## Configuration

### `forRoot` — static configuration

```typescript
import {
  GcpSecretManagerBackend,
  InMemorySecretBackend,
  SecretManagerModule,
} from '@vori/nestjs-secret-manager';

SecretManagerModule.forRoot({
  // Required (unless skipLoading): name of the backend used when @InjectSecret
  // does not specify one. Must match a backend's `name`.
  defaultBackend: 'gcp',

  // Required (unless skipLoading): backends available for resolution.
  backends: [
    new GcpSecretManagerBackend('my-project'),
    new InMemorySecretBackend({'local-secret': 'local-value'}),
  ],

  // Fail startup if any registered secret is inaccessible (default: true)
  validateOnStartup: true,

  // Enable in-memory caching (default: true)
  cacheEnabled: true,

  // Cache TTL in milliseconds. Defaults to 15 minutes when unset; bounds
  // staleness and rotation lag. Set to `0` to cache for the lifetime of
  // the process (explicit escape hatch).
  cacheTTL: 60_000,

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
    backends: [new GcpSecretManagerBackend(config.get('GCP_PROJECT_ID'))],
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

### Binary secrets — `@InjectSecretBytes`

For payloads where UTF-8 decoding would be lossy (PEM/DER private keys, AEAD keys, packed credential blobs), use `@InjectSecretBytes`. It mirrors `@InjectSecret` but resolves to a `SecretBytesAccessor` (`() => Promise<Uint8Array>`):

```typescript
import {
  InjectSecretBytes,
  type SecretBytesAccessor,
} from '@vori/nestjs-secret-manager';

@Injectable()
export class TokenSigner {
  constructor(
    @InjectSecretBytes('signing-key')
    private readonly getSigningKey: SecretBytesAccessor,
  ) {}

  async sign(payload: Uint8Array) {
    const keyBytes = await this.getSigningKey();
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', key, payload);
  }
}
```

The same secret name can be injected as both a string and bytes in different services — the registry tracks them as separate requirements. Programmatic access mirrors the pair: `service.getBytes({ name, version?, backend? })` and `service.getLatestBytes({ name, backend? })`.

### Why `@InjectSecret` returns a function, not a string

A common pattern in DI containers is to inject the resolved secret directly:

```typescript
// NOT how this library works
constructor(@InjectSecret('api-key') private readonly apiKey: string) {}
```

That stores the secret as an instance field for the lifetime of the service. NestJS providers are singletons, so the value pins to the heap until the process exits. Worse, anything that serializes the service — a Sentry breadcrumb, a structured log line, an exception filter dumping `this`, a debugger inspector — can leak it.

This library deliberately offers no `string`-typed mode. `@InjectSecret` always resolves to a `SecretAccessor`:

```typescript
@Injectable()
export class PartnerClient {
  constructor(
    @InjectSecret('partner-api-token')
    private readonly getPartnerToken: SecretAccessor,
  ) {}

  async fetchInvoice(invoiceId: string) {
    const token = await this.getPartnerToken();
    return fetch(`https://api.partner.example.com/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // token goes out of scope here — no instance field, nothing to leak.
  }
}
```

The cost is one `await` per call site. The benefit is that the consumer instance never holds the value, and the cache is the only long-lived copy in memory (and that's redacted from `JSON.stringify` and `util.inspect` — see [Security considerations](#security-considerations)).

If you genuinely need the string at constructor time (e.g., some sync third-party client that won't accept a deferred token), defer the construction itself: resolve the accessor in `onModuleInit` and store the resulting *client*, not the *secret*.

## Programmatic access

Inject `SecretManagerService` directly when you need runtime secret lookups:

```typescript
import {Injectable} from '@nestjs/common';
import {SecretManagerService} from '@vori/nestjs-secret-manager';

@Injectable()
export class MyService {
  constructor(private readonly secrets: SecretManagerService) {
  }

  async getConnectionString() {
    // Fetch the latest version
    return this.secrets.get({name: 'db-connection-string'});

    // Fetch a specific version
    // return this.secrets.get({ name: 'db-connection-string', version: '3' });

    // Fetch from a specific backend
    // return this.secrets.get({ name: 'db-connection-string', backend: 'memory' });
  }
}
```

### Additional service methods

| Method                                   | Description                                                                              |
|------------------------------------------|------------------------------------------------------------------------------------------|
| `get({ name, version?, backend? })`      | Fetch a secret as a UTF-8 string; defaults to `'latest'` and the configured default backend |
| `getLatest({ name, backend? })`          | Alias for `get({ name, version: 'latest', backend })`                                    |
| `getBytes({ name, version?, backend? })` | Fetch a secret as raw bytes (`Uint8Array`); use for binary payloads                      |
| `getLatestBytes({ name, backend? })`     | Alias for `getBytes({ name, version: 'latest', backend })`                               |
| `clearCache()`                           | Flush all cached entries (both string and bytes views)                                   |

### Startup validation scope

Startup validation iterates the secrets registered by the `@InjectSecret` decorator and probes each one against its
backend. **Secrets accessed only via `service.get(...)` are not registered** — they're invisible to the validator and
their access permissions won't be checked at boot. A typo in a name, a missing IAM grant, or a deleted secret will
surface at the first runtime call instead.

Rule of thumb: if the secret name is known at compile time, use `@InjectSecret('name')` and you get validation for
free. Reach for `service.get(...)` only when the name is genuinely computed at runtime (per-tenant, per-request,
selected from config) — those names are not knowable at boot, so per-secret validation isn't possible regardless of
the API. This is a deliberate scope decision; the package does not ship a side-channel "extra secrets to validate"
list because maintaining it parallel to the call sites is exactly the rot the decorator-based approach was designed
to avoid.

## Testing

`forTesting` configures the module with the in-memory backend and disables startup validation, making test setup
lightweight:

```typescript
import {Test} from '@nestjs/testing';
import {SecretManagerModule} from '@vori/nestjs-secret-manager';

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

Implement `SecretBackend` to integrate any secret provider, then pass an instance via `backends`:

```typescript
import {
  SecretBackend,
  SecretManagerModule,
} from '@vori/nestjs-secret-manager';

class VaultBackend implements SecretBackend {
  readonly name = 'vault';

  constructor(private readonly options: { url: string; token: string }) {
  }

  async get(name: string, version?: string): Promise<string> {
    // Fetch from HashiCorp Vault, AWS Secrets Manager, etc.
  }

  async getLatest(name: string): Promise<string> {
    return this.get(name);
  }
}

SecretManagerModule.forRoot({
  defaultBackend: 'vault',
  backends: [
    new VaultBackend({url: 'https://vault.example.com', token: '...'}),
  ],
});

// Then use via decorator or service
@InjectSecret('my-secret', {backend: 'vault'})
```

If your backend needs DI-resolved configuration (e.g., from `ConfigService`), use `forRootAsync` and construct the
backend inside the factory:

```typescript
SecretManagerModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    defaultBackend: 'vault',
    backends: [
      new VaultBackend({
        url: config.get('VAULT_URL'),
        token: config.get('VAULT_TOKEN'),
      }),
    ],
  }),
  inject: [ConfigService],
});
```

## Error handling

The module throws typed errors you can catch and handle specifically:

```typescript
import {
  SecretNotFoundError,
  SecretAccessDeniedError,
} from '@vori/nestjs-secret-manager';

try {
  await secrets.get({name: 'my-secret'});
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

| gRPC status         | Code | Error thrown              |
|---------------------|------|---------------------------|
| `NOT_FOUND`         | 5    | `SecretNotFoundError`     |
| `PERMISSION_DENIED` | 7    | `SecretAccessDeniedError` |

## Security considerations

This module fetches secrets from a backend and holds them in process memory. The substrate is no different from a
hand-rolled `accessSecretVersion` call — once a value reaches Node, it lives on the V8 heap as an immutable string until
it's collected. But because secrets are centralized here, the threat profile is worth being explicit about.

### Threat model

| Risk                                                                                                                   | Mitigation in this module                                                                                                                                                                                                                     |
|------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Accidental serialization.** A logger or error reporter dumps a service that holds the cache.                         | `SecretManagerService` and `SecretCache` both override `toJSON()` and `util.inspect.custom` to return `[…  redacted]`. Internal state is held in JS `#private` fields, so it's unreachable via `Object.keys`, property access, or reflection. |
| **Long-lived service fields.** A constructor parameter typed `string` would keep the value pinned for the process lifetime. | `@InjectSecret` only resolves to a `SecretAccessor` (`() => Promise<string>`); there is no string-typed injection mode. Consumers fetch on demand and the value falls out of scope. |
| **Indefinite caching / rotation lag.** A rotated or revoked secret stays valid in the running process forever.         | `cacheTTL` defaults to **15 minutes**. Set explicitly to bound staleness more tightly, or to `0` to opt back into "cache forever."                                                                                                            |
| **Heap dumps.** A heap snapshot exposes every live string.                                                             | The `#private` fields make secrets harder to find via well-known property paths, but V8 strings can't be zeroed — there is no fix at this layer. Consider whether your hosting environment's diagnostics export heap dumps to third parties.  |

### What this module does *not* do

- **Memory zeroing.** V8 strings are immutable; secrets remain on the heap until GC reclaims them. There is no portable
  workaround.
- **Background rotation.** The cache expires entries on read, not via a refresh loop. Long-running services that fetch a
  secret rarely will see it stay cached for the full TTL.
- **Exception filtering.** If you `throw error.with(secretValue)` (or include a secret in any error message yourself),
  this module won't redact it. Don't pass secret values into error constructors.

## GCP authentication

The GCP backend
uses [Application Default Credentials (ADC)](https://cloud.google.com/docs/authentication/application-default-credentials).
No explicit credential configuration is required when running on GCP (Cloud Run, GKE, etc.). For local development,
authenticate with:

```bash
gcloud auth application-default login
```

## OpenTelemetry

Every secret fetch creates a `secret.get` span with the following attributes:

| Attribute        | Description                                  |
|------------------|----------------------------------------------|
| `secret.name`    | The name of the secret                       |
| `secret.version` | The resolved version (e.g., `latest` or `3`) |
| `secret.backend` | The backend used (e.g., `gcp`, `memory`)     |

Errors are recorded on the span and the span status is set to `ERROR`.