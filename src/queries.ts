// The read side, written once. The local server and the worker each hand in a
// query function; neither owns any SQL.
export type Q = (sql: string, args: unknown[]) => Promise<any[]>

export const coverage = (q: Q) =>
  q(`select (select count(*)::int from lodgement) lodgements,
            (select count(distinct postcode)::int from lodgement) postcodes,
            (select max(at)::text from lodgement) latest,
            (select min(at)::text from lodgement) earliest,
            (select count(*)::int from median) medians,
            (select max(quarter)::text from median) quarter,
            (select count(*)::int from median where state = 'VIC') vic`, [])

// What the typed text could mean. A postcode is worth nothing to a renter who
// knows the suburb, so the localities the Bureau puts in each postal area come
// along as the label, and searching one of those names finds the postcode.
export const find = (q: Q, text: string) => {
  const s = text.trim().toLowerCase()
  if (s.length < 2) return Promise.resolve([])
  return q(
    `select a.state, a.kind, a.area, a.rows, coalesce(nullif(p.label, ''), a.area) as label
       from area a
       left join lateral (
         select string_agg(name, ', ') as label
           from (select name from place
                  where a.kind = 'postcode' and postcode = a.area
                  order by mmm nulls last, area desc nulls last limit 3) t) p on true
      where a.area = $1
         or lower(a.area) like $2
         or (a.kind = 'postcode'
             and exists (select 1 from place where postcode = a.area and lower(name) like $2))
      order by (a.area = $1) desc, length(a.area), a.area
      limit 12`,
    [s, s + '%'],
  )
}

// New South Wales publishes the lodgements one by one, so the spread is real
// rather than someone else's summary. Three months keeps the sample honest for a
// single postcode without going stale.
export const spread = (q: Q, area: string, dwelling: string, beds: number | null, months = 3) =>
  q(`select count(*)::int as n,
            percentile_cont(0.25) within group (order by rent) as p25,
            percentile_cont(0.5)  within group (order by rent) as median,
            percentile_cont(0.75) within group (order by rent) as p75,
            min(rent) as low, max(rent) as high,
            max(at)::text as latest
       from lodgement
      where postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
        and at > (select max(at) from lodgement) - ($4 || ' months')::interval`,
    [area, dwelling, beds, months])

// The other two states hand over a median already worked out. Victoria puts the
// count and the quartiles beside it, Queensland does not.
export const latest = (q: Q, state: string, kind: string, area: string, dwelling: string, beds: number | null) =>
  q(`select rent as median, n, p25, p75, quarter::text as latest
       from median
      where state = $1 and area_kind = $2 and area = $3 and dwelling = $4 and ($5::int is null or beds = $5)
      order by quarter desc limit 1`,
    [state, kind, area, dwelling, beds])

// Where a given rent sits among the tenancies that started around it.
export const rank = (q: Q, area: string, dwelling: string, beds: number | null, rent: number, months = 3) =>
  q(`select count(*)::int as n,
            count(*) filter (where rent <= $5)::int as below
       from lodgement
      where postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
        and at > (select max(at) from lodgement) - ($4 || ' months')::interval`,
    [area, dwelling, beds, months, rent])

// One line per month where the lodgements are there to build it, one per quarter
// where they are not. A month with a handful of bonds behind it is noise, so the
// count travels with the number and the caller can decide.
export const series = (q: Q, rows: boolean, state: string, kind: string, area: string, dwelling: string, beds: number | null) =>
  rows
    ? q(`select to_char(date_trunc('month', at), 'YYYY-MM-DD') as at,
                percentile_cont(0.5) within group (order by rent) as rent,
                count(*)::int as n
           from lodgement
          where state = $4 and postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
          group by 1 order by 1`, [area, dwelling, beds, state])
    : q(`select quarter::text as at, rent, n from median
          where state = $4 and area_kind = $5 and area = $1 and dwelling = $2 and ($3::int is null or beds = $3)
          order by quarter`, [area, dwelling, beds, state, kind])

// The postcodes that moved most over a year, which is the question a renter and a
// journalist both arrive with.
export const movers = (q: Q, state = 'NSW', dwelling = 'H', beds: number | null = 3, min = 20) =>
  q(`with win as (select max(at) as last from lodgement where state = $4),
     now as (
       select postcode, percentile_cont(0.5) within group (order by rent) as rent, count(*)::int as n
         from lodgement, win
        where state = $4 and dwelling = $1 and ($2::int is null or beds = $2)
          and at > win.last - interval '3 months'
        group by 1),
     was as (
       select postcode, percentile_cont(0.5) within group (order by rent) as rent, count(*)::int as n
         from lodgement, win
        where state = $4 and dwelling = $1 and ($2::int is null or beds = $2)
          and at > win.last - interval '15 months' and at <= win.last - interval '12 months'
        group by 1)
     select now.postcode, was.rent as was, now.rent as now, now.n,
            round(((now.rent - was.rent) / nullif(was.rent, 0) * 100)::numeric, 1) as pct,
            (select string_agg(name, ', ') from
               (select name from place where postcode = now.postcode
                 order by mmm nulls last, area desc nulls last limit 2) t) as label
       from now join was using (postcode)
      where now.n >= $3 and was.n >= $3
      order by pct desc nulls last limit 40`, [dwelling, beds, min, state])
