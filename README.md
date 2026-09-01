# rent-check

Every landlord in Australia has to lodge the bond with a state body, and the
lodgement carries the rent. It is the only public record of what a tenancy
actually starts at, as against what the advertisement asked for. Three states
publish it, and they publish three different things.

    https://rent-check-5kx.pages.dev

New South Wales publishes every lodgement, one row each: the date, the postcode,
the dwelling type, the number of bedrooms and the weekly rent. 1.8 million of
them since January 2021, about 26,000 a month. That is what makes a distribution
possible rather than someone else's median: the quartiles are worked out here,
and a renter can be told where their own rent sits inside them.

Queensland publishes the median already worked out, by postcode and quarter, back
to March 2012. Useful for the trend, and nothing can be said about the spread.

Victoria publishes a moving annual median for each of 146 suburbs and towns, with
the count and the quartiles beside it, back to September 2015. The quartiles are
the department's rather than worked out here, but they are quartiles.

A postcode is a delivery route, and nobody says they live in 2026. The Bureau of
Statistics publishes which localities sit in which postal area, so the postcode
carries its suburb names and typing a suburb finds the postcode it is in.

## Reading the spreadsheets

All three states publish xlsx and none of them publishes an API. The reader in `src/xlsx.ts`
is 90 lines and pulls no dependencies: a workbook is a zip of XML parts, and
`zlib.inflateRawSync` is already in Node. Two things in the format bite:

A row Excel never wrote is simply absent, so `<row r="5">` follows `<row r="3">`
and anything that reads rows in document order silently shifts a sheet up. The
same is true of a skipped column. The `r` attribute is the only thing that keeps
a sheet in line, and the Queensland workbook has both.

An empty cell is written `<c r="B5" s="9"/>`, and a regular expression that treats
the closing slash as optional will happily swallow the next cell's value into it.

Victoria renumbers the table between reports and changes its shape inside them, so
the sheet is found by its shape rather than its name: a row of property types, a
row of column labels under it, and the quartiles among them. December 2015 heads
five columns of data with seven labels, which reads a percentage change as a bond
count; a rent is a whole number of dollars and a count is a whole number of bonds,
and a quarter where that does not hold is left out rather than half read.

Curl cannot reach the Victorian department at all, from here or from a GitHub
runner: Akamai drops the connection on the TLS fingerprint. Node's own fetch with
a browser user agent is served normally.

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
    npm run vic
    npm run place
    npm test
    npm run serve

    curl 'localhost:8080/api/find?q=bondi'
    curl 'localhost:8080/api/spread?area=2000&dwelling=F&beds=2'
    curl 'localhost:8080/api/rank?area=2000&dwelling=F&beds=2&rent=900'
    curl 'localhost:8080/api/latest?state=VIC&kind=suburb&area=Brunswick&dwelling=F&beds=2'
    curl 'localhost:8080/api/series?rows=1&state=NSW&kind=postcode&area=2000&dwelling=F&beds=2'
    curl 'localhost:8080/api/movers?dwelling=H&beds=3'

The site is those endpoints and a page over them. `npm run web` serves the page,
`npm run api` runs the worker under it, and `npm run deploy` builds both.

## Layout

    src/xlsx.ts    the spreadsheet reader, no dependencies
    src/nsw.ts     the lodgement files, one a month
    src/qld.ts     the median workbook, rewritten in place each quarter
    src/vic.ts     the quarterly report tables, one workbook a quarter
    src/place.ts   which localities sit in which postal area
    src/db.ts      loads, one file per transaction
    src/queries.ts the read side's SQL, written once
    src/api.ts     local server over it
    worker/        the same routes on Cloudflare
    web/           the page
    test/          the reader's quirks, the Victorian shapes, and the read SQL

## What is missing

Victoria publishes 146 suburb groupings rather than suburbs, so Carnegie is its
own line and Brunswick East is inside Brunswick. Nothing here can split them.

Two of the Victorian quarters are not read. December 2014 is served as xlsx and is
an xls underneath; December 2015 heads five columns of data with seven labels. The
catalogue itself has no 2017 at all.

South Australia and Western Australia publish their own bond data in their own
shapes. Neither is loaded yet.

## Licence

MIT. The data is published by NSW Fair Trading, the Queensland Residential
Tenancies Authority and the Victorian Department of Families, Fairness and Housing
under CC BY 4.0, and the postal area concordance by the Australian Bureau of
Statistics under CC BY 2.5 AU. This is not affiliated with any of them.
