/**
 * Testcontainers wrapper for a real Redis Cluster of three masters.
 *
 * One `redis` container runs three `redis-server` processes on ports 7200-7202 and forms
 * the cluster with `redis-cli --cluster create`. Two details make it reachable from the
 * host, on Linux and on Docker Desktop alike:
 *   - the ports are bound 1:1 (host == container), so a MOVED/ASK redirect to a sibling
 *     node lands on a published port, and
 *   - each node announces `127.0.0.1` and its own client port, which is where the host
 *     reaches it, so the client needs no `natMap`.
 * The cluster bus ports (client port + 10000) stay inside the container: the nodes gossip
 * over loopback.
 * Readiness is the cluster-create output, not a node's listen log — see the wait strategy
 * below. Ports 7200+ are used (not 7000) because macOS reserves 7000 for AirPlay.
 */
import Redis from 'ioredis'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

import type { ClusterNode } from 'ioredis'

/** Client ports of the three masters. */
const CLUSTER_PORTS = [7200, 7201, 7202] as const

/** Redis major under test; the same variable the standalone container reads. */
const DEFAULT_IMAGE = 'redis:8-alpine'

/** One `redis-server` flag set; `$p` is the node's client port. */
const SERVER_FLAGS = [
  '--port $p',
  '--cluster-enabled yes',
  '--cluster-config-file /tmp/nodes-$p.conf',
  '--cluster-announce-ip 127.0.0.1',
  '--cluster-announce-port $p',
  '--cluster-announce-bus-port 1$p',
  '--appendonly no',
  "--save ''",
  '--dir /tmp',
  '--daemonize yes'
].join(' ')

/** Starts the masters, waits for each to answer, then forms the cluster. */
const BOOT_SCRIPT = [
  `for p in ${CLUSTER_PORTS.join(' ')}; do redis-server ${SERVER_FLAGS}; done`,
  `for p in ${CLUSTER_PORTS.join(' ')}; do until redis-cli -p $p ping > /dev/null 2>&1; do sleep 0.2; done; done`,
  `redis-cli --cluster create ${CLUSTER_PORTS.map((port) => `127.0.0.1:${String(port)}`).join(' ')} --cluster-yes`,
  'exec tail -f /dev/null'
].join('\n')

/** A started cluster plus the `nodes` the cache module needs. */
export interface StartedRedisCluster {
  /** The container handle; the caller must `stop()` it when the suite ends. */
  container: StartedTestContainer
  /** Seed nodes for `cluster.nodes`. */
  nodes: ClusterNode[]
}

/**
 * Boots the three-master cluster and waits until every node reports it converged.
 *
 * @returns The container plus the seed nodes for cluster-mode config.
 */
export async function startRedisCluster(): Promise<StartedRedisCluster> {
  const container = await new GenericContainer(process.env['REDIS_IMAGE'] ?? DEFAULT_IMAGE)
    .withEntrypoint(['sh', '-c', BOOT_SCRIPT])
    .withExposedPorts(...CLUSTER_PORTS.map((port) => ({ container: port, host: port })))
    // Wait for slot allocation, not for a port to open. Each node logs "Ready to accept
    // connections" as soon as it binds, and the first of those matches — returning while
    // `redis-cli --cluster create` is still running, so the client connects to a cluster
    // with no slots assigned and fails with CLUSTERDOWN. This line is emitted only once
    // the cluster is actually formed.
    .withWaitStrategy(Wait.forLogMessage(/All 16384 slots covered/i))
    .withStartupTimeout(120_000)
    .start()

  const nodes: ClusterNode[] = CLUSTER_PORTS.map((port) => ({ host: '127.0.0.1', port }))
  try {
    await waitForClusterConvergence()
  } catch (cause: unknown) {
    // Stop the container before rethrowing. Its ports are bound 1:1 on the host, so a cluster
    // left running would make every subsequent run fail to bind — turning one timeout into a
    // cascade across the rest of the suite and the CI job.
    await container.stop()
    throw cause
  }
  return { container, nodes }
}

/** How long the nodes get to agree on the slot map after the create command returns. */
const CONVERGENCE_TIMEOUT_MS = 60_000

/** Interval between convergence probes. */
const CONVERGENCE_POLL_MS = 250

/**
 * Polls `CLUSTER INFO` on every node until all report `cluster_state:ok` with the full slot
 * range assigned. A node can lag the others by a gossip round after the create command
 * returns, and a client that connects to a lagging seed gets CLUSTERDOWN.
 */
async function waitForClusterConvergence(): Promise<void> {
  const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS
  let lastSeen = 'no node answered'

  while (Date.now() < deadline) {
    const states = await Promise.all(CLUSTER_PORTS.map(async (port) => readClusterInfo(port)))
    const converged = states.every(
      (info) =>
        info !== null &&
        info.includes('cluster_state:ok') &&
        info.includes('cluster_slots_assigned:16384')
    )
    if (converged) return
    lastSeen = states.find((info) => info !== null)?.split('\r\n')[0] ?? lastSeen
    await new Promise((resolve) => setTimeout(resolve, CONVERGENCE_POLL_MS))
  }

  throw new Error(
    `Redis cluster did not converge within ${CONVERGENCE_TIMEOUT_MS}ms (last seen: ${lastSeen})`
  )
}

/** Reads `CLUSTER INFO` from one node, or `null` when it does not answer. */
async function readClusterInfo(port: number): Promise<string | null> {
  const client = new Redis({
    host: '127.0.0.1',
    port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    // The probe owns its failure handling; ioredis must not log or retry on its own.
    enableOfflineQueue: false
  })
  client.on('error', () => undefined)
  try {
    await client.connect()
    return await client.cluster('INFO')
  } catch {
    return null
  } finally {
    client.disconnect()
  }
}
