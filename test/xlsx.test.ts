import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, date } from '../src/xlsx.js'

// A zip of stored entries is enough to feed the reader, and writing one here
// keeps a 700 kB spreadsheet out of the repository.
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

const book = (sheet: string, shared = '') =>
  zip([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="One" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', `<sst>${shared}</sst>`],
    ['xl/worksheets/sheet1.xml', `<worksheet><sheetData>${sheet}</sheetData></worksheet>`],
  ])

test('a row Excel never wrote does not shift the ones after it', () => {
  const [s] = read(book('<row r="1"><c r="A1"><v>1</v></c></row><row r="4"><c r="A4"><v>4</v></c></row>'))
  assert.equal(s!.rows.length, 4)
  assert.deepEqual(s!.rows[0], [1])
  assert.deepEqual(s!.rows[1], [])
  assert.deepEqual(s!.rows[3], [4])
})

test('an empty cell does not swallow the next one', () => {
  const [s] = read(book('<row r="1"><c r="A1" s="9"/><c r="B1" t="s"><v>0</v></c></row>', '<si><t>Postcode</t></si>'))
  assert.deepEqual(s!.rows[0], [null, 'Postcode'])
})

test('a skipped column leaves a null, not a hole', () => {
  const [s] = read(book('<row r="1"><c r="A1"><v>1</v></c><c r="D1"><v>4</v></c></row>'))
  assert.deepEqual(s!.rows[0], [1, null, null, 4])
})

test('a shared string of several runs comes back whole', () => {
  const [s] = read(book('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', '<si><r><t>Town</t></r><r><t xml:space="preserve"> house</t></r></si>'))
  assert.deepEqual(s!.rows[0], ['Town house'])
})

test('the escapes an XML writer uses come back as the characters', () => {
  const [s] = read(book('<row r="1"><c r="A1" t="s"><v>0</v></c></row>', '<si><t>Flats &amp; units &lt;2&gt;</t></si>'))
  assert.deepEqual(s!.rows[0], ['Flats & units <2>'])
})

test('the 1900 leap day Excel believes in does not move a date', () => {
  assert.equal(date(44197).toISOString().slice(0, 10), '2021-01-01')
  assert.equal(date(45658).toISOString().slice(0, 10), '2025-01-01')
})
