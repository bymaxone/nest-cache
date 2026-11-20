/**
 * Unit tests for how {@link CacheAdminService.revealValue} reads a value: only bounded commands,
 * whatever the size of the value in Redis.
 *
 * Layer: admin. The reader refuses `GET`, `HGETALL` and `SMEMBERS`, so a reveal that reaches for one
 * fails; the bounded reads go through `call` and are answered by the test.
 */
import { resolveAdminOptions } from '../config/resolved-admin-options'
import { CacheAdminService } from './cache-admin.service'
import { FakeReader, SCOPES } from './__tests__/cache-admin.fixtures'

type Answer = (command: string, args: (string | number)[]) => unknown

/** A reader that refuses the unbounded reads and answers the bounded ones from `answer`. */
class BoundedReader extends FakeReader {
  readonly seen: string[][] = []
  constructor(
    private readonly keyType: string,
    private readonly answer: Answer
  ) {
    super()
  }
  override async type(): Promise<string> {
    return this.keyType
  }
  override async get(): Promise<string | null> {
    throw new Error('GET is unbounded')
  }
  override async hgetall(): Promise<Record<string, string>> {
    throw new Error('HGETALL is unbounded')
  }
  override async smembers(): Promise<string[]> {
    throw new Error('SMEMBERS is unbounded')
  }
  override async call(command: string, ...args: (string | number)[]): Promise<unknown> {
    this.seen.push([command, ...args.map(String)])
    return this.answer(command, args)
  }
}

const reveal = (
  reader: BoundedReader,
  overrides: { revealLimit?: number; revealStringLimit?: number } = {}
): ReturnType<CacheAdminService['revealValue']> =>
  new CacheAdminService(
    { getClient: () => reader },
    resolveAdminOptions({ scopes: SCOPES, ...overrides })
  ).revealValue('cache', 'app:k')

