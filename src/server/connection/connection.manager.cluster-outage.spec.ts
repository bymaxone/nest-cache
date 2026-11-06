/**
 * Unit tests for how {@link ConnectionManager} configures the cluster client when the cluster
 * cannot be reached.
 *
 * Layer: server. They run the real ioredis `Cluster` against a closed local port, because the
 * behaviour under test (a command rejecting at once instead of waiting in an offline queue) is
 * ioredis's, and a fake client cannot exercise it. No server is involved, so no container is needed.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from './connection.manager'

import type { BymaxCacheModuleOptions } from '../interfaces/cache-module-options.interface'

/** Port nothing listens on, so every connection attempt is refused at once. */
const CLOSED_PORT = 1

/** A cluster manager aimed at a closed port, opened lazily so no boot wait hides the outage. */
function managerFor(options: object = {}): ConnectionManager {
  const resolved = applyDefaults({
    mode: 'cluster',
    connection: { lazyConnect: true },
    cluster: { nodes: [{ host: '127.0.0.1', port: CLOSED_PORT }], options }
  } as BymaxCacheModuleOptions)
  return new ConnectionManager(resolved)
}

/** Settles a command and reports how long it took to settle and whether it rejected. */
async function timed(run: () => Promise<unknown>): Promise<{ rejected: boolean; ms: number }> {
  const started = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const outcome = await Promise.race([
    run().then(
      () => false,
      () => true
    ),
    new Promise<'pending'>((resolve) => {
      timer = setTimeout(() => resolve('pending'), 1_000)
    })
  ])
  clearTimeout(timer)
  return { rejected: outcome === true, ms: Date.now() - started }
}

/**
 * Disconnects a client and lets the timers it armed run out before the worker moves on. A cluster
 * that failed a command keeps a 2 s timer of its own after `disconnect()`, which would otherwise
 * outlive the test and stop the worker from exiting.
 */
async function stop(client: { disconnect: () => void }): Promise<void> {
  client.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 2_100))
}

describe('ConnectionManager cluster mode with the cluster unreachable', () => {
  afterEach(() => jest.restoreAllMocks())

  // Scenario: the cluster is down and the client has no connection.
  // Rule: a command rejects promptly instead of waiting in an offline queue for the cluster to
  // return, as it does in standalone mode, so the caller's "unreachable cache is a miss" path runs.
  it('rejects a command at once instead of queueing it', async () => {
    // Short timeouts only so no 5 s timer outlives the test; the timeout alone never fails a
    // queued command fast, the offline queue does.
    const manager = managerFor({ redisOptions: { commandTimeout: 100, connectTimeout: 100 } })
    const client = manager.getClient()

    const { rejected, ms } = await timed(() => client.get('k'))
    await stop(client)

    expect(rejected).toBe(true)
    expect(ms).toBeLessThan(500)
  })

  // Scenario: the consumer sets enableOfflineQueue on the cluster options themselves.
  // Rule: the fail-fast default yields to an explicit choice.
  it('keeps an offline queue the consumer asked for', async () => {
    const manager = managerFor({ enableOfflineQueue: true })
    const client = manager.getClient()

    const { rejected } = await timed(() => client.get('k'))
    await stop(client)

    expect(rejected).toBe(false)
  })

  // Scenario: the subscriber of a cluster is created before its sockets are ready.
  // Rule: it buffers its subscribe like the standalone subscriber does, whatever the data client does.
  it('gives the subscriber client an offline queue', () => {
    const manager = managerFor()
    const subscriber = manager.createSubscriberClient() as unknown as {
      options: { enableOfflineQueue: boolean }
      disconnect: () => void
    }
    subscriber.disconnect()

    expect(subscriber.options.enableOfflineQueue).toBe(true)
  })

  // Scenario: the consumer sets only some redisOptions.
  // Rule: the timeouts and retry cap fill in beside what they set, never replace it.
  it('merges the default redisOptions with the consumer redisOptions', () => {
    const manager = managerFor({ redisOptions: { commandTimeout: 123 } })
    const client = manager.getClient() as unknown as {
      options: { redisOptions: Record<string, unknown> }
      disconnect: () => void
    }
    client.disconnect()

    expect(client.options.redisOptions).toMatchObject({
      commandTimeout: 123,
      connectTimeout: 10_000,
      maxRetriesPerRequest: 3
    })
  })
})
