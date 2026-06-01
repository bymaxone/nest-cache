/**
 * Shared unit-test helpers for inspecting NestJS DynamicModule provider lists.
 *
 * Layer: test utilities — no production imports.
 */
import type { Provider } from '@nestjs/common'

/** Locates a class/value provider entry by its provide token. */
export const findProvider = (providers: Provider[], token: unknown): Provider | undefined =>
  providers.find(
    (provider) => provider === token || (provider as { provide?: unknown }).provide === token
  )
