import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, quarter } from '../src/vic.js'

// The same stored-entry zip the reader tests use, with a Table 12 in it.
function zip(parts: [string, string][]): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let at = 0
  for (const [name, text] of parts) {
    const body = Buffer.from(text, 'utf8')
    const n = Buffer.from(name, 'utf8')
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50, 0)
    h.writeUInt32LE(body.length, 18)
    h.writeUInt32LE(body.length, 22)
    h.writeUInt16LE(n.length, 26)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0)
    c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(body.length, 24)
    c.writeUInt16LE(n.length, 28)
    c.writeUInt32LE(at, 42)
    local.push(h, n, body)
    central.push(c, n)
    at += 30 + n.length + body.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(at, 16)
  return Buffer.concat([...local, dir, end])
}

const STRINGS = ['1 Bed Flat', '2 Bed Flat', 'Count', 'Median', 'Ann % Ch', 'Percentile 25', 'Percentile 75', 'Brunswick', 'Total']
const s = (i: number) => `t="s"><v>${i}</v>`
const cell = (ref: string, body: string) => `<c r="${ref}" ${body}</c>`

// One row of types, one of labels, then the suburbs.
const book = (rows: string) =>
  zip([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Table 12" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst>${STRINGS.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${rows}</sheetData></worksheet>`],
  ])

const TYPES = `<row r="1">${cell('B1', s(0))}${cell('G1', s(1))}</row>`
const LABELS = `<row r="2">${['B', 'C', 'D', 'E', 'F'].map((c, i) => cell(`${c}2`, s(i + 2))).join('')}${['G', 'H', 'I', 'J', 'K'].map((c, i) => cell(`${c}2`, s(i + 2))).join('')}</row>`

test('a quarter is read out of whatever the file was called', () => {
  assert.equal(quarter('Quarterly Tables Sept 2023'), '2023-09-01')
  assert.equal(quarter('tables-rental-report-june-quarter-2025-excel'), '2025-06-01')
  assert.equal(quarter('rental report'), null)
})

test('the count and the quartiles come back beside the median', () => {
  const row = `<row r="3">${cell('A3', s(7))}${cell('B3', '><v>734</v>')}${cell('C3', '><v>415</v>')}${cell('D3', '><v>0.02</v>')}${cell('E3', '><v>370</v>')}${cell('F3', '><v>450</v>')}</row>`
  const [one, ...rest] = parse(book(TYPES + LABELS + row), '2025-09-01')
  assert.deepEqual(rest, [])
  assert.deepEqual(one, {
    kind: 'suburb', area: 'Brunswick', dwelling: 'F', beds: 1, quarter: '2025-09-01',
    rent: 415, n: 734, p25: 370, p75: 450,
  })
})

test('the state total is not a suburb', () => {
  const row = `<row r="3">${cell('A3', s(8))}${cell('B3', '><v>734</v>')}${cell('C3', '><v>415</v>')}</row>`
  assert.throws(() => parse(book(TYPES + LABELS + row), '2025-09-01'), /no suburb table/)
})

// The December 2015 workbook heads five columns of data with seven labels, so a
// percentage change lands where the count belongs.
test('a header that does not describe the data is refused', () => {
  const row = `<row r="3">${cell('A3', s(7))}${cell('B3', '><v>734</v>')}${cell('C3', '><v>415</v>')}${cell('D3', '><v>0.02</v>')}${cell('E3', '><v>0.09</v>')}${cell('F3', '><v>0.14</v>')}</row>`
  assert.throws(() => parse(book(TYPES + LABELS + row), '2015-12-01'), /does not describe/)
})
