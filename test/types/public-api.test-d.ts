/**
 * Compile-time type tests for the public API of `@bymax-one/nest-cache`.
 *
 * For a typed cache, the types ARE part of the product — these assertions lock
 * the generic contracts (the nullable reads, the `T`-preserving writes/batches,
 * `eval` returning `unknown`, the readonly parameter shapes) so a refactor that
 * silently widens or loosens a signature fails `pnpm test:types` (`tsc`). There
 * is no runtime here: everything is checked by the compiler.
 */
import type { ChainableCommander } from 'ioredis'
import type { DynamicModule } from '@nestjs/common'

import type {
  CacheService,
  ISerializer,
  ICacheEvents,
  IScriptDefinition,
  CacheException,
  CacheErrorCode,
  Unsubscribe
} from '@bymax-one/nest-cache'
import { BymaxCacheModule } from '@bymax-one/nest-cache'

/** Exact (invariant) type equality — stricter than mutual assignability. */
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
/** Compiles only when the assertion holds; a false assertion is a type error. */
type Expect<T extends true> = T

interface Doc {
  id: number
  tags: string[]
}

declare const cache: CacheService

// `get<T>` must read back `T | null` — the cache-miss nullability is part of the
// contract, not erased to `T`.
type _Get = Expect<Equal<ReturnType<typeof cache.get<Doc>>, Promise<Doc | null>>>
// `getRaw` is always `string | null`, independent of any generic.
type _GetRaw = Expect<Equal<ReturnType<typeof cache.getRaw>, Promise<string | null>>>
// `set<T>` accepts the value as `T` and resolves `void`.
type _Set = Expect<Equal<Parameters<typeof cache.set<Doc>>[2], Doc>>
type _SetRet = Expect<Equal<ReturnType<typeof cache.set<Doc>>, Promise<void>>>
// `mget<T>` is positionally nullable: `Array<T | null>`.
type _Mget = Expect<Equal<ReturnType<typeof cache.mget<Doc>>, Promise<Array<Doc | null>>>>
// `mset<T>` takes readonly `[id, value]` tuples of `T`.
type _Mset = Expect<
  Equal<Parameters<typeof cache.mset<Doc>>[1], ReadonlyArray<readonly [string, Doc]>>
>
// `hgetall<T>` returns a record keyed by field of decoded `T`.
type _Hgetall = Expect<Equal<ReturnType<typeof cache.hgetall<Doc>>, Promise<Record<string, Doc>>>>
// Boolean-result commands are exactly `Promise<boolean>`.
type _SetNx = Expect<Equal<ReturnType<typeof cache.setNx<Doc>>, Promise<boolean>>>
type _Exists = Expect<Equal<ReturnType<typeof cache.exists>, Promise<boolean>>>
type _Expire = Expect<Equal<ReturnType<typeof cache.expire>, Promise<boolean>>>
type _Sismember = Expect<Equal<ReturnType<typeof cache.sismember>, Promise<boolean>>>
// Count/number commands are exactly `Promise<number>`.
type _Del = Expect<Equal<ReturnType<typeof cache.del>, Promise<number>>>
type _Incr = Expect<Equal<ReturnType<typeof cache.incr>, Promise<number>>>
type _Ttl = Expect<Equal<ReturnType<typeof cache.ttl>, Promise<number>>>
type _Scard = Expect<Equal<ReturnType<typeof cache.scard>, Promise<number>>>
// Sets hold raw strings, so `smembers` is `Promise<string[]>` (never generic).
type _Smembers = Expect<Equal<ReturnType<typeof cache.smembers>, Promise<string[]>>>
// `eval` returns `unknown` (Redis Lua is dynamically typed) — never `any`.
type _Eval = Expect<Equal<ReturnType<typeof cache.eval>, Promise<unknown>>>
// `eval` keys/args are readonly; args accept `string | number`.
type _EvalKeys = Expect<Equal<Parameters<typeof cache.eval>[1], readonly string[]>>
type _EvalArgs = Expect<Equal<Parameters<typeof cache.eval>[2], ReadonlyArray<string | number>>>
// `scan` is a non-blocking async iterable of namespaced keys.
type _Scan = Expect<Equal<ReturnType<typeof cache.scan>, AsyncIterable<string>>>
// `pipeline` exposes the raw ioredis chainable commander.
type _Pipeline = Expect<Equal<ReturnType<typeof cache.pipeline>, ChainableCommander>>

// Both registration entry points return a `DynamicModule`.
type _ForRoot = Expect<Equal<ReturnType<typeof BymaxCacheModule.forRoot>, DynamicModule>>
type _ForRootAsync = Expect<Equal<ReturnType<typeof BymaxCacheModule.forRootAsync>, DynamicModule>>

// `ISerializer` is symmetric and generic over the payload.
declare const serializer: ISerializer
type _Serialize = Expect<Equal<ReturnType<typeof serializer.serialize<Doc>>, string>>
type _Deserialize = Expect<Equal<ReturnType<typeof serializer.deserialize<Doc>>, Doc>>

// `CacheException` exposes a typed `code` and structured, secret-free `details`.
declare const error: CacheException
type _Code = Expect<Equal<typeof error.code, CacheErrorCode>>
type _Details = Expect<Equal<typeof error.details, Record<string, unknown> | null>>

// An `Unsubscribe` handle is an async, argument-free teardown.
type _Unsub = Expect<Equal<Unsubscribe, () => Promise<void>>>

// A script definition pins its `name` + `lua` source as strings.
type _ScriptName = Expect<Equal<IScriptDefinition['name'], string>>
type _ScriptLua = Expect<Equal<IScriptDefinition['lua'], string>>

// `ICacheEvents.onEvent` is an optional observability callback.
type _OnEvent = Expect<Equal<ICacheEvents['onEvent'] extends undefined ? true : false, false>>
