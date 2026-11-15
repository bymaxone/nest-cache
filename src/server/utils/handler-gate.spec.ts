/**
 * Unit tests for {@link HandlerGate}.
 *
 * Layer: server. How many executions run at once, the order the waiting ones start in, what is
 * dropped when the queue is full, and that a slot is freed however an execution ends.
 */
import { HandlerGate } from './handler-gate'

/** An execution that settles when `release` is called, and records when it started. */
function held(started: string[], name: string): { run: () => Promise<void>; release: () => void } {
  let release: () => void = () => undefined
  const done = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    run: () => {
      started.push(name)
      return done
    },
    release
  }
}

const settle = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve))
const always = (): boolean => true

describe('HandlerGate', () => {
  // Scenario: five executions are offered to a gate of two slots and none finishes yet.
  // Rule: two start at once, the other three wait, and each freed slot starts the oldest waiting one.
  it('runs at most the given number at once and starts the waiting ones in arrival order', async () => {
    const started: string[] = []
    const gate = new HandlerGate(2, undefined)
    const jobs = ['a', 'b', 'c', 'd', 'e'].map((name) => held(started, name))
    for (const job of jobs) {
      expect(gate.submit(job.run, always)).toBe(true)
    }
    expect(started).toEqual(['a', 'b'])

    jobs[1]?.release()
    await settle()
    expect(started).toEqual(['a', 'b', 'c'])

    jobs[0]?.release()
    jobs[2]?.release()
    await settle()
    expect(started).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  // Scenario: the queue holds two and a third waiting execution arrives.
  // Rule: the new one is refused and what is already waiting is untouched; zero room refuses at once.
  it('refuses the newest execution when the queue is full', async () => {
    const started: string[] = []
    const gate = new HandlerGate(1, 2)
    const jobs = ['a', 'b', 'c', 'd'].map((name) => held(started, name))

    const accepted = jobs.map((job) => gate.submit(job.run, always))
    jobs.forEach((job) => job.release())
    await settle()

    expect(accepted).toEqual([true, true, true, false])
    expect(started).toEqual(['a', 'b', 'c'])
    expect(new HandlerGate(1, 0).submit(() => new Promise<void>(() => undefined), always)).toBe(
      true
    )
    const none = new HandlerGate(1, 0)
    none.submit(() => new Promise<void>(() => undefined), always)
    expect(none.submit(() => Promise.resolve(), always)).toBe(false)
  })

  // Scenario: an execution rejects, and another throws before returning a promise.
  // Rule: each frees its slot, so the next waiting execution still starts.
  it('frees the slot of an execution that rejects or throws', async () => {
    const started: string[] = []
    const gate = new HandlerGate(1, undefined)
    gate.submit(() => Promise.reject(new Error('rejected')), always)
    gate.submit(() => {
      started.push('second')
      return Promise.resolve()
    }, always)
    gate.submit(() => {
      started.push('third')
      throw new Error('thrown')
    }, always)
    gate.submit(() => {
      started.push('fourth')
      return Promise.resolve()
    }, always)
    await settle()

    expect(started).toEqual(['second', 'third', 'fourth'])
  })

  // Scenario: a waiting execution is no longer active when its turn comes.
  // Rule: it is skipped without taking a slot, and the one behind it starts in its place.
  it('skips a waiting execution that is no longer active', async () => {
    const started: string[] = []
    const gate = new HandlerGate(1, undefined)
    const first = held(started, 'first')
    gate.submit(first.run, always)
    gate.submit(
      () => {
        started.push('skipped')
        return Promise.resolve()
      },
      () => false
    )
    gate.submit(() => {
      started.push('third')
      return Promise.resolve()
    }, always)

    first.release()
    await settle()

    expect(started).toEqual(['first', 'third'])
  })

  // Scenario: the gate is cleared while executions wait and one runs.
  // Rule: the waiting ones never start, the running one finishes, and nothing waiting is left.
  it('drops what waits when it is cleared', async () => {
    const started: string[] = []
    const gate = new HandlerGate(1, undefined)
    const first = held(started, 'first')
    gate.submit(first.run, always)
    gate.submit(held(started, 'waiting').run, always)

    gate.clear()
    first.release()
    await settle()

    expect(started).toEqual(['first'])
  })
})
