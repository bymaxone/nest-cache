/**
 * Unit tests for {@link CacheObservability}.
 *
 * Layer: observability. Every log event is an object whose `event` code and field object are both
 * asserted; `message` is library text only, so an error a host handler threw or the driver raised
 * reaches the logger as the `err` object and never inside the text.
 */
import { Logger } from '@nestjs/common'

import { CacheObservability } from './cache-observability'
import { CACHE_LOG_EVENTS } from './constants'

type Level = 'debug' | 'log' | 'warn' | 'error'

/** A logger that records `[level, entry]` in call order. */
const recorder = (): {
  logger: Record<Level, (entry: unknown) => void>
  calls: Array<[Level, Record<string, unknown>]>
} => {
  const calls: Array<[Level, Record<string, unknown>]> = []
  const at =
    (level: Level) =>
    (entry: unknown): void => {
      calls.push([level, entry as Record<string, unknown>])
    }
  return {
    logger: { debug: at('debug'), log: at('log'), warn: at('warn'), error: at('error') },
    calls
  }
}

const SENTINEL = 'sk-live-4eC39HqLyjWDarjtT1zdp7dc'

describe('CacheObservability', () => {
  describe('log events', () => {
    // Scenario: each connection lifecycle event of the main connection.
    // Rule: one object log, with the documented code, level and library text, and the role field.
    it.each([
      ['connect', 'debug', CACHE_LOG_EVENTS.connect, 'Redis connection opened'],
      ['ready', 'log', CACHE_LOG_EVENTS.ready, 'Redis connection ready'],
      ['close', 'warn', CACHE_LOG_EVENTS.close, 'Redis connection closed'],
      ['reconnecting', 'warn', CACHE_LOG_EVENTS.reconnecting, 'Redis connection is reconnecting'],
      ['end', 'warn', CACHE_LOG_EVENTS.end, 'Redis connection ended, no further reconnect']
    ] as const)('logs %s as %s with its code', (event, level, code, message) => {
      const { logger, calls } = recorder()
      const observability = new CacheObservability({ logger })

      observability.events.onEvent?.(event, { role: 'main' })

      expect(calls).toEqual([[level, { event: code, message, role: 'main' }]])
    })

    // Scenario: the `error` event, by `reason`.
    it.each([
      [
        'forced_disconnect',
        'warn',
        CACHE_LOG_EVENTS.forcedDisconnect,
        'Redis connection did not quit in time and was disconnected'
      ],
      ['handler_error', 'error', CACHE_LOG_EVENTS.handlerError, 'A Pub/Sub handler failed']
    ] as const)('logs the %s reason as %s with its code', (reason, level, code, message) => {
      const { logger, calls } = recorder()

      new CacheObservability({ logger }).events.onEvent?.('error', { role: 'subscriber', reason })

      expect(calls).toEqual([[level, { event: code, message, role: 'subscriber' }]])
    })

    it('logs a drop with how many it sums up and counts them', () => {
      const { logger, calls } = recorder()
      const observability = new CacheObservability({ logger })

      observability.events.onEvent?.('error', {
        role: 'subscriber',
        reason: 'handler_queue_full',
        channel: 'orders',
        dropped: 7
      })
      observability.events.onEvent?.('error', { role: 'subscriber', reason: 'handler_queue_full' })

      expect(calls[0]).toEqual([
        'warn',
        {
          event: CACHE_LOG_EVENTS.pubsubDropped,
          message:
            'Pub/Sub messages were dropped because every handler slot and the queue were taken',
          role: 'subscriber',
          dropped: 7
        }
      ])
      expect(calls[1]?.[1]['dropped']).toBe(1)
      expect(observability.droppedTotal()).toBe(8)
    })

    // Scenario: the driver raised, with no `reason`.
    it('logs a driver error as a connection error', () => {
      const { logger, calls } = recorder()

      new CacheObservability({ logger }).events.onEvent?.('error', { role: 'main' })

      expect(calls).toEqual([
        [
          'error',
          {
            event: CACHE_LOG_EVENTS.connectionError,
            message: 'Redis connection error',
            role: 'main'
          }
        ]
      ])
    })

    // Scenario: a reason the library does not report, and a non-string one.
    it.each(['something_else', 42, null])('writes nothing for the reason %p', (reason) => {
      const { logger, calls } = recorder()

      new CacheObservability({ logger }).events.onEvent?.('error', { role: 'main', reason })

      expect(calls).toEqual([])
    })

    it('adds the reconnect delay only when it is a quantity', () => {
      const { logger, calls } = recorder()
      const observability = new CacheObservability({ logger })

      observability.events.onEvent?.('reconnecting', { role: 'main', delay: 250 })
      observability.events.onEvent?.('reconnecting', { role: 'main', delay: -1 })
      observability.events.onEvent?.('reconnecting', { role: 'main', delay: 'soon' })
      observability.events.onEvent?.('reconnecting', { role: 'main', delay: Number.NaN })

      expect(calls.map(([, entry]) => entry['delay'])).toEqual([
        250,
        undefined,
        undefined,
        undefined
      ])
    })

    // Scenario: a role the library never emits, which a host callback could not have produced.
    // The delay belongs to the reconnect event alone; a number under that name elsewhere is not logged.
    it('adds a delay to no event but the reconnect', () => {
      const { logger, calls } = recorder()

      new CacheObservability({ logger }).events.onEvent?.('close', { role: 'main', delay: 250 })

      expect(Object.hasOwn(calls[0]?.[1] ?? {}, 'delay')).toBe(false)
    })

    it('logs an unrecognised role as unknown', () => {
      const { logger, calls } = recorder()
      const observability = new CacheObservability({ logger })

      observability.events.onEvent?.('ready', { role: `tenant ${SENTINEL}` })
      observability.events.onEvent?.('ready', {})

      expect(calls.map(([, entry]) => entry['role'])).toEqual(['unknown', 'unknown'])
    })

    // QA-052: the error a host handler threw is the `err` object; its text is not in the message.
    it('passes an Error as err and keeps its text out of the message and every other field', () => {
      const { logger, calls } = recorder()
      const failure = new Error(`handler failed for ${SENTINEL}`)

      new CacheObservability({ logger }).events.onEvent?.('error', {
        role: 'subscriber',
        reason: 'handler_error',
        channel: `orders:${SENTINEL}`,
        error: `handler failed for ${SENTINEL}`,
        err: failure
      })

      const entry: Record<string, unknown> = calls[0]?.[1] ?? {}
      expect(entry['err']).toBe(failure)
      expect(entry['message']).toBe('A Pub/Sub handler failed')
      const { err: _err, ...rest } = entry
      expect(JSON.stringify(rest)).not.toContain(SENTINEL)
    })

    // A value that is not an Error is not forwarded: there is nothing for the logger to serialize.
    it.each([SENTINEL, { secret: SENTINEL }, undefined])('drops the non-Error err %p', (err) => {
      const { logger, calls } = recorder()

      new CacheObservability({ logger }).events.onEvent?.('error', {
        role: 'main',
        reason: 'handler_error',
        err
      })

      expect(Object.hasOwn(calls[0]?.[1] ?? {}, 'err')).toBe(false)
    })

    it('writes through a Nest logger named BymaxCache when none is given', () => {
      const contexts: unknown[] = []
      const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(function (this: Logger) {
        contexts.push(Reflect.get(this, 'context'))
      })
      try {
        new CacheObservability().events.onEvent?.('ready', { role: 'main' })

        expect(contexts).toEqual(['BymaxCache'])
        expect(spy).toHaveBeenCalledWith({
          event: CACHE_LOG_EVENTS.ready,
          message: 'Redis connection ready',
          role: 'main'
        })
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('operations and backlog', () => {
    it('counts each command and outcome, and lists them', () => {
      const observability = new CacheObservability({ logger: recorder().logger })

      observability.events.onOperation?.('get', 'hit')
      observability.events.onOperation?.('get', 'hit')
      observability.events.onOperation?.('get', 'miss')
      observability.events.onOperation?.('set', 'ok')

      expect(observability.operations()).toEqual([
        ['get', 'hit', 2],
        ['get', 'miss', 1],
        ['set', 'ok', 1]
      ])
    })

    // Scenario: a name or outcome outside the closed sets, including inherited property names.
    it.each([
      ['users:42', 'ok'],
      ['get', 'a@b.example'],
      ['__proto__', 'ok'],
      ['toString', 'ok'],
      ['get', 'constructor']
    ])('ignores the pair %p / %p', (operation, outcome) => {
      const observability = new CacheObservability({ logger: recorder().logger })

      observability.events.onOperation?.(operation as never, outcome as never)

      expect(observability.operations()).toEqual([])
    })

    it('keeps the last valid backlog and ignores a value that is not a quantity', () => {
      const observability = new CacheObservability({ logger: recorder().logger })

      observability.events.onQueue?.(4)
      for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, '3' as never]) {
        observability.events.onQueue?.(bad)
      }

      expect(observability.queued()).toBe(4)
    })

    it('accepts a backlog of zero', () => {
      const observability = new CacheObservability({ logger: recorder().logger })
      observability.events.onQueue?.(2)

      observability.events.onQueue?.(0)

      expect(observability.queued()).toBe(0)
    })
  })
})
