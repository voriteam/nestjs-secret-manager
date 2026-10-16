import {
  PROPERTY_DEPS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
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
   * `Symbol(description)`. A name that different classes share is qualified
   * with the consumer's module, as in `BillingModule.ConsumerService`.
   * Otherwise one class that two modules provide is one entry.
   */
  readonly consumers: readonly string[];
}

interface Consumer {
  readonly name: string;
  readonly moduleName: string;
  readonly metatype: unknown;
}

type ContainerModule =
  ModulesContainer extends Map<string, infer M> ? M : never;
type InstanceWrapper =
  ContainerModule['providers'] extends Map<unknown, infer W> ? W : never;

/**
 * The secrets this graph injects. It reads metadata only, instantiates
 * nothing and runs no hooks, so it works on a preview-mode graph.
 *
 * Walks every module's providers, controllers, injectables (the guards,
 * interceptors, pipes and filters Nest builds for the module) and
 * middlewares, because the injector constructs all four. Middlewares are
 * registered by `NestApplication.init()` before `onModuleInit`. An
 * application context, including a preview-mode one, has no middleware, so a
 * graph built with `createApplicationContext` omits middleware consumers.
 * `NestFactory.create(AppModule, { preview: true })` followed by
 * `await app.init()` registers middleware without constructing it.
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
    { requirement: SecretRequirement; consumers: Consumer[] }
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
          consumers: [],
        };
        entry.consumers.push({
          name: String(wrapper.name),
          moduleName: moduleRef.name,
          metatype: wrapper.metatype,
        });
        found.set(requirement.token, entry);
      }
    }
  }
  return [...found.values()]
    .map(({ requirement, consumers }) => ({
      requirement,
      consumers: consumerNames(consumers),
    }))
    .sort((a, b) => {
      const left = sortKey(a.requirement);
      const right = sortKey(b.requirement);
      return left === right ? 0 : left < right ? -1 : 1;
    });
}

/**
 * The tokens Nest's injector resolves for this wrapper. A non-nil `inject` is
 * the injector's own test for a factory, and it also covers `useExisting`.
 * A class keeps the last `self:paramtypes` entry per index, as the injector
 * does, because a subclass that re-declares a slot inherits its parent's
 * entry for that slot in the same metadata array. Every property entry
 * counts, inherited ones included, because the injector resolves them all.
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
  const properties: { type: unknown }[] =
    Reflect.getMetadata(PROPERTY_DEPS_METADATA, metatype) ?? [];
  return [...byIndex.values(), ...properties.map(({ type }) => type)];
}

function consumerNames(consumers: readonly Consumer[]): string[] {
  const shared = new Set(
    consumers
      .filter((consumer) =>
        consumers.some(
          ({ name, metatype }) =>
            name === consumer.name && metatype !== consumer.metatype,
        ),
      )
      .map(({ name }) => name),
  );
  const names = consumers.map(({ name, moduleName }) =>
    shared.has(name) ? `${moduleName}.${name}` : name,
  );
  return [...new Set(names)].sort();
}

function sortKey({ name, backend, version, kind }: SecretRequirement): string {
  return [name, backend ?? '', version ?? '', kind].join('\0');
}
