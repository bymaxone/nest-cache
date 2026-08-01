/**
 * Testcontainers wrapper for a real Redis Cluster (`grokzen/redis-cluster`).
 *
 * A single container runs a 3-master / 3-replica cluster on ports 7200-7205.
 * Two Docker-on-non-Linux details make it reachable from the host:
 *   - the ports are bound 1:1 (host == container) so MOVED/ASK redirects to a
 *     sibling node land on a published port, and
 *   - the cluster announces `0.0.0.0` (IP env), which a `natMap` rewrites to
 *     `127.0.0.1:<same-port>` for the client.
 * Readiness is the cluster-create output, not a node's listen log — see the wait
 * strategy below.
 * Ports 7200+ are used (not 7000) because macOS reserves 7000 for AirPlay.
 */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'

import type { ClusterNode, NatMap } from 'ioredis'

/** Client ports the grokzen cluster listens on (3 masters + 3 replicas). */
const CLUSTER_PORTS = [7200, 7201, 7202, 7203, 7204, 7205] as const

/** A started cluster plus the `nodes` + `natMap` the cache module needs. */
export interface StartedRedisCluster {
  /** The container handle; the caller must `stop()` it when the suite ends. */
  container: StartedTestContainer
  /** Seed nodes for `cluster.nodes`. */
  nodes: ClusterNode[]
  /** Rewrites the cluster's announced `0.0.0.0:<port>` to the reachable host. */
  natMap: NatMap
}

/**
 * Boots a `grokzen/redis-cluster:7.0.10` container and waits until it is ready.
 *
 * @returns The container plus the seed nodes and `natMap` for cluster-mode config.
 */
export async function startRedisCluster(): Promise<StartedRedisCluster> {
  const container = await new GenericContainer('grokzen/redis-cluster:7.0.10')
    .withEnvironment({ IP: '0.0.0.0', INITIAL_PORT: String(CLUSTER_PORTS[0]) })
    .withExposedPorts(...CLUSTER_PORTS.map((port) => ({ container: port, host: port })))
    // Wait for slot allocation, not for a port to open. Each of the six nodes
    // logs "Ready to accept connections" as soon as it binds, and the first of
    // those matches — returning while `redis-cli --cluster create` is still
    // running, so the client connects to a cluster with no slots assigned and
    // fails with CLUSTERDOWN. This line is emitted only once the cluster is
    // actually formed.
    .withWaitStrategy(Wait.forLogMessage(/All 16384 slots covered/i))
    .withStartupTimeout(120_000)
    .start()

  const nodes: ClusterNode[] = CLUSTER_PORTS.map((port) => ({ host: '127.0.0.1', port }))
  const natMap: NatMap = Object.fromEntries(
    CLUSTER_PORTS.map((port) => [`0.0.0.0:${port}`, { host: '127.0.0.1', port }])
  )
  return { container, nodes, natMap }
}
