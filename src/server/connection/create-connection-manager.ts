/**
 * Factory for a dedicated, lifecycle-managed Redis connection.
 *
 * Layer: server. A consumer that needs a second connection with its own options (for
 * example a standalone one beside a clustered cache) builds it here instead of
 * hand-writing the resolved options, which would skip validation and the defaults.
 */
import { ConnectionManager } from './connection.manager'
import { resolveOptions } from '../config/default-options'
import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/**
 * Builds a {@link ConnectionManager} from the same options `BymaxCacheModule.forRoot`
 * takes: the options are validated and defaulted exactly as the module does, so an invalid
 * set throws the same `CacheException` before any client exists.
 *
 * The manager owns its connection. Register it as a provider and Nest connects it on
 * `onModuleInit` and quits it on `onModuleDestroy`, with the forced `disconnect()` after
 * `shutdownTimeoutMs`; the caller writes neither hook. Reach the client with
 * `manager.getClient()`. This connection is independent of the one `BymaxCacheModule`
 * registers, and it applies no namespace: keys written through its client are not
 * prefixed.
 *
 * @param options - The connection options, as for `BymaxCacheModule.forRoot`.
 * @returns A new manager that has not connected yet.
 * @throws {CacheException} `SENTINEL_MISCONFIGURED`, `CLUSTER_MISCONFIGURED`,
 *   `CONNECTION_FAILED` or `INVALID_NAMESPACE` when the options are invalid.
 * @example
 * ```ts
 * export const AUTH_REDIS = Symbol('AUTH_REDIS')
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: AUTH_REDIS,
 *       useFactory: () => createConnectionManager({ connection: { url: 'redis://localhost:6379' } })
 *     }
 *   ],
 *   exports: [AUTH_REDIS]
 * })
 * export class AuthRedisModule {}
 * ```
 */
export function createConnectionManager(options: BymaxCacheModuleOptions): ConnectionManager {
  const resolved = resolveOptions(options)
  return new ConnectionManager(resolved, resolved.events)
}
