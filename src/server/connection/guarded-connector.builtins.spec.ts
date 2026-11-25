/**
 * The connectors and the seal of the delay queue against a built-in of the language that is replaced AFTER the
 * library was imported.
 *
 * Layer: server. These paths call built-ins too (`Object.create`, `Object.assign`, `Object.defineProperty`,
 * `Reflect.setPrototypeOf`, `Function.prototype.bind`, `process.nextTick`, `Promise`): a call looked up when it
 * runs finds a replacement. Each row replaces one of them after the module was imported, with a function that
 * would undo what the path does, and expects the path to do it all the same.
 */
import { createServer as netServer, Socket } from 'node:net'
import type { Server } from 'node:net'

import { Cluster } from 'ioredis'

import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { GuardedConnector, GuardedSentinelConnector } from './guarded-connector'
import { sealDelayQueue } from './sealed-delay-queue'

const closers: Array<() => void> = []
/** Kept from before any row replaces it: the helpers below must restore with this, never with the live one. */
const originalDefineProperty = Object.defineProperty

afterEach(() => {
  for (const close of closers.splice(0)) close()
})

/** Runs `run` with `owner[name]` replaced by `replacement`, and puts the original back, even when `owner[name]` is `Object.defineProperty`. */
function replacing<T>(owner: object, name: string, replacement: unknown, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(owner, name) as PropertyDescriptor
  originalDefineProperty(owner, name, { ...original, value: replacement })
  try {
    return run()
  } finally {
    originalDefineProperty(owner, name, original)
  }
}

/** Like `replacing`, for a run that settles later: the original comes back when it has settled. */
async function replacingUntilSettled<T>(
  owner: object,
  name: string,
  replacement: unknown,
  run: () => Promise<T>
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(owner, name) as PropertyDescriptor
  originalDefineProperty(owner, name, { ...original, value: replacement })
  try {
    return await run()
  } finally {
    originalDefineProperty(owner, name, original)
  }
}

/** Starts a server and returns its port; it is closed after the test. */
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  closers.push(() => server.close())
  return (server.address() as { port: number }).port
}

const plainServer = (): Server =>
  netServer((socket) => {
    socket.on('error', () => undefined)
  })

describe('the connector, with a built-in replaced after the import', () => {
  // Scenario: a built-in that the paths read the options with is replaced after the import, by a function that
  // would send the socket elsewhere, drop what the host configured, or leave the table of listeners as it was.
  // Rule: the baseline of those built-ins is in the guard that runs at the call, so the connect is refused, and
  // nothing is opened.
  it.each([
    ['Object.create', Object, 'create'],
    ['Object.assign', Object, 'assign'],
    ['Reflect.setPrototypeOf', Reflect, 'setPrototypeOf']
  ] as const)('is refused when %s was replaced', async (_label, owner, name) => {
    const port = await listen(plainServer())
    const connector = new GuardedConnector({ host: '127.0.0.1', port })

    const outcome = await replacingUntilSettled(
      owner,
      name,
      () => undefined,
      async () =>
        connector.connect().then(
          () => undefined,
          (error: unknown) => error
        )
    )

    expect((outcome as { code?: string }).code).toBe(CACHE_ERROR_CODES.INVALID_OPTIONS)
  })

  it('still opens the socket when process.nextTick runs nothing', async () => {
    const port = await listen(plainServer())
    const connector = new GuardedConnector({ host: '127.0.0.1', port })

    const stream = await replacing(
      process,
      'nextTick',
      () => undefined,
      () => connector.connect()
    )

    expect(stream).toBeInstanceOf(Socket)
    connector.disconnect()
  })

  it('still answers when the global Promise is replaced', async () => {
    const port = await listen(plainServer())
    const connector = new GuardedConnector({ host: '127.0.0.1', port })
    class Hollow {
      public constructor() {
        // never settles
      }
    }

    const stream = await replacing(globalThis, 'Promise', Hollow, () => connector.connect())

    expect(stream).toBeInstanceOf(Socket)
    connector.disconnect()
  })
})

describe('the probe clients of a sentinel connector, with a built-in replaced after the import', () => {
  it('gives a probe its own keys when Object.defineProperty does nothing', () => {
    const connector = new GuardedSentinelConnector({
      name: 'm',
      sentinels: [{ host: '127.0.0.1', port: 1 }]
    } as never)
    const connectToSentinel = (
      connector as unknown as {
        connectToSentinel: (endpoint: object) => {
          options: object
          disconnect: () => void
          on: (event: string, listener: () => void) => void
        }
      }
    ).connectToSentinel

    const probe = replacing(
      Object,
      'defineProperty',
      () => undefined,
      () => connectToSentinel.call(connector, { host: '127.0.0.1', port: 1 })
    )
    probe.on('error', () => undefined)
    closers.push(() => probe.disconnect())

    expect(Object.defineProperty).toBe(originalDefineProperty)

    // Every driver name and nothing else: a loop that reads one past the names would define `undefined`.
    expect(Object.hasOwn(probe.options, 'undefined')).toBe(false)
    expect(Object.getOwnPropertyDescriptor(probe.options, 'path')).toEqual({
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true
    })
  })
})

describe('the seal of the delay queue of a cluster, with a built-in replaced after the import', () => {
  const build = (): { client: Cluster; queue: Record<string, unknown> } => {
    const client = new Cluster([{ host: '127.0.0.1', port: 1 }], { lazyConnect: true })
    closers.push(() => client.disconnect())
    return {
      client,
      queue: (client as unknown as { delayQueue: Record<string, unknown> }).delayQueue
    }
  }

  it('has tables without a prototype when Object.create hands out ordinary objects', () => {
    const { client, queue } = build()

    replacing(
      Object,
      'create',
      () => ({}),
      () => sealDelayQueue(client)
    )

    expect(Reflect.getPrototypeOf(queue['queues'] as object)).toBeNull()
  })

  it('still runs what is pushed when Function.prototype.bind swallows it', async () => {
    const { client, queue } = build()
    const swallow = function (): unknown {
      return () => undefined
    }

    replacing(Function.prototype, 'bind', swallow, () => sealDelayQueue(client))
    const ran = jest.fn()
    ;(queue['push'] as (bucket: string, item: () => void, options: object) => void)('moved', ran, {
      timeout: 1
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(ran).toHaveBeenCalledTimes(1)
  })
})
