-- =====================================================================
-- AarogyaGrid 005: facility hierarchy, item types, tier catalogue, beds by type,
--                  registry fields (HFR / HPR), LaQshya, Jan Aushadhi stores
--   * facility types: sub health centre (shc) and district hospital (dh) join phc / chc / warehouse;
--     a PHC is day-only or 24x7
--   * a sub-centre is supplied by its PHC: the PHC's medical officer (or the district officer)
--     approves its indents and the PHC dispatches them; PHC staff can see their sub-centres
--   * inventory items: medicine, oxygen, consumable, vaccine, diagnostic (the table keeps its name)
--   * tier catalogue: which facility types stock an item (+ "24x7 PHCs only"), enforced on requests
--   * beds by type (general, maternity, paediatric, ICU, HDU, NICU/SNCU, isolation, observation),
--     limited by tier, with daily occupancy by type
--   * HFR / HPR ids, facility certifications (LaQshya), attendance status
-- Safe to run more than once. Run after 004_state_medicines.sql, then db/seed/005_expansion_seed.sql.
-- New enum values are compared as text here (they cannot be used in the same transaction).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FACILITY HIERARCHY
-- ---------------------------------------------------------------------
alter type facility_type add value if not exists 'shc';
alter type facility_type add value if not exists 'dh';

alter table facilities add column if not exists phc_24x7 boolean not null default false;
alter table facilities add column if not exists hfr_id text;
alter table facilities add column if not exists hfr_extensions jsonb not null default '{}'::jsonb;  -- certifications, e.g. {"laqshya": {"since": "2024-03-01"}}
create unique index if not exists facilities_hfr_id_key on facilities (hfr_id) where hfr_id is not null;

-- Care tier used by the catalogue and bed rules: shc | phc_day | phc_24x7 | chc | dh | warehouse
create or replace function facility_tier(p_type text, p_24x7 boolean) returns text
language sql immutable as $$
  select case when p_type = 'phc' then case when p_24x7 then 'phc_24x7' else 'phc_day' end else p_type end
$$;

-- Staff of a PHC (or CHC) also see the sub-centres it supplies.
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
        (p.role::text = 'phc_staff' and f.type::text = 'shc' and p.facility_id = f.supplying_warehouse) or
        (p.role::text = 'district_officer' and p.district_id = f.district_id) or
        (p.role::text = 'state_admin'      and p.state_id    = d.state_id) or
        (p.role::text = 'national_admin')
      )
  )
$$;

-- ---------------------------------------------------------------------
-- 2. INVENTORY ITEMS + TIER CATALOGUE
-- ---------------------------------------------------------------------
alter table medicines add column if not exists item_type text not null default 'medicine';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'medicines_item_type_check') then
    alter table medicines add constraint medicines_item_type_check
      check (item_type in ('medicine', 'oxygen', 'consumable', 'vaccine', 'diagnostic'));
  end if;
end $$;
alter table medicines add column if not exists phc_24x7_only boolean not null default false;  -- at PHC level, only 24x7 PHCs (delivery points) stock it
alter table medicines add column if not exists program text;                                   -- e.g. 'maternal': prioritised at LaQshya-certified facilities
alter table medicines add column if not exists gtin text;                                      -- GS1 barcode item code
create unique index if not exists medicines_gtin_key on medicines (gtin) where gtin is not null;

-- Is this item on this facility's catalogue (tier + 24x7 rule)?
create or replace function item_allowed(p_facility uuid, p_item uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from facilities f, medicines m
    where f.id = p_facility and m.id = p_item
      and f.type = any (m.stocked_at)
      and not (f.type::text = 'phc' and m.phc_24x7_only and not f.phc_24x7)
      and (m.state_id is null or m.state_id = facility_state(f.id))
  )
$$;

-- ---------------------------------------------------------------------
-- 3. BEDS BY TYPE
-- ---------------------------------------------------------------------
create table if not exists tier_bed_types (
  tier     text not null,
  bed_type text not null check (bed_type in ('general', 'maternity', 'paediatric', 'icu', 'hdu', 'nicu', 'isolation', 'observation')),
  primary key (tier, bed_type)
);
insert into tier_bed_types (tier, bed_type) values
  ('phc_day', 'observation'),
  ('phc_24x7', 'general'), ('phc_24x7', 'maternity'), ('phc_24x7', 'observation'),
  ('chc', 'general'), ('chc', 'maternity'), ('chc', 'paediatric'), ('chc', 'isolation'), ('chc', 'hdu'),
  ('dh', 'general'), ('dh', 'maternity'), ('dh', 'paediatric'), ('dh', 'isolation'), ('dh', 'icu'), ('dh', 'hdu'), ('dh', 'nicu')
