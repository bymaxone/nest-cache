/**
 * Acquires an ephemeral free TCP port on the host.
 *
 * Used by the resilience spec to pin a container to a FIXED host port that
 * survives a restart (a random Testcontainers port is remapped on restart). The
 * tiny window between releasing the probe socket and binding the container is
 * acceptable for a test — a collision surfaces as a loud container-start failure.
 */
import { createServer } from 'node:net'

/**
 * Resolves a currently-free host port by binding `0` and reading the assignment.
 *
 * @returns A port number that was free at probe time.
 */
export function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('failed to acquire a free port')))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}
