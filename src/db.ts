import pg from 'pg'

export type Pool = pg.Pool

export function pool(url = process.env.DATABASE_URL): Pool {
  if (!url) throw new Error('DATABASE_URL is not set')
  return new pg.Pool({ connectionString: url, max: 4 })
}

export async function loaded(db: Pool, url: string): Promise<string | null> {
  const { rows } = await db.query('select hash from source where url = $1', [url])
  return rows[0]?.hash ?? null
}

export async function mark(c: pg.PoolClient | Pool, url: string, state: string, kind: string, hash: string, rows: number) {
  const { rows: r } = await c.query(
    `insert into source (url, state, kind, hash, rows) values ($1,$2,$3,$4,$5)
     on conflict (url) do update set hash = excluded.hash, rows = excluded.rows, at = now()
     returning id`,
    [url, state, kind, hash, rows],
  )
  return r[0].id as number
}

export type Lodgement = { at: string; postcode: string; dwelling: string; beds: number | null; rent: number }

// A file is one transaction: either the month is in, or it is not there at all.
export async function putLodgements(db: Pool, url: string, state: string, rows: Lodgement[], hash: string) {
  const c = await db.connect()
  try {
    await c.query('begin')
    const src = await mark(c, url, state, 'lodgement', hash, rows.length)
    await c.query('delete from lodgement where src = $1', [src])
    for (let i = 0; i < rows.length; i += 1000) {
      const batch = rows.slice(i, i + 1000)
      const vals: unknown[] = []
      const holes = batch.map((r, n) => {
        vals.push(src, state, r.at, r.postcode, r.dwelling, r.beds, r.rent)
        const b = n * 7
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`
      })
      await c.query(`insert into lodgement (src, state, at, postcode, dwelling, beds, rent) values ${holes.join(',')}`, vals)
    }
    await c.query(
      `insert into area (state, kind, area, rows) select distinct $1, 'postcode', postcode, true from lodgement where src = $2
       on conflict do nothing`,
      [state, src],
    )
    await c.query('commit')
  } catch (e) {
    await c.query('rollback')
    throw e
  } finally {
    c.release()
  }
}

export type Median = {
  kind: string
  area: string
  dwelling: string
  beds: number
  quarter: string
  rent: number
  n?: number | null
  p25?: number | null
  p75?: number | null
}

export async function putMedians(db: Pool, url: string, state: string, rows: Median[], hash: string) {
  await mark(db, url, state, 'median', hash, rows.length)
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const vals: unknown[] = []
    const holes = batch.map((r, n) => {
      vals.push(state, r.kind, r.area, r.dwelling, r.beds, r.quarter, r.rent, r.n ?? null, r.p25 ?? null, r.p75 ?? null)
      const b = n * 10
      return `(${Array.from({ length: 10 }, (_, k) => `$${b + k + 1}`).join(',')})`
    })
    await db.query(
      `insert into median (state, area_kind, area, dwelling, beds, quarter, rent, n, p25, p75)
       values ${holes.join(',')}
       on conflict (state, area_kind, area, dwelling, beds, quarter)
       do update set rent = excluded.rent, n = excluded.n, p25 = excluded.p25, p75 = excluded.p75`,
      vals,
    )
  }
  await db.query(
    `insert into area (state, kind, area, rows) select distinct state, area_kind, area, false from median where state = $1
     on conflict do nothing`,
    [state],
  )
}
