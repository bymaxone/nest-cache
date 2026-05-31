/**
 * Testcontainers wrapper for a real Redis Sentinel setup.
 *
 * Two stock `redis:7-alpine` containers on a shared network: a master (alias
 * `redis-master`) and a sentinel monitoring it. The sentinel announces the
 * master at its in-network IP, so a `natMap` rewrites that to the published host
 * port for the client (the same NAT trick the cluster helper uses). The sentinel
 * config is written inline rather than baked into an image.
 */
import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer
} from 'testcontainers'

import type { NatMap, SentinelAddress } from 'ioredis'

/** A started master+sentinel pair plus the sentinel-mode config the lib needs. */
export interface StartedRedisSentinel {
  /** The master data node container. */
  master: StartedTestContainer
  /** The sentinel container. */
  sentinel: StartedTestContainer
  /** The shared Docker network (stop it last). */
  network: StartedNetwork
  /** Sentinel addresses for `sentinel.sentinels`. */
  sentinels: SentinelAddress[]
  /** Master group name. */
  name: string
  /** Rewrites the sentinel-announced master IP to the reachable host. */
  natMap: NatMap
}

/**
 * Boots a Redis master + a sentinel monitoring it, both reachable from the host.
 *
 * @returns The containers, network, and the sentinel-mode connection config.
 */
export async function startRedisSentinel(): Promise<StartedRedisSentinel> {
  const image = process.env['REDIS_IMAGE'] ?? 'redis:7-alpine'
  const network = await new Network().start()

  const master = await new GenericContainer(image)
    .withNetwork(network)
    .withNetworkAliases('redis-master')
    .withExposedPorts(6379)
    .withCommand(['redis-server', '--save', ''])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/i))
    .start()

  const masterIp = master.getIpAddress(network.getName())
  const masterPort = master.getMappedPort(6379)

  const conf = [
    'port 26379',
    `sentinel monitor mymaster ${masterIp} 6379 1`,
    'sentinel down-after-milliseconds mymaster 5000'
  ].join('\\n')

  const sentinel = await new GenericContainer(image)
    .withNetwork(network)
    .withExposedPorts(26379)
    .withCommand([
      'sh',
      '-c',
      `printf '${conf}\\n' > /tmp/sentinel.conf && redis-sentinel /tmp/sentinel.conf`
    ])
    .withWaitStrategy(Wait.forLogMessage(/monitor master|Ready to accept connections/i))
    .start()

  return {
    master,
    sentinel,
    network,
    sentinels: [{ host: '127.0.0.1', port: sentinel.getMappedPort(26379) }],
    name: 'mymaster',
    natMap: { [`${masterIp}:6379`]: { host: '127.0.0.1', port: masterPort } }
  }
}
