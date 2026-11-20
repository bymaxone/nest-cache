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
  // Rule: the second still hears the event, nothing goes unhandled, and the failure is raised to the
  // module (a throw, or a rejection of the returned promise) so it can log it.
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
  ])('keeps going when a bag %s, then raises the failure', async (_how, onQueue) => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)
    const second = jest.fn()
    const events = combineCacheEvents({ onQueue: onQueue as () => void }, { onQueue: second })

    const raised = await Promise.resolve()
      .then(() => events.onQueue?.(5))
      .then(
        () => 'resolved',
        () => 'raised'
      )
    await settle()
    process.off('unhandledRejection', record)

    expect(second).toHaveBeenCalledWith(5)
    expect(raised).toBe('raised')
    expect(unhandled).toEqual([])
  })

  // Rule: a bag that throws after another rejected leaves no unhandled rejection behind.
  it('leaves no unhandled rejection when one bag throws and another rejects', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', record)
    const events = combineCacheEvents(
      { onQueue: async (): Promise<void> => Promise.reject(new Error('async')) },
      {
        onQueue: (): void => {
          throw new Error('sync')
        }
      }
    )

    expect(() => events.onQueue?.(1)).toThrow('sync')
    await settle()
    process.off('unhandledRejection', record)

    expect(unhandled).toEqual([])
  })

  // Rule: every bag gets its own frozen copy of the data, so a write in one cannot reach the next
  // and the library's own object is never the one handed out.
  it('gives each bag its own frozen copy of the data', () => {
    const seen: Array<Record<string, unknown>> = []
    const writer: ICacheEvents = {
      onEvent: (_event, data) => {
        seen.push(data)
        expect(() => {
          data['role'] = 'changed'
        }).toThrow(TypeError)
      }
    }
    const reader: ICacheEvents = { onEvent: (_event, data) => void seen.push(data) }
    const original = { role: 'main' }

    combineCacheEvents(writer, reader).onEvent?.('ready', original)

    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
    expect(seen[0]).not.toBe(original)
    expect(seen.map((data) => data['role'])).toEqual(['main', 'main'])
    expect(Object.isFrozen(seen[1])).toBe(true)
  })
})
