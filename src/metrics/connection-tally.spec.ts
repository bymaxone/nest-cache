/**
 * Unit tests for {@link CacheConnectionTally}.
 *
 * Layer: metrics. The tally owns the semantics a metrics backend must not re-derive: which role an
 * event belongs to, which events move a connection's readiness, and what may become a label.
 */
import { CacheConnectionTally } from './connection-tally'

describe('CacheConnectionTally', () => {
  // Every role keeps its own counts; folding the two connections together would let a subscriber
  // reconnecting read as the main client reconnecting.
  it('counts each event per role', () => {
    const tally = new CacheConnectionTally()

    tally.record('ready', { role: 'main' })
    tally.record('ready', { role: 'main' })
    tally.record('ready', { role: 'subscriber' })
    tally.record('close', { role: 'main' })

    expect(tally.entries()).toEqual([
      ['main', 'ready', 2],
      ['main', 'close', 1],
      ['subscriber', 'ready', 1]
    ])
  })

  // Only combinations that happened are reported: a healthy deployment must not publish a dozen
  // permanently-zero series.
  it('reports no entry for an event that never happened', () => {
    expect(new CacheConnectionTally().entries()).toEqual([])
  })

  // The role arrives in a payload typed Record<string, unknown>. Anything that is not a known role
  // collapses to one name, so no payload can mint series without bound.
  it.each([
    ['an unrecognised string', { role: 'intruder' }],
    ['a number', { role: 7 }],
    ['an object', { role: { nested: true } }],
    ['no role', {}]
  ])('collapses %s to the unknown role', (_name, data) => {
    const tally = new CacheConnectionTally()

    tally.record('ready', data)

    expect(tally.entries()).toEqual([['unknown', 'ready', 1]])
  })

  // The bound holds however many distinct values arrive.
  it('mints at most one extra series however many roles arrive', () => {
    const tally = new CacheConnectionTally()

    for (let i = 0; i < 1000; i += 1) {
      tally.record('ready', { role: `role-${i}` })
    }

    expect(tally.entries()).toEqual([['unknown', 'ready', 1000]])
  })

  // A host that runs another connection through the same sink names its role once, up front, and the
  // set stays closed.
  it('accepts extra roles the host declares and no others', () => {
    const tally = new CacheConnectionTally({ roles: ['auth'] })

    tally.record('ready', { role: 'auth' })
    tally.record('ready', { role: 'main' })
    tally.record('ready', { role: 'other' })

    expect(tally.entries()).toEqual([
      ['auth', 'ready', 1],
      ['main', 'ready', 1],
      ['unknown', 'ready', 1]
    ])
  })

  // The event bag hands each event to the tally, which is how it is wired into the module options.
  it('events.onEvent records the event', () => {
    const tally = new CacheConnectionTally()

    tally.events.onEvent?.('connect', { role: 'main' })

    expect(tally.entries()).toEqual([['main', 'connect', 1]])
  })

  // A connection that reports itself as `main` can be recorded under its own role instead, so its
  // drop does not move the cache's own readiness.
  it('eventsAs records under the named role whatever the payload says', () => {
    const tally = new CacheConnectionTally({ roles: ['auth'] })

    tally.eventsAs('auth').onEvent?.('ready', { role: 'main' })

    expect(tally.entries()).toEqual([['auth', 'ready', 1]])
    expect(tally.readiness()).toEqual([['auth', true]])
  })

  describe('readiness', () => {
    // A role is ready when its latest connection transition is `ready`.
    it('is ready after ready and not ready after any later transition', () => {
      const tally = new CacheConnectionTally()

      tally.record('ready', { role: 'main' })
      expect(tally.readiness()).toEqual([['main', true]])

      tally.record('close', { role: 'main' })
      expect(tally.readiness()).toEqual([['main', false]])

      tally.record('reconnecting', { role: 'main' })
      tally.record('connect', { role: 'main' })
      expect(tally.readiness()).toEqual([['main', false]])
    })

    // An `error` carrying a reason is not a socket failure: it is a forced disconnect at shutdown or
    // a subscriber handler that threw, and neither says anything about whether the connection works.
    it.each(['forced_disconnect', 'handler_error'])(
      'an error with reason %s does not move readiness',
      (reason) => {
        const tally = new CacheConnectionTally()
        tally.record('ready', { role: 'main' })

        tally.record('error', { role: 'main', reason })

        expect(tally.readiness()).toEqual([['main', true]])
        expect(tally.entries()).toEqual([
          ['main', 'ready', 1],
          ['main', 'error', 1]
        ])
      }
    )

    // An error carrying the driver's own message is a connection failure.
    it('an error without a reason moves readiness to not ready', () => {
      const tally = new CacheConnectionTally()
      tally.record('ready', { role: 'main' })

      tally.record('error', { role: 'main', error: 'ECONNRESET' })

      expect(tally.readiness()).toEqual([['main', false]])
    })

    // A role that has only ever emitted non-transition errors has nothing that says it works.
    it('a role seen only through non-transition errors is not ready', () => {
      const tally = new CacheConnectionTally()

      tally.record('error', { role: 'subscriber', reason: 'handler_error' })

      expect(tally.readiness()).toEqual([['subscriber', false]])
    })

    // Roles are independent: the subscriber coming ready must not lift a main client that is down.
    it('keeps the roles apart', () => {
      const tally = new CacheConnectionTally()

      tally.record('close', { role: 'main' })
      tally.record('ready', { role: 'subscriber' })

      expect(tally.readiness()).toEqual([
        ['main', false],
        ['subscriber', true]
      ])
    })
  })
})
