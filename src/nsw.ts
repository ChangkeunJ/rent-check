import { createHash } from 'node:crypto'
import { read, date } from './xlsx.js'
import { pool, loaded, putLodgements, type Lodgement } from './db.js'

// New South Wales posts one spreadsheet a month of every bond lodged, and leaves
// the older ones up. The page is the index; there is no API.
const PAGE = 'https://www.nsw.gov.au/housing-and-construction/rental-forms-surveys-and-data/rental-bond-data'
const UA = 'rent-check (github.com/ChangkeunJ/rent-check)'

// A year file repeats the twelve month files, so it is only worth reading for a
// year the month files no longer cover. 2021 is that year today.
export function pick(urls: string[]): string[] {
  const year = (u: string) => /(20\d\d)/.exec(u.split('/').pop() ?? '')?.[1] ?? ''
  const annual = (u: string) => /[_-]year[_-]/i.test(u)
  const months = urls.filter((u) => !annual(u))
  const covered = new Set(months.map(year))
  return [...months, ...urls.filter((u) => annual(u) && !covered.has(year(u)))].sort()
}

export async function files(): Promise<string[]> {
  const html = await (await fetch(PAGE, { headers: { 'user-agent': UA } })).text()
  const out = new Set<string>()
  for (const m of html.matchAll(/href="([^"]+\.xlsx)"/gi)) {
    const u = new URL(m[1]!, PAGE).toString()
    if (/lodgement/i.test(u)) out.add(u)
  }
  return pick([...out])
}

// Header rows carry the month; the data starts where the five columns do.
export function parse(buf: Buffer): Lodgement[] {
  const [sheet] = read(buf)
  if (!sheet) throw new Error('empty workbook')
  const out: Lodgement[] = []
  for (const r of sheet.rows) {
    const [when, pc, kind, beds, rent] = r
    if (typeof when !== 'number' || pc === null || pc === undefined) continue
    const money = Number(rent)
    if (!Number.isFinite(money) || money <= 0) continue
    const n = Number(beds)
    out.push({
      at: date(when).toISOString().slice(0, 10),
      postcode: String(pc).padStart(4, '0'),
      dwelling: String(kind ?? 'U').trim().slice(0, 1).toUpperCase() || 'U',
      beds: Number.isInteger(n) ? n : null,
      rent: money,
    })
  }
  return out
}

async function main() {
  const db = pool()
  const all = await files()
  console.log(`${all.length} lodgement files listed`)
  let added = 0
  for (const url of all) {
    const r = await fetch(url, { headers: { 'user-agent': UA } })
    if (!r.ok) {
      console.log(`skip ${url.split('/').pop()}: ${r.status}`)
      continue
    }
    const buf = Buffer.from(await r.arrayBuffer())
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
    if ((await loaded(db, url)) === hash) continue
    const rows = parse(buf)
    await putLodgements(db, url, 'NSW', rows, hash)
    added += rows.length
    console.log(`${url.split('/').pop()}: ${rows.length}`)
  }
  console.log(`${added} lodgements added`)
  await db.end()
}

if (process.argv[1]?.endsWith('nsw.js')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
