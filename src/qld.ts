import { createHash } from 'node:crypto'
import { read } from './xlsx.js'
import { pool, loaded, putMedians, type Median } from './db.js'

// Queensland does the arithmetic itself: one workbook, rewritten in place each
// quarter, holding medians by postcode back to 2012.
const PAGE = 'https://www.rta.qld.gov.au/forms-resources/rta-data-releases/median-rents-quarterly-data'
const UA = 'rent-check (github.com/ChangkeunJ/rent-check)'

const MONTHS: Record<string, number> = { Mar: 3, Jun: 6, Sep: 9, Dec: 12 }
const KIND: Record<string, string> = { Flat: 'F', House: 'H', Townhouse: 'T' }

export async function file(): Promise<string> {
  const html = await (await fetch(PAGE, { headers: { 'user-agent': UA } })).text()
  const m = /href="([^"]*bond-statistics[^"]*\.xlsx)"/i.exec(html)
  if (!m) throw new Error('the workbook is no longer linked from the data page')
  return new URL(m[1]!, PAGE).toString()
}

// Two header rows carry the quarter: month names above their years. A cell is a
// median in dollars, or empty where too few bonds were lodged to publish one.
export function parse(buf: Buffer): Median[] {
  const sheet = read(buf).find((s) => s.name.includes('pc-rents'))
  if (!sheet) throw new Error('no postcode sheet in the workbook')
  const months = sheet.rows[5] ?? []
  const years = sheet.rows[6] ?? []
  const quarters: (string | null)[] = months.map((m, i) => {
    const month = MONTHS[String(m)]
    const year = Number(years[i])
    return month && year ? `${year}-${String(month).padStart(2, '0')}-01` : null
  })

  const out: Median[] = []
  for (const row of sheet.rows.slice(7)) {
    const pc = Number(row[2])
    const [kind, beds] = String(row[3] ?? '').split(' ')
    const dwelling = KIND[kind ?? '']
    if (!Number.isInteger(pc) || !dwelling || !beds) continue
    for (let i = 4; i < row.length; i++) {
      const q = quarters[i]
      const rent = Number(row[i])
      if (!q || !Number.isFinite(rent) || rent <= 0) continue
      out.push({ postcode: String(pc), dwelling, beds: Number(beds), quarter: q, rent })
    }
  }
  return out
}

async function main() {
  const db = pool()
  const url = await file()
  const r = await fetch(url, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  if ((await loaded(db, url)) === hash) {
    console.log('unchanged')
    await db.end()
    return
  }
  const rows = parse(buf)
  if (rows.length < 10_000) throw new Error(`only ${rows.length} medians parsed, the sheet shape changed`)
  await putMedians(db, url, 'QLD', rows, hash)
  console.log(`${rows.length} medians, latest ${rows.map((x) => x.quarter).sort().pop()}`)
  await db.end()
}

if (process.argv[1]?.endsWith('qld.js')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