on conflict do nothing;
alter table tier_bed_types enable row level security;
drop policy if exists read_tier_beds on tier_bed_types;
create policy read_tier_beds on tier_bed_types for select to authenticated using (true);

create table if not exists facility_beds (
  facility_id uuid not null references facilities(id) on delete cascade,
  bed_type    text not null,
  total       int  not null check (total >= 0),
  updated_at  timestamptz not null default now(),
  primary key (facility_id, bed_type)
);
alter table facility_beds enable row level security;
drop policy if exists read_facility_beds on facility_beds;
create policy read_facility_beds on facility_beds for select to authenticated using (can_view_facility(facility_id));

create table if not exists daily_bed_occupancy (
  facility_id uuid not null references facilities(id) on delete cascade,
  report_date date not null default current_date,
  bed_type    text not null,
  occupied    int  not null check (occupied >= 0),
  created_by  uuid references auth.users(id),
  primary key (facility_id, report_date, bed_type)
);
create index if not exists daily_bed_occupancy_date on daily_bed_occupancy (report_date);
alter table daily_bed_occupancy enable row level security;
drop policy if exists read_bed_occupancy on daily_bed_occupancy;
create policy read_bed_occupancy on daily_bed_occupancy for select to authenticated using (can_view_facility(facility_id));
drop policy if exists write_bed_occupancy on daily_bed_occupancy;
create policy write_bed_occupancy on daily_bed_occupancy for insert to authenticated with check (can_write_facility(facility_id));
drop policy if exists update_bed_occupancy on daily_bed_occupancy;
create policy update_bed_occupancy on daily_bed_occupancy for update to authenticated using (can_write_facility(facility_id));

-- facilities.total_beds always equals the sum of its bed types (when it has any)
create or replace function sync_total_beds() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fid uuid := coalesce(new.facility_id, old.facility_id);
begin
  update facilities set total_beds = coalesce((select sum(total) from facility_beds where facility_id = v_fid), 0) where id = v_fid;
  return null;
end $$;
drop trigger if exists trg_sync_total_beds on facility_beds;
create trigger trg_sync_total_beds after insert or update or delete on facility_beds
  for each row execute function sync_total_beds();

-- occupancy by type rolls up into the daily report's occupied_beds
create or replace function sync_occupied_beds() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sum int;
begin
  select coalesce(sum(occupied), 0) into v_sum from daily_bed_occupancy
   where facility_id = new.facility_id and report_date = new.report_date;
  insert into daily_reports (facility_id, report_date, occupied_beds, created_by)
  values (new.facility_id, new.report_date, v_sum, new.created_by)
  on conflict (facility_id, report_date) do update set occupied_beds = excluded.occupied_beds;
  return null;
end $$;
drop trigger if exists trg_sync_occupied_beds on daily_bed_occupancy;
create trigger trg_sync_occupied_beds after insert or update on daily_bed_occupancy
  for each row execute function sync_occupied_beds();

-- occupancy cannot exceed that bed type's capacity
create or replace function check_bed_occupancy() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total int;
begin
  select total into v_total from facility_beds where facility_id = new.facility_id and bed_type = new.bed_type;
  if v_total is null then raise exception 'This facility has no % beds', new.bed_type; end if;
  if new.occupied > v_total then raise exception '% occupied % beds is more than the % available', new.bed_type, new.occupied, v_total; end if;
  return new;
end $$;
drop trigger if exists trg_check_bed_occupancy on daily_bed_occupancy;
create trigger trg_check_bed_occupancy before insert or update on daily_bed_occupancy
  for each row execute function check_bed_occupancy();

