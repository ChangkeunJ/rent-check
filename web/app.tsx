import { useEffect, useState } from 'react'
import { RULES, check } from './rules'

type Cover = { lodgements: number; postcodes: number; latest: string; earliest: string; medians: number; quarter: string }
type Spread = { n: number; p25: string; median: string; p75: string; low: string; high: string; latest: string }
type Rank = { n: number; below: number }
type Point = { at: string; rent: string; n: number | null }
type Mover = { postcode: string; was: string; now: string; n: number; pct: string }

const KINDS = [
  { id: 'H', label: 'House' },
  { id: 'F', label: 'Flat or unit' },
  { id: 'T', label: 'Townhouse' },
]
const BEDS = ['1', '2', '3', '4', '5']

function useJson<T>(url: string | null) {
  const [v, setV] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!url) {
      setV(null)
      return
    }
    const ac = new AbortController()
    setV(null)
    setErr(null)
    fetch(url, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setV, (e) => e.name !== 'AbortError' && setErr(String(e.message)))
    return () => ac.abort()
  }, [url])
  return { v, err }
}

const money = (v: string | number | null) =>
  v === null || v === undefined ? '—' : '$' + Math.round(Number(v)).toLocaleString('en-AU')
const num = (n: number | string) => Number(n).toLocaleString('en-AU')
const month = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })

// A postcode says which state it is in, and the states publish different things.
const state = (pc: string) => (pc.startsWith('4') ? 'QLD' : 'NSW')

function Line({ d }: { d: Point[] }) {
  const w = 720
  const h = 190
  const pad = 34
  const hi = Math.max(...d.map((p) => Number(p.rent))) * 1.08
  const t0 = Date.parse(d[0]!.at)
  const t1 = Date.parse(d[d.length - 1]!.at)
  const x = (iso: string) => pad + ((Date.parse(iso) - t0) / Math.max(t1 - t0, 1)) * (w - pad * 2)
  const y = (v: number) => h - pad - (v / hi) * (h - pad * 2)
  const line = d.map((p, i) => `${i ? 'L' : 'M'} ${x(p.at).toFixed(1)} ${y(Number(p.rent)).toFixed(1)}`).join(' ')
  const last = d[d.length - 1]!

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="median rent by month">
      <line x1={pad} y1={y(0)} x2={w - pad} y2={y(0)} className="axis" />
      <path d={`${line} L ${x(last.at)} ${y(0)} L ${x(d[0]!.at)} ${y(0)} Z`} className="fill" />
      <path d={line} className="line" />
      <circle cx={x(last.at)} cy={y(Number(last.rent))} r="3.5" className="dot" />
      <text x={pad} y={y(0) + 15} className="lab">{month(d[0]!.at)}</text>
      <text x={w - pad} y={y(0) + 15} className="lab end">{month(last.at)}</text>
      <text x={x(last.at) - 8} y={y(Number(last.rent)) - 9} className="lab end strong">{money(last.rent)}</text>
    </svg>
  )
}

function Bar({ s }: { s: Spread }) {
  const lo = Number(s.p25)
  const mid = Number(s.median)
  const hi = Number(s.p75)
  const span = Math.max(hi - lo, 1)
  const at = ((mid - lo) / span) * 100
  return (
    <div className="quart">
      <div className="track">
        <span className="mid" style={{ left: `${at}%` }} />
      </div>
      <div className="ends">
        <span>{money(lo)}<em>a quarter pay less</em></span>
        <span className="r">{money(hi)}<em>a quarter pay more</em></span>
      </div>
    </div>
  )
}

function Yours({ pc, kind, beds }: { pc: string; kind: string; beds: string }) {
  const [rent, setRent] = useState('')
  const n = Number(rent)
  const ask = n > 0 ? `/api/rank?postcode=${pc}&dwelling=${kind}&beds=${beds}&rent=${n}` : null
  const { v } = useJson<Rank>(ask)
  const share = v && v.n > 0 ? Math.round((v.below / v.n) * 100) : null
  return (
    <div className="yours">
      <label htmlFor="rent">Paying</label>
      <input id="rent" inputMode="numeric" placeholder="700" value={rent} onChange={(e) => setRent(e.target.value.replace(/[^\d]/g, ''))} />
      <span className="unit">a week</span>
      {share !== null && (
        <p className="verdict">
          Dearer than <strong>{share}%</strong> of the {num(v!.n)} tenancies that started here.
        </p>
      )}
    </div>
  )
}

function Result({ pc, kind, beds }: { pc: string; kind: string; beds: string }) {
  const qs = `postcode=${pc}&dwelling=${kind}&beds=${beds}`
  const st = state(pc)
  const { v: s } = useJson<Spread>(st === 'NSW' ? `/api/spread?${qs}` : null)
  const { v: line, err } = useJson<Point[]>(`/api/series?state=${st}&${qs}`)
  const kindName = KINDS.find((k) => k.id === kind)?.label.toLowerCase()

  if (err) return <p className="err">{err}</p>
  if (st === 'NSW' && s && s.n === 0 && !line?.length)
    return <p className="empty">No bond was lodged for a {beds} bedroom {kindName} in {pc} in the window. Try a different size, or a neighbouring postcode.</p>

  return (
    <>
      {s && s.n > 0 && (
        <div className="hero">
          <div>
            <span className="k">Median rent, {beds} bedroom {kindName}, {pc}</span>
            <span className="figure">{money(s.median)}<em>a week</em></span>
            <span className="k">
              {num(s.n)} bonds lodged in the three months to {month(s.latest)}
            </span>
          </div>
          <Bar s={s} />
        </div>
      )}
      {st === 'QLD' && (
        <p className="note pad">
          Queensland publishes the median already worked out, once a quarter, so there is no spread to show and no way
          to place your own rent inside it. New South Wales publishes every lodgement.
        </p>
      )}
      {line && line.length > 1 && (
        <div className="pad">
          <Line d={line} />
        </div>
      )}
      {st === 'NSW' && s && s.n > 0 && <Yours pc={pc} kind={kind} beds={beds} />}
    </>
  )
}

