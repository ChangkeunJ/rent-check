// The read side, written once. The local server and the worker each hand in a
// query function; neither owns any SQL.
export type Q = (sql: string, args: unknown[]) => Promise<any[]>

export const coverage = (q: Q) =>
  q(`select (select count(*)::int from lodgement) lodgements,
            (select count(distinct postcode)::int from lodgement) postcodes,
            (select max(at)::text from lodgement) latest,
            (select min(at)::text from lodgement) earliest,
            (select count(*)::int from median) medians,
            (select max(quarter)::text from median) quarter`, [])

// New South Wales publishes the lodgements one by one, so the spread is real
// rather than someone else's summary. Three months keeps the sample honest for a
// single postcode without going stale.
export const spread = (q: Q, postcode: string, dwelling: string, beds: number | null, months = 3) =>
  q(`select count(*)::int as n,
            percentile_cont(0.25) within group (order by rent) as p25,
            percentile_cont(0.5)  within group (order by rent) as median,
            percentile_cont(0.75) within group (order by rent) as p75,
            min(rent) as low, max(rent) as high,
            max(at)::text as latest
       from lodgement
      where postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
        and at > (select max(at) from lodgement) - ($4 || ' months')::interval`,
    [postcode, dwelling, beds, months])

// Where a given rent sits among the tenancies that started around it.
export const rank = (q: Q, postcode: string, dwelling: string, beds: number | null, rent: number, months = 3) =>
  q(`select count(*)::int as n,
            count(*) filter (where rent <= $5)::int as below
       from lodgement
      where postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
        and at > (select max(at) from lodgement) - ($4 || ' months')::interval`,
    [postcode, dwelling, beds, months, rent])

// One line per month. A month with a handful of bonds behind it is noise, so the
// count travels with the number and the caller can decide.
export const series = (q: Q, state: string, postcode: string, dwelling: string, beds: number | null) =>
  state === 'QLD'
    ? q(`select quarter::text as at, rent, null::int as n from median
          where state = 'QLD' and postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
          order by quarter`, [postcode, dwelling, beds])
    : q(`select to_char(date_trunc('month', at), 'YYYY-MM-DD') as at,
                percentile_cont(0.5) within group (order by rent) as rent,
                count(*)::int as n
           from lodgement
          where state = $4 and postcode = $1 and dwelling = $2 and ($3::int is null or beds = $3)
          group by 1 order by 1`, [postcode, dwelling, beds, state])

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
            round(((now.rent - was.rent) / nullif(was.rent, 0) * 100)::numeric, 1) as pct
       from now join was using (postcode)
      where now.n >= $3 and was.n >= $3
      order by pct desc nulls last limit 40`, [dwelling, beds, min, state])
