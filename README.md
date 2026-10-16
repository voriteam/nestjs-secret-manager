# @vori/nestjs-secret-manager

A NestJS module for accessing secrets via dependency injection, with startup validation, in-memory caching, and
pluggable backends.

## Why use this?

We created this package to solve a few repeated issues:

**IAM misconfiguration**

Secrets were added in code, but service accounts were not updated to access these secrets. These misconfigurations
surfaced at runtime instead of sooner. This module probes, at boot, every secret injected into a class the application
builds. An inaccessible secret fails startup, so the misconfiguration never reaches production. Secrets fetched only
through `service.get(...)` fall outside this check. See [Startup validation](#startup-validation) for the full scope.

**Repeated loading**

Some of our secrets are accessed frequently, especially at startup time. These repeated accesses are now cached in
memory, reducing overall latency to retrieve secrets.

**Usage tracking**

"Is this secret actually used?" `collectInjectedSecrets` answers it from the dependency graph. It lists every secret an
application's classes inject, and which classes inject it.

## Features

- `@InjectSecret` and `@InjectSecretBytes` inject secret accessors into constructor parameters, and
  `secretAccessorToken` and `secretBytesAccessorToken` name the same accessors in a factory provider's `inject`.
- Startup validation probes the secrets the application's classes inject, and can enforce, warn or be switched off.
- An in-memory cache with a TTL serves repeat reads, and concurrent reads of one secret share one backend fetch.
- Backends for Google Cloud Secret Manager and for in-memory secrets (tests and local development) ship with the
  package, and the `SecretBackend` interface adds others.
- The module is global. Register it once in `AppModule` and every module can inject secrets.

## Requirements

- Node.js &gt;= 24
- NestJS 10 or 11 (`@nestjs/common` and `@nestjs/core`)
- `@google-cloud/secret-manager` 5, 6 or 7, only when you use `GcpSecretManagerBackend`

## Installation

```bash
pnpm add @vori/nestjs-secret-manager
# Only for GcpSecretManagerBackend
pnpm add @google-cloud/secret-manager
```

The Google Cloud client is an optional peer dependency. The package loads it when you construct a
`GcpSecretManagerBackend`, and that constructor throws a message naming the package when it is not installed.

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

By default the application refuses to start when it cannot read a secret that one of its classes injects, so misconfigured access fails at boot rather than at the first call. See [Startup validation](#startup-validation) for what is probed and how to warn instead.

## Configuration

### `forRoot` — static configuration

```typescript
import {
  GcpSecretManagerBackend,
  InMemorySecretBackend,
  SecretManagerModule,
  StartupValidation,
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

  // What boot does with the secrets the application's classes inject:
  // Enforce (default) fails startup, Warn logs, Off skips the check.
  startupValidation: StartupValidation.Enforce,

  // Enable in-memory caching (default: true)
  cacheEnabled: true,

  // Cache TTL in milliseconds. Defaults to 15 minutes when unset; bounds
  // staleness and rotation lag. Set to `0` to cache for the lifetime of
  // the process (explicit escape hatch).
  cacheTTL: 60_000,
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
    startupValidation:
      config.get('NODE_ENV') === 'production'
        ? StartupValidation.Enforce
        : StartupValidation.Warn,
  }),
  inject: [ConfigService],
});
```

`useExisting` and `useClass` (via the `SecretManagerOptionsFactory` interface) are also supported.

## Startup validation

When the application initializes, the module collects the secrets that the classes Nest builds inject, probes them all
in parallel, and logs one line:

```
Validated 24 injected secret(s) in 312ms
```

### What is probed

A secret is probed when `@InjectSecret` or `@InjectSecretBytes` sits on a constructor parameter of a class that Nest
instantiates in this application: a provider, a controller, a guard, interceptor, pipe or filter, or a middleware. A
factory provider counts too when its `inject` list names a secret's token, as described in
[Factory providers](#factory-providers). Importing a decorated class is not enough. A class that is imported but never
provided by any module is not probed, so a worker that shares code with an API does not fail on secrets only the API
uses.

Secrets read only through `service.get(...)` are not probed. Their names are invisible to the graph, so a typo, a
missing IAM grant or a deleted secret surfaces at the first runtime call instead. If the name is known at compile time,
use `@InjectSecret('name')` and validation covers it. Reach for `service.get(...)` only when the name is computed at
runtime (per tenant, per request, or selected from config), because those names cannot be known at boot. The package
deliberately ships no side list of extra secrets to validate, because a list kept apart from the call sites drifts from
them.

Validation runs in `onModuleInit`, ahead of the `onModuleInit` of every module that is not global, on NestJS 10 and 11.
So a consumer in such a module that reads its secret in its own `onModuleInit` cannot fail before the report. A read during construction, in a constructor
or in the body of an async factory provider, happens before any hook. If that read fails, boot stops with the read's own
error and no report.

### Modes

`startupValidation` takes a `StartupValidation` value:

| Mode | Behavior |
|------|----------|
| `StartupValidation.Enforce` (default) | Fails initialization with a `SecretValidationError` when any probe fails. |
| `StartupValidation.Warn` | Logs the same list of failures once at warn level and keeps booting. |
| `StartupValidation.Off` | Probes nothing. |

With failures, the summary line ends with the count, as in `Validated 13 injected secret(s) in 210ms, 12 failed`. The
error message, which `Warn` also logs, lists every failed secret with its backend, version and the classes that inject
it:

```
Failed to validate 2 injected secret(s):
  - payments-api-key (backend: gcp, version: latest), needed by BillingService, PaymentsController: Access denied to secret 'payments-api-key' in backend 'gcp'
  - signing-key (backend: gcp, version: 3, bytes), needed by TokenSigner: Secret 'signing-key' not found in backend 'gcp' (version: 3)
```

`SecretValidationError.failures` carries the same data as `{ name, version, backend, kind, consumers, error }` objects,
where `error` is the underlying `SecretNotFoundError` or `SecretAccessDeniedError`.

### Listing a graph's secrets from a tool

`collectInjectedSecrets(modules)` returns the list the validator probes, without reading any secret. It reads metadata
only, so it works on a graph built in preview mode, where Nest instantiates nothing:

```typescript
import { NestContainer, NestFactory } from '@nestjs/core';
import { collectInjectedSecrets } from '@vori/nestjs-secret-manager';

const app = await NestFactory.create(AppModule, { preview: true, logger: false });
// Registers middleware without constructing it.
await app.init();
// On NestJS 10, app.get(ModulesContainer) returns null in preview mode,
// so read the container directly.
const modules = (app as unknown as { container: NestContainer }).container.getModules();

for (const { requirement, consumers } of collectInjectedSecrets(modules)) {
  console.log(requirement.name, requirement.kind, consumers.join(', '));
}
```

Nest registers middleware only when an HTTP application initializes. A graph built with
`NestFactory.createApplicationContext` therefore has no middleware, and the list omits secrets that only middleware
injects. That is the right call for an application that has no HTTP server, such as a worker.

Each entry is one `{ requirement, consumers }` pair per injection token, sorted by secret name, with `consumers` sorted.

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

The same secret name can be injected as both a string and bytes in different services. The registry tracks them as separate requirements, and startup validation probes each one. Programmatic access mirrors the pair with `service.getBytes({ name, version?, backend? })`.

### Factory providers

A factory provider has no constructor parameters to decorate. List the secret's token in its `inject` instead.
`secretAccessorToken(name, options?)` returns the token `@InjectSecret(name, options)` injects, and
`secretBytesAccessorToken(name, options?)` returns the token `@InjectSecretBytes(name, options)` injects. Both take the
decorator's options.

```typescript
import {Module} from '@nestjs/common';
import {
  secretAccessorToken,
  type SecretAccessor,
} from '@vori/nestjs-secret-manager';

@Module({
  providers: [
    {
      provide: PartnerClient,
      useFactory: (getToken: SecretAccessor) => new PartnerClient(getToken),
      inject: [secretAccessorToken('partner-api-token')],
    },
  ],
  exports: [PartnerClient],
})
export class PartnerModule {}
```

The factory receives the same accessor the decorator would inject. Startup validation probes the secret and names the
provider's token, `PartnerClient` here, as its consumer. A token and a decorator with the same name and options share
one requirement, so validation probes the secret once and names both consumers.

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
| `get({ name, version?, backend? })`      | Fetch a secret as a UTF-8 string. Defaults to `'latest'` and the configured default backend. |
| `getBytes({ name, version?, backend? })` | Fetch a secret as raw bytes (`Uint8Array`) for binary payloads.                          |
| `invalidate({ name, version?, backend? })` | Drop one secret's cached string and bytes entries, so the next read fetches it from the backend. A fetch already in flight still answers its callers but is not cached. |
| `clearCache()`                           | Flush every cached entry. A fetch already in flight still answers its callers but is not cached. |

Reads are cache-first. Concurrent reads of one uncached secret share a single backend fetch, even with
`cacheEnabled: false`, and a failed fetch is never cached, so the next read tries again. Every backend fetch logs
`Fetching secret` with the backend, name and version at debug level.

When a vendor rejects a credential that may have been rotated, call `invalidate` with the secret's name and read it
again. The other secrets stay cached:

```typescript
const response = await this.callPartner(await this.getPartnerToken());
if (response.status === 401) {
  this.secrets.invalidate({name: 'partner-api-token'});
  return this.callPartner(await this.getPartnerToken());
}
```

Under `forSkipLoading()`, `invalidate` does nothing.

## Testing

`forTesting` configures the module with the in-memory backend, turns caching and startup validation off, and takes the
secrets a test needs:

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

A test that builds a large graph rarely wants to seed every secret it injects. Pass `fallback` to serve any secret the
test did not seed:

```typescript
SecretManagerModule.forTesting(
  { 'api-key': 'test-api-key' },
  { fallback: (name) => `fake-secret::${name}` },
);
```

Without `fallback`, reading an unseeded secret throws `SecretNotFoundError`. The same option exists on
`new InMemorySecretBackend(secrets, { fallback })`.

## Running without secret access

CLI tools, code generators and builds often construct the application without any access to a secret backend.
`forSkipLoading()` configures no backends and probes nothing, and every read returns a JSON placeholder:

```typescript
SecretManagerModule.forSkipLoading();

await secrets.get({ name: 'stripe-config' });
// '{"_placeholder":true,"key":"stripe-config"}'
```

The placeholder parses as JSON, so a provider that runs `JSON.parse` on its secret while it starts still starts.
`getBytes` returns the same text, UTF-8 encoded.

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

  // `version` is 'latest' when the caller pinned none.
  async get(name: string, version?: string): Promise<string> {
    // Fetch from HashiCorp Vault, AWS Secrets Manager, etc.
  }

  async getBytes(name: string, version?: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.get(name, version));
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
  SecretAccessDeniedError,
  SecretNotFoundError,
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

At boot, `SecretValidationError` collects every failed probe. See [Modes](#modes).

Here is how Google Secret Manager gRPC statuses are mapped:

| gRPC status         | Code | Error thrown              |
|---------------------|------|---------------------------|
| `NOT_FOUND`         | 5    | `SecretNotFoundError`     |
| `PERMISSION_DENIED` | 7    | `SecretAccessDeniedError` |

## Upgrading from 0.1

- `validateOnStartup` is replaced by `startupValidation`. A `forRootAsync` factory that still returns
  `validateOnStartup` compiles, and the key is ignored, so remove it. `validateOnStartup: false` becomes
  `StartupValidation.Off`.
- Validation probes only the secrets that classes in the application's graph inject, not every decorated class the
  process imported.
- `debug` is removed. Every backend fetch logs at debug level.
- `getLatest` and `getLatestBytes` are removed from `SecretManagerService` and from `SecretBackend`. Call `get` or
  `getBytes` without a version. A custom backend no longer implements them.
- Under `forSkipLoading()`, reads return `{"_placeholder":true,"key":"<name>"}` instead of `SECRET_NOT_LOADED:<name>`.
- The package no longer creates OpenTelemetry spans, and `@opentelemetry/api` is no longer a peer dependency.
- `@google-cloud/secret-manager` is an optional peer dependency. Install it yourself to use `GcpSecretManagerBackend`.
- `SecretCache` is no longer exported.

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