// The other half of the question. What the median is worth knowing next to is
// whether the increase was allowed at all, and that is a matter of two dates.
function Allowed({ st }: { st: string }) {
  const rule = RULES[st]
  const [since, setSince] = useState('')
  const [from, setFrom] = useState('')
  const [told, setTold] = useState('')
  if (!rule) return null
  const ready = since && from && told
  const c = ready ? check(rule, new Date(since), new Date(from), new Date(told)) : null

  return (
    <section>
      <div className="bar">
        <h2>Was the increase allowed?</h2>
        <p className="note">{rule.note}</p>
      </div>
      <div className="dates">
        <div>
          <label htmlFor="since">Current rent started</label>
          <input id="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </div>
        <div>
          <label htmlFor="from">New rent starts</label>
          <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="told">Notice given</label>
          <input id="told" type="date" value={told} onChange={(e) => setTold(e.target.value)} />
        </div>
      </div>
      {c && (
        <ul className="verdicts">
          <li className={c.often ? 'ok' : 'no'}>
            <strong>{c.often ? 'Far enough apart.' : 'Too soon.'}</strong> {c.months} months since the current rent
            became payable, where the Act asks for {rule.everyMonths}.
          </li>
          <li className={c.notice ? 'ok' : 'no'}>
            <strong>{c.notice ? 'Enough notice.' : 'Short notice.'}</strong> {c.days} days between the notice and the
            day the new rent starts, where the Act asks for {rule.noticeSaid}.
          </li>
        </ul>
      )}
      <p className="cite">
        {rule.act}, as it has stood since {rule.since}. <a href={rule.law}>The section</a> and the{' '}
        <a href={rule.guide}>government's own guidance</a>. This reads two dates against one rule; it is not advice, and
        it knows nothing about your agreement.
      </p>
    </section>
  )
}

function Movers() {
  const [kind, setKind] = useState('H')
  const [beds, setBeds] = useState('3')
  const { v } = useJson<Mover[]>(`/api/movers?dwelling=${kind}&beds=${beds}`)
  return (
    <section>
      <div className="bar">
        <h2>Where it moved most</h2>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="dwelling">
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <select value={beds} onChange={(e) => setBeds(e.target.value)} aria-label="bedrooms">
          {BEDS.map((b) => <option key={b} value={b}>{b} bed</option>)}
        </select>
        <p className="note">Median of the last three months against the same three months a year earlier. New South Wales only.</p>
      </div>
      {v?.length ? (
        <table>
          <thead>
            <tr>
              <th>Postcode</th>
              <th className="r">A year ago</th>
              <th className="r">Now</th>
              <th className="r">Change</th>
              <th className="r">Bonds</th>
            </tr>
          </thead>
          <tbody>
            {v.map((m) => (
              <tr key={m.postcode}>
                <td className="name">{m.postcode}</td>
                <td className="r dim">{money(m.was)}</td>
                <td className="r strong">{money(m.now)}</td>
                <td className={'r ' + (Number(m.pct) > 0 ? 'up' : 'down')}>
                  {(Number(m.pct) > 0 ? '+' : '') + m.pct}%
                </td>
                <td className="r dim">{num(m.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  )
}

export default function App() {
  const [pc, setPc] = useState('2000')
  const [kind, setKind] = useState('F')
  const [beds, setBeds] = useState('2')
  const { v: c } = useJson<Cover>('/api/coverage')

  return (
    <>
      <header>
        <div className="wrap">
          <h1>rent check</h1>
          <p className="thesis">
            Every landlord in Australia has to lodge the bond with the state, and the lodgement carries the rent. It is
            the only public record of what a tenancy actually starts at, as against what the ad asked for.
          </p>
          {c && (
            <p className="cover">
              {num(c.lodgements)} bond lodgements across {c.postcodes} New South Wales postcodes, {month(c.earliest)} to{' '}
              {month(c.latest)}
              {c.medians > 0 && `, and ${num(c.medians)} Queensland medians to ${month(c.quarter)}`}.
            </p>
          )}
        </div>
      </header>

      <main className="wrap">
        <form className="find" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="pc">Postcode</label>
            <input id="pc" inputMode="numeric" maxLength={4} value={pc}
                   onChange={(e) => setPc(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
          <div>
            <label htmlFor="kind">Dwelling</label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="beds">Bedrooms</label>
            <select id="beds" value={beds} onChange={(e) => setBeds(e.target.value)}>
              {BEDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </form>
        {pc.length === 4 ? <Result pc={pc} kind={kind} beds={beds} /> : <p className="empty">Four digits.</p>}
      </main>

      <div className="wrap">
        <Allowed st={state(pc)} />
        <Movers />
      </div>

      <footer className="wrap">
        <p>
          New South Wales bond lodgements from NSW Fair Trading and Queensland median rents from the Residential
          Tenancies Authority, both CC BY 4.0. Rents are what was lodged, not what was advertised, and a bond is lodged
          at the start of a tenancy, so this is the market for new leases rather than for sitting tenants.{' '}
          <a href="https://github.com/ChangkeunJ/rent-check">Code</a>.
        </p>
      </footer>
    </>
  )
}
