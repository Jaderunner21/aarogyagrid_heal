-- =====================================================================
-- AarogyaGrid — 002_upgrade.sql   (run after db/base/01_schema.sql + 02_seed.sql)
--
-- Adds: national admin role, surge / outbreak detection, footfall-driven and
-- pooled forecasting, admin console (facilities, people, admin handover,
-- medicines, batches & expiry, audit log) and realtime.
--
-- Safe to run once on the existing database. New enum values are compared as
-- text (role::text = 'national_admin') inside this file because Postgres does
-- not allow using a freshly added enum value in the same transaction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. ENUM VALUES
-- ---------------------------------------------------------------------
alter type user_role  add value if not exists 'national_admin';
alter type alert_type add value if not exists 'demand_surge';
alter type alert_type add value if not exists 'expiry_risk';
alter type log_source add value if not exists 'wastage';

-- ---------------------------------------------------------------------
-- 1. COLUMNS ON EXISTING TABLES
-- ---------------------------------------------------------------------
alter table profiles  add column if not exists is_active      boolean not null default true;
alter table profiles  add column if not exists deactivated_at timestamptz;
alter table profiles  add column if not exists email          text;

alter table facilities add column if not exists opened_on date;

alter table medicines add column if not exists is_chronic    boolean not null default false;
alter table medicines add column if not exists status        text    not null default 'active';
alter table medicines add column if not exists status_date   date;
alter table medicines add column if not exists status_reason text;
alter table medicines add column if not exists stocked_at    facility_type[] not null default '{phc,chc,warehouse}';
do $$ begin
  alter table medicines add constraint medicines_status_check check (status in ('active', 'discontinued', 'withdrawn'));
exception when duplicate_object then null; end $$;

-- chronic medicines are forecast from their own history only (no footfall blend)
update medicines set is_chronic = true where name in ('Metformin 500mg', 'Amlodipine 5mg', 'Iron Folic Acid');

alter table forecasts add column if not exists footfall_weight    numeric;           -- 0..1 share of the footfall-based forecast
alter table forecasts add column if not exists seasonality_source text;              -- own | district | state | national
alter table forecasts add column if not exists surge              boolean not null default false;

alter table alerts add column if not exists facts jsonb;                             -- numbers behind the alert (for Gemini)

-- profile scope rule now allows a national admin with no facility/district/state
alter table profiles drop constraint if exists scope_matches_role;
alter table profiles add constraint scope_matches_role check (
  (role::text in ('phc_staff', 'warehouse_manager') and facility_id is not null) or
  (role::text = 'district_officer' and district_id is not null) or
  (role::text = 'state_admin'      and state_id    is not null) or
  (role::text = 'national_admin')
);

alter table ai_briefs drop constraint if exists ai_briefs_scope_type_check;
alter table ai_briefs add constraint ai_briefs_scope_type_check check (scope_type in ('district', 'state', 'national'));

-- keep emails on profiles for the People console
update profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- ---------------------------------------------------------------------
-- 2. SCOPE HELPERS (now national- and deactivation-aware)
-- ---------------------------------------------------------------------
create or replace function is_national() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role::text = 'national_admin' and is_active)
$$;

create or replace function can_view_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    join facilities f on f.id = fid
    join districts  d on d.id = f.district_id
    where p.id = auth.uid() and p.is_active
      and (
        (p.role::text in ('phc_staff', 'warehouse_manager') and p.facility_id = f.id) or
        (p.role::text = 'district_officer' and p.district_id = f.district_id) or
        (p.role::text = 'state_admin'      and p.state_id    = d.state_id) or
        (p.role::text = 'national_admin')
      )
  )
$$;

create or replace function can_write_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.is_active
      and p.role::text in ('phc_staff', 'warehouse_manager')
      and p.facility_id = fid
  )
$$;

create or replace function can_view_district(did uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join districts d on d.id = did
    where p.id = auth.uid() and p.is_active
      and ((p.role::text = 'district_officer' and p.district_id = did) or
           (p.role::text = 'state_admin' and p.state_id = d.state_id) or
           (p.role::text = 'national_admin'))
  )
$$;

-- admin of a state: its state admin, or any national admin
create or replace function is_admin_of_state(p_state uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.is_active
      and (p.role::text = 'national_admin' or (p.role::text = 'state_admin' and p.state_id = p_state))
  )
$$;

-- ---------------------------------------------------------------------
-- 3. AUDIT LOG
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_name  text,
  actor_role  text,
  action      text not null,                 -- e.g. facility.create, person.deactivate, admin.handover.accept
  entity_type text not null,                 -- facility | person | medicine | batch | handover | bed_change
  entity_id   text,
  entity_name text,
  state_id    uuid references states(id) on delete set null,  -- scope used for filtering (null = national)
  before      jsonb,
  after       jsonb,
  note        text
);
create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_state_idx on audit_log (state_id, at desc);
alter table audit_log enable row level security;
drop policy if exists read_audit on audit_log;
create policy read_audit on audit_log for select to authenticated
  using (is_national() or (state_id is not null and state_id = (me()).state_id and my_role()::text = 'state_admin'));

