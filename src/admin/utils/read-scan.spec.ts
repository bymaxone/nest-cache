/**
 * Unit tests for {@link readScanPage}: both wire shapes of a hash page, a set page, and a reply that
 * is not a page.
 *
 * Layer: admin.
 */
import { readScanPage } from './read-scan'

describe('readScanPage', () => {
  // Scenario: an HSCAN page in the flat RESP2 shape, with an unpaired trailing element.
  // Rule: fields and values are paired by walking, and the unpaired one is dropped, not invented.
  it('pairs a flat hash page and drops an unpaired trailing element', () => {
    expect(readScanPage(['17', ['a', '1', 'b', '2', 'c']], true)).toEqual({
      cursor: '17',
      entries: [
        ['a', '1'],
        ['b', '2']
      ]
    })
  })

  // Scenario: an HSCAN page in the RESP3 shape, one array per pair, one with no value.
  // Rule: the pair is read as given, an absent value as an empty string.
  it('reads a hash page whose elements are pairs', () => {
    expect(readScanPage(['0', [['a', '1'], ['b']]], true)).toEqual({
      cursor: '0',
      entries: [
        ['a', '1'],
        ['b', '']
      ]
    })
  })

  // Scenario: an SSCAN page.
  // Rule: every element is a member with an empty second slot, whatever its position.
  it('reads a set page member by member', () => {
    expect(readScanPage(['3', ['x', 'y', 'z']], false)).toEqual({
      cursor: '3',
      entries: [
        ['x', ''],
        ['y', ''],
        ['z', '']
      ]
    })
  })

  // Scenario: a numeric cursor, a reply that is not an array, and a reply whose elements are not.
  // Rule: the cursor is a string, and anything unreadable ends the scan with nothing, marked unreadable
  // so the scan does not report that it finished.
  it.each([[null], ['OK'], [[]], [['5', 'not-an-array']]])(
    'treats an unreadable reply %p as an empty page that ends the scan',
    (reply) => {
      expect(readScanPage(reply, true)).toEqual({ cursor: '0', entries: [], unreadable: true })
    }
  )

  // Scenario: a server or driver that answers the cursor as a number.
  // Rule: it is read as a string, the way it is sent back.
  it('turns a numeric cursor into a string', () => {
    expect(readScanPage([42, []], false).cursor).toBe('42')
  })
})
