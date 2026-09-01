import { createHash } from 'node:crypto'
import { read } from './xlsx.js'
import { pool, loaded, mark } from './db.js'

// The Bureau's own concordance between suburbs and localities and postal areas,
// 2021 edition, CC BY 2.5 AU. It is the only list of the two together that comes
// with a licence.
const URL = 'https://data.gov.au/data/dataset/f50d81d1-59e0-417f-858b-808ca5550cdd/resource/2fcfd12a-2aef-49b1-a4b6-650ea5a85197/download/mmm23_sal21_poa21.xlsx'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

const STATES: Record<string, string> = {
  'New South Wales': 'NSW',
  Victoria: 'VIC',
  Queensland: 'QLD',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'TAS',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
  'Other Territories': 'OT',
}

export type Place = { postcode: string; state: string; name: string; area: number | null; mmm: number | null }

// A banner row and a title sit above the header, so the header is found by its
// first column rather than counted to.
export function parse(buf: Buffer): Place[] {
  const sheet = read(buf)[0]
  if (!sheet) throw new Error('the workbook is empty')
  const head = sheet.rows.findIndex((r) => r.some((v) => String(v ?? '').startsWith('SAL 2021 Code')))
  if (head < 0) throw new Error('no header row in the concordance')
  const cols = (sheet.rows[head] ?? []).map((v) => String(v ?? ''))
  const at = (want: string) => cols.findIndex((c) => c.startsWith(want))
  const [name, pc, area, mmm, state] =
    [at('SAL 2021 Name'), at('POA 2021 Code'), at('SAL 2021 Area'), at('MMM 2023'), at('State')]

  // A locality split across remoteness categories is written once per category,
  // so the same suburb and postcode come round more than once.
  const out = new Map<string, Place>()
  for (const row of sheet.rows.slice(head + 1)) {
    const code = Number(row[pc])
    const label = String(row[name] ?? '').trim()
    const st = STATES[String(row[state] ?? '').trim()]
    if (!label || !st || !Number.isInteger(code)) continue
    const p: Place = {
      postcode: String(code).padStart(4, '0'),
      state: st,
      // "Abbotsford (NSW)" only needs the state when two states share the name.
      name: label.replace(/\s*\((?:[^()]*[-–]\s*)?(?:NSW|Vic\.|Qld|SA|WA|Tas\.|NT|ACT)\)$/, ''),
      area: Number.isFinite(Number(row[area])) ? Number(row[area]) : null,
      mmm: Number.isInteger(Number(row[mmm])) ? Number(row[mmm]) : null,
    }
    out.set(`${p.postcode}\t${p.name}`, p)
  }
  return [...out.values()]
}

async function main() {
  const db = pool()
  const r = await fetch(URL, { headers: { 'user-agent': UA } })
  if (!r.ok) throw new Error(`${URL} answered ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16)
  if ((await loaded(db, URL)) === hash) {
    console.log('unchanged')
    await db.end()
    return
  }
  const rows = parse(buf)
  if (rows.length < 10_000) throw new Error(`only ${rows.length} localities parsed, the sheet shape changed`)
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const vals: unknown[] = []
    const holes = batch.map((p, n) => {
      vals.push(p.postcode, p.state, p.name, p.area, p.mmm)
      const b = n * 5
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`
    })
    await db.query(
      `insert into place (postcode, state, name, area, mmm) values ${holes.join(',')}
       on conflict (postcode, name) do update set state = excluded.state, area = excluded.area, mmm = excluded.mmm`,
      vals,
    )
  }
  await mark(db, URL, 'AU', 'place', hash, rows.length)
  console.log(`${rows.length} localities`)
  await db.end()
}

if (process.argv[1]?.endsWith('place.js')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
