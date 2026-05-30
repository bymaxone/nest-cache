/**
 * Lua script definition contract.
 *
 * Layer: server. Describes a named Lua script pre-registered with the script
 * manager (Phase 3). The manager runs the register → `SCRIPT LOAD` → `EVALSHA`
 * cycle, falling back to a full `EVAL` on `NOSCRIPT` (script evicted from the
 * Redis cache).
 */

/**
 * A named Lua script for atomic server-side operations.
 *
 * The `name` is the lookup key consumers pass to `eval`; the `lua` body is
 * loaded once via `SCRIPT LOAD` and thereafter invoked by SHA via `EVALSHA`,
 * with a transparent `NOSCRIPT` fallback.
 */
export interface IScriptDefinition {
  /** Unique lookup name used to invoke the script by reference. */
  name: string
  /** The Lua source. Must never be built from untrusted input (CLAUDE.md §4). */
  lua: string
}
