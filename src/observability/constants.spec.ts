/**
 * Unit tests for the log catalog in constants.
 *
 * Layer: observability. The main entry writes `CACHE_HOOK_FAILED` without importing this subpath, so
 * the two spellings must be pinned to each other here.
 */
import { HOOK_FAILED_EVENT } from '../server/utils/call-hook'

import { CACHE_LOG_EVENTS, CACHE_OPERATION_NAMES, CACHE_OPERATION_OUTCOMES } from './constants'

describe('CACHE_LOG_EVENTS', () => {
  it('lists the code the main entry writes when a host hook fails', () => {
    expect(CACHE_LOG_EVENTS.hookFailed).toBe(HOOK_FAILED_EVENT)
    expect(HOOK_FAILED_EVENT).toBe('CACHE_HOOK_FAILED')
  })

  it('gives every event a distinct CACHE_ code', () => {
    const codes = Object.values(CACHE_LOG_EVENTS)

    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.every((code) => code.startsWith('CACHE_'))).toBe(true)
  })

  // Scenario: the table is read by the observability writer and by the specs through the same
  // constant, so a changed spelling would move the code and its expectation together.
  // Rule: the ten codes keep these literal strings, because log pipelines match on them.
  it('keeps the literal string of every event code', () => {
    expect(CACHE_LOG_EVENTS).toEqual({
      connect: 'CACHE_CONNECT',
      ready: 'CACHE_READY',
      close: 'CACHE_CLOSE',
      reconnecting: 'CACHE_RECONNECTING',
      end: 'CACHE_END',
      connectionError: 'CACHE_CONNECTION_ERROR',
      forcedDisconnect: 'CACHE_FORCED_DISCONNECT',
      handlerError: 'CACHE_HANDLER_ERROR',
      pubsubDropped: 'CACHE_PUBSUB_DROPPED',
      hookFailed: 'CACHE_HOOK_FAILED'
    })
  })
})

describe('CACHE_OPERATION_NAMES and CACHE_OPERATION_OUTCOMES', () => {
  // Scenario: the label values of the operations counter come from these two tables.
  // Rule: the names and outcomes a dashboard filters on stay exactly these literals, in this order.
  it('keeps the literal command names', () => {
    expect(Object.keys(CACHE_OPERATION_NAMES)).toEqual([
      'get',
      'getRaw',
      'set',
      'setRaw',
      'setNx',
      'del',
      'delMany',
      'exists',
      'incr',
      'decr',
      'expire',
      'ttl',
      'persist',
      'mget',
      'mset',
      'hget',
      'hset',
      'hgetall',
      'hdel',
      'sadd',
      'srem',
      'smembers',
      'sismember',
      'scard',
      'keys',
      'scan',
      'flushNamespace',
      'eval',
      'isHealthy',
      'ping',
      'info'
    ])
  })

  it('keeps the literal outcomes', () => {
    expect(Object.keys(CACHE_OPERATION_OUTCOMES)).toEqual(['hit', 'miss', 'ok', 'error'])
  })
})
