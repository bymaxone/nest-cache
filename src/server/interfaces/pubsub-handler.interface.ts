/**
 * Pub/Sub message handler contracts.
 *
 * Layer: server. Callback signatures the Pub/Sub service invokes when
 * a message arrives on a subscribed channel or pattern. The message is already
 * deserialized to `T` by the service.
 */

/**
 * Handler for messages on an exactly-named channel.
 *
 * @typeParam T - The deserialized message payload type.
 * @param message - The deserialized payload.
 * @param channel - The channel the message arrived on.
 */
export type IPubSubHandler<T> = (message: T, channel: string) => void | Promise<void>

/**
 * Handler for messages on a pattern subscription (`psubscribe`).
 *
 * @typeParam T - The deserialized message payload type.
 * @param message - The deserialized payload.
 * @param channel - The concrete channel the message arrived on.
 * @param pattern - The pattern that matched the channel.
 */
export type IPubSubPatternHandler<T> = (
  message: T,
  channel: string,
  pattern: string
) => void | Promise<void>
