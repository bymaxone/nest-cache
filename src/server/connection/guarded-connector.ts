/**
 * The connector the manager gives ioredis, and the guard it puts on every connect.
 *
 * Layer: server. ioredis opens its socket in `connect()`, on the first connect and on every reconnect,
 * from an ordinary object it builds then (`{ port, host, family }` plus the `tls` options), which Node
 * reads with inheritance: a `path`, `ca`, `cert` or `servername` planted on `Object.prototype` after the
 * client was built would redirect the connection to a unix socket or make a server trusted. The guard
 * that refuses a polluted `Object.prototype` at build time cannot see that, so it runs here as well, in
 * the tick that opens the socket, and the object handed to Node has no prototype.
 */
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
import type { ConnectionOptions } from 'node:tls'

import { AbstractConnector, SentinelConnector } from 'ioredis'

import { assertDriverUnshadowed, DRIVER_OPTION_NAMES } from './driver-option-names'

/** `Object.hasOwn` as it was when this module loaded. */
const hasOwn = Object.hasOwn

/** ioredis's own text for a connect attempt that was cancelled before the socket opened. */
const CONNECTION_CLOSED_MESSAGE = 'Connection is closed.'

/**
 * Gives the table of listeners of a socket no prototype. Node finds the listeners of an event with a plain
 * property read of that table, which inherits `Object.prototype`, so a string planted there under the name
 * of an event after the guard ran (`lookup`, `connectionAttempt`, `ready`, `resume`, and any other) is read as
 * the listener and throws in the event loop, where nothing can catch it. A list of names can never be
 * complete; a table with no prototype finds only the socket's own listeners, which keep working.
 *
 * @param stream - A socket that was just created.
 */
function sealListeners(stream: object): void {
  const table = (stream as { _events?: object })._events
  if (table !== undefined && Reflect.getPrototypeOf(table) !== null) {
    Reflect.setPrototypeOf(table, null)
  }
}

/**
 * The descriptor of an own key whose value is `undefined`. It has no prototype, and the key is defined and not
 * assigned: an assignment to an inherited key that is read-only throws, and a descriptor that inherits a
 * planted `get` or `set` is refused.
 */
const SHADOW = Object.assign(Object.create(null) as PropertyDescriptor, {
  value: undefined,
  writable: true,
  enumerable: true,
  configurable: true
})

/** The options of a client, as far as the connector reads them. */
interface IConnectorOptions {
  readonly disconnectTimeout?: number | undefined
  readonly path?: string | undefined
  readonly port?: number | undefined
  readonly host?: string | undefined
  readonly family?: number | undefined
  readonly tls?: ConnectionOptions | undefined
}

/**
 * The connector of a standalone client and of the nodes of a cluster: ioredis's own `StandaloneConnector`
 * with the guard run in the tick that opens the socket, and the options handed to Node held in an
 * object that has no prototype.
 */
export class GuardedConnector extends AbstractConnector {
  /**
   * @param options - The options ioredis built the client with.
   */
  public constructor(private readonly options: IConnectorOptions) {
    super(options.disconnectTimeout ?? 0)
  }

  /**
   * The unix socket the options name, when the connector may connect to one.
   *
   * @param options - The options ioredis built the client with.
   * @returns The path, or `undefined`.
   */
  protected pathOf(options: IConnectorOptions): string | undefined {
    return options.path
  }

  /**
   * Opens the socket.
   *
   * @returns The socket, a TLS socket when `tls` is set.
   * @throws {CacheException} `INVALID_OPTIONS` when `Object.prototype` holds a key it does not hold by
   *   default. ioredis ends a client whose connector rejects (status `end`, no retry), so the client is
   *   not used again.
   */
  public connect(): Promise<Socket> {
    const { options } = this
    // Before anything is read: ioredis builds the options of a client with a `for...in` that copies an
    // enumerable key visible on `Object.prototype` into the options as an own key, and starts the first
    // connect in the same synchronous step, so a key that is visible then is visible here, and one that is
    // gone before the guard of the next tick would otherwise be read as the host's.
    try {
      assertDriverUnshadowed()
    } catch (error) {
      return Promise.reject(error)
    }
    this.connecting = true
    const target = Object.create(null) as Record<string, unknown>
    const path = this.pathOf(options)
    if (path) {
      target['path'] = path
    } else {
      // Stryker disable next-line ConditionalExpression: Node reads an own `undefined` port as an absent one (measured), so setting it always connects the same
      if (options.port != null) target['port'] = options.port
      // Stryker disable next-line ConditionalExpression: Node reads an own `undefined` or `null` host as an absent one (measured), so setting it always connects the same
      if (options.host != null) target['host'] = options.host
      // Stryker disable next-line ConditionalExpression: Node reads an own `undefined` or `null` family as an absent one (measured), so setting it always connects the same
      if (options.family != null) target['family'] = options.family
    }
    const { tls } = options
    if (tls) Object.assign(target, tls)

    return new Promise<Socket>((resolve, reject) => {
      process.nextTick(() => {
        if (!this.connecting) {
          reject(new Error(CONNECTION_CLOSED_MESSAGE))
          return
        }
        try {
          assertDriverUnshadowed()
          this.stream = tls
            ? tlsConnect(target as unknown as ConnectionOptions)
            : createConnection(target as unknown as { path: string })
        } catch (error) {
          reject(error)
          return
        }
        sealListeners(this.stream)
        this.stream.once('error', (error) => {
          this.firstError = error
        })
        resolve(this.stream)
      })
    })
  }
}

