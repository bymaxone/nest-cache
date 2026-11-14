/**
 * Unit tests for opt-in message validation on {@link PubSubService}.
 *
 * Layer: server. `subscribe` and `psubscribe` take an optional `{ validate }`. A message that does
 * not satisfy it is not delivered: it takes the existing handler-error path, an `error` event with
 * the catalog text and no part of the payload. With no `validate` nothing changes.
 */
import { applyDefaults } from '../config/default-options'
import { ConnectionManager } from '../connection/connection.manager'
import { KeyBuilder } from '../utils/key-builder'
import { PubSubService } from './pubsub.service'

// Swap the real ioredis for the in-memory mock so no socket is opened.
jest.mock('ioredis', () => {
  const Mock = require('ioredis-mock')
  return { __esModule: true, Redis: Mock, default: Mock, Cluster: class FakeCluster {} }
})

interface Ping {
  seq: number
}

/** Whether `value` is a {@link Ping}. */
const isPing = (value: unknown): value is Ping =>
  typeof value === 'object' && value !== null && typeof (value as Ping).seq === 'number'

/** Waits for the in-memory bus to deliver and the listener's promise chain to settle. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('PubSubService message validation', () => {
  let connection: ConnectionManager
  let observed: PubSubService
  const onEvent = jest.fn()

  beforeEach(async () => {
    onEvent.mockClear()
    const options = applyDefaults({ connection: { host: 'h' }, namespace: 'pv' })
    connection = new ConnectionManager(options)
    await connection.onModuleInit()
    observed = new PubSubService(options, connection, new KeyBuilder(options), undefined, {
      onEvent
    })
  })

  afterEach(async () => {
    await observed.onApplicationShutdown()
    await connection.onApplicationShutdown()
  })

  // A message that satisfies the validator is delivered, typed.
  it('delivers a matching message through subscribe', async () => {
    const received: Ping[] = []
    await observed.subscribe<Ping>('ok', (message) => void received.push(message), {
      validate: isPing
    })

    await observed.publish('ok', { seq: 1 })
    await settle()

    expect(received).toEqual([{ seq: 1 }])
    expect(onEvent).not.toHaveBeenCalled()
  })

  // A message of the wrong shape is not delivered, and the host's observer is told through the
  // existing handler-error event, with the catalog text and nothing of the payload.
  it('drops a wrong-shape message and reports it without its payload', async () => {
    const handler = jest.fn()
    await observed.subscribe<Ping>('bad', handler, { validate: isPing })

    await observed.publish('bad', { seq: 'secret-token-123' })
    await settle()

    expect(handler).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith('error', {
      role: 'subscriber',
      reason: 'handler_error',
      channel: 'pv:bad',
      error: 'The stored value does not match the expected shape.'
    })
    expect(JSON.stringify(onEvent.mock.calls)).not.toContain('secret')
  })

  // The same for a pattern subscription, which also hands the handler the channel and the pattern.
  it('validates through psubscribe, delivering the channel and the pattern', async () => {
    const received: Array<[Ping, string, string]> = []
    await observed.psubscribe<Ping>(
      'room:*',
      (message, channel, pattern) => void received.push([message, channel, pattern]),
      { validate: isPing }
    )

    await observed.publish('room:1', { seq: 7 })
    await observed.publish('room:2', { nope: true })
    await settle()

    expect(received).toEqual([[{ seq: 7 }, 'pv:room:1', 'pv:room:*']])
    expect(onEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ reason: 'handler_error', channel: 'pv:room:2' })
    )
  })

  // An asynchronous Standard Schema is awaited before the handler runs.
  it('awaits an asynchronous schema before delivering', async () => {
    const received: Ping[] = []
    const schema = {
      '~standard': {
        version: 1 as const,
        validate: (value: unknown) =>
          Promise.resolve(isPing(value) ? { value } : { issues: [{ message: 'x' }] })
      }
    }
    await observed.subscribe<Ping>('async', (message) => void received.push(message), {
      validate: schema
    })

    await observed.publish('async', { seq: 3 })
    await settle()

    expect(received).toEqual([{ seq: 3 }])
  })

  // With no validate nothing changes: the message arrives as decoded.
  it('delivers any decoded message when no validate is given', async () => {
    const received: unknown[] = []
    await observed.subscribe('plain', (message) => void received.push(message))
    await observed.psubscribe('pl:*', (message) => void received.push(message))

    await observed.publish('plain', { anything: true })
    await observed.publish('pl:x', 'text')
    await settle()

    expect(received).toEqual([{ anything: true }, 'text'])
  })
})
