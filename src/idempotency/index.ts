/**
 * Public API of the `@bymax-one/nest-cache/idempotency` subpath: a Redis store for HTTP
 * idempotency keys. The host binds it to `BYMAX_IDEMPOTENCY_STORE` itself, so this subpath holds no
 * runtime import of `@bymax-one/nest-core`.
 *
 * Layer: idempotency, an optional subpath; this file is its public barrel.
 */
export { RedisIdempotencyStore } from './redis-idempotency-store'
