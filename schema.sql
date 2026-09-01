-- Every state makes a landlord lodge the bond with a government body, and the
-- lodgement carries the rent. That is the only public record of what a tenancy
-- actually starts at, as against what an ad asked for.

-- One file, loaded once. The monthly files never change after they are posted;
-- the Queensland workbook is rewritten in place, so it is tracked by hash.
create table if not exists source (
  id     serial primary key,
  url    text not null unique,
  state  text not null,
  kind   text not null,
  hash   text not null,
  rows   int  not null,
  at     timestamptz not null default now()
);

-- One row per bond lodged. New South Wales publishes them one by one, which is
-- what makes a distribution possible rather than someone else's median.
create table if not exists lodgement (
  src      int not null references source on delete cascade,
  state    text not null,
  at       date not null,
  postcode text not null,
  dwelling char(1) not null,
  beds     smallint,
  rent     numeric(10,2) not null
);
create index if not exists lodgement_at on lodgement (state, postcode, dwelling, beds, at);
create index if not exists lodgement_month on lodgement (at);

-- Queensland and Victoria publish the medians already worked out, by quarter.
-- Queensland keys them to a postcode and Victoria to a named suburb, and only
-- Victoria publishes the quartiles beside them.
create table if not exists median (
  state     text not null,
  area_kind text not null,
  area      text not null,
  dwelling  text not null,
  beds      smallint not null,
  quarter   date not null,
  rent      numeric(10,2) not null,
  n         int,
  p25       numeric(10,2),
  p75       numeric(10,2),
  primary key (state, area_kind, area, dwelling, beds, quarter)
);
create index if not exists median_area on median (state, area_kind, area);

-- A postcode is a delivery route, not a place, and nobody says they live in 2026.
-- The Bureau publishes which localities fall in which postal area; the area is
-- what decides which name to show first.
create table if not exists place (
  postcode text not null,
  state    text not null,
  name     text not null,
  area     numeric(12,4),
  -- The Modified Monash class, 1 in a capital and 7 in the back country. It is
  -- what puts the town at the head of a rural postcode's list of localities.
  mmm      smallint,
  primary key (postcode, name)
);
create index if not exists place_name on place (lower(name));

-- Which postcodes and suburbs there is anything to show for. Kept as a table
-- rather than a distinct over four million lodgements every time someone types.
-- rows says the state publishes the lodgements one by one, which is what decides
-- whether there is a distribution to show or only somebody else's median.
create table if not exists area (
  state text not null,
  kind  text not null,
  area  text not null,
  rows  boolean not null,
  primary key (state, kind, area)
);
