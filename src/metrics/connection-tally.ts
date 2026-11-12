/**
 * Tally of cache connection lifecycle events per role.
 *
 * Layer: metrics, with no dependency on a metrics backend. It owns the semantics a backend must not
 * re-derive: which role an event belongs to, which events move a connection's readiness, and what may
 * become a label. `BymaxCacheModule` runs two connections, the main client and a dedicated subscriber
 * minted on the first subscribe, and both emit the same six events, told apart only by `data.role`.
 *
 * It records rather than publishes: events arrive from the moment the client connects, which is before
 * any metrics registry exists, so a sink that wrote straight to a collector would drop the startup
 * window, which is where a reconnect loop first shows.
 */
import type { ICacheEvents } from '@bymax-one/nest-cache'
import type { CacheEventName } from '@bymax-one/nest-cache/shared'

/** The roles the library itself emits. */
const LIBRARY_ROLES: readonly string[] = ['main', 'subscriber']

/** Where an unrecognised or absent role is recorded. */
const UNKNOWN_ROLE = 'unknown'

/** The event that marks a connection usable; every other transition leaves it unusable. */
const READY_EVENT: CacheEventName = 'ready'

/** The event the library reuses for failures that are not always connection failures. */
const ERROR_EVENT: CacheEventName = 'error'

/** Options of {@link CacheConnectionTally}. */
export interface CacheConnectionTallyOptions {
  /**
   * Extra roles to record under their own name, for a host that runs another connection through
   * {@link CacheConnectionTally.eventsAs}. The set stays closed: any other role is recorded as
   * `unknown`, so a payload cannot mint series without bound.
   */
  readonly roles?: readonly string[]
}

/**
 * Whether an event moves a connection's readiness.
 *
 * Every event except `error` is a socket transition. An `error` is one only when it carries the
 * driver's message instead of a `reason`: the library reuses the event for a forced disconnect during
 * shutdown (`reason: 'forced_disconnect'`) and for a subscriber handler that threw
 * (`reason: 'handler_error'`), neither of which says anything about whether the connection works.
 *
 * @param event - The lifecycle event name.
 * @param data - The payload accompanying it.
 * @returns True when the event should move readiness.
 */
function isConnectionTransition(event: CacheEventName, data: Record<string, unknown>): boolean {
  return event !== ERROR_EVENT || data['reason'] === undefined
}

/**
 * Running count of cache connection lifecycle events per role, and each role's latest transition.
 */
export class CacheConnectionTally {
  /** The roles recorded under their own name. */
  private readonly roles: ReadonlySet<string>

  /** How many times each role has seen each event. */
  private readonly counts = new Map<string, Map<CacheEventName, number>>()

  /** Each role's most recent connection transition. */
  private readonly latest = new Map<string, CacheEventName>()

  /**
   * The callback bag to hand to `BymaxCacheModule` as `events`.
   *
   * The library swallows anything thrown from a callback, so this does the least it can: two map
   * writes per event and no I/O.
   */
  readonly events: ICacheEvents = {
    onEvent: (event, data): void => {
      this.record(event, data)
    }
  }

  /**
   * @param options - Extra roles to recognise beyond the library's own.
   */
  constructor(options: CacheConnectionTallyOptions = {}) {
    this.roles = new Set([...LIBRARY_ROLES, ...(options.roles ?? [])])
  }

  /**
   * Records one lifecycle event against the role that emitted it.
   *
   * @param event - The event the cache client emitted.
   * @param data - The payload accompanying it, carrying the role. Nothing else in it is read.
   */
  record(event: CacheEventName, data: Record<string, unknown>): void {
    const role = this.roleOf(data['role'])
    const forRole = this.counts.get(role) ?? new Map<CacheEventName, number>()
    forRole.set(event, (forRole.get(event) ?? 0) + 1)
    this.counts.set(role, forRole)

    if (isConnectionTransition(event, data)) {
      this.latest.set(role, event)
    }
  }

  /**
   * A callback bag that records every event under `role`, whatever the payload says.
   *
   * For a connection that reports itself as `main`: recorded as it arrives, its drop would move the
   * cache's own readiness. `role` must have been declared in the constructor options, or the events
   * are recorded as `unknown`.
   *
   * @param role - The role to record under.
   * @returns The callback bag.
   */
  eventsAs(role: string): ICacheEvents {
    return {
      onEvent: (event, data): void => {
        this.record(event, { ...data, role })
      }
    }
  }

  /**
   * Every role and event seen so far, with its count.
   *
   * Only combinations that have occurred are returned: a zero for every role and event would put a
   * dozen permanently-zero series on the endpoint of a healthy deployment.
   *
   * @returns Role, event and count triples, in the order they were first seen.
   */
  entries(): readonly (readonly [string, CacheEventName, number])[] {
    const rows: (readonly [string, CacheEventName, number])[] = []
    for (const [role, forRole] of this.counts) {
      for (const [event, count] of forRole) {
        rows.push([role, event, count])
      }
    }
    return rows
  }

  /**
   * Each role's current readiness.
   *
   * Derived from the latest transition, so there is one source of truth. A role that has emitted
   * nothing but non-transition errors is reported as not ready: nothing has said it works.
   *
   * @returns Role and readiness pairs, in the order the roles were first seen.
   */
  readiness(): readonly (readonly [string, boolean])[] {
    return [...this.counts.keys()].map((role) => [role, this.latest.get(role) === READY_EVENT])
  }

  /**
   * Bounds what can become a label.
   *
   * @param role - The `role` value of a payload, of any type.
   * @returns A declared role, or `unknown`.
   */
  private roleOf(role: unknown): string {
    return typeof role === 'string' && this.roles.has(role) ? role : UNKNOWN_ROLE
  }
}
