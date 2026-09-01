import { neon } from '@neondatabase/serverless'
import * as Q from '../src/queries'

interface Env {
  DATABASE_URL: string
  ASSETS: { fetch(req: Request): Promise<Response> }
}

const beds = (v: string | null) => (v === null || v === '' ? null : Number(v))

const routes: Record<string, (q: Q.Q, p: URLSearchParams) => Promise<unknown>> = {
  '/api/coverage': async (q) => (await Q.coverage(q))[0],
  '/api/spread': async (q, p) =>
    (await Q.spread(q, p.get('postcode') ?? '', p.get('dwelling') ?? 'H', beds(p.get('beds'))))[0],
  '/api/rank': async (q, p) =>
    (await Q.rank(q, p.get('postcode') ?? '', p.get('dwelling') ?? 'H', beds(p.get('beds')), Number(p.get('rent') ?? 0)))[0],
  '/api/series': (q, p) =>
    Q.series(q, p.get('state') ?? 'NSW', p.get('postcode') ?? '', p.get('dwelling') ?? 'H', beds(p.get('beds'))),
  '/api/movers': (q, p) => Q.movers(q, 'NSW', p.get('dwelling') ?? 'H', beds(p.get('beds'))),
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // The files behind this move once a month.
      'cache-control': status === 200 ? 'public, max-age=600, s-maxage=3600' : 'no-store',
    },
  })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const u = new URL(req.url)
    const fn = routes[u.pathname]
    if (!fn) {
      if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
      return json({ error: 'not found', routes: Object.keys(routes) }, 404)
    }
    const sql = neon(env.DATABASE_URL)
    const q: Q.Q = (text, args) => sql.query(text, args) as Promise<any[]>
    try {
      return json(await fn(q, u.searchParams))
    } catch (e: any) {
      return json({ error: String(e?.message ?? e) }, 500)
    }
  },
}