describe('CacheAdminService.revealValue reads', () => {
  // Scenario: a string far longer than the limit.
  // Rule: one GETRANGE of four bytes per character of the limit is the only read, however long the
  // value is, and the text is cut to the limit and reported incomplete.
  it('reads a long string with one ranged read and reports it incomplete', async () => {
    const reader = new BoundedReader('string', () => 'abcdefghijklmnopq')

    const result = await reveal(reader, { revealStringLimit: 4 })

    expect(reader.seen).toEqual([['GETRANGE', 'app:k', '0', '16']])
    expect(result).toMatchObject({ value: { kind: 'string', value: 'abcd', isComplete: false } })
  })

  // Scenario: values of exactly the limit, one over it, and multibyte text around the byte bound.
  // Rule: complete only when the whole value was read and fits the limit, counted in characters.
  it.each([
    ['exactly the limit', 'abcd', 'abcd', true],
    ['one over the limit', 'abcde', 'abcd', false],
    ['multibyte within the bound', '€€', '€€', true],
    ['multibyte over the limit', '€€€', '€€', false]
  ])('reports a string %s', async (_name, stored, shown, isComplete) => {
    const limit = stored.startsWith('€') ? 2 : 4
    const reader = new BoundedReader('string', () => stored)

    const result = await reveal(reader, { revealStringLimit: limit })

    expect(result).toMatchObject({ value: { kind: 'string', value: shown, isComplete } })
  })

  // Scenario: a read of a string cut by the byte bound in the middle of a character.
  // Rule: the cut character lies past the limit, so it never shows.
  it('keeps a character cut by the byte bound out of the shown text', async () => {
    const reader = new BoundedReader('string', () => '€€�')

    const result = await reveal(reader, { revealStringLimit: 2 })

    expect(result).toMatchObject({ value: { kind: 'string', value: '€€', isComplete: false } })
  })

  // Scenario: an empty answer, once for a key that is gone and once for a string that is empty.
  // Rule: a gone key is missing, an empty string is revealed empty and complete.
  it('tells an empty string from a key that vanished', async () => {
    let type = 'string'
    const reader = new BoundedReader('string', () => '')
    jest.spyOn(reader, 'type').mockImplementation(async () => type)
    expect(await reveal(reader)).toMatchObject({
      status: 'revealed',
      value: { kind: 'string', value: '', isComplete: true }
    })

    type = 'none'
    expect(await reveal(reader)).toEqual({ status: 'missing', key: 'app:k' })
  })

  // Scenario: a hash spread over three pages, one field returned twice, with the limit at 3.
  // Rule: the scan follows the cursor with COUNT set to the limit, drops the repeat, and stops on
  // the page that brings it past the limit, reporting the value incomplete.
  it('follows an HSCAN to one more than the limit and drops a repeated field', async () => {
    const pages: [string, string[]][] = [
      ['9', ['a', '1', 'b', '2']],
      ['4', ['b', '2', 'c', '3']],
      ['2', ['d', '4', 'e', '5']]
    ]
    const reader = new BoundedReader('hash', () => pages.shift())

    const result = await reveal(reader, { revealLimit: 3 })

    expect(reader.seen).toEqual([
      ['HSCAN', 'app:k', '0', 'COUNT', '3'],
      ['HSCAN', 'app:k', '9', 'COUNT', '3'],
      ['HSCAN', 'app:k', '4', 'COUNT', '3']
    ])
    expect(result).toMatchObject({
      value: {
        kind: 'hash',
        fields: [
          { field: 'a', value: '1' },
          { field: 'b', value: '2' },
          { field: 'c', value: '3' }
        ],
        isComplete: false
      }
    })
  })

  // Scenario: a hash whose second page comes back in a shape the reader cannot read.
  // Rule: the entries of the first page are shown and the value is reported incomplete: an unreadable
  // page is not the end of the scan, so the read never claims to hold everything.
  it('reports a hash incomplete when a later HSCAN page is unreadable', async () => {
    const pages: unknown[] = [['9', ['a', '1']], 'OK']
    const reader = new BoundedReader('hash', () => pages.shift())

    const result = await reveal(reader, { revealLimit: 3 })

    expect(result).toMatchObject({
      status: 'revealed',
      value: { kind: 'hash', fields: [{ field: 'a', value: '1' }], isComplete: false }
    })
  })

  // Scenario: a hash or a set whose first and only page is unreadable.
  // Rule: the key is not reported as gone, since nothing says it was deleted: it reads as no
  // entries, incomplete.
  it.each([
    ['hash', { kind: 'hash', fields: [], isComplete: false }],
    ['set', { kind: 'members', members: [], isComplete: false }]
  ])('does not call a %s with an unreadable page a deleted key', async (type, value) => {
    const reader = new BoundedReader(type, () => 'OK')

    const result = await reveal(reader)

    expect(result).toMatchObject({ status: 'revealed', value })
  })

  // Scenario: a hash of exactly the limit whose scan ends, and one more entry than the limit whose
  // scan also ends in the same page.
  // Rule: complete only when the scan ended and nothing past the limit was seen.
  it.each([
    ['exactly the limit', ['a', '1', 'b', '2'], true],
    ['one over the limit', ['a', '1', 'b', '2', 'c', '3'], false]
  ])('reports a hash of %s once the scan has ended', async (_name, flat, isComplete) => {
    const reader = new BoundedReader('hash', () => ['0', flat])

    const result = await reveal(reader, { revealLimit: 2 })

    expect(result).toMatchObject({ value: { kind: 'hash', isComplete } })
  })

  // Scenario: a set spread over two pages, with the limit at 2.
  // Rule: SSCAN is followed with COUNT set to the limit, and a set that fits is complete.
  it('follows an SSCAN to the end of a set that fits the limit', async () => {
    const pages: [string, string[]][] = [
      ['6', ['x']],
      ['0', ['y']]
    ]
    const reader = new BoundedReader('set', () => pages.shift())

    const result = await reveal(reader, { revealLimit: 2 })

    expect(reader.seen).toEqual([
      ['SSCAN', 'app:k', '0', 'COUNT', '2'],
      ['SSCAN', 'app:k', '6', 'COUNT', '2']
    ])
    expect(result).toMatchObject({
      value: { kind: 'members', members: ['x', 'y'], isComplete: true }
    })
  })

  // Scenario: a scan that keeps answering an empty page with a cursor that never ends.
  // Rule: the loop stops after one hundred calls and the value is reported incomplete.
  it('stops a scan that never ends after one hundred calls', async () => {
    const reader = new BoundedReader('set', () => ['5', []])

    const result = await reveal(reader)

    expect(reader.seen).toHaveLength(100)
    expect(result).toMatchObject({ value: { kind: 'members', members: [], isComplete: false } })
  })

  // Scenario: a ranged read that answers something other than text.
  // Rule: it is read as an empty value, so the type asked again decides between a vanished key and
  // an empty string.
  it('reads a ranged answer that is not text as an empty value', async () => {
    const reader = new BoundedReader('string', () => null)

    expect(await reveal(reader)).toMatchObject({
      status: 'revealed',
      value: { kind: 'string', value: '', isComplete: true }
    })
  })

  // Scenario: a non-empty ranged answer.
  // Rule: it is the value, and the type is not asked a second time: only an empty answer needs it.
  it('does not ask for the type again when the ranged answer has text', async () => {
    const reader = new BoundedReader('string', () => 'text')
    const type = jest.spyOn(reader, 'type').mockResolvedValue('string')

    await reveal(reader)

    expect(type).toHaveBeenCalledTimes(1)
  })

  // Scenario: a list of three with the limit at two; LRANGE is asked for one more than the limit.
  // Rule: the first two are shown and the value is reported incomplete.
  it('truncates a list to the limit and reports it incomplete', async () => {
    const reader = new BoundedReader('list', () => undefined)
    jest.spyOn(reader, 'lrange').mockResolvedValue(['m1', 'm2', 'm3'])

    expect(await reveal(reader, { revealLimit: 2 })).toMatchObject({
      value: { kind: 'members', members: ['m1', 'm2'], isComplete: false }
    })
  })

  // Scenario: a field that two pages both return, with a different value the second time.
  // Rule: it is listed once, with the value it had when first seen.
  it('keeps the first value of a field a scan returns twice', async () => {
    const pages: [string, string[]][] = [
      ['3', ['a', 'first']],
      ['0', ['a', 'second']]
    ]
    const reader = new BoundedReader('hash', () => pages.shift())

    expect(await reveal(reader)).toMatchObject({
      value: { kind: 'hash', fields: [{ field: 'a', value: 'first' }], isComplete: true }
    })
  })

  // Scenario: strings of two-, three- and four-byte characters and a mix, behind ASCII prefixes of
  // zero to three, cut at limits around the boundary.
  // Rule: the shown text never ends in half a surrogate pair and is the longest whole-character
  // prefix that fits the limit, counted in UTF-16 units; a string that fits is shown whole.
  it('never cuts a surrogate pair in half and shows the longest whole-character prefix', async () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    const wholePrefix = (text: string, limit: number): string => {
      let shown = ''
      for (const character of text) {
        if (shown.length + character.length > limit) {
          break
        }
        shown += character
      }
      return shown
    }
    const failures: string[] = []
    for (const unit of ['\u00e9', '\u20ac', '\u{1F600}', 'a\u{1F600}', '\u{1F600}\u20ac']) {
      for (let prefix = 0; prefix <= 3; prefix += 1) {
        for (let limit = 4; limit <= 9; limit += 1) {
          const stored = 'a'.repeat(prefix) + unit.repeat(10)
          const result = await reveal(new BoundedReader('string', () => stored), {
            revealStringLimit: limit
          })
          const shown =
            result.status === 'revealed' && result.value.kind === 'string'
              ? result.value.value
              : null
          const complete =
            result.status === 'revealed' && result.value.kind === 'string'
              ? result.value.isComplete
              : null
          if (
            shown === null ||
            lone.test(shown) ||
            shown !== wholePrefix(stored, limit) ||
            complete !== false
          ) {
            failures.push(`${JSON.stringify(unit)} prefix ${prefix} limit ${limit}`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  // Scenario: a value that fits the limit, even though it ends in a lone surrogate it was stored with.
  // Rule: nothing was cut, so nothing is dropped: it is returned as stored and complete.
  it('returns a value that fits the limit as stored, whatever it ends in', async () => {
    const stored = 'ab\uD83D'
    const reader = new BoundedReader('string', () => stored)

    expect(await reveal(reader, { revealStringLimit: 3 })).toMatchObject({
      value: { kind: 'string', value: stored, isComplete: true }
    })
  })

  // Scenario: a hash, a set, a list and a sorted set deleted between the TYPE and the read, so the
  // read answers nothing, and a scan that gave up with nothing found.
  // Rule: a finished read of nothing is `missing`, as for a string; a scan stopped by its call cap is
  // incomplete, not missing, since it did not finish.
  it.each([
    ['hash', (): unknown => ['0', []]],
    ['set', (): unknown => ['0', []]],
    ['zset', (): unknown => []]
  ])('reports a %s that vanished between reads as missing', async (type, answer) => {
    const reader = new BoundedReader(type, answer)

    expect(await reveal(reader)).toEqual({ status: 'missing', key: 'app:k' })
  })

  it('reports a list that vanished between reads as missing', async () => {
    const reader = new BoundedReader('list', () => undefined)
    jest.spyOn(reader, 'lrange').mockResolvedValue([])

    expect(await reveal(reader)).toEqual({ status: 'missing', key: 'app:k' })
  })

  it.each([['hash'], ['set']])(
    'keeps a %s whose scan was stopped by the call cap incomplete',
    async (type) => {
      const reader = new BoundedReader(type, () => ['5', []])

      expect(await reveal(reader)).toMatchObject({
        status: 'revealed',
        value: { isComplete: false }
      })
    }
  )

  // Scenario: the cut falls right after the first and the last unit of the high-surrogate range, and
  // right after the units on either side of it.
  // Rule: only a unit from 0xD800 to 0xDBFF is dropped; 0xD7FF and 0xDC00 are kept.
  it.each([
    ['0xD800', '\uD800', 'a'],
    ['0xDBFF', '\uDBFF', 'a'],
    ['0xD7FF', '\uD7FF', 'a\uD7FF'],
    ['0xDC00', '\uDC00', 'a\uDC00']
  ])('drops a cut-off unit only when it is a high surrogate (%s)', async (_name, unit, shown) => {
    const reader = new BoundedReader('string', () => `a${unit}tail`)

    expect(await reveal(reader, { revealStringLimit: 2 })).toMatchObject({
      value: { kind: 'string', value: shown, isComplete: false }
    })
  })
})
