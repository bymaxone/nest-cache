/**
 * @fileoverview The names a README snippet uses without declaring them, typed
 * against the published package. `check-published-surface.mjs` copies this file into
 * the throwaway consumer it compiles the snippets in, so a call made through one of
 * these names is checked against the real types instead of resolving to `any`.
 * Only names the surrounding prose introduces belong here; a wrong option, method or
 * field on a package type is a real error and must stay one.
 */
import type { NestFactory as NestFactoryClass } from '@nestjs/core'
import type {
  BymaxCacheModule as BymaxCacheModuleClass,
  CacheService,
  PubSubService,
  ScriptManagerService
} from '@bymax-one/nest-cache'

declare global {
  /** What `this` holds in a snippet that shows service calls without a class around them. */
  interface SnippetContext {
    cache: CacheService
    pubsub: PubSubService
    scripts: ScriptManagerService
  }

  const cache: CacheService
  const pubsub: PubSubService
  const BymaxCacheModule: typeof BymaxCacheModuleClass

  /** The payload type the Pub/Sub snippet publishes. */
  interface UserEvent {
    type: string
    id: string
  }
  function handle(event: UserEvent): Promise<void>

  /** The value types a snippet's Lua and cache-aside examples pass around. */
  interface Profile {
    id: string
  }
  const expected: string
  const next: string

  /** NestJS names a snippet uses without importing them. */
  const NestFactory: typeof NestFactoryClass
  /** The root module of the application a snippet bootstraps. */
  class AppModule {}
  function Module(metadata: { imports?: unknown[] }): ClassDecorator
  function Inject(token: unknown): ParameterDecorator

  /** Peer-package names the dependency-injection snippets refer to by prose. */
  class ConfigService {
    getOrThrow<T = string>(key: string): T
  }
  const config: ConfigService
  class ConfigModule {}
  class LoggerModule {}
}

export {}
