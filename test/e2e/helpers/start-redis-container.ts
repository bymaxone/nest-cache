/**
 * Testcontainers wrapper for the end-to-end suite.
 *
 * Boots a real Redis 7 container on a random host port so the scenarios that
 * `ioredis-mock` cannot faithfully reproduce (atomic `EVALSHA`, `SCRIPT FLUSH`
 * recovery, real connection lifecycle) run against an actual server. The caller
 * owns the returned handle and must `stop()` it in `afterAll`.
 */
import { GenericContainer, type StartedTestContainer } from 'testcontainers'

/** A started Redis container plus the `redis://` URL the cache module connects to. */
export interface StartedRedis {
  /** The container handle; the caller must `stop()` it when the suite ends. */
  container: StartedTestContainer
  /** The connection URL mapped to the container's host port. */
  url: string
}

/** Options for {@link startRedisContainer}. */
export interface StartRedisOptions {
  /**
   * Bind container port 6379 to this FIXED host port instead of a random one.
   * A random host port is remapped on `restart()`, which would leave a client
   * reconnecting to a dead port; a fixed port survives a restart — required by
   * the resilience spec. Omit for the default random-port behavior.
   */
  hostPort?: number
}

/**
 * Starts a `redis:7-alpine` container with persistence disabled (`--save ''`),
 * exposing 6379 on a random host port (or a fixed one via {@link StartRedisOptions.hostPort}).
 *
 * @param options - Optional fixed-host-port binding.
 * @returns The started container and its connection URL.
 */
export async function startRedisContainer(options: StartRedisOptions = {}): Promise<StartedRedis> {
  // The image is overridable (CI matrixes Redis 7/8 via REDIS_IMAGE); defaults to
  // Redis 7 for local runs.
  const image = process.env['REDIS_IMAGE'] ?? 'redis:7-alpine'
  const container = await new GenericContainer(image)
    .withExposedPorts(
      options.hostPort === undefined ? 6379 : { container: 6379, host: options.hostPort }
    )
    .withCommand(['redis-server', '--save', ''])
    .start()

  const host = container.getHost()
  const port = container.getMappedPort(6379)
  return { container, url: `redis://${host}:${port}` }
}
