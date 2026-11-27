/**
 * Redaction of driver errors.
 *
 * Layer: server. A server reply error carries the command it answers (`command.args`) and a text the
 * server chose, which can quote those arguments back. Either would reach every hook, logger and `cause`
 * the error is handed to. Every driver error is rewritten here before it leaves the library: the command
 * is removed, and of the server's text only the reply code is kept. The rewrite is in place, so the error
 * keeps its identity and its class.
 */

/** A reply code: the first word of a server error, in capitals. */
const REPLY_CODE = /^[A-Z]{2,32}(?!\S)/

/** What follows the reply code in a rewritten server error. */
const WITHHELD = '(server error text withheld)'

/** The part of a driver message that quotes another error or a server's reply. */
const REPEATED_ERROR = / Last (?:error|reply): [\s\S]*/

/** Reads an own property, so a key planted on `Object.prototype` is never taken for the driver's. */
function own(target: object, key: string): unknown {
  return Object.hasOwn(target, key) ? Reflect.get(target, key) : undefined
}

/** The message an error may keep: a reply code for a server error, no quoted tail otherwise. */
function safeMessage(error: Error): string {
  if (error.name !== 'ReplyError') {
    return error.message.replace(REPEATED_ERROR, '')
  }
  const code = REPLY_CODE.exec(error.message)?.[0] ?? 'ERR'
  return `${code} ${WITHHELD}`
}

/** Removes from one error what it holds of a command and of a server's text. */
function strip(error: Error): void {
  Reflect.deleteProperty(error, 'command')
  // A protocol error keeps the raw reply it could not parse.
  Reflect.deleteProperty(error, 'buffer')
  const message = error.message
  const kept = safeMessage(error)
  if (kept !== message) {
    // The stack repeats the message, and is rewritten while it still matches.
    Reflect.set(
      error,
      'stack',
      error.stack?.replace(message, () => kept)
    )
    Reflect.set(error, 'message', kept)
  }
}

/**
 * Removes the command and the server's text from a driver error and from the errors it carries
 * (`previousErrors` of an aborted transaction, `lastNodeError` of a cluster failure).
 *
 * @typeParam E - The type of what was thrown.
 * @param thrown - What the driver rejected with or emitted.
 * @returns The same value.
 */
export function redactDriverError<E>(thrown: E): E {
  const seen = new Set<Error>()
  const pending: unknown[] = [thrown]
  while (pending.length > 0) {
    const error = pending.pop()
    if (error instanceof Error && !seen.has(error)) {
      seen.add(error)
      strip(error)
      pending.push(own(error, 'lastNodeError'))
      const previous = own(error, 'previousErrors')
      if (Array.isArray(previous)) {
        pending.push(...(previous as unknown[]))
      }
    }
  }
  return thrown
}