/**
 * The connector of the probe clients of a sentinel client. A probe connects to the address of a sentinel,
 * never to a unix socket, and ioredis copies an enumerable key it can see on `Object.prototype` into the
 * options of a client as an own key while it builds them, in a step that a guard looking at the prototype
 * afterwards cannot see: a `path` that was there for that step only (an accessor that removes itself)
 * would send the probe, and the sentinel password, to a socket of its own. A probe ignores `path`.
 */
class ProbeConnector extends GuardedConnector {
  protected override pathOf(): undefined {
    return undefined
  }
}

/** What the connector of a sentinel client needs of a probe client ioredis built from a literal. */
interface IProbeClient {
  readonly options: Record<string, unknown>
}

/**
 * The connector of a sentinel client: ioredis's own `SentinelConnector` with the guard run before the connect
 * and again once it resolved, the socket's table of listeners sealed, and the same guard and shadows on the
 * probe clients it builds to ask the sentinels for the master and to watch for a failover.
 *
 * It asks the sentinels for the master and then opens the socket from what they answered, an ordinary object
 * Node reads with inheritance, so a key planted while it waited is read there: a socket opened under a
 * polluted `Object.prototype` is destroyed before ioredis uses it and the connect is refused. The probe
 * clients are built from literals on ioredis's default connector, so a key planted while the connect waited
 * would redirect them to a socket of its own and send the sentinel password there: each is given the
 * connector of the library and an own `undefined` for every driver option name.
 */
export class GuardedSentinelConnector extends SentinelConnector {
  /**
   * @param options - The options ioredis built the client with.
   */
  public constructor(options: ConstructorParameters<typeof SentinelConnector>[0]) {
    super(options)
    // `connectToSentinel` is private in the typings of ioredis, so it is replaced on the instance.
    const self = this as unknown as {
      connectToSentinel: (endpoint: object, extra?: object) => IProbeClient
    }
    const original = self.connectToSentinel.bind(this)
    self.connectToSentinel = (endpoint, extra): IProbeClient => {
      const probe = original(endpoint, { ...extra, Connector: ProbeConnector })
      for (const name of DRIVER_OPTION_NAMES) {
        if (!hasOwn(probe.options, name)) Object.defineProperty(probe.options, name, SHADOW)
      }
      return probe
    }
  }

  /**
   * Opens the socket to the master the sentinels name.
   *
   * @param eventEmitter - ioredis's callback for the events of the connect.
   * @returns The socket.
   * @throws {CacheException} `INVALID_OPTIONS` when `Object.prototype` holds a key it does not hold by
   *   default, before or while the sentinels were asked.
   */
  public override async connect(
    eventEmitter: Parameters<SentinelConnector['connect']>[0]
  ): ReturnType<SentinelConnector['connect']> {
    assertDriverUnshadowed()
    const stream = await super.connect(eventEmitter)
    try {
      assertDriverUnshadowed()
    } catch (error) {
      stream.destroy()
      throw error
    }
    sealListeners(stream)
    return stream
  }
}

/**
 * Hands the client the emitter the sentinel connector reports its events through: ioredis sets it only
 * when it builds the connector itself, and a `Connector` option bypasses that.
 *
 * @param client - A client built with `GuardedSentinelConnector`.
 * @returns The same client.
 */
export function bindSentinelEmitter<T extends object>(client: T): T {
  ;(client as unknown as { connector: { emitter: unknown } }).connector.emitter = client
  return client
}
