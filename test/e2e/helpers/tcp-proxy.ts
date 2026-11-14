/**
 * A TCP proxy a test can cut and reopen, so a client's connection drops without the server stopping.
 *
 * Layer: test utilities. `docker pause` keeps the sockets open and `docker stop` ends the server;
 * neither drops only the client's connection and then lets it reconnect to the same server, which
 * a reconnecting client under test needs.
 */
import { connect, createServer, type Server, type Socket } from 'node:net'

/** Forwards `127.0.0.1:port` to `target` until it is cut. */
export class TcpProxy {
  readonly #sockets = new Set<Socket>()
  #server: Server | undefined
  #dropReplies = false

  /**
   * @param port - The local port clients connect to; stays the same across a cut and a reopen.
   * @param target - The server the proxy forwards to.
   * @param target.host - The target host.
   * @param target.port - The target port.
   */
  constructor(
    readonly port: number,
    private readonly target: { host: string; port: number }
  ) {}

  /** Starts accepting and forwarding connections. */
  async open(): Promise<void> {
    const server = createServer((client) => {
      const upstream = connect(this.target.port, this.target.host)
      for (const socket of [client, upstream]) {
        this.#sockets.add(socket)
        socket.on('error', () => socket.destroy())
        socket.on('close', () => this.#sockets.delete(socket))
      }
      client.pipe(upstream)
      upstream.on('data', (chunk: Buffer) => {
        if (!this.#dropReplies) {
          client.write(chunk)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(this.port, '127.0.0.1', resolve))
    this.#server = server
  }

  /**
   * While `on`, what the server answers is dropped and what the client sends still reaches the
   * server, so a command is executed and its reply never arrives.
   *
   * @param on - Whether to drop the server's replies.
   */
  dropReplies(on: boolean): void {
    this.#dropReplies = on
  }

  /** Destroys every connection and stops accepting new ones, so a client sees the server go away. */
  async cut(): Promise<void> {
    const server = this.#server
    this.#server = undefined
    this.#sockets.forEach((socket) => socket.destroy())
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
