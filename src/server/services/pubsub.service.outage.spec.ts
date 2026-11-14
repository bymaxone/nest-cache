/**
 * Unit tests for how {@link PubSubService} reports an unavailable backing service.
 *
 * Layer: server. A publish, subscribe or unsubscribe that times out, or finds the connection down
 * with the offline queue off, surfaces as `COMMAND_TIMEOUT` or `CONNECTION_LOST` (both 503), the
 * original error on `cause`, instead of a bare ioredis error.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { CACHE_ERROR_CODES } from '../errors/cache-error-codes'
import { CacheException } from '../errors/cache.exception'
import { KeyBuilder } from '../utils/key-builder'
import { PubSubService } from './pubsub.service'

// Swap real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

const TIMEOUT = 'Command timed out'
const OFFLINE = "Stream isn't writeable and enableOfflineQueue options is false"

describe('PubSubService outage mapping', () => {
  let connection: ConnectionManager
  let pubsub: PubSubService

  beforeEach(async () => {
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'ps' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    pubsub = new PubSubService(options, connection, new KeyBuilder(options))
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    await pubsub.onApplicationShutdown()
    await connection.onApplicationShutdown()
  })

  /** What `call` rejected with, failing the test when it resolved. */
  const rejectionOf = async (call: () => Promise<unknown>): Promise<CacheException> => {
    try {
      await call()
    } catch (error) {
      return error as CacheException
    }
    throw new Error('expected the call to reject')
  }

  it('reports a timed-out publish as COMMAND_TIMEOUT with the original as cause', async () => {
    const original = new Error(TIMEOUT)
    jest.spyOn(connection.getClient(), 'publish').mockRejectedValue(original)

    const error = await rejectionOf(() => pubsub.publish('events', 'x'))

    expect(error).toBeInstanceOf(CacheException)
    expect(error.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    expect(error.getStatus()).toBe(503)
    expect(error.cause).toBe(original)
  })

  it('reports a publish while the connection is down as CONNECTION_LOST (offline)', async () => {
    jest.spyOn(connection.getClient(), 'publish').mockRejectedValue(new Error(OFFLINE))

    const error = await rejectionOf(() => pubsub.publish('events', 'x'))

    expect(error.code).toBe(CACHE_ERROR_CODES.CONNECTION_LOST)
    expect(error.details).toEqual({ reason: 'offline' })
  })

  // The subscriber is a separate client minted by the connection manager.
  it('reports a timed-out SUBSCRIBE and PSUBSCRIBE as COMMAND_TIMEOUT', async () => {
    const subscriber = connection.createSubscriberClient()
    jest.spyOn(connection, 'createSubscriberClient').mockReturnValue(subscriber)
    jest.spyOn(subscriber, 'subscribe').mockRejectedValue(new Error(TIMEOUT))
    jest.spyOn(subscriber, 'psubscribe').mockRejectedValue(new Error(TIMEOUT))

    const channel = await rejectionOf(() => pubsub.subscribe('events', () => undefined))
    const pattern = await rejectionOf(() => pubsub.psubscribe('ev*', () => undefined))

    expect(channel.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
    expect(pattern.code).toBe(CACHE_ERROR_CODES.COMMAND_TIMEOUT)
  })

  it('passes any other failure of a publish through unchanged', async () => {
    const original = new Error('ERR something else')
    jest.spyOn(connection.getClient(), 'publish').mockRejectedValue(original)

    expect(await rejectionOf(() => pubsub.publish('events', 'x'))).toBe(original)
  })
})
