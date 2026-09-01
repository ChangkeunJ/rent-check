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

-- Queensland publishes the medians already worked out, by quarter.
create table if not exists median (
  state    text not null,
  postcode text not null,
  dwelling text not null,
  beds     smallint not null,
  quarter  date not null,
  rent     numeric(10,2) not null,
  primary key (state, postcode, dwelling, beds, quarter)
);