-- Admin: set a facility's beds by type (only types its tier allows). p_beds = {"general": 20, "icu": 4, ...}
create or replace function admin_set_facility_beds(p_id uuid, p_beds jsonb)
returns facilities language plpgsql security definer set search_path = public as $$
declare f facilities; v_state uuid; v_old jsonb; k text; v int; v_tier text;
begin
  select * into f from facilities where id = p_id;
  if f.id is null then raise exception 'Facility not found'; end if;
  v_state := admin_state_of_district(f.district_id);
  if not is_admin_of_state(v_state) then raise exception 'Not allowed to change this facility'; end if;
  v_tier := facility_tier(f.type::text, f.phc_24x7);
  select coalesce(jsonb_object_agg(bed_type, total), '{}'::jsonb) into v_old from facility_beds where facility_id = p_id;
  for k, v in select key, (value)::int from jsonb_each_text(p_beds) loop
    if v < 0 then raise exception 'Beds cannot be negative'; end if;
    if v > 0 and not exists (select 1 from tier_bed_types where tier = v_tier and bed_type = k) then
      raise exception 'A % cannot have % beds', replace(v_tier, '_', ' '), k;
    end if;
    if v = 0 then
      delete from facility_beds where facility_id = p_id and bed_type = k;
    else
      insert into facility_beds (facility_id, bed_type, total) values (p_id, k, v)
      on conflict (facility_id, bed_type) do update set total = excluded.total, updated_at = now();
    end if;
  end loop;
  select * into f from facilities where id = p_id;
  perform log_audit('facility.change_beds', 'bed_change', f.id::text, f.name, v_state, v_old,
                    (select coalesce(jsonb_object_agg(bed_type, total), '{}'::jsonb) from facility_beds where facility_id = p_id));
  return f;
end $$;

-- Oxygen and other bed-driven items: daily occupied critical-care beds (ICU + HDU + NICU), oldest -> yesterday.
create or replace function engine_critical_beds(p_district uuid default null, p_days int default 425)
returns table (facility_id uuid, occupied numeric[], reported boolean[])
language sql stable security definer set search_path = public as $$
  with days as (
    select d::date as day from generate_series(current_date - p_days, current_date - 1, interval '1 day') d
  ),
  fac as (
    select distinct fb.facility_id from facility_beds fb join facilities f on f.id = fb.facility_id
    where fb.bed_type in ('icu', 'hdu', 'nicu') and f.is_active and (p_district is null or f.district_id = p_district)
  ),
  occ as (
    select o.facility_id, o.report_date, sum(o.occupied) as occupied from daily_bed_occupancy o
    where o.bed_type in ('icu', 'hdu', 'nicu') and o.report_date >= current_date - p_days
    group by 1, 2
  )
  select f.facility_id,
         array_agg(coalesce(o.occupied, 0)::numeric order by dy.day),
         array_agg(o.facility_id is not null order by dy.day)
  from fac f cross join days dy
  left join occ o on o.facility_id = f.facility_id and o.report_date = dy.day
  group by f.facility_id
