/**
 * Unit tests for the log catalog in constants.
 *
 * Layer: observability. The main entry writes `CACHE_HOOK_FAILED` without importing this subpath, so
 * the two spellings must be pinned to each other here.
 */
import { HOOK_FAILED_EVENT } from '../server/utils/call-hook'

import { CACHE_LOG_EVENTS } from './constants'

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
})
