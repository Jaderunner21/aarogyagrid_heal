-- =====================================================================
-- AarogyaGrid — base schema
-- 01_schema.sql  (run once in Supabase SQL Editor, before 02_seed.sql)
--
-- Hierarchy : State -> District -> Facility (PHC | CHC | Warehouse)
-- Roles     : phc_staff | warehouse_manager | district_officer | state_admin
-- Rules     : reads are scoped by RLS; every stock movement goes through
--             a workflow function (approve -> dispatch -> receive) so the
--             AI only ever *proposes*, humans decide and confirm.
-- Expansion : block level, sub-centres, batch/expiry tracking and
--             multi-line indents can be added without breaking these tables
--             (see notes at the bottom).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. ENUMS
-- ---------------------------------------------------------------------
create type facility_type        as enum ('phc', 'chc', 'warehouse');
create type user_role            as enum ('phc_staff', 'warehouse_manager', 'district_officer', 'state_admin');
create type staff_role           as enum ('medical_officer', 'nurse', 'pharmacist', 'lab_technician', 'health_worker', 'other');
create type log_source           as enum ('manual', 'voice', 'transfer', 'indent', 'adjustment', 'seed');
create type alert_type           as enum ('stockout_risk', 'overstock', 'staff_shortage', 'bed_pressure');
create type alert_severity       as enum ('critical', 'warning', 'info');
create type alert_status         as enum ('open', 'acknowledged', 'resolved');
create type transfer_status      as enum ('proposed', 'approved', 'rejected', 'dispatched', 'received', 'cancelled');
create type indent_status        as enum ('submitted', 'approved', 'rejected', 'dispatched', 'received', 'cancelled');
create type carrier_type         as enum ('warehouse_vehicle', 'facility_staff', 'courier', 'other');
create type origin_type          as enum ('ai', 'manual');
create type notification_channel as enum ('in_app', 'email', 'whatsapp', 'sms');

-- ---------------------------------------------------------------------
-- 1. GEOGRAPHY & FACILITIES
-- ---------------------------------------------------------------------
create table states (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text not null unique,
  created_at timestamptz not null default now()
);

create table districts (
  id         uuid primary key default gen_random_uuid(),
  state_id   uuid not null references states(id) on delete cascade,
  name       text not null,
  code       text not null unique,
  created_at timestamptz not null default now()
);
create index on districts(state_id);

create table facilities (
  id                  uuid primary key default gen_random_uuid(),
  district_id         uuid not null references districts(id) on delete cascade,
  type                facility_type not null,
  name                text not null,
  code                text not null unique,
  lat                 double precision not null,
  lng                 double precision not null,
  address             text,
  total_beds          int  not null default 0 check (total_beds >= 0),
  resupply_days       int  not null default 7 check (resupply_days > 0),   -- normal restock lead time = alert threshold
  supplying_warehouse uuid references facilities(id),                       -- which warehouse fills this PHC's indents
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
create index on facilities(district_id);
create index on facilities(type);

-- ---------------------------------------------------------------------
-- 2. USERS (1 row per Supabase auth user)
-- ---------------------------------------------------------------------
create table profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text not null,
  role               user_role not null,
  facility_id        uuid references facilities(id),
  district_id        uuid references districts(id),
  state_id           uuid references states(id),
  phone              text,
  preferred_language text not null default 'en',      -- 'en' | 'hi' | ... (UI + AI replies)
  created_at         timestamptz not null default now(),
  constraint scope_matches_role check (
    (role in ('phc_staff', 'warehouse_manager') and facility_id is not null) or
    (role = 'district_officer' and district_id is not null) or
    (role = 'state_admin'      and state_id    is not null)
  )
);

-- fill district_id / state_id from the facility or district so every profile carries its full scope
create function fill_profile_scope() returns trigger language plpgsql as $$
begin
  if new.facility_id is not null then
    select f.district_id, d.state_id into new.district_id, new.state_id
    from facilities f join districts d on d.id = f.district_id where f.id = new.facility_id;
  elsif new.district_id is not null then
    select d.state_id into new.state_id from districts d where d.id = new.district_id;
  end if;
  return new;
end $$;
create trigger trg_profile_scope before insert or update on profiles
  for each row execute function fill_profile_scope();

