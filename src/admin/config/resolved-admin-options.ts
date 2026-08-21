/**
 * Administration option validation and defaulting.
 *
 * Layer: admin. Runs once at module wiring — every rule here is a bootstrap
 * invariant, so a misconfigured surface fails to start rather than serving a
 * misleading answer on its first request.
 */
import { CACHE_ERROR_CODES, CacheException } from '@bymax-one/nest-cache'

import { validateScopes } from './validate-scopes'
import {
  DEFAULT_DEGRADED_ABOVE_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_SCAN_LIMIT,
  DEFAULT_COMMAND_BATCH_LIMIT,
  DEFAULT_REVEAL_LIMIT,
  DEFAULT_REVEAL_STRING_LIMIT
} from '../constants/admin-defaults'
import type { BymaxCacheAdminModuleOptions } from '../interfaces/admin-module-options.interface'
import type { CacheScope } from '../interfaces/cache-scope.interface'

/** Administration options after defaults are merged and validated. */
export interface ResolvedAdminOptions {
  readonly scopes: readonly CacheScope[]
  readonly degradedAboveMs: number
  readonly probeTimeoutMs: number
  readonly scanLimit: number
  readonly commandBatchLimit: number
  readonly revealLimit: number
  readonly revealStringLimit: number
  readonly isGlobal: boolean
}

/**
 * Rejects a threshold that is not a positive integer.
 *
 * A non-positive threshold is not a tuning choice but a broken surface: a zero
 * degraded threshold reports a healthy cache as degraded, and a zero probe
 * timeout reports every cache down without asking it anything. A fractional cap
 * is meaningless — 2.5 keys is not a page size.
 *
 * @param option - The option name, echoed so a consumer fixes the line they wrote.
 * @param value - The configured value.
 * @throws {CacheException} `INVALID_SCOPE` when the value is not a positive integer.
 */
function requirePositiveInteger(option: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new CacheException(CACHE_ERROR_CODES.INVALID_SCOPE, {
      reason: 'threshold must be positive',
      option,
      value
    })
  }
}

/**
 * Merges administration options with defaults, validates them, and freezes the
 * result.
 *
 * @param options - The raw consumer options.
 * @returns The frozen resolved options.
 * @throws {CacheException} `INVALID_SCOPE` when a scope is malformed or a
 *   threshold is not a positive integer.
 */
export function resolveAdminOptions(
  options: BymaxCacheAdminModuleOptions
): Readonly<ResolvedAdminOptions> {
  const resolved: ResolvedAdminOptions = {
    scopes: validateScopes(options.scopes),
    degradedAboveMs: options.degradedAboveMs ?? DEFAULT_DEGRADED_ABOVE_MS,
    probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    scanLimit: options.scanLimit ?? DEFAULT_SCAN_LIMIT,
    commandBatchLimit: options.commandBatchLimit ?? DEFAULT_COMMAND_BATCH_LIMIT,
    revealLimit: options.revealLimit ?? DEFAULT_REVEAL_LIMIT,
    revealStringLimit: options.revealStringLimit ?? DEFAULT_REVEAL_STRING_LIMIT,
    isGlobal: options.isGlobal ?? false
  }

  requirePositiveInteger('degradedAboveMs', resolved.degradedAboveMs)
  requirePositiveInteger('probeTimeoutMs', resolved.probeTimeoutMs)
  requirePositiveInteger('scanLimit', resolved.scanLimit)
  requirePositiveInteger('commandBatchLimit', resolved.commandBatchLimit)
  requirePositiveInteger('revealLimit', resolved.revealLimit)
  requirePositiveInteger('revealStringLimit', resolved.revealStringLimit)

  return Object.freeze(resolved)
}
