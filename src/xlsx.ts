import { inflateRawSync } from 'node:zlib'

// Enough of xlsx to read a table out of one. A workbook is a zip of XML parts;
// the sheet holds numbers inline and text as an index into a shared table.
export type Sheet = { name: string; rows: (string | number | null)[][] }

type Entry = { name: string; body: Buffer }

// The central directory is at the end, after a comment of unknown length, so it
// is found by scanning back for its signature.
function entries(zip: Buffer): Entry[] {
  let end = zip.length - 22
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--
  if (end < 0) throw new Error('not a zip')
  const count = zip.readUInt16LE(end + 10)
  let p = zip.readUInt32LE(end + 16)
  const out: Entry[] = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory ended early')
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const at = zip.readUInt32LE(p + 42)
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen)
    // The local header repeats the name and extra field with its own lengths.
    const dataAt = at + 30 + zip.readUInt16LE(at + 26) + zip.readUInt16LE(at + 28)
    const raw = zip.subarray(dataAt, dataAt + size)
    out.push({ name, body: method === 0 ? raw : inflateRawSync(raw) })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const unescape = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+);/g, (m, e) =>
    e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"'
      : e === 'apos' ? "'" : String.fromCharCode(Number(e.slice(1))))

// <si> holds one or more <t> runs; a cell of type s points at the si by index.
function strings(xml: string): string[] {
  const out: string[] = []
  for (const si of xml.split('<si>').slice(1)) {
    let s = ''
    for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += m[1]
    out.push(unescape(s))
  }
  return out
}

const col = (ref: string) => {
  let n = 0
  for (const c of ref) {
    if (c < 'A' || c > 'Z') break
    n = n * 26 + (c.charCodeAt(0) - 64)
  }
  return n - 1
}

// A row or a cell that Excel never wrote is simply absent from the XML, so the
// r attribute is the only thing that keeps a sheet in line.
function cells(xml: string, shared: string[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = []
  for (const m of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const n = Number(/ r="(\d+)"/.exec(m[1] ?? '')?.[1] ?? rows.length + 1)
    const row: (string | number | null)[] = []
    for (const c of (m[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attr = c[1] ?? ''
      const body = c[2] ?? ''
      const type = /\bt="([^"]+)"/.exec(attr)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let out: string | number | null = null
      if (type === 's') out = shared[Number(v)] ?? null
      else if (type === 'inlineStr' || type === 'str') out = unescape(/<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? v ?? '')
      else if (v !== undefined) out = Number(v)
      const ref = /\br="([A-Z]+)/.exec(attr)?.[1]
      if (ref) row[col(ref)] = out
      else row.push(out)
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null
    while (rows.length < n - 1) rows.push([])
    rows[n - 1] = row
  }
  return rows
}

export function read(zip: Buffer): Sheet[] {
  const parts = new Map(entries(zip).map((e) => [e.name, e.body]))
  const wb = parts.get('xl/workbook.xml')?.toString('utf8')
  const rels = parts.get('xl/_rels/workbook.xml.rels')?.toString('utf8')
  if (!wb || !rels) throw new Error('not an xlsx')
  const shared = strings(parts.get('xl/sharedStrings.xml')?.toString('utf8') ?? '')

  const target = new Map<string, string>()
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) target.set(m[1]!, m[2]!)

  const out: Sheet[] = []
  for (const m of wb.matchAll(/<sheet ([^>]*)\/>/g)) {
    const a = m[1]!
    const name = unescape(/name="([^"]*)"/.exec(a)?.[1] ?? '')
    const id = /r:id="([^"]+)"/.exec(a)?.[1]
    const path = id && target.get(id)
    const body = path && parts.get(path.startsWith('/') ? path.slice(1) : `xl/${path}`)
    if (body) out.push({ name, rows: cells(body.toString('utf8'), shared) })
  }
  return out
}

// Excel keeps a date as days since 1900, with a leap day that never existed.
export function date(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400_000)
}