create or replace function log_audit(p_action text, p_entity_type text, p_entity_id text, p_entity_name text,
                                     p_state uuid, p_before jsonb, p_after jsonb, p_note text default null,
                                     p_actor uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := coalesce(p_actor, auth.uid()); v_name text; v_role text;
begin
  select full_name, role::text into v_name, v_role from profiles where id = v_actor;
  insert into audit_log (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, state_id, before, after, note)
  values (v_actor, coalesce(v_name, 'System'), v_role, p_action, p_entity_type, p_entity_id, p_entity_name, p_state, p_before, p_after, p_note);
end $$;
revoke execute on function log_audit(text, text, text, text, uuid, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant  execute on function log_audit(text, text, text, text, uuid, jsonb, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. NOTIFICATIONS (national admins + inactive users)
-- ---------------------------------------------------------------------
create or replace function notify_scope(p_facility uuid, p_roles user_role[], p_type text,
                                        p_title text, p_body text, p_ref_table text, p_ref_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_district uuid; v_state uuid;
begin
  select f.district_id, d.state_id into v_district, v_state
  from facilities f join districts d on d.id = f.district_id where f.id = p_facility;

  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  select p.id, p_type, p_title, p_body, p_ref_table, p_ref_id
  from profiles p
  where p.is_active
    and p.role = any (p_roles)
    and (
      (p.role::text in ('phc_staff', 'warehouse_manager') and p.facility_id = p_facility) or
      (p.role::text = 'district_officer' and p.district_id = v_district) or
      (p.role::text = 'state_admin'      and p.state_id    = v_state) or
      (p.role::text = 'national_admin')
    );
end $$;

create or replace function on_alert_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare v_fac text; v_med text; v_roles user_role[];
begin
  if new.severity = 'info' then return new; end if;
  select name into v_fac from facilities where id = new.facility_id;
  select name into v_med from medicines  where id = new.medicine_id;
  v_roles := array['phc_staff', 'warehouse_manager', 'district_officer']::user_role[];
  if new.type::text = 'demand_surge' and new.severity = 'critical' then
    v_roles := v_roles || array['state_admin']::user_role[];
  end if;
  perform notify_scope(new.facility_id, v_roles, 'alert',
    case when new.type::text = 'demand_surge' then 'Surge: ' when new.type::text = 'expiry_risk' then 'Expiry: '
         else initcap(new.severity::text) || ': ' end
      || coalesce(v_med, replace(new.type::text, '_', ' ')) || ' at ' || v_fac,
    new.message, 'alerts', new.id);
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. OUTBREAKS (3+ PHCs in a district surging on one medicine category)
-- ---------------------------------------------------------------------
create table if not exists outbreaks (
  id              uuid primary key default gen_random_uuid(),
  district_id     uuid not null references districts(id) on delete cascade,
  category        text not null,
  medicine_ids    uuid[] not null default '{}',
  facility_ids    uuid[] not null default '{}',
  status          text not null default 'open' check (status in ('open', 'resolved')),
  message         text not null,
  facts           jsonb,
  ai_summary      text,
  ai_generated_at timestamptz,
  detected_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create unique index if not exists outbreaks_one_open on outbreaks (district_id, category) where status = 'open';
alter table outbreaks enable row level security;
drop policy if exists read_outbreaks on outbreaks;
create policy read_outbreaks on outbreaks for select to authenticated using (can_view_district(district_id));

create or replace function on_outbreak_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare v_state uuid; v_name text;
begin
  select d.state_id, d.name into v_state, v_name from districts d where d.id = new.district_id;
  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  select p.id, 'alert', 'Possible outbreak — ' || new.category || ' in ' || v_name, new.message, 'outbreaks', new.id
  from profiles p
  where p.is_active and (
    (p.role::text = 'district_officer' and p.district_id = new.district_id) or
    (p.role::text = 'state_admin' and p.state_id = v_state) or
    (p.role::text = 'national_admin'));
  return new;
end $$;
drop trigger if exists trg_outbreak_notify on outbreaks;
create trigger trg_outbreak_notify after insert on outbreaks for each row execute function on_outbreak_insert();

-- ---------------------------------------------------------------------
-- 6. ENGINE INPUTS (service role only)
-- ---------------------------------------------------------------------
-- Same as engine_series, but outflow excludes wastage (write-offs are not demand) and wastage is separate.
create or replace function engine_series2(p_district uuid default null, p_days int default 425)
returns table (facility_id uuid, medicine_id uuid, facility_type facility_type, district_id uuid,
               resupply_days int, stock numeric, start_date date,
               used numeric[], received numeric[], outflow numeric[], wasted numeric[], reported boolean[])
language sql stable security definer set search_path = public as $$
  with days as (
    select d::date as day from generate_series(current_date - p_days, current_date - 1, interval '1 day') d
  ),
  pairs as (
    select s.facility_id, s.medicine_id, f.type, f.district_id, f.resupply_days, s.quantity
    from stock s join facilities f on f.id = s.facility_id
    where f.is_active and (p_district is null or f.district_id = p_district)
  ),
  agg as (
    select l.facility_id, l.medicine_id, l.log_date,
           sum(l.qty_used) as used, sum(l.qty_received) as received,
           sum(case when l.source::text = 'wastage' then 0 else l.qty_out end) as outflow,
           sum(case when l.source::text = 'wastage' then l.qty_out else 0 end) as wasted
    from stock_log l
    where l.log_date >= current_date - p_days and l.log_date < current_date
      and (p_district is null or l.facility_id in (select id from facilities where district_id = p_district))
    group by 1, 2, 3
  ),
  fac_days as (
    select distinct l.facility_id, l.log_date from stock_log l
    where l.log_date >= current_date - p_days and l.log_date < current_date
      and l.source::text <> 'wastage'
      and (p_district is null or l.facility_id in (select id from facilities where district_id = p_district))
  )
  select p.facility_id, p.medicine_id, p.type, p.district_id, p.resupply_days, p.quantity,
         current_date - p_days,
         array_agg(coalesce(a.used, 0)     order by dy.day),
         array_agg(coalesce(a.received, 0) order by dy.day),
         array_agg(coalesce(a.outflow, 0)  order by dy.day),
         array_agg(coalesce(a.wasted, 0)   order by dy.day),
         array_agg(fd.facility_id is not null order by dy.day)
  from pairs p
  cross join days dy
  left join agg a on a.facility_id = p.facility_id and a.medicine_id = p.medicine_id and a.log_date = dy.day
  left join fac_days fd on fd.facility_id = p.facility_id and fd.log_date = dy.day
  group by p.facility_id, p.medicine_id, p.type, p.district_id, p.resupply_days, p.quantity
$$;
revoke execute on function engine_series2(uuid, int) from public, anon, authenticated;
grant  execute on function engine_series2(uuid, int) to service_role;

-- Daily footfall per PHC, oldest -> yesterday (reported = a daily report exists).
create or replace function engine_footfall(p_district uuid default null, p_days int default 425)
returns table (facility_id uuid, district_id uuid, total_beds int, start_date date,
               footfall numeric[], occupied numeric[], reported boolean[])
language sql stable security definer set search_path = public as $$
  with days as (
    select d::date as day from generate_series(current_date - p_days, current_date - 1, interval '1 day') d
  )
  select f.id, f.district_id, f.total_beds, current_date - p_days,
         array_agg(coalesce(r.footfall, 0)::numeric order by dy.day),
         array_agg(coalesce(r.occupied_beds, 0)::numeric order by dy.day),
         array_agg(r.facility_id is not null order by dy.day)
  from facilities f
  cross join days dy
  left join daily_reports r on r.facility_id = f.id and r.report_date = dy.day
  where f.is_active and f.type <> 'warehouse' and (p_district is null or f.district_id = p_district)
  group by f.id, f.district_id, f.total_beds
$$;
revoke execute on function engine_footfall(uuid, int) from public, anon, authenticated;
grant  execute on function engine_footfall(uuid, int) to service_role;

-- Seasonal patterns pooled across facilities (for facilities with < 1 year of history).
create table if not exists seasonal_profiles (
  level       text not null check (level in ('district', 'state', 'national')),
  scope_id    uuid not null,                       -- district / state id; 00000000-… for national
  medicine_id uuid not null references medicines(id) on delete cascade,
  ratio       numeric not null,                    -- year-over-year change going into the next 30 days
  n           int not null,                        -- facilities pooled
  computed_on date not null default current_date,
  primary key (level, scope_id, medicine_id)
);
alter table seasonal_profiles enable row level security;
drop policy if exists read_seasonal on seasonal_profiles;
create policy read_seasonal on seasonal_profiles for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 7. BEDS WITH AN EFFECTIVE DATE
-- ---------------------------------------------------------------------
create table if not exists facility_bed_changes (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references facilities(id) on delete cascade,
  total_beds     int  not null check (total_beds >= 0),
  effective_from date not null,
  applied_at     timestamptz,
  changed_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);
alter table facility_bed_changes enable row level security;
drop policy if exists read_bed_changes on facility_bed_changes;
create policy read_bed_changes on facility_bed_changes for select to authenticated using (can_view_facility(facility_id));

create or replace function apply_due_bed_changes() returns int
language plpgsql security definer set search_path = public as $$
declare c record; n int := 0;
begin
  for c in select * from facility_bed_changes where applied_at is null and effective_from <= current_date order by effective_from, created_at loop
    update facilities set total_beds = c.total_beds where id = c.facility_id;
    update facility_bed_changes set applied_at = now() where id = c.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function apply_due_bed_changes() from public, anon, authenticated;
grant  execute on function apply_due_bed_changes() to service_role;

-- ---------------------------------------------------------------------
-- 8. BATCHES & EXPIRY (stock issued oldest-expiry first)
-- ---------------------------------------------------------------------
create table if not exists stock_batches (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete cascade,
  batch_no    text not null,
  expiry_date date not null,
  qty         numeric not null default 0 check (qty >= 0),
  status      text not null default 'active' check (status in ('active', 'written_off')),
  received_on date not null default current_date,
  created_at  timestamptz not null default now(),
  unique (facility_id, medicine_id, batch_no)
);
create index if not exists stock_batches_fefo on stock_batches (facility_id, medicine_id, expiry_date);
create index if not exists stock_batches_expiry on stock_batches (expiry_date) where qty > 0;
alter table stock_batches enable row level security;
drop policy if exists read_batches on stock_batches;
create policy read_batches on stock_batches for select to authenticated using (can_view_facility(facility_id));

create table if not exists batch_movements (
  id           bigint generated always as identity primary key,
  stock_log_id bigint not null references stock_log(id) on delete cascade,
  batch_id     uuid   not null references stock_batches(id) on delete cascade,
  qty          numeric not null,          -- negative = out of the batch, positive = into it
  created_at   timestamptz not null default now()
);
create index if not exists batch_movements_log on batch_movements (stock_log_id);
alter table batch_movements enable row level security;
drop policy if exists read_batch_movements on batch_movements;
create policy read_batch_movements on batch_movements for select to authenticated
  using (exists (select 1 from stock_batches b where b.id = batch_id and can_view_facility(b.facility_id)));

create or replace function apply_batches() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_out numeric := new.qty_used + new.qty_out;
  v_left numeric; v_take numeric; v_sent numeric; v_done numeric := 0; v_part numeric;
  b record; m record; v_batch uuid; v_n int; v_i int := 0;
begin
  if coalesce(current_setting('heal.skip_stock_trigger', true), 'off') = 'on' then return new; end if;

  -- OUT: a write-off of one specific batch, or oldest-expiry-first for everything else
  if new.source::text = 'wastage' and new.ref_id is not null then
    update stock_batches set qty = greatest(qty - new.qty_out, 0),
           status = case when qty - new.qty_out <= 0 then 'written_off' else status end
     where id = new.ref_id;
    if found then insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, new.ref_id, -new.qty_out); end if;
  elsif v_out > 0 then
    v_left := v_out;
    for b in select * from stock_batches
             where facility_id = new.facility_id and medicine_id = new.medicine_id and status = 'active' and qty > 0
             order by expiry_date, received_on, batch_no for update loop
      v_take := least(b.qty, v_left);
      update stock_batches set qty = qty - v_take where id = b.id;
      insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, b.id, -v_take);
      v_left := v_left - v_take;
      exit when v_left <= 0;
    end loop;
  end if;

  -- IN: a transfer/indent receipt carries the sender's batches; any other receipt becomes a dated batch
  if new.qty_received > 0 then
    v_sent := 0;
    if new.ref_id is not null and new.source::text in ('transfer', 'indent') then
      select coalesce(sum(-bm.qty), 0), count(distinct bm.batch_id) into v_sent, v_n
      from batch_movements bm join stock_log l on l.id = bm.stock_log_id
      where l.ref_id = new.ref_id and l.qty_out > 0 and bm.qty < 0;
    end if;
    if v_sent > 0 then
      for m in select sb.batch_no, sb.expiry_date, sum(-bm.qty) as q
               from batch_movements bm
               join stock_log l on l.id = bm.stock_log_id
               join stock_batches sb on sb.id = bm.batch_id
               where l.ref_id = new.ref_id and l.qty_out > 0 and bm.qty < 0
               group by sb.batch_no, sb.expiry_date order by sb.expiry_date loop
        v_i := v_i + 1;
        v_part := case when v_i = v_n then new.qty_received - v_done else round(m.q * new.qty_received / v_sent) end;
        continue when v_part <= 0;
        v_done := v_done + v_part;
        insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
        values (new.facility_id, new.medicine_id, m.batch_no, m.expiry_date, v_part, new.log_date)
        on conflict (facility_id, medicine_id, batch_no)
          do update set qty = stock_batches.qty + excluded.qty, status = 'active'
        returning id into v_batch;
        insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, v_batch, v_part);
      end loop;
    else
      insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
      values (new.facility_id, new.medicine_id, 'RCV-' || to_char(new.log_date, 'YYYYMMDD'), new.log_date + 540, new.qty_received, new.log_date)
      on conflict (facility_id, medicine_id, batch_no)
        do update set qty = stock_batches.qty + excluded.qty, status = 'active'
      returning id into v_batch;
      insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, v_batch, new.qty_received);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_log_batches on stock_log;
create trigger trg_stock_log_batches after insert on stock_log for each row execute function apply_batches();

-- Write off every expired batch as wastage (engine / cron, service role).
create or replace function write_off_expired() returns int
language plpgsql security definer set search_path = public as $$
declare b record; n int := 0;
begin
  for b in select * from stock_batches where status = 'active' and qty > 0 and expiry_date < current_date loop
    insert into stock_log (facility_id, medicine_id, qty_out, source, ref_id, note)
    values (b.facility_id, b.medicine_id, b.qty, 'wastage', b.id, 'Expired batch ' || b.batch_no || ' written off');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function write_off_expired() from public, anon, authenticated;
grant  execute on function write_off_expired() to service_role;

-- ---------------------------------------------------------------------
-- 9. ADMIN HANDOVERS
-- ---------------------------------------------------------------------
create table if not exists admin_handovers (
  id               uuid primary key default gen_random_uuid(),
  scope_type       text not null check (scope_type in ('state', 'national')),
  scope_id         uuid references states(id) on delete cascade,     -- null for national
  from_user        uuid not null references profiles(id) on delete cascade,
  to_user          uuid not null references auth.users(id) on delete cascade,
  to_name          text,
  to_email         text,
  old_admin_action text not null check (old_admin_action in ('demote', 'deactivate')),
  demote_role      user_role,
  demote_facility  uuid references facilities(id),
  demote_district  uuid references districts(id),
  demote_state     uuid references states(id),
  status           text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create unique index if not exists admin_handovers_one_pending on admin_handovers (from_user) where status = 'pending';
alter table admin_handovers enable row level security;
drop policy if exists read_handovers on admin_handovers;
create policy read_handovers on admin_handovers for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid() or is_national()
         or (scope_type = 'state' and is_admin_of_state(scope_id)));

-- There must always be one active admin per state (once it has one) and one national admin.
create or replace function ensure_admin_coverage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_active and old.role::text = 'state_admin' and old.state_id is not null then
    if not exists (select 1 from profiles where role::text = 'state_admin' and is_active and state_id = old.state_id) then
      raise exception 'Every state needs at least one active state admin. Hand over the role first.' using errcode = 'P0001';
    end if;
  end if;
  if old.is_active and old.role::text = 'national_admin' then
    if not exists (select 1 from profiles where role::text = 'national_admin' and is_active) then
      raise exception 'There must always be one active national admin. Hand over the role first.' using errcode = 'P0001';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_admin_coverage on profiles;
create constraint trigger trg_admin_coverage after update or delete on profiles
  deferrable initially deferred for each row execute function ensure_admin_coverage();

-- ---------------------------------------------------------------------
-- 10. ADMIN FUNCTIONS (scoped, every change audited)
-- ---------------------------------------------------------------------
create or replace function admin_state_of_district(p_district uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select state_id from districts where id = p_district
$$;

-- ---- facilities ------------------------------------------------------
create or replace function admin_save_facility(
  p_id uuid, p_district uuid, p_type facility_type, p_name text, p_code text,
  p_lat double precision, p_lng double precision, p_address text default null,
  p_total_beds int default 0, p_resupply_days int default 7,
  p_supplying_warehouse uuid default null, p_opened_on date default null)
returns facilities language plpgsql security definer set search_path = public as $$
declare f facilities; v_old facilities; v_state uuid := admin_state_of_district(p_district); w facilities;
begin
  if v_state is null then raise exception 'District not found'; end if;
  if not is_admin_of_state(v_state) then raise exception 'Only an admin of this state can manage its facilities'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_code), '') = '' then raise exception 'Name and code are required'; end if;
  if p_lat not between 6 and 38 or p_lng not between 68 and 98 then raise exception 'Coordinates must be inside India'; end if;
  if p_supplying_warehouse is not null then
    select * into w from facilities where id = p_supplying_warehouse;
    if w.id is null or w.type <> 'warehouse' then raise exception 'The supplying facility must be a warehouse'; end if;
    if admin_state_of_district(w.district_id) <> v_state then raise exception 'The supplying warehouse must be in the same state'; end if;
  end if;

  if p_id is null then
    insert into facilities (district_id, type, name, code, lat, lng, address, total_beds, resupply_days, supplying_warehouse, opened_on)
    values (p_district, p_type, trim(p_name), upper(trim(p_code)), p_lat, p_lng, p_address, coalesce(p_total_beds, 0),
            coalesce(p_resupply_days, 7), case when p_type = 'warehouse' then null else p_supplying_warehouse end,
            coalesce(p_opened_on, current_date))
    returning * into f;
    -- stock lines for every active medicine this facility type holds
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from medicines m where m.status = 'active' and f.type = any (m.stocked_at)
    on conflict do nothing;
    perform log_audit('facility.create', 'facility', f.id::text, f.name, v_state, null, to_jsonb(f));
  else
    select * into v_old from facilities where id = p_id for update;
    if v_old.id is null then raise exception 'Facility not found'; end if;
    if not is_admin_of_state(admin_state_of_district(v_old.district_id)) then raise exception 'Not allowed to edit this facility'; end if;
    update facilities set district_id = p_district, type = p_type, name = trim(p_name), code = upper(trim(p_code)),
           lat = p_lat, lng = p_lng, address = p_address, resupply_days = coalesce(p_resupply_days, resupply_days),
           supplying_warehouse = case when p_type = 'warehouse' then null else p_supplying_warehouse end,
           opened_on = coalesce(p_opened_on, opened_on)
     where id = p_id returning * into f;
    perform log_audit(case when v_old.supplying_warehouse is distinct from f.supplying_warehouse
                           then 'facility.change_warehouse' else 'facility.update' end,
                      'facility', f.id::text, f.name, v_state, to_jsonb(v_old), to_jsonb(f));
  end if;
  return f;
