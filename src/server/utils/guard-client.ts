/**
 * Command-timeout mapping for the client a service uses.
 *
 * Layer: server. ioredis rejects a command with a plain `Error` in two cases a host must tell apart from
 * its own failures: `Command timed out` when it exceeds `commandTimeout`, and `Stream isn't writeable
 * and enableOfflineQueue options is false` when the connection is down and the offline queue is off (the
 * default here, so a stopped Redis rejects every call at once). A host that catches `CacheException` and
 * keys on its code would see both as unclassified, so they are reported as `COMMAND_TIMEOUT` and
 * `CONNECTION_LOST` (`reason: 'offline'`), with the original error kept as `cause`. A timed-out
 * command may still have been applied by the server.
 */
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'

/** The exact message ioredis rejects a timed-out command with. */
const COMMAND_TIMED_OUT = 'Command timed out'

/** The exact message ioredis rejects a command with when the connection is down and the queue is off. */
const OFFLINE = "Stream isn't writeable and enableOfflineQueue options is false"

/**
 * Turns the two ioredis failures a host must classify into a `CacheException`, and leaves every other
 * error alone.
 *
 * @param error - What a command rejected with.
 * @returns `COMMAND_TIMEOUT` for ioredis's timeout, `CONNECTION_LOST` (`reason: 'offline'`) for its
 *   offline rejection, otherwise `error` itself.
 */
function mapCommandFailure(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error
  }
  if (error.message === COMMAND_TIMED_OUT) {
    return new CacheException(CACHE_ERROR_CODES.COMMAND_TIMEOUT, undefined, undefined, error)
  }
  return error.message === OFFLINE
    ? new CacheException(CACHE_ERROR_CODES.CONNECTION_LOST, { reason: 'offline' }, undefined, error)
    : error
}

/** The wrapped client of each client, so a client is wrapped once however many calls reach it. */
const GUARDED = new WeakMap<object, object>()

/**
 * Wraps a client so that every command it runs reports a timeout or an offline connection as a coded error.
 *
 * Methods that return a promise have their rejection mapped; everything else (properties, pipelines,
 * streams) is returned as it is.
 *
 * @typeParam C - The client type.
 * @param client - The ioredis client.
 * @returns A proxy with the client's own type, the same one for the same client.
 */
export function guardClient<C extends object>(client: C): C {
  const known = GUARDED.get(client)
  if (known !== undefined) {
    return known as C
  }
  const guarded = new Proxy(client, {
    get(target, property): unknown {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]): unknown => {
        const result: unknown = value.apply(target, args)
        return result instanceof Promise
          ? result.catch((error: unknown) => {
              throw mapCommandFailure(error)
            })
          : result
      }
    }
  })
  GUARDED.set(client, guarded)
  return guarded
}
