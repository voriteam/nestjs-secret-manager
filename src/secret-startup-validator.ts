import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

import { SECRET_MANAGER_OPTIONS, SecretKind } from './constants';
import type { SecretRequirement } from './constants';
import {
  SecretValidationError,
  SecretValidationFailure,
} from './errors/secret-validation.error';
import { InjectedSecret, collectInjectedSecrets } from './injected-secrets';
import { StartupValidation } from './interfaces/secret-manager-options.interface';
import type { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';
import { SecretManagerService } from './secret-manager.service';

const STARTUP_VALIDATION_MODES: readonly string[] =
  Object.values(StartupValidation);

/**
 * Probes, at boot, every secret the built graph injects. A provider of its
 * own rather than part of SecretManagerService, so the service stays
 * constructible from options alone and overriding it in a test does not
 * silently drop validation.
 */
@Injectable()
export class SecretStartupValidator implements OnModuleInit {
  readonly #logger = new Logger(SecretStartupValidator.name);
  readonly #mode: StartupValidation;
  readonly #skipLoading: boolean;
  readonly #defaultBackend: string | undefined;
  readonly #modules: ModulesContainer;
  readonly #secrets: SecretManagerService;

  constructor(
    @Inject(SECRET_MANAGER_OPTIONS) options: SecretManagerModuleOptions,
    modules: ModulesContainer,
    secrets: SecretManagerService,
  ) {
    this.#mode = startupValidationFrom(options.startupValidation);
    this.#skipLoading = options.skipLoading === true;
    this.#defaultBackend = options.defaultBackend;
    this.#modules = modules;
    this.#secrets = secrets;
  }

  async onModuleInit(): Promise<void> {
    if (this.#skipLoading || this.#mode === StartupValidation.Off) {
      return;
    }

    const startedAt = performance.now();
    const injected = collectInjectedSecrets(this.#modules);
    const settled = await Promise.allSettled(
      injected.map(({ requirement }) => this.#probe(requirement)),
    );
    const failures = injected.flatMap((secret, i) => {
      const outcome = settled[i];
      return outcome?.status === 'rejected'
        ? [this.#failureOf(secret, outcome.reason)]
        : [];
    });
    const durationMs = Math.round(performance.now() - startedAt);

    const failedSuffix =
      failures.length > 0 ? `, ${failures.length} failed` : '';
    this.#logger.log(
      `Validated ${injected.length} injected secret(s) in ${durationMs}ms${failedSuffix}`,
    );
    if (failures.length === 0) {
      return;
    }
    const error = new SecretValidationError(failures);
    if (this.#mode === StartupValidation.Enforce) {
      throw error;
    }
    this.#logger.warn(error.message);
  }

  async #probe({
    name,
    version,
    backend,
    kind,
  }: SecretRequirement): Promise<void> {
    if (kind === SecretKind.Bytes) {
      const bytes = await this.#secrets.getBytes({ name, version, backend });
      bytes.fill(0);
      return;
    }
    await this.#secrets.get({ name, version, backend });
  }

  #failureOf(
    { requirement, consumers }: InjectedSecret,
    reason: unknown,
  ): SecretValidationFailure {
    return {
      name: requirement.name,
      version: requirement.version ?? 'latest',
      backend: requirement.backend ?? this.#defaultBackend ?? 'default',
      kind: requirement.kind,
      consumers,
      error: reason instanceof Error ? reason : new Error(String(reason)),
    };
  }
}

function startupValidationFrom(
  value: StartupValidation | undefined,
): StartupValidation {
  if (value === undefined) {
    return StartupValidation.Enforce;
  }
  if (!STARTUP_VALIDATION_MODES.includes(value)) {
    throw new Error(
      `Invalid startupValidation: '${String(value)}'. Expected one of: ${STARTUP_VALIDATION_MODES.join(', ')}.`,
    );
  }
  return value;
}
