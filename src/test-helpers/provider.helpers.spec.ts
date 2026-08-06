/**
 * @fileoverview Unit tests for the shared provider-list helper.
 * @layer test utilities
 */

import type { Provider } from '@nestjs/common'

import { findProvider } from './provider.helpers'

class BareClassProvider {}
class OtherClass {}

const VALUE_TOKEN = Symbol('VALUE_TOKEN')

describe('findProvider', () => {
  // A `DynamicModule.providers` list mixes both shapes: a bare class, which IS its own token,
  // and a `{ provide, useValue }` entry, whose token is the `provide` field. The helper has to
  // match on either — and each half needs a list where ONLY it can succeed, or the other half
  // covers for it and the disjunct could be dropped without the module suites noticing.
  const providers: Provider[] = [
    { provide: VALUE_TOKEN, useValue: 'v' },
    BareClassProvider,
    { provide: 'STRING_TOKEN', useValue: 1 }
  ]

  it('finds a bare class provider, which is its own token', () => {
    expect(findProvider(providers, BareClassProvider)).toBe(BareClassProvider)
  })

  it('finds a value provider by its provide token', () => {
    expect(findProvider(providers, VALUE_TOKEN)).toEqual({ provide: VALUE_TOKEN, useValue: 'v' })
    expect(findProvider(providers, 'STRING_TOKEN')).toEqual({
      provide: 'STRING_TOKEN',
      useValue: 1
    })
  })

  // An absent token answers `undefined` rather than the first entry: a helper that matched
  // anything would make every "is this provider registered" assertion in the module suites pass
  // regardless of what the module actually registers.
  it('answers undefined for a token that is not registered', () => {
    expect(findProvider(providers, OtherClass)).toBeUndefined()
    expect(findProvider([], BareClassProvider)).toBeUndefined()
  })
})
