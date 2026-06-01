/**
 * Lua script manager.
 *
 * Layer: server. Owns the register → `SCRIPT LOAD` → `EVALSHA` lifecycle for
 * named Lua scripts. SHAs are cached per script; when the server reports
 * `NOSCRIPT` (its script cache was flushed or it restarted) the script is
 * reloaded once and the call is retried transparently. Scripts may be
 * pre-registered through `options.scripts` or added at runtime via
 * {@link ScriptManagerService.register}.
 *
 * @see `docs/technical_specification.md` §9 — Lua Scripts and ScriptManager
 */
import { Inject, Injectable } from '@nestjs/common'
import type { OnApplicationBootstrap } from '@nestjs/common'

import { BYMAX_CACHE_OPTIONS } from '../bymax-cache.constants'
import type { ResolvedOptions } from '../config/resolved-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/** The `SCRIPT LOAD` subcommand keyword. */
const SCRIPT_LOAD = 'LOAD'

/** Substring of the Redis error raised when a SHA is no longer cached. */
const NOSCRIPT_MARKER = 'NOSCRIPT'

/** A registered script and its cached SHA1 (once loaded). */
interface ScriptEntry {
  lua: string
  sha?: string
}

/**
 * Extracts a human-readable message from an unknown throw value. Redis client
 * rejections are `Error`s, but a non-`Error` throw is still surfaced safely.
 *
 * @param err - The caught throw value.
 * @returns The error message, or `String(err)` when it is not an `Error`.
 */
const toErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

@Injectable()
export class ScriptManagerService implements OnApplicationBootstrap {
  /** Registry of script name → `{ lua, sha? }`. */
  private readonly scripts = new Map<string, ScriptEntry>()

  /**
   * @param options - Resolved module options; `options.scripts` seeds the registry.
   * @param connection - Owns the client used for `SCRIPT LOAD` / `EVALSHA`.
   *   Explicit `@Inject` — the published bundle is built without
   *   emitDecoratorMetadata, so type-only DI cannot resolve a class provider
   *   (CLAUDE.md §5).
   */
  constructor(
    @Inject(BYMAX_CACHE_OPTIONS) private readonly options: ResolvedOptions,
    @Inject(ConnectionManager) private readonly connection: ConnectionManager
  ) {
    for (const definition of options.scripts ?? []) {
      this.scripts.set(definition.name, { lua: definition.lua })
    }
  }

  /**
   * Pre-loads every registered script once the application has bootstrapped,
   * unless `lazyConnect` is set — in which case loading is deferred to the first
   * {@link eval}.
   *
   * Runs in `onApplicationBootstrap` (not `onModuleInit`) deliberately: NestJS
   * invokes `onModuleInit` hooks concurrently, so loading here would race the
   * {@link ConnectionManager} connect and fail fast against a not-yet-writable
   * socket (offline queue is disabled). `onApplicationBootstrap` is guaranteed to
   * run after every `onModuleInit` resolved — i.e. once the connection is ready.
   *
   * @returns Resolves once all eager scripts are loaded.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.options.connection?.lazyConnect) {
      return
    }
    await Promise.all([...this.scripts.keys()].map((name) => this.load(name)))
  }

  /**
   * Registers a script under `name`, or overrides an existing one. The new
   * script is loaded lazily on its next {@link eval} / {@link load}.
   *
   * @param name - Lookup name used to invoke the script.
   * @param lua - The Lua source. Never build this from untrusted input (CLAUDE.md §4).
   */
  register(name: string, lua: string): void {
    this.scripts.set(name, { lua })
  }

  /**
   * Loads a registered script into Redis (if not already cached) and returns its
   * SHA1. Idempotent — a cached SHA is reused without a second `SCRIPT LOAD`.
   *
   * @param name - The registered script name.
   * @returns The script's SHA1.
   * @throws {CacheException} `SCRIPT_NOT_REGISTERED` when `name` is unknown.
   */
  async load(name: string): Promise<string> {
    const entry = this.scripts.get(name)
    if (!entry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    }
    if (!entry.sha) {
      const client = this.connection.getClient()
      // SCRIPT LOAD always returns the 40-char SHA1 per Redis protocol.
      entry.sha = (await client.script(SCRIPT_LOAD, entry.lua)) as string
    }
    return entry.sha
  }

  /**
   * Executes a registered Lua script.
   *
   * Standalone / sentinel use `EVALSHA`; on `NOSCRIPT` the script is reloaded once
   * and the call retried. CLUSTER uses `EVAL` (the full body): `EVALSHA` routes to
   * the key's slot owner while `SCRIPT LOAD` is keyless (lands on an arbitrary
   * node), so the owner could `NOSCRIPT` and a keyless reload would not fix it —
   * `EVAL` ships the body and routes by key to the slot owner; a keyless `EVAL`
   * would execute on an arbitrary node — this method throws
   * `SCRIPT_EXECUTION_FAILED` when called in cluster mode with zero keys.
   *
   * Keys must already be namespaced — {@link CacheService.eval} handles that for
   * consumer-facing usage. In cluster mode all keys of a single call must hash to
   * the same slot (use a hash tag), per Redis cluster semantics.
   *
   * @param name - The registered script name.
   * @param keys - `KEYS[]` for the script (already namespaced).
   * @param args - `ARGV[]` for the script.
   * @returns The script's return value, typed `unknown` (Redis Lua is dynamic).
   * @throws {CacheException} `SCRIPT_NOT_REGISTERED` when `name` is unknown.
   * @throws {CacheException} `SCRIPT_EXECUTION_FAILED` on a non-`NOSCRIPT` error,
   *   a failed reload-and-retry, or any cluster `EVAL` failure. The Lua source is
   *   never echoed in the error.
   */
  async eval(
    name: string,
    keys: readonly string[],
    args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    const entry = this.scripts.get(name)
    if (!entry) {
      throw new CacheException(CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, { name })
    }
    const client = this.connection.getClient()
    if (this.options.mode === 'cluster') {
      if (keys.length === 0) {
        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
          name,
          reason: 'cluster EVAL requires at least one key for slot routing'
        })
      }
      try {
        return await client.eval(entry.lua, keys.length, ...keys, ...args)
      } catch (err) {
        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
          name,
          originalError: toErrorMessage(err)
        })
      }
    }
    try {
      const sha = entry.sha ?? (await this.load(name))
      return await client.evalsha(sha, keys.length, ...keys, ...args)
    } catch (err) {
      if (!toErrorMessage(err).includes(NOSCRIPT_MARKER)) {
        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
          name,
          originalError: toErrorMessage(err)
        })
      }
      // The server evicted the SHA — reload once and retry. Wrap a failure of
      // EITHER the reload (SCRIPT LOAD) or the retry, so the method's contract of
      // surfacing SCRIPT_EXECUTION_FAILED holds even if the reload itself fails.
      try {
        // SCRIPT LOAD always returns the 40-char SHA1 per Redis protocol.
        const reloadedSha = (await client.script(SCRIPT_LOAD, entry.lua)) as string
        entry.sha = reloadedSha
        return await client.evalsha(reloadedSha, keys.length, ...keys, ...args)
      } catch (retryErr) {
        throw new CacheException(CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, {
          name,
          originalError: toErrorMessage(retryErr)
        })
      }
    }
  }
}