exception when unique_violation then
  raise exception 'Facility code % is already used', upper(trim(p_code));
end $$;

create or replace function admin_set_facility_active(p_id uuid, p_active boolean, p_reason text default null)
returns facilities language plpgsql security definer set search_path = public as $$
declare f facilities; v_old facilities; v_state uuid;
begin
  select * into v_old from facilities where id = p_id for update;
  if v_old.id is null then raise exception 'Facility not found'; end if;
  v_state := admin_state_of_district(v_old.district_id);
  if not is_admin_of_state(v_state) then raise exception 'Not allowed to change this facility'; end if;
  if not p_active and v_old.type = 'warehouse'
     and exists (select 1 from facilities where supplying_warehouse = p_id and is_active) then
    raise exception 'PHCs are still supplied by this warehouse. Change their supplying warehouse first.';
  end if;
  if not p_active and exists (select 1 from transfers where (from_facility_id = p_id or to_facility_id = p_id) and status in ('approved', 'dispatched')) then
    raise exception 'This facility has transfers in progress. Finish or reject them first.';
  end if;
  update facilities set is_active = p_active where id = p_id returning * into f;
  perform log_audit(case when p_active then 'facility.reactivate' else 'facility.deactivate' end,
                    'facility', f.id::text, f.name, v_state, jsonb_build_object('is_active', v_old.is_active),
                    jsonb_build_object('is_active', f.is_active), p_reason);
  return f;
