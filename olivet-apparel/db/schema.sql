-- Olivet Apparel: initial schema (DRAFT, PostgreSQL)
-- Run as migration 001 once the project is created.

create extension if not exists "pgcrypto";

-- ───────── Portfolio ─────────

create table collections (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text,
  cover_url    text,
  sort_order   int  not null default 0,
  published    boolean not null default false,
  created_at   timestamptz not null default now()
);

create table looks (
  id             uuid primary key default gen_random_uuid(),
  collection_id  uuid references collections(id) on delete set null,
  slug           text not null unique,
  title          text not null,
  story          text,                       -- the narrative behind the piece
  occasion       text,                       -- e.g. bridal, owambe, evening, everyday
  silhouette     text,                       -- e.g. mermaid, a-line, boubou, suit
  colour_mood    text,                       -- e.g. earth, jewel, pastel, monochrome
  price_from     numeric(12,2),              -- optional "starting from"
  currency       text not null default 'NGN',
  turnaround_days int,
  tryon_garment_url text,                    -- clean garment image for AI try-on
  featured       boolean not null default false,
  published      boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create type media_stage as enum ('sketch', 'fabric', 'fitting', 'final', 'detail');

create table look_media (
  id         uuid primary key default gen_random_uuid(),
  look_id    uuid not null references looks(id) on delete cascade,
  stage      media_stage not null,
  url        text not null,
  alt        text not null,                  -- required for accessibility
  sort_order int not null default 0
);
create index on look_media (look_id, stage, sort_order);

create table fabrics (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,                 -- e.g. Mikado silk, Adire, Lace
  swatch_url  text not null,
  description text
);

create table look_fabrics (
  look_id   uuid references looks(id) on delete cascade,
  fabric_id uuid references fabrics(id) on delete cascade,
  primary key (look_id, fabric_id)
);

create table look_tags (
  look_id uuid references looks(id) on delete cascade,
  tag     text not null,
  primary key (look_id, tag)
);
create index on look_tags (tag);

-- ───────── Bookings ─────────

create type booking_status as enum
  ('new', 'contacted', 'fitting_booked', 'in_progress', 'delivered', 'cancelled');

create type fit_option as enum ('in_person_fitting', 'send_measurements', 'unsure');

create table bookings (
  id              uuid primary key default gen_random_uuid(),
  reference       text not null unique,      -- short human code, e.g. OA-7K3P
  full_name       text not null,
  email           text,
  phone           text not null,             -- WhatsApp number
  preferred_contact text not null default 'whatsapp', -- whatsapp | email | call
  occasion        text,
  event_date      date,
  fit             fit_option not null default 'unsure',
  measurements    jsonb,                     -- guided fields when sent online
  budget_range    text,
  delivery        text,                      -- pickup | delivery
  notes           text,
  style_finder    jsonb,                     -- quiz answers, if any
  status          booking_status not null default 'new',
  admin_notes     text,
  email_sent_at   timestamptz,               -- null = retry needed
  created_at      timestamptz not null default now()
);
create index on bookings (status, created_at desc);

create table booking_looks (
  booking_id uuid references bookings(id) on delete cascade,
  look_id    uuid references looks(id) on delete set null,
  primary key (booking_id, look_id)
);

create table booking_attachments (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  kind       text not null,                  -- inspiration | tryon
  url        text not null,
  created_at timestamptz not null default now()
);

-- ───────── Social proof ─────────

create table testimonials (
  id          uuid primary key default gen_random_uuid(),
  look_id     uuid references looks(id) on delete set null,
  client_name text not null,
  quote       text,
  photo_url   text,
  occasion    text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ───────── AI try-on log (rate limiting; no photos stored) ─────────

create table tryon_jobs (
  id          uuid primary key default gen_random_uuid(),
  look_id     uuid references looks(id) on delete set null,
  ip_hash     text not null,                 -- hashed, for rate limiting only
  status      text not null,                 -- queued | done | failed
  duration_ms int,
  created_at  timestamptz not null default now()
);
create index on tryon_jobs (ip_hash, created_at desc);
