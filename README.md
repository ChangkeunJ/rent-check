# rent-check

Every landlord in Australia has to lodge the bond with a state body, and the
lodgement carries the rent. It is the only public record of what a tenancy
actually starts at, as against what the advertisement asked for. Two states
publish it, and they publish two different things.

    https://rent-check.pages.dev

New South Wales publishes every lodgement, one row each: the date, the postcode,
the dwelling type, the number of bedrooms and the weekly rent. 1.8 million of
them since January 2021, about 26,000 a month. That is what makes a distribution
possible rather than someone else's median: the quartiles are worked out here,
and a renter can be told where their own rent sits inside them.

Queensland publishes the median already worked out, by postcode and quarter, back
to March 2012. Useful for the trend, and nothing can be said about the spread.

## Reading the spreadsheets

Both states publish xlsx and neither publishes an API. The reader in `src/xlsx.ts`
is 90 lines and pulls no dependencies: a workbook is a zip of XML parts, and
`zlib.inflateRawSync` is already in Node. Two things in the format bite:

A row Excel never wrote is simply absent, so `<row r="5">` follows `<row r="3">`
and anything that reads rows in document order silently shifts a sheet up. The
same is true of a skipped column. The `r` attribute is the only thing that keeps
a sheet in line, and the Queensland workbook has both.

An empty cell is written `<c r="B5" s="9"/>`, and a regular expression that treats
the closing slash as optional will happily swallow the next cell's value into it.

## What is in the numbers

A bond is lodged when a tenancy starts. Nothing here says anything about what a
sitting tenant pays, which is a different and less public number, and the gap
between the two is most of the argument about rent in Australia.

The dwelling type and the bedroom count are whatever the landlord or the agent
typed. July 2026 has one lodgement recorded as dwelling type `Y` and one with 18
bedrooms. They are kept as served.

Around 250 rows a month carry no rent at all and are dropped at the door.

## Running it locally

    docker compose up -d
    export DATABASE_URL=postgres://rent:rent@localhost:5433/rent
    npm ci && psql "$DATABASE_URL" -f schema.sql
    npm run nsw
    npm run qld
    npm test
    npm run serve

    curl 'localhost:8080/api/spread?postcode=2000&dwelling=F&beds=2'
    curl 'localhost:8080/api/rank?postcode=2000&dwelling=F&beds=2&rent=900'
    curl 'localhost:8080/api/series?state=QLD&postcode=4000&dwelling=F&beds=2'
    curl 'localhost:8080/api/movers?dwelling=H&beds=3'

The site is those endpoints and a page over them. `npm run web` serves the page,
`npm run api` runs the worker under it, and `npm run deploy` builds both.

## Layout

    src/xlsx.ts    the spreadsheet reader, no dependencies
    src/nsw.ts     the lodgement files, one a month
    src/qld.ts     the median workbook, rewritten in place each quarter
    src/db.ts      loads, one file per transaction
    src/queries.ts the read side's SQL, written once
    src/api.ts     local server over it
    worker/        the same routes on Cloudflare
    web/           the page
    test/          the reader's quirks and the read SQL

## What is missing

Postcodes have no suburb names here. The lists that carry them are either
unlicensed or too heavy to pin a portfolio project to, and a wrong name on a rent
figure is worse than no name.

Victoria, South Australia and Western Australia publish their own bond data in
their own shapes. None of them is loaded yet.

## Licence

MIT. The data is published by NSW Fair Trading and the Queensland Residential
Tenancies Authority under CC BY 4.0. This is not affiliated with either.