end $$;

create or replace function admin_change_beds(p_id uuid, p_total_beds int, p_effective date default current_date)
returns facility_bed_changes language plpgsql security definer set search_path = public as $$
declare f facilities; c facility_bed_changes; v_state uuid;
begin
  select * into f from facilities where id = p_id;
  if f.id is null then raise exception 'Facility not found'; end if;
  v_state := admin_state_of_district(f.district_id);
  if not is_admin_of_state(v_state) then raise exception 'Not allowed to change this facility'; end if;
  if p_total_beds < 0 then raise exception 'Beds cannot be negative'; end if;
  insert into facility_bed_changes (facility_id, total_beds, effective_from, changed_by)
  values (p_id, p_total_beds, coalesce(p_effective, current_date), auth.uid()) returning * into c;
  if c.effective_from <= current_date then
    update facilities set total_beds = p_total_beds where id = p_id;
    update facility_bed_changes set applied_at = now() where id = c.id returning * into c;
  end if;
  perform log_audit('facility.change_beds', 'bed_change', f.id::text, f.name, v_state,
                    jsonb_build_object('total_beds', f.total_beds),
                    jsonb_build_object('total_beds', p_total_beds, 'effective_from', c.effective_from));
  return c;
end $$;

-- rows: [{district_code, type, name, code, lat, lng, address, total_beds, resupply_days, supplying_warehouse_code}]
create or replace function admin_import_facilities(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_district uuid; v_wh uuid; v_existing uuid; n int := 0; i int := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    select id into v_district from districts where code = upper(trim(r->>'district_code'));
    if v_district is null then raise exception 'Row %: unknown district code %', i, r->>'district_code'; end if;
    v_wh := null;
    if coalesce(r->>'supplying_warehouse_code', '') <> '' then
      select id into v_wh from facilities where code = upper(trim(r->>'supplying_warehouse_code')) and type = 'warehouse';
      if v_wh is null then raise exception 'Row %: unknown warehouse code %', i, r->>'supplying_warehouse_code'; end if;
    end if;
    select id into v_existing from facilities where code = upper(trim(r->>'code'));
    begin
      perform admin_save_facility(v_existing, v_district, (r->>'type')::facility_type, r->>'name', r->>'code',
        (r->>'lat')::double precision, (r->>'lng')::double precision, nullif(r->>'address', ''),
        coalesce(nullif(r->>'total_beds', '')::int, 0), coalesce(nullif(r->>'resupply_days', '')::int, 7), v_wh, null);
    exception when others then
      raise exception 'Row % (%): %', i, r->>'code', sqlerrm;
    end;
    n := n + 1;
  end loop;
  perform log_audit('facility.import', 'facility', null, n || ' facilities',
                    (select state_id from districts where code = upper(trim(p_rows->0->>'district_code'))), null,
                    jsonb_build_object('rows', n));
  return n;
end $$;

-- ---- medicines (national catalogue) -----------------------------------
create or replace function admin_save_medicine(
  p_id uuid, p_name text, p_generic text, p_strength text, p_unit text, p_category text,
  p_is_chronic boolean default false, p_stocked_at facility_type[] default '{phc,chc,warehouse}')
returns medicines language plpgsql security definer set search_path = public as $$
declare m medicines; v_old medicines;
begin
  if not is_national() then raise exception 'The medicine catalogue is managed by the national admin'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_unit), '') = '' then raise exception 'Name and unit are required'; end if;
  if p_id is null then
    insert into medicines (name, generic_name, strength, unit, category, is_chronic, stocked_at)
    values (trim(p_name), p_generic, p_strength, trim(p_unit), trim(p_category), coalesce(p_is_chronic, false), p_stocked_at)
    returning * into m;
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from facilities f where f.is_active and f.type = any (m.stocked_at)
    on conflict do nothing;
    perform log_audit('medicine.create', 'medicine', m.id::text, m.name, null, null, to_jsonb(m));
  else
    select * into v_old from medicines where id = p_id for update;
    if v_old.id is null then raise exception 'Medicine not found'; end if;
    update medicines set name = trim(p_name), generic_name = p_generic, strength = p_strength, unit = trim(p_unit),
           category = trim(p_category), is_chronic = coalesce(p_is_chronic, is_chronic), stocked_at = p_stocked_at
     where id = p_id returning * into m;
    -- newly covered facility types get a stock line
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from facilities f where f.is_active and f.type = any (m.stocked_at)
    on conflict do nothing;
    perform log_audit('medicine.update', 'medicine', m.id::text, m.name, null, to_jsonb(v_old), to_jsonb(m));
  end if;
  return m;
