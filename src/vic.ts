import { createHash } from 'node:crypto'
import { read } from './xlsx.js'
import { pool, loaded, putMedians, type Median } from './db.js'

// Victoria publishes a whole report each quarter and the tables behind it. Table
// 12 is the one worth having: a moving annual median for every suburb and town,
// with the count and the quartiles beside it. The archive is on the open data
// catalogue; the newest quarter appears on the department's own page first.
const CKAN = 'https://discover.data.vic.gov.au/api/3/action/package_show?id=rental-report-quarterly-data-tables'
const PAGE = 'https://www.dffh.vic.gov.au/publications/rental-report'
// Akamai turns curl away at the door, so the requests go out looking like a browser.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'
const KIND: Record<string, string> = { Flat: 'F', House: 'H' }

// "Quarterly Tables Sept 2023", "tables-rental-report-june-quarter-2025-excel".
export function quarter(s: string): string | null {
  const m = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^0-9a-z]*(?:quarter[^0-9]*)?(20\d\d)/i.exec(s)
    ?? /(20\d\d)[^0-9a-z]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(s)
  if (!m) return null
  const [name, year] = /^\d/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!]
  const at = MONTHS.indexOf(name.slice(0, 3).toLowerCase())
  if (at < 0) return null
  const month = Math.ceil((at / 4 + 1) / 3) * 3
  return `${year}-${String(month).padStart(2, '0')}-01`
}

export async function files(): Promise<{ url: string; at: string }[]> {
  const out = new Map<string, string>()
  const cat = await (await fetch(CKAN, { headers: { 'user-agent': UA } })).json() as any
  for (const r of cat?.result?.resources ?? []) {
    if (String(r.format).toUpperCase() !== 'XLSX') continue
    const at = quarter(r.name ?? '') ?? quarter(r.url ?? '')
    if (at) out.set(r.url, at)
  }
  // The catalogue runs a year or so behind the department's own page.
  const html = await (await fetch(PAGE, { headers: { 'user-agent': UA } })).text()
  for (const m of html.matchAll(/href="([^"]*rental-report[^"]*excel[^"]*)"/gi)) {
    const url = new URL(m[1]!, PAGE).toString()
    const at = quarter(url)
    if (at && !out.has(url)) out.set(url, at)
  }
  return [...out].map(([url, at]) => ({ url, at })).sort((a, b) => a.at.localeCompare(b.at))
}

// The report renumbers its tables over the years, so the sheet is found by its
// shape: a row of property types, a row of column labels under it, and the
// quartiles among them. The area name sits in the column before the first group.
export function parse(buf: Buffer, at: string): Median[] {
  for (const sheet of read(buf)) {
    const top = sheet.rows.findIndex((r) => r.some((v) => /^\d Bed (Flat|House)$/.test(String(v ?? ''))))
    if (top < 0) continue
    const labels = sheet.rows[top + 1] ?? []
    if (!labels.some((v) => /percentile 25/i.test(String(v ?? '')))) continue

    const groups: { at: number; end: number; dwelling: string; beds: number }[] = []
    for (const [i, v] of (sheet.rows[top] ?? []).entries()) {
      const m = /^(\d) Bed (Flat|House)$/.exec(String(v ?? ''))
      if (m) groups.push({ at: i, end: labels.length, dwelling: KIND[m[2]!]!, beds: Number(m[1]) })
    }
    for (let i = 0; i < groups.length - 1; i++) groups[i]!.end = groups[i + 1]!.at
    const name = groups[0]!.at - 1

    // Some quarters carry a header describing seven columns a group over data
    // that only has five, and reading one against the other silently turns a
    // percentage change into a count. A rent is a whole number of dollars and a
    // count is a whole number of bonds, so anything else says the two do not
    // belong together and the quarter is left out.
    const out: Median[] = []
    const whole = (v: number, least = 0) => Number.isInteger(v) && v >= least
    for (const row of sheet.rows.slice(top + 2)) {
      const area = String(row[name] ?? '').trim()
      if (!area || area === 'Total') continue
      for (const g of groups) {
        const col = (want: RegExp) => {
          for (let i = g.at; i < g.end; i++) if (want.test(String(labels[i] ?? ''))) return Number(row[i])
          return NaN
        }
        const rent = col(/^median$/i)
        if (!Number.isFinite(rent) || rent <= 0) continue
        const n = col(/^count$/i)
        const p25 = col(/percentile 25/i)
        const p75 = col(/percentile 75/i)
        if (!whole(rent, 20)) throw new Error('the header does not describe the data')
        for (const v of [n, p25, p75]) if (Number.isFinite(v) && !whole(v)) throw new Error('the header does not describe the data')
        out.push({
          kind: 'suburb',
          area,
          dwelling: g.dwelling,
          beds: g.beds,
          quarter: at,
          rent,
          n: Number.isFinite(n) ? n : null,
          p25: Number.isFinite(p25) ? p25 : null,
          p75: Number.isFinite(p75) ? p75 : null,
        })
      }
    }
    if (out.length) return out
  }
  throw new Error('no suburb table with quartiles in the workbook')
}

async function main() {
  const db = pool()
  const all = await files()
  console.log(`${all.length} quarters listed`)
  let added = 0
  for (const { url, at } of all) {
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    if (!r.ok) {
      console.log(`skip ${at}: ${r.status}`)
      continue
    }
    const buf = Buffer.from(await r.arrayBuffer())
    // The catalogue calls a few of the older files xlsx; the bytes say otherwise.
    if (buf.subarray(0, 2).toString('latin1') !== 'PK') {
      console.log(`skip ${at}: not a zip, the older format is not read here`)
      continue
    }
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
    if ((await loaded(db, url)) === hash) continue
    let rows: Median[]
    try {
      rows = parse(buf, at)
    } catch (e: any) {
      console.log(`skip ${at}: ${e.message}`)
      continue
    }
    await putMedians(db, url, 'VIC', rows, hash)
    added += rows.length
    console.log(`${at}: ${rows.length}`)
  }
  console.log(`${added} medians added`)
  await db.end()
}

if (process.argv[1]?.endsWith('vic.js')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
