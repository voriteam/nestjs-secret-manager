import { SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';

import { SecretRequirement, secretRegistry } from './constants';

/** A secret the built graph injects, and the names of what Nest builds with it. */
export interface InjectedSecret {
  readonly requirement: SecretRequirement;
  /**
   * Sorted and unique. A class provider is named by the class Nest
   * constructs, so `{ provide: Foo, useClass: Bar }` reads `Bar`, the class
   * that carries the decorator. A factory or alias provider is named by its
   * token: a string as itself, a class by its name, a symbol as
   * `Symbol(description)`.
   */
  readonly consumers: readonly string[];
}

type NestModule = ModulesContainer extends Map<string, infer M> ? M : never;
type InstanceWrapper =
  NestModule['providers'] extends Map<unknown, infer W> ? W : never;

/**
 * The secrets this graph injects. It reads metadata only, instantiates
 * nothing and runs no hooks, so a preview-mode graph and a booted one give the
 * same answer.
 *
 * Walks every module's providers, controllers, injectables (the guards,
 * interceptors, pipes and filters Nest builds for the module) and
 * middlewares, because the injector constructs all four. Middlewares are
 * registered by `NestApplication.init()` before `onModuleInit`, and an
 * application context has none.
 *
 * One entry per requirement token, so a string and a bytes injection of one
 * name are two entries. Ordered by name, backend, version, then kind, so the
 * result does not move when module order does.
 */
export function collectInjectedSecrets(
  modules: ModulesContainer,
): InjectedSecret[] {
  const found = new Map<
    string,
    { requirement: SecretRequirement; consumers: Set<string> }
  >();
  for (const moduleRef of modules.values()) {
    const wrappers = [
      ...moduleRef.providers.values(),
      ...moduleRef.controllers.values(),
      ...moduleRef.injectables.values(),
      ...moduleRef.middlewares.values(),
    ];
    for (const wrapper of wrappers) {
      for (const token of dependencyTokens(wrapper)) {
        const requirement =
          typeof token === 'string' ? secretRegistry.get(token) : undefined;
        if (requirement === undefined) {
          continue;
        }
        const entry = found.get(requirement.token) ?? {
          requirement,
          consumers: new Set<string>(),
        };
        entry.consumers.add(consumerName(wrapper));
        found.set(requirement.token, entry);
      }
    }
  }
  return [...found.values()]
    .map(({ requirement, consumers }) => ({
      requirement,
      consumers: [...consumers].sort(),
    }))
    .sort((a, b) => compareRequirements(a.requirement, b.requirement));
}

/**
 * The tokens Nest's injector resolves for this wrapper. A non-nil `inject` is
 * the injector's own test for a factory, and it also covers `useExisting`.
 * A class keeps the last `self:paramtypes` entry per index, as the injector
 * does, because a subclass that re-declares a slot inherits its parent's
 * entry for that slot in the same metadata array.
 */
function dependencyTokens(wrapper: InstanceWrapper): unknown[] {
  const { metatype, inject } = wrapper;
  if (typeof metatype !== 'function') {
    return [];
  }
  if (inject != null) {
    return inject.map((dependency) =>
      typeof dependency === 'object' &&
      dependency !== null &&
      'token' in dependency
        ? dependency.token
        : dependency,
    );
  }
  const declared: { index: number; param: unknown }[] =
    Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, metatype) ?? [];
  const byIndex = new Map<number, unknown>();
  for (const { index, param } of declared) {
    byIndex.set(index, param);
  }
  return [...byIndex.values()];
}

function consumerName(wrapper: InstanceWrapper): string {
  const { metatype, inject, name } = wrapper;
  if (inject == null && typeof metatype === 'function' && metatype.name) {
    return metatype.name;
  }
  return typeof name === 'string' ? name : String(name);
}

function compareRequirements(
  a: SecretRequirement,
  b: SecretRequirement,
): number {
  const keyOf = (r: SecretRequirement): string[] => [
    r.name,
    r.backend ?? '',
    r.version ?? '',
    r.kind,
  ];
  const left = keyOf(a);
  const right = keyOf(b);
  for (let i = 0; i < left.length; i += 1) {
    const x = left[i] ?? '';
    const y = right[i] ?? '';
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
