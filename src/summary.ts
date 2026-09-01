import { writeFileSync, mkdirSync } from 'node:fs'
import { pool } from './db.js'
import { coverage, latest, movers, spread } from './queries.js'

// Written into the repository after every run. It is the public record of what
// the files held that month, and it is what keeps GitHub from switching the
// schedule off after sixty quiet days.
async function main() {
  const db = pool()
  const q = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rows
  const [c] = await coverage(q)
  const day = new Date().toISOString().slice(0, 10)

  const out = {
    date: day,
    coverage: c,
    sydney_2br_flat: (await spread(q, '2000', 'F', 2))[0],
    melbourne_2br_flat: (await latest(q, 'VIC', 'suburb', 'CBD-St Kilda Rd', 'F', 2))[0],
    movers: (await movers(q, 'NSW', 'H', 3)).slice(0, 10).map((m) => ({
      postcode: m.postcode, label: m.label, was: Number(m.was), now: Number(m.now), pct: Number(m.pct), n: m.n,
    })),
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(`data/${day}.json`, JSON.stringify(out, null, 1) + '\n')
  writeFileSync('data/latest.json', JSON.stringify(out, null, 1) + '\n')
  console.log(`${day}: ${c.lodgements} lodgements to ${c.latest}`)
  await db.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
