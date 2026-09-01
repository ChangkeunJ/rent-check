import { createServer } from 'node:http'
import { pool } from './db.js'
import * as Q from './queries.js'

const db = pool()
const PORT = Number(process.env.PORT ?? 8080)
const q = async (sql: string, args: unknown[]) => (await db.query(sql, args)).rows
const beds = (v: string | null) => (v === null || v === '' ? null : Number(v))

const routes: Record<string, (p: URLSearchParams) => Promise<unknown>> = {
  '/api/coverage': async () => (await Q.coverage(q))[0],
  '/api/find': (p) => Q.find(q, p.get('q') ?? ''),
  '/api/spread': async (p) =>
    (await Q.spread(q, p.get('area') ?? '', p.get('dwelling') ?? 'H', beds(p.get('beds'))))[0],
  '/api/latest': async (p) =>
    (await Q.latest(q, p.get('state') ?? '', p.get('kind') ?? 'postcode', p.get('area') ?? '',
                    p.get('dwelling') ?? 'H', beds(p.get('beds'))))[0] ?? null,
  '/api/rank': async (p) =>
    (await Q.rank(q, p.get('area') ?? '', p.get('dwelling') ?? 'H', beds(p.get('beds')), Number(p.get('rent') ?? 0)))[0],
  '/api/series': (p) =>
    Q.series(q, p.get('rows') === '1', p.get('state') ?? 'NSW', p.get('kind') ?? 'postcode', p.get('area') ?? '',
             p.get('dwelling') ?? 'H', beds(p.get('beds'))),
  '/api/movers': (p) => Q.movers(q, 'NSW', p.get('dwelling') ?? 'H', beds(p.get('beds'))),
}

createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x')
  const fn = routes[u.pathname]
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('access-control-allow-origin', '*')
  if (!fn) {
    res.writeHead(404).end(JSON.stringify({ error: 'not found', routes: Object.keys(routes) }))
    return
  }
  try {
    res.end(JSON.stringify(await fn(u.searchParams), null, 1))
  } catch (e: any) {
    res.writeHead(500).end(JSON.stringify({ error: String(e.message ?? e) }))
  }
}).listen(PORT, () => console.log(`listening on ${PORT}`))
