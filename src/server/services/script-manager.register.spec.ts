/**
 * The runtime `register` of the script manager takes the same name and source as an entry of
 * `options.scripts`, so it holds them to the same rule.
 *
 * Layer: server. A source that is not a string fails inside Redis at the first load, far from the call
 * that registered it.
 */
import { ConnectionManager } from '../connection/connection.manager'
import { applyDefaults } from '../config/default-options'
import { ScriptManagerService } from './script-manager.service'

/** A script manager with no scripts of its own. */
const build = (): ScriptManagerService => {
  const options = applyDefaults({ connection: { host: 'h' } })
  return new ScriptManagerService(options, new ConnectionManager(options))
}

/** The refusal a call is expected to throw. */
const refusing = (reason: string): Error =>
  expect.objectContaining({
    code: 'cache.invalid_options',
    details: expect.objectContaining({ reason })
  }) as Error

describe('ScriptManagerService.register validates what it is given', () => {
  // Scenario: a well-formed script.
  it('registers a name with a source', () => {
    expect(() => build().register('a', 'return 1')).not.toThrow()
  })

  // Scenario: the name or the source is empty or not a string.
  // Rule: it is refused as INVALID_OPTIONS naming the argument, and nothing is registered.
  it.each([
    ['an empty name', '', 'return 1', 'register name must be a non-empty string'],
    ['a name that is not a string', 7, 'return 1', 'register name must be a non-empty string'],
    ['an empty source', 'a', '', 'register lua must be a non-empty string'],
    ['a source that is a number', 'a', 12345, 'register lua must be a non-empty string']
  ])('refuses %s', (_label, name, lua, reason) => {
    const registry = build()

    expect(() => registry.register(name as string, lua as string)).toThrow(refusing(reason))
    expect([...(registry as unknown as { scripts: Map<string, unknown> }).scripts.keys()]).toEqual(
      []
    )
    expect(() => registry.register('a', 'return 1')).not.toThrow()
  })
})
