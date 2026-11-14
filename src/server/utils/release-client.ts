/**
 * Disconnects a client unless it has already ended.
 *
 * Layer: server. ioredis arms a 2 s teardown timer in `disconnect()` and clears it only when the
 * stream emits `close`. A client in status `end` has already closed its stream and never emits
 * `close` again, so disconnecting it keeps the process alive 2 s longer for nothing.
 */

/** The part of an ioredis client (standalone or cluster) that release needs. */
export interface ReleasableClient {
  readonly status: string
  disconnect(): void
}

/**
 * Disconnects `client` when it has not ended.
 *
 * @param client - The ioredis client to release.
 */
export function releaseClient(client: ReleasableClient): void {
  if (client.status !== 'end') {
    client.disconnect()
  }
}