$$;
revoke execute on function engine_critical_beds(uuid, int) from public, anon, authenticated;
grant  execute on function engine_critical_beds(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 4. REGISTRIES, CERTIFICATIONS, ATTENDANCE STATUS
-- ---------------------------------------------------------------------
alter table profiles add column if not exists hpr_id text;
alter table staff    add column if not exists hpr_id text;

alter table attendance add column if not exists status text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_status_check') then
    alter table attendance add constraint attendance_status_check
      check (status is null or status in ('present_on_duty', 'absent', 'on_leave', 'on_deputation'));
  end if;
end $$;
update attendance set status = case when present then 'present_on_duty' else 'absent' end where status is null;
-- present stays the on-duty flag used by the staffing alerts
create or replace function sync_attendance_status() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.present is distinct from old.present then
    new.status := null;  -- only `present` was changed (older screens): derive the status from it
  end if;
  if new.status is null then
    new.status := case when new.present then 'present_on_duty' else 'absent' end;
  else
    new.present := new.status = 'present_on_duty';
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_attendance_status on attendance;
create trigger trg_sync_attendance_status before insert or update on attendance
  for each row execute function sync_attendance_status();

create or replace function admin_set_registry_ids(p_person uuid, p_hpr_id text)
returns profiles language plpgsql security definer set search_path = public as $$
declare v_old profiles; p profiles;
begin
  select * into v_old from profiles where id = p_person for update;
  if v_old.id is null then raise exception 'Person not found'; end if;
  if not admin_can_manage(v_old.role::text, v_old.facility_id, v_old.district_id, v_old.state_id) then raise exception 'This person is outside your scope'; end if;
  update profiles set hpr_id = nullif(trim(p_hpr_id), '') where id = p_person returning * into p;
  if v_old.hpr_id is distinct from p.hpr_id then
    perform log_audit('person.hpr_id', 'person', p.id::text, p.full_name, scope_state(p),
                      jsonb_build_object('hpr_id', v_old.hpr_id), jsonb_build_object('hpr_id', p.hpr_id));
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 5. ADMIN: FACILITIES (new types, 24x7, HFR id, certifications; a sub-centre is supplied by a PHC/CHC)
-- ---------------------------------------------------------------------
drop function if exists admin_save_facility(uuid, uuid, facility_type, text, text, double precision, double precision, text, int, int, uuid, date);
create or replace function admin_save_facility(
  p_id uuid, p_district uuid, p_type facility_type, p_name text, p_code text,
  p_lat double precision, p_lng double precision, p_address text default null,
  p_total_beds int default 0, p_resupply_days int default 7,
  p_supplying_warehouse uuid default null, p_opened_on date default null,
  p_phc_24x7 boolean default null, p_hfr_id text default null, p_hfr_extensions jsonb default null)
returns facilities language plpgsql security definer set search_path = public as $$
declare f facilities; v_old facilities; v_state uuid := admin_state_of_district(p_district); w facilities;
begin
  if v_state is null then raise exception 'District not found'; end if;
  if not is_admin_of_state(v_state) then raise exception 'Only an admin of this state can manage its facilities'; end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_code), '') = '' then raise exception 'Name and code are required'; end if;
  if p_lat not between 6 and 38 or p_lng not between 68 and 98 then raise exception 'Coordinates must be inside India'; end if;
  if p_supplying_warehouse is not null then
    select * into w from facilities where id = p_supplying_warehouse;
    if w.id is null then raise exception 'Supplying facility not found'; end if;
    if p_type::text = 'shc' then
      if w.type::text not in ('phc', 'chc') then raise exception 'A sub-centre is supplied by its PHC or CHC'; end if;
    elsif w.type::text <> 'warehouse' then
      raise exception 'The supplying facility must be a warehouse';
    end if;
    if admin_state_of_district(w.district_id) <> v_state then raise exception 'The supplying facility must be in the same state'; end if;
  end if;

  if p_id is null then
    insert into facilities (district_id, type, name, code, lat, lng, address, total_beds, resupply_days, supplying_warehouse, opened_on,
                            phc_24x7, hfr_id, hfr_extensions)
    values (p_district, p_type, trim(p_name), upper(trim(p_code)), p_lat, p_lng, p_address,
            case when p_type::text = 'shc' then 0 else coalesce(p_total_beds, 0) end,
            coalesce(p_resupply_days, 7), case when p_type::text = 'warehouse' then null else p_supplying_warehouse end,
            coalesce(p_opened_on, current_date), p_type::text = 'phc' and coalesce(p_phc_24x7, false),
            nullif(trim(p_hfr_id), ''), coalesce(p_hfr_extensions, '{}'::jsonb))
    returning * into f;
    -- stock lines for every active item on this facility's catalogue
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from medicines m where m.status = 'active' and item_allowed(f.id, m.id)
    on conflict do nothing;
    perform log_audit('facility.create', 'facility', f.id::text, f.name, v_state, null, to_jsonb(f));
  else
    select * into v_old from facilities where id = p_id for update;
    if v_old.id is null then raise exception 'Facility not found'; end if;
    if not is_admin_of_state(admin_state_of_district(v_old.district_id)) then raise exception 'Not allowed to edit this facility'; end if;
    update facilities set district_id = p_district, type = p_type, name = trim(p_name), code = upper(trim(p_code)),
           lat = p_lat, lng = p_lng, address = p_address, resupply_days = coalesce(p_resupply_days, resupply_days),
           supplying_warehouse = case when p_type::text = 'warehouse' then null else p_supplying_warehouse end,
           opened_on = coalesce(p_opened_on, opened_on),
           phc_24x7 = p_type::text = 'phc' and coalesce(p_phc_24x7, phc_24x7),
           hfr_id = case when p_hfr_id is null then hfr_id else nullif(trim(p_hfr_id), '') end,
           hfr_extensions = coalesce(p_hfr_extensions, hfr_extensions)
     where id = p_id returning * into f;
    -- a changed tier can open new catalogue items
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from medicines m where m.status = 'active' and item_allowed(f.id, m.id)
    on conflict do nothing;
    perform log_audit(case when v_old.supplying_warehouse is distinct from f.supplying_warehouse
                           then 'facility.change_warehouse' else 'facility.update' end,
                      'facility', f.id::text, f.name, v_state, to_jsonb(v_old), to_jsonb(f));
  end if;
  return f;
