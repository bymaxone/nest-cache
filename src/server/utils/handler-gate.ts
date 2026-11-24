/**
 * Bounds how many executions run at once and how many wait for a slot.
 *
 * Layer: server. One gate serves a whole Pub/Sub subscriber, so the work its handlers have in flight
 * is bounded as a whole and not per channel.
 */

import { absorbCall } from './settle'

const noop = (): void => undefined

/** One execution waiting for a slot. */
interface Waiting {
  readonly run: () => Promise<unknown>
  readonly isActive: () => boolean
}

/** Runs at most `slots` executions at once; the rest wait in arrival order, up to `room` of them. */
export class HandlerGate {
  #running = 0

  readonly #waiting: Waiting[] = []

  /**
   * @param slots - The most executions in flight at once.
   * @param room - The most executions that may wait; `undefined` leaves the wait unbounded.
   * @param onChange - Told how many executions wait, after each push, each take and each clear.
   */
  constructor(
    private readonly slots: number,
    private readonly room: number | undefined,
    private readonly onChange?: (waiting: number) => void
  ) {}

  /**
   * Starts an execution now when a slot is free, queues it when there is room, or refuses it.
   *
   * @param run - Starts the execution; its settling, however it ends, frees the slot.
   * @param isActive - Asked when the execution's turn comes; one no longer active is skipped.
   * @returns `false` when the execution was refused because no slot and no room was left.
   */
  submit(run: () => Promise<unknown>, isActive: () => boolean): boolean {
    if (this.#running < this.slots) {
      this.#start(run)
      return true
    }
    if (this.#waiting.length >= (this.room ?? Infinity)) {
      return false
    }
    this.#waiting.push({ run, isActive })
    this.onChange?.(this.#waiting.length)
    return true
  }

  /** Forgets every waiting execution; those already running finish. */
  clear(): void {
    this.#waiting.length = 0
    this.onChange?.(0)
  }

  #start(run: () => Promise<unknown>): void {
    this.#running += 1
    const free = (): void => {
      this.#running -= 1
      this.#startWaiting()
    }
    // A throw before the promise exists frees the slot the same way a rejection does.
    absorbCall(async () => {
      try {
        await run()
      } finally {
        free()
      }
    }, noop)
  }

  #startWaiting(): void {
    while (this.#running < this.slots) {
      const next = this.#waiting.shift()
      if (next === undefined) {
        return
      }
      this.onChange?.(this.#waiting.length)
      if (next.isActive()) {
        this.#start(next.run)
      }
    }
  }
}
