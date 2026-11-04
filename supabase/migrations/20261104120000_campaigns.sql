-- Solar Radar: campaigns, leads and a DB-enforced lead pipeline.
-- Single demo installer, no login. Reads are public via RLS SELECT policies;
-- there are NO insert/update/delete policies: every write goes through the two
-- security-definer functions below, so the status gate cannot be bypassed.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  center_lat double precision,
  center_lon double precision,
  radius_m int check (radius_m in (100, 200, 350)),
  verdict text not null,
  stats jsonb not null,
  assumptions jsonb not null,
  flight_date text,
  created_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  roof_id int,
  lat double precision,
  lon double precision,
  area_m2 numeric,
  kwp numeric,
  kwh_yr numeric,
  eur_yr numeric,
  segment text,
  status text not null default 'to_visit'
    check (status in ('to_visit', 'visited', 'quoted', 'won', 'lost')),
  updated_at timestamptz not null default now()
);
create index leads_campaign_id_idx on public.leads (campaign_id);

create table public.lead_events (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  created_at timestamptz not null default now()
);
create index lead_events_lead_id_idx on public.lead_events (lead_id);

alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

-- Explicit table grants: read-only for API roles (writes only via functions).
revoke all on public.campaigns, public.leads, public.lead_events from anon, authenticated;
grant select on public.campaigns, public.leads, public.lead_events to anon, authenticated;

create policy "campaigns are readable" on public.campaigns
  for select to anon, authenticated using (true);
create policy "leads are readable" on public.leads
  for select to anon, authenticated using (true);
create policy "lead events are readable" on public.lead_events
  for select to anon, authenticated using (true);

-- The pipeline gate: to_visit -> visited -> quoted -> won | lost. Nothing else.
create or replace function public.advance_lead(p_lead uuid, p_to text, p_note text default null)
returns public.leads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
  v_from text;
begin
  select * into v_lead from public.leads where id = p_lead for update;
  if not found then
    raise exception 'lead % not found', p_lead using errcode = 'P0002';
  end if;
  v_from := v_lead.status;

  if not (
       (v_from = 'to_visit' and p_to = 'visited')
    or (v_from = 'visited'  and p_to = 'quoted')
    or (v_from = 'quoted'   and p_to in ('won', 'lost'))
  ) then
    raise exception 'illegal transition: % -> % (allowed: to_visit -> visited -> quoted -> won | lost)',
      v_from, coalesce(p_to, 'null')
      using errcode = 'P0001';
  end if;

  update public.leads
     set status = p_to, updated_at = now()
   where id = p_lead
  returning * into v_lead;

  insert into public.lead_events (lead_id, from_status, to_status, note)
  values (p_lead, v_from, p_to, nullif(btrim(p_note), ''));

  return v_lead;
end;
$$;

-- Atomic campaign + leads creation; every lead starts at to_visit with a 'created' event.
create or replace function public.create_campaign(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if coalesce(btrim(p->>'name'), '') = '' then
    raise exception 'campaign name is required';
  end if;
  if jsonb_typeof(coalesce(p->'leads', '[]'::jsonb)) <> 'array' then
    raise exception 'leads must be an array';
  end if;

  insert into public.campaigns (name, center_lat, center_lon, radius_m, verdict, stats, assumptions, flight_date)
  values (
    btrim(p->>'name'),
    (p->>'center_lat')::double precision,
    (p->>'center_lon')::double precision,
    (p->>'radius_m')::int,
    p->>'verdict',
    coalesce(p->'stats', '{}'::jsonb),
    coalesce(p->'assumptions', '{}'::jsonb),
    p->>'flight_date'
  )
  returning id into v_id;

  with ins as (
    insert into public.leads (campaign_id, roof_id, lat, lon, area_m2, kwp, kwh_yr, eur_yr, segment)
    select v_id,
           (l->>'roof_id')::int,
           (l->>'lat')::double precision,
           (l->>'lon')::double precision,
           (l->>'area_m2')::numeric,
           (l->>'kwp')::numeric,
           (l->>'kwh_yr')::numeric,
           (l->>'eur_yr')::numeric,
           l->>'segment'
      from jsonb_array_elements(coalesce(p->'leads', '[]'::jsonb)) as l
    returning id
  )
  insert into public.lead_events (lead_id, from_status, to_status, note)
  select id, null, 'to_visit', 'created' from ins;

  return v_id;
end;
$$;

-- Functions are executable by PUBLIC by default; lock down, then grant explicitly.
revoke execute on function public.advance_lead(uuid, text, text) from public;
revoke execute on function public.create_campaign(jsonb) from public;
grant execute on function public.advance_lead(uuid, text, text) to anon, authenticated;
grant execute on function public.create_campaign(jsonb) to anon, authenticated;