-- ---------------------------------------------------------------------
-- 3. CATALOGUE
-- ---------------------------------------------------------------------
create table medicines (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  generic_name text,
  strength     text,
  unit         text not null,             -- tablet, sachet, vial, bottle ...
  category     text not null,             -- analgesic, antibiotic, antimalarial ...
  is_essential boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. CURRENT STATE
-- ---------------------------------------------------------------------
create table stock (
  facility_id uuid not null references facilities(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete cascade,
  quantity    numeric not null default 0 check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  primary key (facility_id, medicine_id)
);
create index on stock(medicine_id);

-- ---------------------------------------------------------------------
-- 5. HISTORY (what forecasting learns from)
-- ---------------------------------------------------------------------
-- One row = one movement. qty_used = patient consumption (forecast input);
-- qty_received = inflow; qty_out = non-consumption outflow (transfer/indent dispatch, wastage).
create table stock_log (
  id           bigint generated always as identity primary key,
  facility_id  uuid not null references facilities(id) on delete cascade,
  medicine_id  uuid not null references medicines(id) on delete cascade,
  log_date     date not null default current_date,
  qty_used     numeric not null default 0 check (qty_used >= 0),
  qty_received numeric not null default 0 check (qty_received >= 0),
  qty_out      numeric not null default 0 check (qty_out >= 0),
  source       log_source not null default 'manual',
  ref_id       uuid,                      -- transfer / indent id when source = transfer / indent
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create index on stock_log(facility_id, medicine_id, log_date);

-- keep `stock` in sync with every log row (seed can bypass with: set local heal.skip_stock_trigger = 'on')
create function apply_stock_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('heal.skip_stock_trigger', true), 'off') = 'on' then
    return new;
  end if;
  update stock
     set quantity = quantity + new.qty_received - new.qty_used - new.qty_out, updated_at = now()
   where facility_id = new.facility_id and medicine_id = new.medicine_id;
  if not found then
    insert into stock (facility_id, medicine_id, quantity)
    values (new.facility_id, new.medicine_id, new.qty_received - new.qty_used - new.qty_out);
  end if;
  return new;
exception when check_violation then
  raise exception 'Not enough stock: % would go below zero at this facility',
    (select name from medicines where id = new.medicine_id) using errcode = 'P0001';
end $$;
create trigger trg_apply_stock_log after insert on stock_log
  for each row execute function apply_stock_log();

create table daily_reports (
  facility_id   uuid not null references facilities(id) on delete cascade,
  report_date   date not null default current_date,
  footfall      int  not null default 0 check (footfall >= 0),
  occupied_beds int  not null default 0 check (occupied_beds >= 0),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  primary key (facility_id, report_date)
);

create table staff (
  id          uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities(id) on delete cascade,
  name        text not null,
  role        staff_role not null,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index on staff(facility_id);

create table attendance (
  staff_id  uuid not null references staff(id) on delete cascade,
  att_date  date not null default current_date,
  present   boolean not null,
  marked_by uuid references auth.users(id),
  primary key (staff_id, att_date)
);

-- ---------------------------------------------------------------------
-- 6. SYSTEM OUTPUTS (written by the backend engine with the service key)
-- ---------------------------------------------------------------------
create table forecasts (
  facility_id         uuid not null references facilities(id) on delete cascade,
  medicine_id         uuid not null references medicines(id) on delete cascade,
  generated_at        timestamptz not null default now(),
  method              text not null,               -- e.g. 'holt_winters_yearly_adj', 'seed_moving_average'
  predicted_daily_use numeric not null,            -- mean of next 14 days
  lower_daily         numeric,                     -- 80% band
  upper_daily         numeric,
  forecast_7d         numeric,
  forecast_30d        numeric,
  days_left           numeric,                     -- simulated against the forecast curve
  stockout_date       date,
  mape                numeric,                     -- backtest error on last 14 days (0.18 = 18%)
  series              jsonb,                       -- [{date, yhat, lower, upper}] next 30 days for charts
  primary key (facility_id, medicine_id)
);

create table alerts (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references facilities(id) on delete cascade,
  medicine_id     uuid references medicines(id) on delete cascade,
  type            alert_type not null,
  severity        alert_severity not null,
  status          alert_status not null default 'open',
  days_left       numeric,
  message         text not null,                   -- deterministic, always present
  ai_summary      text,                            -- Gemini explanation, filled later
  ai_generated_at timestamptz,                     -- set when Gemini wrote ai_summary
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index on alerts(facility_id, status);
-- one live alert per facility + medicine + type
create unique index alerts_one_live on alerts
  (facility_id, coalesce(medicine_id, '00000000-0000-0000-0000-000000000000'::uuid), type)
  where status <> 'resolved';

create table transfers (
  id                uuid primary key default gen_random_uuid(),
  medicine_id       uuid not null references medicines(id),
  from_facility_id  uuid not null references facilities(id),
  to_facility_id    uuid not null references facilities(id),
  qty               numeric not null check (qty > 0),
  distance_km       numeric,
  is_cross_district boolean not null default false,
  origin            origin_type not null default 'ai',
  priority          int not null default 2,          -- 1 = urgent, 2 = normal, 3 = low
  status            transfer_status not null default 'proposed',
  ai_reason         text,                            -- template from engine, rewritten by Gemini
  ai_generated_at   timestamptz,                     -- set when Gemini wrote ai_reason
  alert_id          uuid references alerts(id) on delete set null,
  created_by        uuid references auth.users(id),  -- null = system/AI
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  rejected_reason   text,
  carrier_type      carrier_type,
  carrier_name      text,
  carrier_contact   text,
  dispatched_by     uuid references auth.users(id),
  dispatched_at     timestamptz,
  received_by       uuid references auth.users(id),
  received_at       timestamptz,
  received_qty      numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (from_facility_id <> to_facility_id)
);
create index on transfers(status);
create index on transfers(from_facility_id);
create index on transfers(to_facility_id);

create table indents (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references facilities(id),    -- requesting PHC
  warehouse_id    uuid not null references facilities(id),    -- supplying warehouse
  medicine_id     uuid not null references medicines(id),
  qty_requested   numeric not null check (qty_requested > 0),
  qty_approved    numeric check (qty_approved > 0),
  origin          origin_type not null default 'manual',
  status          indent_status not null default 'submitted',
  ai_reason       text,
  ai_generated_at timestamptz,
  note            text,
  raised_by       uuid references auth.users(id),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  rejected_reason text,
  carrier_type    carrier_type,
  carrier_name    text,
  dispatched_by   uuid references auth.users(id),
  dispatched_at   timestamptz,
  received_by     uuid references auth.users(id),
  received_at     timestamptz,
  received_qty    numeric,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on indents(status);
create index on indents(facility_id);
create index on indents(warehouse_id);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,                      -- 'alert' | 'transfer' | 'indent' | 'brief'
  title      text not null,
  body       text,
  ref_table  text,
  ref_id     uuid,
  channel    notification_channel not null default 'in_app',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id, read_at);

-- AI situation briefs for a district or the state (written by backend, cached)
create table ai_briefs (
  id           uuid primary key default gen_random_uuid(),
  scope_type   text not null check (scope_type in ('district', 'state')),
  scope_id     uuid not null,                  -- districts.id or states.id
  content      text not null,                  -- markdown bullets
  facts        jsonb,                          -- numbers the brief was based on
  generated_at timestamptz not null default now()
);
create index on ai_briefs(scope_type, scope_id, generated_at desc);

-- tunable thresholds (read by backend engine + views)
create table app_settings (
  key   text primary key,
  value jsonb not null
);

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_transfers_touch before update on transfers for each row execute function touch_updated_at();
create trigger trg_indents_touch   before update on indents   for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- 7. SCOPE HELPERS (used by RLS, views and workflow functions)
-- ---------------------------------------------------------------------
create function me() returns profiles
language sql stable security definer set search_path = public as $$
  select * from profiles where id = auth.uid()
$$;

create function my_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create function can_view_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    join facilities f on f.id = fid
    join districts  d on d.id = f.district_id
    where p.id = auth.uid()
      and (
        (p.role in ('phc_staff', 'warehouse_manager') and p.facility_id = f.id) or
        (p.role = 'district_officer' and p.district_id = f.district_id) or
        (p.role = 'state_admin'      and p.state_id    = d.state_id)
      )
  )
$$;

create function can_write_facility(fid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = auth.uid()
      and p.role in ('phc_staff', 'warehouse_manager')
      and p.facility_id = fid
  )
$$;

create function facility_district(fid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select district_id from facilities where id = fid
$$;

create function facility_state(fid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select d.state_id from facilities f join districts d on d.id = f.district_id where f.id = fid
$$;

create function haversine_km(lat1 double precision, lng1 double precision,
                             lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))
$$;

-- ---------------------------------------------------------------------
-- 8. NOTIFICATIONS FAN-OUT
-- ---------------------------------------------------------------------
-- notify everyone of the given roles whose scope covers the facility
create function notify_scope(p_facility uuid, p_roles user_role[], p_type text,
                             p_title text, p_body text, p_ref_table text, p_ref_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_district uuid; v_state uuid;
begin
  select f.district_id, d.state_id into v_district, v_state
  from facilities f join districts d on d.id = f.district_id where f.id = p_facility;

  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  select p.id, p_type, p_title, p_body, p_ref_table, p_ref_id
  from profiles p
  where p.role = any (p_roles)
    and (
      (p.role in ('phc_staff', 'warehouse_manager') and p.facility_id = p_facility) or
      (p.role = 'district_officer' and p.district_id = v_district) or
      (p.role = 'state_admin'      and p.state_id    = v_state)
    );
end $$;

create function on_alert_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare v_fac text; v_med text;
begin
  if new.severity = 'info' then return new; end if;
  select name into v_fac from facilities where id = new.facility_id;
  select name into v_med from medicines  where id = new.medicine_id;
  perform notify_scope(new.facility_id, array['phc_staff', 'district_officer']::user_role[], 'alert',
    initcap(new.severity::text) || ': ' || coalesce(v_med, replace(new.type::text, '_', ' ')) || ' at ' || v_fac,
    new.message, 'alerts', new.id);
  return new;
end $$;
create trigger trg_alert_notify after insert on alerts for each row execute function on_alert_insert();

create function on_transfer_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_med text; v_from text; v_to text; v_title text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select name into v_med  from medicines  where id = new.medicine_id;
  select name into v_from from facilities where id = new.from_facility_id;
  select name into v_to   from facilities where id = new.to_facility_id;
  v_title := v_med || ' x' || new.qty || ': ' || v_from || ' -> ' || v_to;

  if new.status = 'proposed' then
    if new.is_cross_district then
      perform notify_scope(new.to_facility_id, array['state_admin']::user_role[], 'transfer',
        'Approval needed (cross-district) — ' || v_title, new.ai_reason, 'transfers', new.id);
    else
      perform notify_scope(new.to_facility_id, array['district_officer']::user_role[], 'transfer',
        'Approval needed — ' || v_title, new.ai_reason, 'transfers', new.id);
    end if;
  elsif new.status = 'approved' then
    perform notify_scope(new.from_facility_id, array['phc_staff', 'warehouse_manager']::user_role[], 'transfer',
      'Dispatch requested — ' || v_title, 'Carrier: ' || coalesce(new.carrier_name, 'to be arranged'), 'transfers', new.id);
    perform notify_scope(new.to_facility_id, array['phc_staff']::user_role[], 'transfer',
      'Incoming stock approved — ' || v_title, null, 'transfers', new.id);
  elsif new.status = 'dispatched' then
    perform notify_scope(new.to_facility_id, array['phc_staff', 'warehouse_manager']::user_role[], 'transfer',
      'On the way — confirm on arrival: ' || v_title, null, 'transfers', new.id);
  elsif new.status = 'received' then
    perform notify_scope(new.to_facility_id, array['district_officer']::user_role[], 'transfer',
      'Delivered — ' || v_title, 'Received qty: ' || new.received_qty, 'transfers', new.id);
  end if;
  return new;
end $$;
create trigger trg_transfer_notify after insert or update of status on transfers
  for each row execute function on_transfer_change();

create function on_indent_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_med text; v_fac text; v_title text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select name into v_med from medicines  where id = new.medicine_id;
  select name into v_fac from facilities where id = new.facility_id;
  v_title := v_med || ' for ' || v_fac;

  if new.status = 'submitted' then
    perform notify_scope(new.facility_id, array['district_officer']::user_role[], 'indent',
      'Indent to approve — ' || v_title || ' x' || new.qty_requested, coalesce(new.ai_reason, new.note), 'indents', new.id);
  elsif new.status = 'approved' then
    perform notify_scope(new.warehouse_id, array['warehouse_manager']::user_role[], 'indent',
      'Indent to dispatch — ' || v_title || ' x' || new.qty_approved, null, 'indents', new.id);
    perform notify_scope(new.facility_id, array['phc_staff']::user_role[], 'indent',
      'Indent approved — ' || v_title, null, 'indents', new.id);
  elsif new.status = 'rejected' then
    perform notify_scope(new.facility_id, array['phc_staff']::user_role[], 'indent',
      'Indent rejected — ' || v_title, new.rejected_reason, 'indents', new.id);
  elsif new.status = 'dispatched' then
    perform notify_scope(new.facility_id, array['phc_staff']::user_role[], 'indent',
      'Indent on the way — confirm on arrival: ' || v_title, null, 'indents', new.id);
  elsif new.status = 'received' then
    perform notify_scope(new.facility_id, array['district_officer']::user_role[], 'indent',
      'Indent delivered — ' || v_title, 'Received qty: ' || new.received_qty, 'indents', new.id);
  end if;
  return new;
end $$;
create trigger trg_indent_notify after insert or update of status on indents
  for each row execute function on_indent_change();

-- ---------------------------------------------------------------------
-- 9. WORKFLOW FUNCTIONS (call from the app with supabase.rpc(...))
--    Each checks who is calling, moves the status one step, and writes
--    the stock movement. The UI never updates these tables directly.
-- ---------------------------------------------------------------------

-- TRANSFERS ------------------------------------------------------------
create function approve_transfer(p_id uuid, p_carrier_type carrier_type,
                                 p_carrier_name text default null, p_carrier_contact text default null)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status <> 'proposed' then raise exception 'Only proposed transfers can be approved (current: %)', t.status; end if;
  p := me();
  if t.is_cross_district then
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

create function reject_transfer(p_id uuid, p_reason text)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status not in ('proposed', 'approved') then raise exception 'Cannot reject a % transfer', t.status; end if;
  p := me();
  if not ((p.role = 'district_officer' and p.district_id in (facility_district(t.from_facility_id), facility_district(t.to_facility_id)))
       or (p.role = 'state_admin' and p.state_id = facility_state(t.to_facility_id))) then
    raise exception 'Not allowed to reject this transfer';
  end if;
  update transfers set status = 'rejected', rejected_reason = p_reason, approved_by = auth.uid(), approved_at = now()
  where id = p_id returning * into t;
  return t;
end $$;

create function dispatch_transfer(p_id uuid)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status <> 'approved' then raise exception 'Only approved transfers can be dispatched (current: %)', t.status; end if;
  p := me();
  if not (can_write_facility(t.from_facility_id)
       or (p.role = 'district_officer' and p.district_id = facility_district(t.from_facility_id))) then
    raise exception 'Only the sending facility (or its district officer) can dispatch';
  end if;
  insert into stock_log (facility_id, medicine_id, qty_out, source, ref_id, note, created_by)
  values (t.from_facility_id, t.medicine_id, t.qty, 'transfer', t.id, 'Transfer dispatched', auth.uid());
  update transfers set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now()
  where id = p_id returning * into t;
  return t;
end $$;

create function receive_transfer(p_id uuid, p_received_qty numeric default null)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles; v_qty numeric;
begin
  select * into t from transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found'; end if;
  if t.status <> 'dispatched' then raise exception 'Only dispatched transfers can be received (current: %)', t.status; end if;
  p := me();
  if not (can_write_facility(t.to_facility_id)
       or (p.role = 'district_officer' and p.district_id = facility_district(t.to_facility_id))) then
    raise exception 'Only the receiving facility (or its district officer) can confirm receipt';
  end if;
  v_qty := coalesce(p_received_qty, t.qty);
  if v_qty < 0 or v_qty > t.qty then raise exception 'Received qty must be between 0 and %', t.qty; end if;
  insert into stock_log (facility_id, medicine_id, qty_received, source, ref_id, note, created_by)
  values (t.to_facility_id, t.medicine_id, v_qty, 'transfer', t.id, 'Transfer received', auth.uid());
  update transfers set status = 'received', received_by = auth.uid(), received_at = now(), received_qty = v_qty
  where id = p_id returning * into t;
  -- close the stock-out alert this transfer was answering
  update alerts set status = 'resolved', resolved_at = now()
  where id = t.alert_id and status <> 'resolved';
  return t;
end $$;

-- a district officer / state admin can raise a manual transfer too
create function create_manual_transfer(p_medicine uuid, p_from uuid, p_to uuid, p_qty numeric, p_reason text default null)
returns transfers language plpgsql security definer set search_path = public as $$
declare t transfers; p profiles; f1 facilities; f2 facilities;
begin
  p := me();
  select * into f1 from facilities where id = p_from;
  select * into f2 from facilities where id = p_to;
  if not ((p.role = 'district_officer' and p.district_id = f1.district_id and p.district_id = f2.district_id)
       or (p.role = 'state_admin' and p.state_id = facility_state(p_from) and p.state_id = facility_state(p_to))) then
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

-- INDENTS --------------------------------------------------------------
create function raise_indent(p_medicine uuid, p_qty numeric, p_note text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles; v_wh uuid;
begin
  p := me();
  if p.role <> 'phc_staff' then raise exception 'Only PHC staff raise indents'; end if;
  select supplying_warehouse into v_wh from facilities where id = p.facility_id;
  if v_wh is null then raise exception 'This facility has no supplying warehouse set'; end if;
  insert into indents (facility_id, warehouse_id, medicine_id, qty_requested, origin, note, raised_by)
  values (p.facility_id, v_wh, p_medicine, p_qty, 'manual', p_note, auth.uid())
  returning * into i;
  return i;
end $$;

create function approve_indent(p_id uuid, p_qty_approved numeric default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'submitted' then raise exception 'Only submitted indents can be approved (current: %)', i.status; end if;
  p := me();
  if not (p.role = 'district_officer' and p.district_id = facility_district(i.facility_id)) then
    raise exception 'Only the district officer can approve indents';
  end if;
  update indents set status = 'approved', qty_approved = coalesce(p_qty_approved, qty_requested),
         approved_by = auth.uid(), approved_at = now()
  where id = p_id returning * into i;
  return i;
end $$;

create function reject_indent(p_id uuid, p_reason text)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status not in ('submitted', 'approved') then raise exception 'Cannot reject a % indent', i.status; end if;
  p := me();
  if not (p.role = 'district_officer' and p.district_id = facility_district(i.facility_id)) then
    raise exception 'Only the district officer can reject indents';
  end if;
  update indents set status = 'rejected', rejected_reason = p_reason where id = p_id returning * into i;
  return i;
end $$;

create function dispatch_indent(p_id uuid, p_carrier_type carrier_type default 'warehouse_vehicle', p_carrier_name text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'approved' then raise exception 'Only approved indents can be dispatched (current: %)', i.status; end if;
  if not can_write_facility(i.warehouse_id) then
    raise exception 'Only the supplying warehouse can dispatch';
  end if;
  insert into stock_log (facility_id, medicine_id, qty_out, source, ref_id, note, created_by)
  values (i.warehouse_id, i.medicine_id, i.qty_approved, 'indent', i.id, 'Indent dispatched', auth.uid());
  update indents set status = 'dispatched', dispatched_by = auth.uid(), dispatched_at = now(),
         carrier_type = p_carrier_type, carrier_name = p_carrier_name
  where id = p_id returning * into i;
  return i;
end $$;

create function receive_indent(p_id uuid, p_received_qty numeric default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; v_qty numeric;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'dispatched' then raise exception 'Only dispatched indents can be received (current: %)', i.status; end if;
  if not can_write_facility(i.facility_id) then
    raise exception 'Only the requesting facility can confirm receipt';
  end if;
  v_qty := coalesce(p_received_qty, i.qty_approved);
  if v_qty < 0 or v_qty > i.qty_approved then raise exception 'Received qty must be between 0 and %', i.qty_approved; end if;
  insert into stock_log (facility_id, medicine_id, qty_received, source, ref_id, note, created_by)
  values (i.facility_id, i.medicine_id, v_qty, 'indent', i.id, 'Indent received', auth.uid());
  update indents set status = 'received', received_by = auth.uid(), received_at = now(), received_qty = v_qty
  where id = p_id returning * into i;
  update alerts set status = 'resolved', resolved_at = now()
  where facility_id = i.facility_id and medicine_id = i.medicine_id
    and type = 'stockout_risk' and status <> 'resolved';
  return i;
end $$;

-- ALERTS & NOTIFICATIONS ----------------------------------------------
create function acknowledge_alert(p_id uuid)
returns alerts language plpgsql security definer set search_path = public as $$
declare a alerts;
begin
  select * into a from alerts where id = p_id for update;
  if a.id is null or not can_view_facility(a.facility_id) then raise exception 'Alert not found'; end if;
  update alerts set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
  where id = p_id and status = 'open' returning * into a;
  return a;
end $$;

create function mark_notifications_read(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids))
$$;

-- ENGINE INPUT --------------------------------------------------------
-- One row per facility x medicine with gap-filled daily arrays (oldest -> yesterday),
-- so the engine gets ~400 rows instead of ~170k (PostgREST caps responses at 1000 rows).
-- Service role only.
create function engine_series(p_district uuid default null, p_days int default 425)
returns table (facility_id uuid, medicine_id uuid, facility_type facility_type, district_id uuid,
               resupply_days int, stock numeric, start_date date,
               used numeric[], received numeric[], outflow numeric[], reported boolean[])
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
           sum(l.qty_used) as used, sum(l.qty_received) as received, sum(l.qty_out) as outflow
    from stock_log l
    where l.log_date >= current_date - p_days and l.log_date < current_date
      and (p_district is null or l.facility_id in (select id from facilities where district_id = p_district))
    group by 1, 2, 3
  ),
  fac_days as (   -- did the facility log anything at all that day? (no entry = missing, not zero)
    select distinct l.facility_id, l.log_date from stock_log l
    where l.log_date >= current_date - p_days and l.log_date < current_date
      and (p_district is null or l.facility_id in (select id from facilities where district_id = p_district))
  )
  select p.facility_id, p.medicine_id, p.type, p.district_id, p.resupply_days, p.quantity,
         current_date - p_days,
         array_agg(coalesce(a.used, 0)     order by dy.day),
         array_agg(coalesce(a.received, 0) order by dy.day),
         array_agg(coalesce(a.outflow, 0)  order by dy.day),
         array_agg(fd.facility_id is not null order by dy.day)
  from pairs p
  cross join days dy
  left join agg a on a.facility_id = p.facility_id and a.medicine_id = p.medicine_id and a.log_date = dy.day
  left join fac_days fd on fd.facility_id = p.facility_id and fd.log_date = dy.day
  group by p.facility_id, p.medicine_id, p.type, p.district_id, p.resupply_days, p.quantity
$$;
revoke execute on function engine_series(uuid, int) from public, anon, authenticated;
grant  execute on function engine_series(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 10. VIEWS (security_invoker => RLS of the caller applies)
-- ---------------------------------------------------------------------
-- status buckets: critical < resupply_days <= low < 2x resupply_days <= ok <= 90 days < overstock
create view v_stock_status with (security_invoker = true) as
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
  end as status
from stock s
join facilities f on f.id = s.facility_id
join districts  d on d.id = f.district_id
join medicines  m on m.id = s.medicine_id
left join forecasts fc on fc.facility_id = s.facility_id and fc.medicine_id = s.medicine_id;

create view v_facility_summary with (security_invoker = true) as
select
  f.id as facility_id, f.name, f.type, f.code, f.lat, f.lng, f.total_beds, f.resupply_days,
  f.district_id, d.name as district_name, d.state_id,
  count(*) filter (where vs.status = 'critical')  as critical_count,
  count(*) filter (where vs.status = 'low')       as low_count,
  count(*) filter (where vs.status = 'ok')        as ok_count,
  count(*) filter (where vs.status = 'overstock') as overstock_count,
  min(vs.days_left)                               as min_days_left,
  (select count(*) from alerts a where a.facility_id = f.id and a.status <> 'resolved') as open_alerts,
  (select dr.occupied_beds from daily_reports dr where dr.facility_id = f.id order by dr.report_date desc limit 1) as occupied_beds,
  (select dr.footfall      from daily_reports dr where dr.facility_id = f.id order by dr.report_date desc limit 1) as last_footfall,
  (select round(avg(case when at.present then 1 else 0 end)::numeric, 2)
     from attendance at join staff st on st.id = at.staff_id
    where st.facility_id = f.id and at.att_date > current_date - 7) as attendance_rate_7d,
  case
    when count(*) filter (where vs.status = 'critical') > 0 then 'critical'
    when count(*) filter (where vs.status = 'low')      > 0 then 'low'
    else 'ok'
  end as overall_status
from facilities f
join districts d on d.id = f.district_id
left join v_stock_status vs on vs.facility_id = f.id
where can_view_facility(f.id)
group by f.id, d.name, d.state_id;

create view v_district_summary with (security_invoker = true) as
select
  d.id as district_id, d.name, d.state_id,
  count(distinct fs.facility_id) filter (where fs.type <> 'warehouse')   as facilities,
  count(distinct fs.facility_id) filter (where fs.overall_status = 'critical' and fs.type <> 'warehouse') as facilities_critical,
  coalesce(sum(fs.critical_count), 0)  as critical_items,
  coalesce(sum(fs.low_count), 0)       as low_items,
  coalesce(sum(fs.overstock_count), 0) as overstock_items,
  coalesce(sum(fs.open_alerts), 0)     as open_alerts,
  (select count(*) from transfers t join facilities tf on tf.id = t.to_facility_id
    where tf.district_id = d.id and t.status = 'proposed')                            as transfers_pending,
  (select count(*) from indents i join facilities inf on inf.id = i.facility_id
    where inf.district_id = d.id and i.status = 'submitted')                          as indents_pending,
  round(avg(fs.attendance_rate_7d), 2) as attendance_rate_7d
from districts d
join v_facility_summary fs on fs.district_id = d.id
group by d.id;

create view v_transfers with (security_invoker = true) as
select
  t.*, m.name as medicine_name, m.unit,
  ff.name as from_name, ff.type as from_type, ff.district_id as from_district_id, ff.lat as from_lat, ff.lng as from_lng,
  tf.name as to_name,   tf.type as to_type,   tf.district_id as to_district_id,   tf.lat as to_lat,   tf.lng as to_lng,
  ap.full_name as approved_by_name
from transfers t
join medicines m   on m.id = t.medicine_id
join facilities ff on ff.id = t.from_facility_id
join facilities tf on tf.id = t.to_facility_id
left join profiles ap on ap.id = t.approved_by;

create view v_indents with (security_invoker = true) as
select
  i.*, m.name as medicine_name, m.unit,
  f.name as facility_name, f.district_id, w.name as warehouse_name,
  rb.full_name as raised_by_name, ab.full_name as approved_by_name
from indents i
join medicines m  on m.id = i.medicine_id
join facilities f on f.id = i.facility_id
join facilities w on w.id = i.warehouse_id
left join profiles rb on rb.id = i.raised_by
left join profiles ab on ab.id = i.approved_by;

-- ---------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
--     Browser / user-session clients: read within scope, write only data
--     entry for own facility. Engine writes (forecasts, alerts, AI
--     transfers & indents) use the service-role key, which bypasses RLS.
-- ---------------------------------------------------------------------
alter table states        enable row level security;
alter table districts     enable row level security;
alter table facilities    enable row level security;
alter table profiles      enable row level security;
alter table medicines     enable row level security;
alter table stock         enable row level security;
alter table stock_log     enable row level security;
alter table daily_reports enable row level security;
alter table staff         enable row level security;
alter table attendance    enable row level security;
alter table forecasts     enable row level security;
alter table alerts        enable row level security;
alter table transfers     enable row level security;
alter table indents       enable row level security;
alter table notifications enable row level security;
alter table app_settings  enable row level security;
alter table ai_briefs     enable row level security;

-- directory data: readable by any signed-in user
create policy read_states     on states       for select to authenticated using (true);
create policy read_districts  on districts    for select to authenticated using (true);
create policy read_facilities on facilities   for select to authenticated using (true);
create policy read_medicines  on medicines    for select to authenticated using (true);
create policy read_settings   on app_settings for select to authenticated using (true);

-- master data managed by state admin
create policy admin_medicines  on medicines  for all to authenticated
  using (my_role() = 'state_admin') with check (my_role() = 'state_admin');
create policy admin_facilities on facilities for all to authenticated
  using (my_role() = 'state_admin' and facility_state(id) = (me()).state_id)
  with check (my_role() = 'state_admin');

-- profiles: see yourself + people in your state (names on approvals etc.)
create policy read_profiles on profiles for select to authenticated
  using (id = auth.uid() or state_id = (me()).state_id);
-- profile rows are created/changed by the admin script (service key); users can only change their language
create function set_my_language(p_lang text) returns void
language sql security definer set search_path = public as $$
  update profiles set preferred_language = p_lang where id = auth.uid()
$$;

-- scoped operational reads
create policy read_stock     on stock         for select to authenticated using (can_view_facility(facility_id));
create policy read_stock_log on stock_log     for select to authenticated using (can_view_facility(facility_id));
create policy read_reports   on daily_reports for select to authenticated using (can_view_facility(facility_id));
create policy read_staff     on staff         for select to authenticated using (can_view_facility(facility_id));
create policy read_att       on attendance    for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and can_view_facility(s.facility_id)));
create policy read_forecasts on forecasts     for select to authenticated using (can_view_facility(facility_id));
create policy read_alerts    on alerts        for select to authenticated using (can_view_facility(facility_id));
create policy read_transfers on transfers     for select to authenticated
  using (can_view_facility(from_facility_id) or can_view_facility(to_facility_id));
create policy read_indents   on indents       for select to authenticated
  using (can_view_facility(facility_id) or can_view_facility(warehouse_id));
create policy read_own_notifications on notifications for select to authenticated using (user_id = auth.uid());
create policy read_briefs on ai_briefs for select to authenticated using (
  (scope_type = 'state'    and scope_id = (me()).state_id and my_role() = 'state_admin') or
  (scope_type = 'district' and (scope_id = (me()).district_id and my_role() = 'district_officer'
                                or (my_role() = 'state_admin' and scope_id in (select id from districts where state_id = (me()).state_id))))
);

-- data entry (own facility only)
create policy insert_stock_log on stock_log for insert to authenticated
  with check (can_write_facility(facility_id) and source in ('manual', 'voice', 'adjustment') and created_by = auth.uid());
create policy upsert_reports on daily_reports for insert to authenticated
  with check (can_write_facility(facility_id));
create policy update_reports on daily_reports for update to authenticated
  using (can_write_facility(facility_id)) with check (can_write_facility(facility_id));
create policy manage_staff on staff for all to authenticated
  using (can_write_facility(facility_id)) with check (can_write_facility(facility_id));
create policy insert_att on attendance for insert to authenticated
  with check (exists (select 1 from staff s where s.id = staff_id and can_write_facility(s.facility_id)));
create policy update_att on attendance for update to authenticated
  using (exists (select 1 from staff s where s.id = staff_id and can_write_facility(s.facility_id)));

-- transfers / indents / alerts / forecasts: no direct writes from users —
-- users go through the workflow functions above; the engine uses the service key.

-- ---------------------------------------------------------------------
-- 12. DEFAULT SETTINGS
-- ---------------------------------------------------------------------
insert into app_settings (key, value) values
  ('forecast',       '{"horizon_days": 30, "history_days": 120, "season_period": 7, "alpha": 0.3, "beta": 0.05, "gamma": 0.2, "damping": 0.9}'),
  ('thresholds',     '{"low_multiplier": 2, "overstock_days": 90, "target_cover_days": 30, "donor_keep_days": 45}'),
  ('redistribution', '{"max_distance_km": 80, "min_transfer_qty": 10, "prefer_same_district": true}'),
  ('staffing',       '{"min_attendance_rate": 0.7}');

-- =====================================================================
-- EXPANSION NOTES (not built now; schema already leaves room)
--  * Block level: add `blocks(id, district_id)` + facilities.block_id (nullable) and a 'block_officer' role.
--  * Sub-centres: add 'sub_centre' to facility_type; supplying_warehouse can point at a PHC.
--  * Batches & expiry: add `stock_batches(facility_id, medicine_id, batch_no, expiry_date, qty)`;
--    `stock` stays as the per-medicine total.
--  * Multi-line indents: add `indent_items(indent_id, medicine_id, qty...)` and move medicine/qty there.
--  * WhatsApp/SMS: notifications.channel already exists; a worker sends rows where channel <> 'in_app'.
-- =====================================================================
