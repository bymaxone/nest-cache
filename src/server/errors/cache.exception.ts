/**
 * Cache exception type and human-readable messages.
 *
 * Layer: server — depends on `@nestjs/common` (`HttpException`). Error codes
 * live in the zero-dependency shared subpath; message and HTTP-status mapping
 * live here. A `Map` (not an index signature) backs the lookup so a runtime
 * `code` cannot trigger object-injection.
 */
import { HttpException, HttpStatus } from '@nestjs/common'

import { CACHE_ERROR_CODES } from '../../shared/constants/error-codes'

/**
 * Default end-user-facing messages per error code (English; consumers localize
 * upstream). Unknown codes fall back to a generic message.
 */
const CACHE_ERROR_MESSAGES = new Map<string, string>([
  [CACHE_ERROR_CODES.CONNECTION_FAILED, 'Could not connect to Redis after retries.'],
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT, 'Redis command timed out.'],
  [CACHE_ERROR_CODES.CONNECTION_LOST, 'Redis connection was lost during the operation.'],
  [CACHE_ERROR_CODES.SERIALIZATION_FAILED, 'Failed to serialize the value.'],
  [CACHE_ERROR_CODES.DESERIALIZATION_FAILED, 'Failed to deserialize the cached value.'],
  [CACHE_ERROR_CODES.INVALID_NAMESPACE, 'Namespace is empty or contains the reserved separator.'],
  [CACHE_ERROR_CODES.INVALID_KEY, 'Cache key prefix or id is empty.'],
  [CACHE_ERROR_CODES.SCRIPT_NOT_REGISTERED, 'Tried to execute an unregistered Lua script.'],
  [CACHE_ERROR_CODES.SCRIPT_EXECUTION_FAILED, 'Lua script returned a Redis error.'],
  [CACHE_ERROR_CODES.SCRIPT_REGISTRY_MISSING, 'eval called without registering any scripts.'],
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, 'flushNamespace is disabled in production.'],
  [CACHE_ERROR_CODES.CLUSTER_MISCONFIGURED, 'Cluster mode requires cluster.nodes.'],
  [CACHE_ERROR_CODES.SENTINEL_MISCONFIGURED, 'Sentinel mode is misconfigured.'],
  [CACHE_ERROR_CODES.SHUTDOWN_TIMEOUT, 'Graceful shutdown exceeded the timeout.']
])

/**
 * Canonical HTTP status per error code, from the error catalog in
 * `docs/technical_specification.md` §12.2. Only the codes whose canonical
 * status differs from 500 are listed; every other code falls back to 500, so a
 * throw site never has to remember an override to get the documented status.
 * A `Map` (not an index signature) backs the lookup so a runtime `code` cannot
 * trigger object-injection.
 */
const CACHE_ERROR_STATUS = new Map<string, HttpStatus>([
  [CACHE_ERROR_CODES.COMMAND_TIMEOUT, HttpStatus.GATEWAY_TIMEOUT],
  [CACHE_ERROR_CODES.CONNECTION_LOST, HttpStatus.SERVICE_UNAVAILABLE],
  [CACHE_ERROR_CODES.INVALID_KEY, HttpStatus.BAD_REQUEST],
  [CACHE_ERROR_CODES.FLUSH_DISABLED_IN_PRODUCTION, HttpStatus.FORBIDDEN]
])

/**
 * Exception thrown by the cache library. Serializes to a structured
 * `{ error: { code, message, details } }` body and carries an HTTP status, so
 * it surfaces cleanly when thrown inside a NestJS request pipeline.
 *
 * @param code - One of {@link CACHE_ERROR_CODES}.
 * @param details - Optional structured context. Never include secret values.
 * @param statusCode - HTTP status override. When omitted, defaults to the
 *   canonical status for `code` (error catalog §12.2), or 500 for codes whose
 *   canonical status is 500.
 */
export class CacheException extends HttpException {
  constructor(code: string, details?: Record<string, unknown>, statusCode?: HttpStatus) {
    super(
      {
        error: {
          code,
          message: CACHE_ERROR_MESSAGES.get(code) ?? 'Cache error',
          details: details ?? null
        }
      },
      statusCode ?? CACHE_ERROR_STATUS.get(code) ?? HttpStatus.INTERNAL_SERVER_ERROR
    )
  }
}
