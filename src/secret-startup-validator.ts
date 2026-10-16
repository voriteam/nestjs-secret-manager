import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  PROPERTY_DEPS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';

import {
  SECRET_MANAGER_OPTIONS,
  SecretKind,
  secretRegistry,
} from './constants';
import type { SecretRequirement } from './constants';
import {
  SecretValidationError,
  SecretValidationFailure,
} from './errors/secret-validation.error';
import { StartupValidation } from './interfaces/secret-manager-options.interface';
import type { SecretManagerModuleOptions } from './interfaces/secret-manager-options.interface';
import { SecretManagerService } from './secret-manager.service';

export interface InjectedSecret {
  readonly requirement: SecretRequirement;
  readonly consumers: readonly string[];
}

@Injectable()
export class SecretStartupValidator implements OnModuleInit {
  readonly #logger = new Logger(SecretStartupValidator.name);
  readonly #options: SecretManagerModuleOptions;
  readonly #modules: ModulesContainer;
  readonly #secrets: SecretManagerService;

  constructor(
    @Inject(SECRET_MANAGER_OPTIONS) options: SecretManagerModuleOptions,
    modules: ModulesContainer,
    secrets: SecretManagerService,
  ) {
    this.#options = options;
    this.#modules = modules;
    this.#secrets = secrets;
  }

  async onModuleInit(): Promise<void> {
    const mode = this.#options.startupValidation ?? StartupValidation.Enforce;
    if (this.#options.skipLoading || mode === StartupValidation.Off) {
      return;
    }

    const startedAt = performance.now();
    const injected = collectInjectedSecrets(this.#modules);
    const failures = (
      await Promise.all(injected.map((secret) => this.#probe(secret)))
    ).flat();
    const durationMs = Math.round(performance.now() - startedAt);
    const failed = failures.length > 0 ? `, ${failures.length} failed` : '';
    this.#logger.log(
      `Validated ${injected.length} injected secret(s) in ${durationMs}ms${failed}`,
    );
    if (failures.length === 0) {
      return;
    }

    const error = new SecretValidationError(failures);
    if (mode === StartupValidation.Warn) {
      this.#logger.warn(error.message);
      return;
    }
    throw error;
  }

  async #probe({
    requirement: { name, version, backend, kind },
    consumers,
  }: InjectedSecret): Promise<SecretValidationFailure[]> {
    try {
      if (kind === SecretKind.Bytes) {
        await this.#secrets.getBytes({ name, version, backend });
      } else {
        await this.#secrets.get({ name, version, backend });
      }
      return [];
    } catch (error) {
      return [
        {
          name,
          version: version ?? 'latest',
          backend: backend ?? this.#options.defaultBackend ?? 'none',
          kind,
          consumers,
          error: error instanceof Error ? error : new Error(String(error)),
        },
      ];
    }
  }
}

/**
 * The secrets the scanned graph injects, each with the names of the classes
 * and factory providers that inject it. Reads metadata only, so the graph
 * need not be instantiated.
 */
export function collectInjectedSecrets(
  modules: ModulesContainer,
): InjectedSecret[] {
  const consumersByToken = new Map<unknown, Set<string>>();
  for (const moduleRef of modules.values()) {
    const wrappers = [
      ...moduleRef.providers.values(),
      ...moduleRef.controllers.values(),
      ...moduleRef.injectables.values(),
      ...moduleRef.middlewares.values(),
    ];
    for (const wrapper of wrappers) {
      for (const token of dependencyTokens(wrapper)) {
        const consumers = consumersByToken.get(token) ?? new Set();
        consumersByToken.set(token, consumers.add(String(wrapper.name)));
      }
    }
  }
  return secretRegistry.getAll().flatMap((requirement) => {
    const consumers = consumersByToken.get(requirement.token);
    return consumers ? [{ requirement, consumers: [...consumers] }] : [];
  });
}

function dependencyTokens({ metatype, inject }: InstanceWrapper): unknown[] {
  if (inject) {
    return inject.map((dependency) =>
      typeof dependency === 'object' && 'token' in dependency
        ? dependency.token
        : dependency,
    );
  }
  if (typeof metatype !== 'function') {
    return [];
  }
  const declared: { index: number; param: unknown }[] =
    Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, metatype) ?? [];
  // A subclass's entries follow its parent's, and the injector keeps the last
  // per constructor index.
  const byIndex = new Map(declared.map(({ index, param }) => [index, param]));
  const properties: { type: unknown }[] =
    Reflect.getMetadata(PROPERTY_DEPS_METADATA, metatype) ?? [];
  return [...byIndex.values(), ...properties.map(({ type }) => type)];
}
