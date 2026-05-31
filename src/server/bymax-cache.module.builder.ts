/**
 * Configurable module base for `BymaxCacheModule`.
 *
 * Layer: server. Generates the NestJS dynamic-module plumbing (the
 * `MODULE_OPTIONS_TOKEN` provider and the `forRoot`/`forRootAsync` statics) via
 * `ConfigurableModuleBuilder`, per the Bymax standard (spec §0). The concrete
 * module in `bymax-cache.module.ts` extends the generated class and augments the
 * produced `DynamicModule` with the connection/key-builder providers.
 */
import { ConfigurableModuleBuilder } from '@nestjs/common'

import type { BymaxCacheModuleOptions } from './interfaces/cache-module-options.interface'

/**
 * Extra (non-option) registration flags folded into the generated dynamic
 * module by the builder. Kept as a builder *extra* — rather than read from the
 * resolved `BymaxCacheModuleOptions` — so the generated `forRootAsync` can decide
 * the module's `global` flag synchronously, before the async options factory
 * resolves.
 */
interface BymaxCacheModuleExtras {
  /**
   * Register the module globally. Required in the resolved extras (the builder
   * fills it from the `{ isGlobal: true }` default) but optional for consumers,
   * who receive it as `Partial<BymaxCacheModuleExtras>` on the registration types.
   */
  isGlobal: boolean
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN, OPTIONS_TYPE, ASYNC_OPTIONS_TYPE } =
  new ConfigurableModuleBuilder<BymaxCacheModuleOptions>({ moduleName: 'BymaxCache' })
    .setClassMethodName('forRoot')
    .setExtras<BymaxCacheModuleExtras>({ isGlobal: true }, (definition, extras) => ({
      ...definition,
      global: extras.isGlobal
    }))
    .build()
