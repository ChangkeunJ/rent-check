import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { pool } from '../src/db.js'
import * as Q from '../src/queries.js'

const live = !!process.env.DATABASE_URL
const opts = live ? {} : { skip: 'DATABASE_URL not set' }
const db = live ? pool() : null
const q: Q.Q = async (sql, args) => (await db!.query(sql, args)).rows

// A state of its own, so the fixture is never mixed in with the real lodgements.
const ST = 'ZZ'
const PC = '9999'

before(async () => {
  if (!db) return
  const { rows } = await db.query(
    `insert into source (url, state, kind, hash, rows) values ('test://read', $1, 'lodgement', 'x', 0)
     on conflict (url) do update set hash = 'x' returning id`, [ST])
  const src = rows[0].id
  await db.query('delete from lodgement where src = $1', [src])
  const add = (at: string, beds: number, rent: number, dwelling = 'H') =>
    db.query(`insert into lodgement (src, state, at, postcode, dwelling, beds, rent) values ($1,$2,$3,$4,$5,$6,$7)`,
      [src, ST, at, PC, dwelling, beds, rent])
  // Nine three bedroom houses this quarter and nine a year before it.
  for (const [i, rent] of [500, 550, 600, 650, 700, 750, 800, 850, 900].entries()) {
    await add('2026-07-15', 3, rent)
    await add('2025-06-15', 3, rent - 100)
    if (i === 0) await add('2026-07-15', 2, 400, 'F')
  }
})

after(async () => {
  if (!db) return
  await db.query(`delete from source where url = 'test://read'`)
  await db.end()
})

test('the spread is the quartiles of what was lodged', opts, async () => {
  const [s] = await Q.spread(q, PC, 'H', 3, 3)
  assert.equal(s.n, 9)
  assert.equal(Number(s.median), 700)
  assert.equal(Number(s.p25), 600)
  assert.equal(Number(s.p75), 800)
})

test('bedrooms and dwelling both narrow the sample', opts, async () => {
  const [s] = await Q.spread(q, PC, 'F', 2, 3)
  assert.equal(s.n, 1)
  assert.equal(Number(s.median), 400)
})

test('a rent is ranked against the tenancies around it', opts, async () => {
  const [r] = await Q.rank(q, PC, 'H', 3, 700, 3)
  assert.deepEqual([r.n, r.below], [9, 5])
})

test('a rent under everything ranks below everything', opts, async () => {
  const [r] = await Q.rank(q, PC, 'H', 3, 100, 3)
  assert.equal(r.below, 0)
})

test('the series is one median a month', opts, async () => {
  const s = await Q.series(q, ST, PC, 'H', 3)
  assert.deepEqual(s.map((r: any) => [r.at, Number(r.rent), r.n]), [
    ['2025-06-01', 600, 9],
    ['2026-07-01', 700, 9],
  ])
})

test('a mover compares this quarter with the same quarter a year back', opts, async () => {
  const [m] = await Q.movers(q, ST, 'H', 3, 5)
  assert.equal(m.postcode, PC)
  assert.deepEqual([Number(m.was), Number(m.now)], [600, 700])
  assert.equal(Number(m.pct), 16.7)
})

test('a postcode with too few bonds is left out', opts, async () => {
  assert.deepEqual(await Q.movers(q, ST, 'H', 3, 20), [])
})
