/**
 * Unit tests for {@link combineCacheEvents}.
 *
 * Layer: observability. Every bag gets every callback in order, and one bag's failure, sync or
 * async, never hides the event from the others or reaches the caller.
 */
import type { ICacheEvents } from '@bymax-one/nest-cache'

import { combineCacheEvents } from './combine-cache-events'

describe('combineCacheEvents', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

  it('forwards each callback to every bag, in order', () => {
    const order: string[] = []
    const bag = (name: string): ICacheEvents => ({
      onEvent: (event) => void order.push(`${name}:event:${event}`),
      onOperation: (operation, outcome) => void order.push(`${name}:op:${operation}:${outcome}`),
      onQueue: (queued) => void order.push(`${name}:queue:${queued}`)
    })
    const events = combineCacheEvents(bag('a'), bag('b'))

    events.onEvent?.('ready', {})
    events.onOperation?.('get', 'hit')
    events.onQueue?.(2)

    expect(order).toEqual([
      'a:event:ready',
      'b:event:ready',
      'a:op:get:hit',
      'b:op:get:hit',
      'a:queue:2',
      'b:queue:2'
    ])
  })

  it('skips a bag that lacks a callback', () => {
    const onQueue = jest.fn()
    const events = combineCacheEvents({}, { onQueue })

    events.onQueue?.(1)
    events.onEvent?.('close', {})
    events.onOperation?.('set', 'ok')

    expect(onQueue).toHaveBeenCalledWith(1)
  })

  // Scenario: the first bag throws, rejects, or hands back a thenable that throws.
  // Rule: the second still hears the event, and nothing escapes or goes unhandled.
  it.each([
    [
      'throws',
      (): never => {
        throw new Error('sink')
      }
    ],
    ['rejects', async (): Promise<never> => Promise.reject(new Error('sink'))],
    [
      'returns a throwing thenable',
      (): unknown => ({
        then: (): never => {
          throw new Error('sink')
        }
      })
    ]
  ])('keeps going when a bag %s', async (_how, onQueue) => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)
    const second = jest.fn()
    const events = combineCacheEvents({ onQueue: onQueue as () => void }, { onQueue: second })

    expect(() => events.onQueue?.(5)).not.toThrow()
    await settle()
    process.off('unhandledRejection', record)

    expect(second).toHaveBeenCalledWith(5)
    expect(unhandled).toEqual([])
  })
})