exception when unique_violation then
  raise exception 'Facility code % (or HFR id) is already used', upper(trim(p_code));
end $$;

-- rows: [{district_code, type, name, code, lat, lng, address, total_beds, resupply_days, supplying_warehouse_code, phc_24x7, hfr_id}]
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
      select id into v_wh from facilities where code = upper(trim(r->>'supplying_warehouse_code'));
      if v_wh is null then raise exception 'Row %: unknown supplying facility code %', i, r->>'supplying_warehouse_code'; end if;
    end if;
    select id into v_existing from facilities where code = upper(trim(r->>'code'));
    begin
      perform admin_save_facility(v_existing, v_district, lower(trim(r->>'type'))::facility_type, r->>'name', r->>'code',
        (r->>'lat')::double precision, (r->>'lng')::double precision, nullif(r->>'address', ''),
        coalesce(nullif(r->>'total_beds', '')::int, 0), coalesce(nullif(r->>'resupply_days', '')::int, 7), v_wh, null,
        lower(coalesce(r->>'phc_24x7', '')) in ('true', 'yes', '1', 'y'), nullif(r->>'hfr_id', ''), null);
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

-- ---------------------------------------------------------------------
-- 6. ADMIN: ITEMS (type, 24x7-only, programme, GTIN)
-- ---------------------------------------------------------------------
drop function if exists admin_save_medicine(uuid, text, text, text, text, text, boolean, facility_type[], uuid);
create or replace function admin_save_medicine(
  p_id uuid, p_name text, p_generic text, p_strength text, p_unit text, p_category text,
  p_is_chronic boolean default false, p_stocked_at facility_type[] default '{phc,chc,warehouse}',
  p_state uuid default null, p_item_type text default null, p_phc_24x7_only boolean default null,
  p_program text default null, p_gtin text default null)
returns medicines language plpgsql security definer set search_path = public as $$
declare m medicines; v_old medicines; v_state uuid := p_state; me_ profiles := me();
begin
  if not is_national() then
    if me_.role::text <> 'state_admin' or not me_.is_active then
      raise exception 'Only the national admin or a state admin can change medicine lists';
    end if;
    v_state := me_.state_id;
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_unit), '') = '' then raise exception 'Name and unit are required'; end if;
  if p_item_type is not null and p_item_type not in ('medicine', 'oxygen', 'consumable', 'vaccine', 'diagnostic') then
    raise exception 'Unknown item type %', p_item_type;
  end if;
  if p_id is null then
    insert into medicines (name, generic_name, strength, unit, category, is_chronic, stocked_at, state_id,
                           item_type, phc_24x7_only, program, gtin)
    values (trim(p_name), p_generic, p_strength, trim(p_unit), trim(p_category), coalesce(p_is_chronic, false), p_stocked_at, v_state,
            coalesce(p_item_type, 'medicine'), coalesce(p_phc_24x7_only, false), nullif(trim(p_program), ''), nullif(trim(p_gtin), ''))
    returning * into m;
    perform log_audit('medicine.create', 'medicine', m.id::text, m.name, m.state_id, null, to_jsonb(m));
  else
    select * into v_old from medicines where id = p_id for update;
    if v_old.id is null then raise exception 'Medicine not found'; end if;
    if not is_national() and v_old.state_id is distinct from me_.state_id then
      raise exception 'This medicine is on the national list; only the national admin can change it';
    end if;
    update medicines set name = trim(p_name), generic_name = p_generic, strength = p_strength, unit = trim(p_unit),
           category = trim(p_category), is_chronic = coalesce(p_is_chronic, is_chronic), stocked_at = p_stocked_at,
           item_type = coalesce(p_item_type, item_type), phc_24x7_only = coalesce(p_phc_24x7_only, phc_24x7_only),
           program = case when p_program is null then program else nullif(trim(p_program), '') end,
           gtin = case when p_gtin is null then gtin else nullif(trim(p_gtin), '') end
     where id = p_id returning * into m;
    perform log_audit('medicine.update', 'medicine', m.id::text, m.name, m.state_id, to_jsonb(v_old), to_jsonb(m));
  end if;
  -- every facility whose catalogue now includes it gets a stock line
  insert into stock (facility_id, medicine_id, quantity)
  select f.id, m.id, 0 from facilities f where f.is_active and item_allowed(f.id, m.id)
  on conflict do nothing;
  return m;
