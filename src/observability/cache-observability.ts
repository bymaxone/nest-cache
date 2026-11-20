/**
 * Records the cache's operations, its Pub/Sub backlog and its drops, and writes the library's log events.
 *
 * Layer: observability, an optional subpath. Hand {@link CacheObservability.events} to `BymaxCacheModule`
 * as `events`: the module calls it from the moment a client connects, which is before any metrics registry
 * exists, so it records rather than publishes, and the contributor reads it on every scrape.
 *
 * The log events are object messages through a Nest logger: `message` is library text, and an error a
 * host handler threw, or the driver raised, goes in `err` as the object itself, never interpolated into
 * the text, so the logger's serializer and redaction apply to it. No channel, key or payload is logged.
 */
import { Logger } from '@nestjs/common'

import type { ICacheEvents } from '@bymax-one/nest-cache'
import type {
  CacheEventName,
  CacheOperationName,
  CacheOperationOutcome
} from '@bymax-one/nest-cache/shared'

import { CACHE_LOG_EVENTS, CACHE_OPERATION_NAMES, CACHE_OPERATION_OUTCOMES } from './constants'

/** The logger methods this surface uses; a Nest `Logger` satisfies it. */
export interface CacheObservabilityLogger {
  /** Writes a debug event. */
  debug(message: unknown): void
  /** Writes an informational event. */
  log(message: unknown): void
  /** Writes a warning event. */
  warn(message: unknown): void
  /** Writes an error event. */
  error(message: unknown): void
}

/** Options of {@link CacheObservability}. */
export interface CacheObservabilityOptions {
  /** Where the log events go. Defaults to a Nest `Logger` named `BymaxCache`. */
  readonly logger?: CacheObservabilityLogger
}

/** The roles the library itself emits; any other is logged as `unknown`. */
const LIBRARY_ROLES: readonly string[] = ['main', 'subscriber']

/** Where an unrecognised or absent role is logged. */
const UNKNOWN_ROLE = 'unknown'

/** One connection or Pub/Sub log event: its code, level and library text. */
interface LogEntry {
  readonly event: string
  readonly level: 'debug' | 'log' | 'warn' | 'error'
  readonly message: string
}

/** The log event of each connection lifecycle event that carries no `reason`. */
const LIFECYCLE_LOGS: Readonly<Record<Exclude<CacheEventName, 'error'>, LogEntry>> = {
  connect: { event: CACHE_LOG_EVENTS.connect, level: 'debug', message: 'Redis connection opened' },
  ready: { event: CACHE_LOG_EVENTS.ready, level: 'log', message: 'Redis connection ready' },
  close: { event: CACHE_LOG_EVENTS.close, level: 'warn', message: 'Redis connection closed' },
  reconnecting: {
    event: CACHE_LOG_EVENTS.reconnecting,
    level: 'warn',
    message: 'Redis connection is reconnecting'
  },
  end: {
    event: CACHE_LOG_EVENTS.end,
    level: 'warn',
    message: 'Redis connection ended, no further reconnect'
  }
}

/** The log event of each `reason` an `error` event carries. */
const REASON_LOGS: Readonly<Record<string, LogEntry>> = {
  forced_disconnect: {
    event: CACHE_LOG_EVENTS.forcedDisconnect,
    level: 'warn',
    message: 'Redis connection did not quit in time and was disconnected'
  },
  handler_error: {
    event: CACHE_LOG_EVENTS.handlerError,
    level: 'error',
    message: 'A Pub/Sub handler failed'
  },
  handler_queue_full: {
    event: CACHE_LOG_EVENTS.pubsubDropped,
    level: 'warn',
    message: 'Pub/Sub messages were dropped because every handler slot and the queue were taken'
  }
}

/** The log event of an `error` event that carries the driver's failure, with no `reason`. */
const CONNECTION_ERROR_LOG: LogEntry = {
  event: CACHE_LOG_EVENTS.connectionError,
  level: 'error',
  message: 'Redis connection error'
}

/**
 * Whether a payload value is a finite, non-negative number.
 *
 * @param value - The payload value.
 * @returns True for a number that can be counted or printed as a quantity.
 */
function isQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Running tally of operations, the Pub/Sub backlog and the drops, plus the log writer.
 */
