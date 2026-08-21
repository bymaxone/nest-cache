/**
 * Options for the administration module.
 *
 * Layer: admin. The application declares which keyspaces exist and how patient
 * this deployment is; the library owns everything else.
 */
import type { CacheScope } from './cache-scope.interface'

/** Consumer-supplied options for `BymaxCacheAdminModule`. */
export interface BymaxCacheAdminModuleOptions {
  /**
   * The keyspaces this deployment exposes, in the order a surface should offer
   * them. Validated and frozen at wiring — see `validateScopes`.
   */
  scopes: readonly CacheScope[]
  /** Round trip above which health reports `degraded`. Default: 250 ms. */
  degradedAboveMs?: number
  /** How long a health probe waits before reporting `down`. Default: 2000 ms. */
  probeTimeoutMs?: number
  /** Most keys one listing reads before reporting the page incomplete. Default: 500. */
  scanLimit?: number
  /** Most commands one pipeline flush sends. Default: 100. */
  commandBatchLimit?: number
  /** Most members or hash fields one value reveal returns. Default: 200. */
  revealLimit?: number
  /** Most characters one revealed string value carries. Default: 4096. */
  revealStringLimit?: number
  /** Register the module globally. Default: `false` — an admin surface is wired where it is used. */
  isGlobal?: boolean
}