exception when unique_violation then
  raise exception 'A medicine called % (or with that barcode) is already on a list', trim(p_name);
end $$;

-- ---------------------------------------------------------------------
-- 7. REQUESTS FOLLOW THE CATALOGUE AND THE SUPPLY HIERARCHY
-- ---------------------------------------------------------------------
create or replace function raise_indent(p_medicine uuid, p_qty numeric, p_note text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles; v_wh uuid; v_status text; v_wait boolean;
begin
  p := me();
  if p.role <> 'phc_staff' or not p.is_active then raise exception 'Only facility staff raise indents'; end if;
  select status into v_status from medicines where id = p_medicine;
  if v_status <> 'active' then raise exception 'This medicine is % — no new indents. Return or quarantine remaining stock.', v_status; end if;
  if not item_allowed(p.facility_id, p_medicine) then raise exception 'This item is not on your facility''s catalogue'; end if;
  select supplying_warehouse into v_wh from facilities where id = p.facility_id;
  if v_wh is null then raise exception 'This facility has no supplying warehouse set'; end if;
  v_wait := p.phc_position <> 'medical_officer' and facility_has_medical_officer(p.facility_id);
  insert into indents (facility_id, warehouse_id, medicine_id, qty_requested, origin, note, raised_by, awaiting_mo,
                       mo_decided_by, mo_decided_at)
  values (p.facility_id, v_wh, p_medicine, p_qty, 'manual', p_note, auth.uid(), v_wait,
          case when p.phc_position = 'medical_officer' then auth.uid() end,
          case when p.phc_position = 'medical_officer' then now() end)
  returning * into i;
  return i;
end $$;

-- who approves an indent: the district officer, or, for a sub-centre supplied by a PHC/CHC, that facility's medical officer too
create or replace function can_approve_indent(i indents) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p where p.id = auth.uid() and p.is_active and (
      (p.role::text = 'district_officer' and p.district_id = facility_district(i.facility_id)) or
      (p.role::text = 'phc_staff' and p.phc_position = 'medical_officer' and p.facility_id = i.warehouse_id
         and (select type::text from facilities where id = i.warehouse_id) in ('phc', 'chc'))
    )
  )
$$;