exception when unique_violation then
  raise exception 'A medicine called % already exists', trim(p_name);
end $$;

create or replace function admin_set_medicine_status(p_id uuid, p_status text, p_date date default current_date, p_reason text default null)
returns medicines language plpgsql security definer set search_path = public as $$
declare m medicines; v_old medicines;
begin
  if not is_national() then raise exception 'The medicine catalogue is managed by the national admin'; end if;
  if p_status not in ('active', 'discontinued', 'withdrawn') then raise exception 'Unknown status %', p_status; end if;
  if p_status <> 'active' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
  select * into v_old from medicines where id = p_id for update;
  if v_old.id is null then raise exception 'Medicine not found'; end if;
  update medicines set status = p_status, status_date = case when p_status = 'active' then null else coalesce(p_date, current_date) end,
         status_reason = case when p_status = 'active' then null else p_reason end
   where id = p_id returning * into m;
  if p_status <> 'active' then
    -- stop the pipeline: pending recommendations and indents for it are cancelled
    update transfers set status = 'cancelled', rejected_reason = 'Medicine ' || p_status || ': ' || p_reason
     where medicine_id = p_id and status = 'proposed';
    update indents set status = 'cancelled', rejected_reason = 'Medicine ' || p_status || ': ' || p_reason
     where medicine_id = p_id and status = 'submitted';
  end if;
  perform log_audit('medicine.' || p_status, 'medicine', m.id::text, m.name, null,
                    jsonb_build_object('status', v_old.status), jsonb_build_object('status', m.status, 'date', m.status_date, 'reason', m.status_reason),
                    p_reason);
  return m;
end $$;

-- ---- batches -----------------------------------------------------------
-- Register a batch for stock already on the shelf (cannot exceed untracked stock).
create or replace function admin_add_batch(p_facility uuid, p_medicine uuid, p_batch_no text, p_expiry date, p_qty numeric)
returns stock_batches language plpgsql security definer set search_path = public as $$
declare b stock_batches; v_stock numeric; v_tracked numeric; v_state uuid; f facilities;
begin
  select * into f from facilities where id = p_facility;
  if f.id is null then raise exception 'Facility not found'; end if;
  v_state := admin_state_of_district(f.district_id);
  if not (is_admin_of_state(v_state) or can_write_facility(p_facility)) then raise exception 'Not allowed for this facility'; end if;
  if coalesce(trim(p_batch_no), '') = '' or p_expiry is null or p_qty <= 0 then raise exception 'Batch number, expiry and a positive quantity are required'; end if;
  select coalesce(quantity, 0) into v_stock from stock where facility_id = p_facility and medicine_id = p_medicine;
  select coalesce(sum(qty), 0) into v_tracked from stock_batches where facility_id = p_facility and medicine_id = p_medicine and status = 'active';
  if p_qty > coalesce(v_stock, 0) - v_tracked then
    raise exception 'Only % units are not yet in a batch', greatest(coalesce(v_stock, 0) - v_tracked, 0);
  end if;
  insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty)
  values (p_facility, p_medicine, upper(trim(p_batch_no)), p_expiry, p_qty)
  on conflict (facility_id, medicine_id, batch_no) do update set qty = stock_batches.qty + excluded.qty, status = 'active'
  returning * into b;
  perform log_audit('batch.register', 'batch', b.id::text, b.batch_no, v_state, null, to_jsonb(b));
  return b;
end $$;

create or replace function admin_write_off_batch(p_batch uuid, p_reason text)
returns stock_batches language plpgsql security definer set search_path = public as $$
declare b stock_batches; v_old stock_batches; v_state uuid; f facilities;
begin
  select * into v_old from stock_batches where id = p_batch for update;
  if v_old.id is null then raise exception 'Batch not found'; end if;
  select * into f from facilities where id = v_old.facility_id;
  v_state := admin_state_of_district(f.district_id);
  if not (is_admin_of_state(v_state) or can_write_facility(f.id)) then raise exception 'Not allowed for this facility'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
  if v_old.qty <= 0 then raise exception 'This batch is already empty'; end if;
  insert into stock_log (facility_id, medicine_id, qty_out, source, ref_id, note, created_by)
  values (v_old.facility_id, v_old.medicine_id, v_old.qty, 'wastage', v_old.id, 'Write-off ' || v_old.batch_no || ': ' || p_reason, auth.uid());
  select * into b from stock_batches where id = p_batch;
  perform log_audit('batch.write_off', 'batch', b.id::text, b.batch_no, v_state, to_jsonb(v_old), to_jsonb(b), p_reason);
  return b;
end $$;