export class CacheObservability {
  /** Where the log events go. */
  private readonly logger: CacheObservabilityLogger

  /** How many times each command has ended each way. */
  private readonly counts = new Map<CacheOperationName, Map<CacheOperationOutcome, number>>()

  /** How many Pub/Sub messages wait for a handler slot now. */
  private waiting = 0

  /** How many Pub/Sub messages have been dropped since start. */
  private dropped = 0

  /**
   * The callback bag to hand to `BymaxCacheModule` as `events`.
   *
   * The library swallows anything thrown from a callback, so each does the least it can: a map write,
   * a number, or one log line.
   */
  readonly events: ICacheEvents = {
    onEvent: (event, data): void => {
      this.observe(event, data)
    },
    onOperation: (operation, outcome): void => {
      this.record(operation, outcome)
    },
    onQueue: (queued): void => {
      this.waiting = isQuantity(queued) ? queued : this.waiting
    }
  }

  /**
   * @param options - Where the log events go.
   */
  constructor(options: CacheObservabilityOptions = {}) {
    this.logger = options.logger ?? new Logger('BymaxCache')
  }

  /**
   * Every command and outcome counted so far.
   *
   * @returns One `[operation, outcome, count]` triple per series.
   */
  operations(): Array<[CacheOperationName, CacheOperationOutcome, number]> {
    return [...this.counts].flatMap(([operation, outcomes]) =>
      [...outcomes].map(([outcome, count]): [CacheOperationName, CacheOperationOutcome, number] => [
        operation,
        outcome,
        count
      ])
    )
  }

  /**
   * How many Pub/Sub messages wait for a handler slot now.
   *
   * @returns The count; 0 when the subscriber is not bounded.
   */
  queued(): number {
    return this.waiting
  }

  /**
   * How many Pub/Sub messages have been dropped since start.
   *
   * @returns The total.
   */
  droppedTotal(): number {
    return this.dropped
  }

  /**
   * Counts one command, ignoring a name or an outcome outside the closed sets.
   *
   * @param operation - The command that ran.
   * @param outcome - How it ended.
   */
  private record(operation: CacheOperationName, outcome: CacheOperationOutcome): void {
    if (!Object.hasOwn(CACHE_OPERATION_NAMES, operation)) {
      return
    }
    if (!Object.hasOwn(CACHE_OPERATION_OUTCOMES, outcome)) {
      return
    }
    const outcomes = this.counts.get(operation) ?? new Map<CacheOperationOutcome, number>()
    outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1)
    this.counts.set(operation, outcomes)
  }

  /**
   * Counts a drop and writes the log event of a connection or Pub/Sub event.
   *
   * @param event - The lifecycle event name.
   * @param data - The payload that accompanied it.
   */
  private observe(event: CacheEventName, data: Record<string, unknown>): void {
    const entry = this.entryFor(event, data)
    if (entry === undefined) {
      return
    }
    const fields: Record<string, unknown> = {
      role: LIBRARY_ROLES.includes(data['role'] as string) ? data['role'] : UNKNOWN_ROLE
    }
    if (entry.event === CACHE_LOG_EVENTS.pubsubDropped) {
      const dropped = isQuantity(data['dropped']) ? data['dropped'] : 1
      this.dropped += dropped
      fields['dropped'] = dropped
    }
    if (entry.event === CACHE_LOG_EVENTS.reconnecting && isQuantity(data['delay'])) {
      fields['delay'] = data['delay']
    }
    if (data['err'] instanceof Error) {
      fields['err'] = data['err']
    }
    this.logger[entry.level]({ event: entry.event, message: entry.message, ...fields })
  }

  /**
   * Picks the log event an event maps to.
   *
   * @param event - The lifecycle event name.
   * @param data - The payload that accompanied it.
   * @returns The entry, or `undefined` for an `error` whose `reason` the library does not report.
   */
  private entryFor(event: CacheEventName, data: Record<string, unknown>): LogEntry | undefined {
    if (event !== 'error') {
      return LIFECYCLE_LOGS[event]
    }
    const reason = data['reason']
    if (reason === undefined) {
      return CONNECTION_ERROR_LOG
    }
    return typeof reason === 'string' && Object.hasOwn(REASON_LOGS, reason)
      ? REASON_LOGS[reason]
      : undefined
  }
}