create or replace function approve_indent(p_id uuid, p_qty_approved numeric default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'submitted' then raise exception 'Only submitted indents can be approved (current: %)', i.status; end if;
  if i.awaiting_mo then raise exception 'Waiting for the PHC medical officer to sign off this request'; end if;
  if (select status from medicines where id = i.medicine_id) <> 'active' then raise exception 'This medicine is discontinued'; end if;
  if not can_approve_indent(i) then raise exception 'Only the district officer (or the supplying PHC''s medical officer) can approve this indent'; end if;
  update indents set status = 'approved', qty_approved = coalesce(p_qty_approved, qty_requested),
         approved_by = auth.uid(), approved_at = now()
  where id = p_id returning * into i;
  return i;
end $$;

create or replace function reject_indent(p_id uuid, p_reason text)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status not in ('submitted', 'approved') then raise exception 'Cannot reject a % indent', i.status; end if;
  if i.awaiting_mo then raise exception 'Waiting for the PHC medical officer to sign off this request'; end if;
  if not can_approve_indent(i) then raise exception 'Only the district officer (or the supplying PHC''s medical officer) can reject this indent'; end if;
  update indents set status = 'rejected', rejected_reason = p_reason where id = p_id returning * into i;
  return i;
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
  if not item_allowed(p_to, p_medicine) then raise exception 'This item is not on the receiving facility''s catalogue'; end if;
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

-- notifications: a sub-centre's indent goes to its PHC (medical officer to approve, staff to dispatch)
create or replace function on_indent_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_med text; v_fac text; v_title text; v_supplier_type text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select name into v_med from medicines  where id = new.medicine_id;
  select name into v_fac from facilities where id = new.facility_id;
  select type::text into v_supplier_type from facilities where id = new.warehouse_id;
  v_title := v_med || ' for ' || v_fac;

  if new.status = 'submitted' then
    if new.awaiting_mo then
      insert into notifications (user_id, type, title, body, ref_table, ref_id)
      select p.id, 'indent', 'Request to sign off — ' || v_med || ' x' || new.qty_requested,
             coalesce(new.note, 'Raised by ' || coalesce((select full_name from profiles where id = new.raised_by), 'staff')),
             'indents', new.id
      from profiles p
      where p.is_active and p.role::text = 'phc_staff' and p.phc_position = 'medical_officer' and p.facility_id = new.facility_id;
    elsif v_supplier_type in ('phc', 'chc') then
      insert into notifications (user_id, type, title, body, ref_table, ref_id)
      select p.id, 'indent', 'Sub-centre indent to approve — ' || v_title || ' x' || new.qty_requested,
             coalesce(new.ai_reason, new.note), 'indents', new.id
      from profiles p
      where p.is_active and p.role::text = 'phc_staff' and p.phc_position = 'medical_officer' and p.facility_id = new.warehouse_id;
    else
      perform notify_scope(new.facility_id, array['district_officer']::user_role[], 'indent',
        'Indent to approve — ' || v_title || ' x' || new.qty_requested, coalesce(new.ai_reason, new.note), 'indents', new.id);
    end if;
  elsif new.status = 'approved' then
    perform notify_scope(new.warehouse_id, array['warehouse_manager', 'phc_staff']::user_role[], 'indent',
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

-- ---------------------------------------------------------------------
-- 8. JAN AUSHADHI KENDRAS (where patients can buy generics; not part of the government stock chain)
-- ---------------------------------------------------------------------
create table if not exists jan_aushadhi_kendras (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null references districts(id) on delete cascade,
  name        text not null,
  address     text,
  lat         double precision not null,
  lng         double precision not null,
  created_at  timestamptz not null default now()
);
alter table jan_aushadhi_kendras enable row level security;
drop policy if exists read_kendras on jan_aushadhi_kendras;
create policy read_kendras on jan_aushadhi_kendras for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 9. VIEWS: item type and tier on stock status; tier, 24x7, HFR, certifications, critical beds on the summary
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
  m.status as medicine_status, m.is_chronic, fc.method, fc.seasonality_source, fc.footfall_weight, coalesce(fc.surge, false) as surge,
  m.item_type, m.program, facility_tier(f.type::text, f.phc_24x7) as tier
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
  (select count(*) from alerts a where a.facility_id = f.id and a.status <> 'resolved' and a.type::text = 'demand_surge') as open_surges,
  facility_tier(f.type::text, f.phc_24x7) as tier, f.phc_24x7, f.hfr_id, f.hfr_extensions, f.supplying_warehouse,
  (select coalesce(sum(fb.total), 0) from facility_beds fb where fb.facility_id = f.id and fb.bed_type in ('icu', 'hdu', 'nicu')) as critical_beds_total,
  (select coalesce(sum(o.occupied), 0) from daily_bed_occupancy o
    where o.facility_id = f.id and o.bed_type in ('icu', 'hdu', 'nicu')
      and o.report_date = (select max(report_date) from daily_bed_occupancy o2 where o2.facility_id = f.id)) as critical_beds_occupied
from facilities f
join districts d on d.id = f.district_id
left join v_stock_status vs on vs.facility_id = f.id
where can_view_facility(f.id) and f.is_active
group by f.id, d.name, d.state_id;

-- ---------------------------------------------------------------------
-- 10. LIVE UPDATES
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_bed_occupancy') then
    execute 'alter publication supabase_realtime add table public.daily_bed_occupancy';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. CHECK
-- ---------------------------------------------------------------------
select 'migration 005 applied' as status,
       (select count(*) from tier_bed_types) as tier_bed_rules,
       (select count(*) from information_schema.columns where table_name = 'medicines' and column_name = 'item_type') as item_type_column,
       (select count(*) from information_schema.tables where table_name in ('facility_beds', 'daily_bed_occupancy', 'jan_aushadhi_kendras')) as new_tables;
