/**
 * The delay queue of a cluster client, sealed against a key planted on `Object.prototype` after the client was
 * built.
 *
 * Layer: server. ioredis's cluster keeps the commands it retries after a redirect (`MOVED`, `TRYAGAIN`,
 * `CLUSTERDOWN`, a node that dropped) in a `DelayQueue` that finds a bucket with a plain property read of two
 * ordinary objects and reads `callback` off the literal each caller passes. A string planted under the name
 * of a bucket, or under `callback`, is read as a queue or as a function and throws in a timer, where nothing
 * can catch it and the process exits.
 */

/** The fields of ioredis's `DelayQueue` that are used here. */
interface IDelayQueue {
  queues: object
  timeouts: object
  push: (
    bucket: string,
    item: () => void,
    options: { timeout?: number | undefined; callback?: unknown }
  ) => void
}

/** `Object.hasOwn` as it was when this module loaded. */
const hasOwn = Object.hasOwn

/**
 * Gives the two tables of the delay queue of a cluster client no prototype, and makes every push pass options
 * that hold `timeout` and `callback` of their own. A client without the queue (a version of ioredis that
 * keeps its retries elsewhere) is returned as it is: the spec that pins the shape of the installed version
 * fails then.
 *
 * @param cluster - A cluster client that was just built.
 * @returns The same client.
 */
export function sealDelayQueue<T extends object>(cluster: T): T {
  const queue = (cluster as { delayQueue?: IDelayQueue }).delayQueue
  if (queue === undefined) {
    return cluster
  }
  queue.queues = Object.create(null) as object
  queue.timeouts = Object.create(null) as object
  const push = queue.push.bind(queue)
  queue.push = (bucket, item, options): void => {
    const own = Object.create(null) as { timeout?: number | undefined; callback?: unknown }
    own.timeout = options.timeout
    own.callback = hasOwn(options, 'callback') ? options.callback : undefined
    push(bucket, item, own)
  }
  return cluster
}
