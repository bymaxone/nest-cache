/**
 * The module object a spec hands `jest.mock('ioredis', ...)`: fakes for the client and the cluster, and the
 * real `AbstractConnector`, which the library's connector extends and a fake client never opens a socket
 * through.
 *
 * Layer: server. Called from inside a mock factory with `require`, because a factory cannot reach a
 * top-level import.
 */

import type * as IoRedis from 'ioredis'

/**
 * @param redis - The fake client, given as `Redis` and as the default export.
 * @param cluster - The fake cluster.
 * @returns The module object.
 */
export function ioredisModule(redis: unknown, cluster: unknown): object {
  return {
    __esModule: true,
    AbstractConnector: jest.requireActual<typeof IoRedis>('ioredis').AbstractConnector,
    Redis: redis,
    Cluster: cluster,
    default: redis
  }
}