-- ---- people ------------------------------------------------------------
-- Can the caller give someone this role and scope?
create or replace function admin_can_manage(p_role text, p_facility uuid, p_district uuid, p_state uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_state uuid := p_state;
begin
  if p_facility is not null then select d.state_id into v_state from facilities f join districts d on d.id = f.district_id where f.id = p_facility;
  elsif p_district is not null then v_state := admin_state_of_district(p_district); end if;
  if p_role = 'national_admin' then return is_national(); end if;
  if v_state is null then return false; end if;
  return is_admin_of_state(v_state);
end $$;

create or replace function scope_state(p profiles) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(p.state_id,
                  (select state_id from districts where id = p.district_id),
                  (select d.state_id from facilities f join districts d on d.id = f.district_id where f.id = p.facility_id))
$$;

-- Edit or reassign a person (not for admin roles: those go through handover / admin_set_state_admin).
create or replace function admin_update_person(p_id uuid, p_full_name text, p_phone text, p_role user_role,
                                               p_facility uuid default null, p_district uuid default null, p_state uuid default null)
returns profiles language plpgsql security definer set search_path = public as $$
declare v_old profiles; p profiles;
begin
  select * into v_old from profiles where id = p_id for update;
  if v_old.id is null then raise exception 'Person not found'; end if;
  if v_old.role::text in ('state_admin', 'national_admin') or p_role::text in ('state_admin', 'national_admin') then
    raise exception 'Admin roles change through the Admins tab (handover)';
  end if;
  if not admin_can_manage(v_old.role::text, v_old.facility_id, v_old.district_id, v_old.state_id) then raise exception 'This person is outside your scope'; end if;
  if not admin_can_manage(p_role::text, p_facility, p_district, p_state) then raise exception 'The new assignment is outside your scope'; end if;
  update profiles set full_name = coalesce(nullif(trim(p_full_name), ''), full_name), phone = p_phone, role = p_role,
         facility_id = case when p_role::text in ('phc_staff', 'warehouse_manager') then p_facility end,
         district_id = case when p_role::text = 'district_officer' then p_district end,
         state_id    = null   -- filled from the facility / district by trg_profile_scope
   where id = p_id returning * into p;
  perform log_audit(case when v_old.facility_id is distinct from p.facility_id or v_old.district_id is distinct from p.district_id
                         or v_old.role <> p.role then 'person.reassign' else 'person.update' end,
                    'person', p.id::text, p.full_name, scope_state(p),
                    jsonb_build_object('role', v_old.role, 'facility_id', v_old.facility_id, 'district_id', v_old.district_id, 'full_name', v_old.full_name, 'phone', v_old.phone),
                    jsonb_build_object('role', p.role, 'facility_id', p.facility_id, 'district_id', p.district_id, 'full_name', p.full_name, 'phone', p.phone));
  return p;
end $$;

create or replace function admin_set_person_active(p_id uuid, p_active boolean, p_reason text default null)
returns profiles language plpgsql security definer set search_path = public as $$
declare v_old profiles; p profiles;
begin
  select * into v_old from profiles where id = p_id for update;
  if v_old.id is null then raise exception 'Person not found'; end if;
  if p_id = auth.uid() then raise exception 'You cannot deactivate yourself. Hand over your role instead.'; end if;
  if not admin_can_manage(v_old.role::text, v_old.facility_id, v_old.district_id, v_old.state_id) then raise exception 'This person is outside your scope'; end if;
  update profiles set is_active = p_active, deactivated_at = case when p_active then null else now() end
   where id = p_id returning * into p;
  perform log_audit(case when p_active then 'person.reactivate' else 'person.deactivate' end, 'person', p.id::text, p.full_name, scope_state(p),
                    jsonb_build_object('is_active', v_old.is_active), jsonb_build_object('is_active', p.is_active), p_reason);
  return p;
end $$;

-- Called by the server (service role) after it creates the auth user for an invite.
create or replace function admin_create_profile(p_actor uuid, p_user uuid, p_email text, p_full_name text, p_role user_role,
                                                p_facility uuid default null, p_district uuid default null, p_state uuid default null)
returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  insert into profiles (id, full_name, role, facility_id, district_id, state_id, email)
  values (p_user, trim(p_full_name), p_role,
          case when p_role::text in ('phc_staff', 'warehouse_manager') then p_facility end,
          case when p_role::text = 'district_officer' then p_district end,
          case when p_role::text = 'state_admin' then p_state end,
          lower(trim(p_email)))
  returning * into p;
  perform log_audit('person.invite', 'person', p.id::text, p.full_name, scope_state(p), null,
                    jsonb_build_object('role', p.role, 'email', p.email, 'facility_id', p.facility_id, 'district_id', p.district_id, 'state_id', p.state_id),
                    null, p_actor);
  return p;
end $$;
revoke execute on function admin_create_profile(uuid, uuid, text, text, user_role, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function admin_create_profile(uuid, uuid, text, text, user_role, uuid, uuid, uuid) to service_role;

-- ---- admin handover ------------------------------------------------------
create or replace function request_admin_handover(
  p_to_user uuid, p_old_action text,
  p_demote_role user_role default null, p_demote_facility uuid default null,
  p_demote_district uuid default null, p_demote_state uuid default null)
returns admin_handovers language plpgsql security definer set search_path = public as $$
declare me_ profiles := me(); h admin_handovers; v_scope text; v_to profiles; v_email text;
begin
  if me_.id is null or not me_.is_active or me_.role::text not in ('state_admin', 'national_admin') then
    raise exception 'Only an admin can hand over an admin role';
  end if;
  if p_to_user = me_.id then raise exception 'Choose someone else as your successor'; end if;
  if p_old_action not in ('demote', 'deactivate') then raise exception 'Choose demote or deactivate'; end if;
  v_scope := case when me_.role::text = 'national_admin' then 'national' else 'state' end;
  select * into v_to from profiles where id = p_to_user;
  select email into v_email from auth.users where id = p_to_user;
  if v_email is null then raise exception 'Successor not found'; end if;
  if v_to.id is not null and not v_to.is_active then raise exception 'The successor is deactivated'; end if;
  if v_scope = 'state' and v_to.id is not null and scope_state(v_to) is distinct from me_.state_id then
    raise exception 'The successor must work in your state';
  end if;
  if p_old_action = 'demote' then
    if p_demote_role is null then raise exception 'Choose the role you will move to'; end if;
    if p_demote_role::text in ('state_admin', 'national_admin') and not (me_.role::text = 'national_admin' and p_demote_role::text = 'state_admin') then
      raise exception 'Choose a non-admin role to move to';
    end if;
  end if;
  insert into admin_handovers (scope_type, scope_id, from_user, to_user, to_name, to_email, old_admin_action,
                               demote_role, demote_facility, demote_district, demote_state)
  values (v_scope, case when v_scope = 'state' then me_.state_id end, me_.id, p_to_user, v_to.full_name, v_email, p_old_action,
          p_demote_role, p_demote_facility, p_demote_district, p_demote_state)
  returning * into h;
  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  select p_to_user, 'admin', 'You have been asked to take over as ' || case when v_scope = 'state' then 'state admin' else 'national admin' end,
         me_.full_name || ' wants to hand over the admin role to you. Open the Admin console to accept.', 'admin_handovers', h.id
  where v_to.id is not null;
  perform log_audit('admin.handover.request', 'handover', h.id::text, coalesce(v_to.full_name, v_email),
                    case when v_scope = 'state' then me_.state_id end, null, to_jsonb(h));
  return h;
exception when unique_violation then
  raise exception 'You already have a pending handover. Cancel it first.';
end $$;

create or replace function accept_admin_handover(p_id uuid, p_full_name text default null)
returns admin_handovers language plpgsql security definer set search_path = public as $$
declare h admin_handovers; v_from profiles; v_to profiles; v_role user_role;
begin
  select * into h from admin_handovers where id = p_id for update;
  if h.id is null or h.status <> 'pending' then raise exception 'This handover is no longer pending'; end if;
  if h.to_user <> auth.uid() then raise exception 'This handover is addressed to someone else'; end if;
  select * into v_from from profiles where id = h.from_user for update;
  v_role := (case when h.scope_type = 'state' then 'state_admin' else 'national_admin' end)::user_role;
  if not v_from.is_active or v_from.role <> v_role then
    raise exception 'The current admin no longer holds this role';
  end if;

  -- 1. successor becomes admin (a new invitee gets a profile now)
  select * into v_to from profiles where id = h.to_user for update;
  if v_to.id is null then
    insert into profiles (id, full_name, role, state_id, email)
    values (h.to_user, coalesce(nullif(trim(p_full_name), ''), h.to_name, split_part(h.to_email, '@', 1)), v_role,
            case when h.scope_type = 'state' then h.scope_id end, h.to_email);
  else
    update profiles set role = v_role, facility_id = null, district_id = null,
           state_id = case when h.scope_type = 'state' then h.scope_id end, is_active = true, deactivated_at = null
     where id = h.to_user;
  end if;

  -- 2. old admin is demoted or deactivated (the coverage check runs at commit)
  if h.old_admin_action = 'deactivate' then
    update profiles set is_active = false, deactivated_at = now() where id = h.from_user;
  else
    update profiles set role = h.demote_role,
           facility_id = case when h.demote_role::text in ('phc_staff', 'warehouse_manager') then h.demote_facility end,
           district_id = case when h.demote_role::text = 'district_officer' then h.demote_district end,
           state_id    = case when h.demote_role::text = 'state_admin' then coalesce(h.demote_state, v_from.state_id) end
     where id = h.from_user;
  end if;

  update admin_handovers set status = 'accepted', decided_at = now() where id = p_id returning * into h;
  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  values (h.from_user, 'admin', 'Admin handover accepted', coalesce(p_full_name, h.to_name, h.to_email) || ' is now the admin.', 'admin_handovers', h.id);
  perform log_audit('admin.handover.accept', 'handover', h.id::text, coalesce(h.to_name, h.to_email), h.scope_id,
                    jsonb_build_object('admin', h.from_user, 'old_admin_action', h.old_admin_action),
                    jsonb_build_object('admin', h.to_user, 'demoted_to', h.demote_role));
  return h;
end $$;

create or replace function decide_admin_handover(p_id uuid, p_decision text)
returns admin_handovers language plpgsql security definer set search_path = public as $$
declare h admin_handovers;
begin
  if p_decision not in ('declined', 'cancelled') then raise exception 'Unknown decision'; end if;
  select * into h from admin_handovers where id = p_id for update;
  if h.id is null or h.status <> 'pending' then raise exception 'This handover is no longer pending'; end if;
  if p_decision = 'declined' and h.to_user <> auth.uid() then raise exception 'Only the successor can decline'; end if;
  if p_decision = 'cancelled' and h.from_user <> auth.uid() and not is_national() then raise exception 'Only the current admin can cancel'; end if;
  update admin_handovers set status = p_decision, decided_at = now() where id = p_id returning * into h;
  perform log_audit('admin.handover.' || replace(p_decision, 'ed', ''), 'handover', h.id::text, coalesce(h.to_name, h.to_email), h.scope_id, null, to_jsonb(h));
  return h;
end $$;

-- national admin: make someone the state admin directly; optionally demote/deactivate a current one
create or replace function admin_set_state_admin(p_state uuid, p_user uuid, p_old_admin uuid default null,
                                                 p_old_action text default null, p_demote_role user_role default null,
                                                 p_demote_facility uuid default null, p_demote_district uuid default null)
returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles; v_old profiles; v_prev profiles;
begin
  if not is_national() then raise exception 'Only the national admin can assign state admins directly'; end if;
  select * into v_prev from profiles where id = p_user for update;
  if v_prev.id is null then raise exception 'Person not found (invite them first)'; end if;
  if v_prev.role::text = 'national_admin' then raise exception 'Use a handover to move the national admin'; end if;
  update profiles set role = 'state_admin', state_id = p_state, facility_id = null, district_id = null, is_active = true, deactivated_at = null
   where id = p_user returning * into p;
  if p_old_admin is not null then
    select * into v_old from profiles where id = p_old_admin for update;
    if v_old.role::text <> 'state_admin' or v_old.state_id <> p_state then raise exception 'The previous admin is not an admin of this state'; end if;
    if p_old_action = 'deactivate' then
      update profiles set is_active = false, deactivated_at = now() where id = p_old_admin;
    elsif p_old_action = 'demote' then
      if p_demote_role is null or p_demote_role::text in ('state_admin', 'national_admin') then raise exception 'Choose a non-admin role for the previous admin'; end if;
      update profiles set role = p_demote_role,
             facility_id = case when p_demote_role::text in ('phc_staff', 'warehouse_manager') then p_demote_facility end,
             district_id = case when p_demote_role::text = 'district_officer' then p_demote_district end,
             state_id = null
       where id = p_old_admin;
    end if;
  end if;
  perform log_audit('admin.assign_state_admin', 'person', p.id::text, p.full_name, p_state,
                    jsonb_build_object('role', v_prev.role, 'previous_admin', p_old_admin, 'previous_admin_action', p_old_action),
                    jsonb_build_object('role', p.role, 'state_id', p_state));
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 11. WORKFLOW FUNCTIONS: national admin + discontinued medicines
-- ---------------------------------------------------------------------
create or replace function approve_transfer(p_id uuid, p_carrier_type carrier_type,
                                            p_carrier_name text default null, p_carrier_contact text default null)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status <> 'proposed' then raise exception 'Only proposed transfers can be approved (current: %)', t.status; end if;
  if (select status from medicines where id = t.medicine_id) <> 'active' then raise exception 'This medicine is discontinued'; end if;
  p := me();
  if not p.is_active then raise exception 'Your account is deactivated'; end if;
  if p.role::text = 'national_admin' then
    null;  -- national admin can approve anywhere
  elsif t.is_cross_district then
    if not (p.role = 'state_admin' and p.state_id = facility_state(t.to_facility_id)) then
      raise exception 'Cross-district transfers are approved by the state admin';
    end if;
  else
    if not (p.role = 'district_officer' and p.district_id = facility_district(t.from_facility_id)) then
      raise exception 'Only the district officer can approve this transfer';
    end if;
  end if;
  update transfers set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         carrier_type = p_carrier_type, carrier_name = p_carrier_name, carrier_contact = p_carrier_contact
  where id = p_id returning * into t;
  return t;
end $$;

create or replace function reject_transfer(p_id uuid, p_reason text)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status not in ('proposed', 'approved') then raise exception 'Cannot reject a % transfer', t.status; end if;
  p := me();
  if not ((p.role = 'district_officer' and p.district_id in (facility_district(t.from_facility_id), facility_district(t.to_facility_id)))
       or (p.role = 'state_admin' and p.state_id = facility_state(t.to_facility_id))
       or p.role::text = 'national_admin') or not p.is_active then
    raise exception 'Not allowed to reject this transfer';
  end if;
  update transfers set status = 'rejected', rejected_reason = p_reason, approved_by = auth.uid(), approved_at = now()
  where id = p_id returning * into t;
  return t;
end $$;

create or replace function create_manual_transfer(p_medicine uuid, p_from uuid, p_to uuid, p_qty numeric, p_reason text default null)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles; f1 facilities; f2 facilities;
begin
  p := me();
  select * into f1 from facilities where id = p_from;
  select * into f2 from facilities where id = p_to;
  if (select status from medicines where id = p_medicine) <> 'active' then raise exception 'This medicine is discontinued'; end if;
  if not (f1.is_active and f2.is_active) then raise exception 'Both facilities must be active'; end if;
  if not p.is_active or not ((p.role = 'district_officer' and p.district_id = f1.district_id and p.district_id = f2.district_id)
       or (p.role = 'state_admin' and p.state_id = facility_state(p_from) and p.state_id = facility_state(p_to))
       or p.role::text = 'national_admin') then
    raise exception 'Not allowed to create this transfer';
  end if;
  insert into transfers (medicine_id, from_facility_id, to_facility_id, qty, distance_km,
                         is_cross_district, origin, ai_reason, created_by)
  values (p_medicine, p_from, p_to, p_qty,
          round(haversine_km(f1.lat, f1.lng, f2.lat, f2.lng)::numeric, 1),
          f1.district_id <> f2.district_id, 'manual', p_reason, auth.uid())
  returning * into t;
  return t;
end $$;

create or replace function raise_indent(p_medicine uuid, p_qty numeric, p_note text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles; v_wh uuid; v_status text;
begin
  p := me();
  if p.role <> 'phc_staff' or not p.is_active then raise exception 'Only PHC staff raise indents'; end if;
  select status into v_status from medicines where id = p_medicine;
  if v_status <> 'active' then raise exception 'This medicine is % — no new indents. Return or quarantine remaining stock.', v_status; end if;
  select supplying_warehouse into v_wh from facilities where id = p.facility_id;
  if v_wh is null then raise exception 'This facility has no supplying warehouse set'; end if;
  insert into indents (facility_id, warehouse_id, medicine_id, qty_requested, origin, note, raised_by)
  values (p.facility_id, v_wh, p_medicine, p_qty, 'manual', p_note, auth.uid())
  returning * into i;
  return i;
end $$;

create or replace function approve_indent(p_id uuid, p_qty_approved numeric default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'submitted' then raise exception 'Only submitted indents can be approved (current: %)', i.status; end if;
  if (select status from medicines where id = i.medicine_id) <> 'active' then raise exception 'This medicine is discontinued'; end if;
  p := me();
  if not p.is_active or not (p.role = 'district_officer' and p.district_id = facility_district(i.facility_id)) then
    raise exception 'Only the district officer can approve indents';
  end if;
  update indents set status = 'approved', qty_approved = coalesce(p_qty_approved, qty_requested),
         approved_by = auth.uid(), approved_at = now()
  where id = p_id returning * into i;
  return i;
end $$;

-- ---------------------------------------------------------------------
-- 12. RLS UPDATES
-- ---------------------------------------------------------------------
drop policy if exists read_profiles on profiles;
create policy read_profiles on profiles for select to authenticated
  using (id = auth.uid() or is_national() or state_id = (me()).state_id or scope_state(profiles) = (me()).state_id);

drop policy if exists read_briefs on ai_briefs;
create policy read_briefs on ai_briefs for select to authenticated using (
  is_national() or
  (scope_type = 'state'    and scope_id = (me()).state_id and my_role() = 'state_admin') or
  (scope_type = 'district' and (scope_id = (me()).district_id and my_role() = 'district_officer'
                                or (my_role() = 'state_admin' and scope_id in (select id from districts where state_id = (me()).state_id))))
);

-- master data now changes only through the audited admin functions above
drop policy if exists admin_medicines on medicines;
drop policy if exists admin_facilities on facilities;

-- staff roster: facility staff can deactivate (remove) as well as add (already allowed by manage_staff)

-- ---------------------------------------------------------------------
-- 13. VIEWS (new columns appended at the end; inactive facilities hidden)
-- ---------------------------------------------------------------------
create or replace view v_stock_status with (security_invoker = true) as
select
  s.facility_id, f.name as facility_name, f.type as facility_type, f.code as facility_code,
  f.lat, f.lng, f.district_id, d.name as district_name, d.state_id,
  s.medicine_id, m.name as medicine_name, m.unit, m.category,
  s.quantity, s.updated_at,
  fc.predicted_daily_use, fc.lower_daily, fc.upper_daily, fc.days_left, fc.stockout_date,
  fc.mape, fc.generated_at as forecast_at, f.resupply_days,
  case
    when fc.days_left is null            then 'unknown'
    when fc.days_left < f.resupply_days  then 'critical'
    when fc.days_left < f.resupply_days * 2 then 'low'
    when fc.days_left > 90               then 'overstock'
    else 'ok'
  end as status,
  m.status as medicine_status, m.is_chronic, fc.method, fc.seasonality_source, fc.footfall_weight, coalesce(fc.surge, false) as surge
from stock s
join facilities f on f.id = s.facility_id
join districts  d on d.id = f.district_id
join medicines  m on m.id = s.medicine_id
left join forecasts fc on fc.facility_id = s.facility_id and fc.medicine_id = s.medicine_id
where f.is_active;

create or replace view v_facility_summary with (security_invoker = true) as
select
  f.id as facility_id, f.name, f.type, f.code, f.lat, f.lng, f.total_beds, f.resupply_days,
  f.district_id, d.name as district_name, d.state_id,
  count(*) filter (where vs.status = 'critical')  as critical_count,
  count(*) filter (where vs.status = 'low')       as low_count,
  count(*) filter (where vs.status = 'ok')        as ok_count,
  count(*) filter (where vs.status = 'overstock') as overstock_count,
  min(vs.days_left)                               as min_days_left,
  (select count(*) from alerts a where a.facility_id = f.id and a.status <> 'resolved' and a.severity <> 'info') as open_alerts,
  (select dr.occupied_beds from daily_reports dr where dr.facility_id = f.id order by dr.report_date desc limit 1) as occupied_beds,
  (select dr.footfall      from daily_reports dr where dr.facility_id = f.id order by dr.report_date desc limit 1) as last_footfall,
  (select round(avg(case when at.present then 1 else 0 end)::numeric, 2)
     from attendance at join staff st on st.id = at.staff_id
    where st.facility_id = f.id and at.att_date > current_date - 7) as attendance_rate_7d,
  case
    when count(*) filter (where vs.status = 'critical') > 0 then 'critical'
    when count(*) filter (where vs.status = 'low')      > 0 then 'low'
    else 'ok'
  end as overall_status,
  (select count(*) from alerts a where a.facility_id = f.id and a.status <> 'resolved' and a.type::text = 'demand_surge') as open_surges
from facilities f
join districts d on d.id = f.district_id
left join v_stock_status vs on vs.facility_id = f.id
where can_view_facility(f.id) and f.is_active
group by f.id, d.name, d.state_id;

-- ---------------------------------------------------------------------
-- 14. REALTIME (maps, alerts, queues, pipeline and the bell update live)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['transfers', 'indents', 'alerts', 'notifications', 'stock', 'outbreaks', 'forecasts'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 15. CHECK
-- ---------------------------------------------------------------------
select 'migration 002 applied' as status,
       (select count(*) from pg_proc where proname like 'admin_%') as admin_functions,
       (select count(*) from medicines where is_chronic) as chronic_medicines;
