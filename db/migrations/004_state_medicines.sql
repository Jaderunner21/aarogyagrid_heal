-- =====================================================================
-- AarogyaGrid 004: state medicine lists + requests for medicines not on the list
--   * medicines.state_id: null = national list (every state), otherwise that state's own list
--   * state admins add / edit / stop medicines on their own state's list
--   * a PHC doctor (or PHC staff where there is no doctor account) can request a medicine that
--     is not on the list: PHC -> district officer -> state admin. When the state admin approves,
--     it is added to the state list and every facility in the state gets a stock line for it.
-- Safe to run more than once. Run after 003_phc_doctors.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STATE LISTS
-- ---------------------------------------------------------------------
alter table medicines add column if not exists state_id uuid references states(id);
create index if not exists medicines_state_idx on medicines (state_id);

-- Names are unique within a list (national, or one state's), so two states can each add the same medicine.
alter table medicines drop constraint if exists medicines_name_key;
create unique index if not exists medicines_name_per_list
  on medicines (lower(name), coalesce(state_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ...but a state medicine may not repeat a national one (or the other way round), or a state would see it twice.
create or replace function medicines_name_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.state_id is not null and exists (
       select 1 from medicines where id <> new.id and state_id is null and lower(name) = lower(new.name)) then
    raise exception '% is already on the national list', new.name;
  end if;
  if new.state_id is null and exists (
       select 1 from medicines m join states s on s.id = m.state_id where m.id <> new.id and lower(m.name) = lower(new.name)) then
    raise exception '% is already on a state list; add it there or rename it', new.name;
  end if;
  return new;
end $$;
drop trigger if exists trg_medicines_name_guard on medicines;
create trigger trg_medicines_name_guard before insert or update of name, state_id on medicines
  for each row execute function medicines_name_guard();

-- A state's own medicine is only stocked by that state's facilities (covers every path that adds stock lines).
create or replace function stock_state_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_med_state uuid;
begin
  select state_id into v_med_state from medicines where id = new.medicine_id;
  if v_med_state is not null and v_med_state is distinct from facility_state(new.facility_id) then
    return null;  -- silently skip: this medicine is not on that facility's state list
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_state_guard on stock;
create trigger trg_stock_state_guard before insert on stock for each row execute function stock_state_guard();

-- Everyone sees the national list; a state's list is seen in that state (and nationally).
drop policy if exists read_medicines on medicines;
create policy read_medicines on medicines for select to authenticated
  using (state_id is null or is_national() or state_id = scope_state(me()));

-- ---------------------------------------------------------------------
-- 2. ADMIN: add / edit medicines (national: any list; state admin: own state's list only)
-- ---------------------------------------------------------------------
drop function if exists admin_save_medicine(uuid, text, text, text, text, text, boolean, facility_type[]);
create or replace function admin_save_medicine(
  p_id uuid, p_name text, p_generic text, p_strength text, p_unit text, p_category text,
  p_is_chronic boolean default false, p_stocked_at facility_type[] default '{phc,chc,warehouse}',
  p_state uuid default null)
returns medicines language plpgsql security definer set search_path = public as $$
declare m medicines; v_old medicines; v_state uuid := p_state; me_ profiles := me();
begin
  if not is_national() then
    if me_.role::text <> 'state_admin' or not me_.is_active then
      raise exception 'Only the national admin or a state admin can change medicine lists';
    end if;
    v_state := me_.state_id;  -- a state admin always works on their own state's list
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_unit), '') = '' then raise exception 'Name and unit are required'; end if;
  if p_id is null then
    insert into medicines (name, generic_name, strength, unit, category, is_chronic, stocked_at, state_id)
    values (trim(p_name), p_generic, p_strength, trim(p_unit), trim(p_category), coalesce(p_is_chronic, false), p_stocked_at, v_state)
    returning * into m;
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from facilities f join districts d on d.id = f.district_id
     where f.is_active and f.type = any (m.stocked_at) and (m.state_id is null or d.state_id = m.state_id)
    on conflict do nothing;
    perform log_audit('medicine.create', 'medicine', m.id::text, m.name, m.state_id, null, to_jsonb(m));
  else
    select * into v_old from medicines where id = p_id for update;
    if v_old.id is null then raise exception 'Medicine not found'; end if;
    if not is_national() and v_old.state_id is distinct from me_.state_id then
      raise exception 'This medicine is on the national list; only the national admin can change it';
    end if;
    update medicines set name = trim(p_name), generic_name = p_generic, strength = p_strength, unit = trim(p_unit),
           category = trim(p_category), is_chronic = coalesce(p_is_chronic, is_chronic), stocked_at = p_stocked_at
     where id = p_id returning * into m;
    insert into stock (facility_id, medicine_id, quantity)
    select f.id, m.id, 0 from facilities f join districts d on d.id = f.district_id
     where f.is_active and f.type = any (m.stocked_at) and (m.state_id is null or d.state_id = m.state_id)
    on conflict do nothing;
    perform log_audit('medicine.update', 'medicine', m.id::text, m.name, m.state_id, to_jsonb(v_old), to_jsonb(m));
  end if;
  return m;
exception when unique_violation then
  raise exception 'A medicine called % is already on a list', trim(p_name);
end $$;

-- Discontinue / withdraw / reinstate: national admin for any medicine, state admin for their state's own.
create or replace function admin_set_medicine_status(p_id uuid, p_status text, p_date date default current_date, p_reason text default null)
returns medicines language plpgsql security definer set search_path = public as $$
declare m medicines; v_old medicines;
begin
  if p_status not in ('active', 'discontinued', 'withdrawn') then raise exception 'Unknown status %', p_status; end if;
  if p_status <> 'active' and coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
  select * into v_old from medicines where id = p_id for update;
  if v_old.id is null then raise exception 'Medicine not found'; end if;
  if not (is_national() or (v_old.state_id is not null and is_admin_of_state(v_old.state_id))) then
    raise exception 'Only the national admin can stop a medicine on the national list';
  end if;
  update medicines set status = p_status, status_date = case when p_status = 'active' then null else coalesce(p_date, current_date) end,
         status_reason = case when p_status = 'active' then null else p_reason end
   where id = p_id returning * into m;
  if p_status <> 'active' then
    update transfers set status = 'cancelled', rejected_reason = 'Medicine ' || p_status || ': ' || p_reason
     where medicine_id = p_id and status = 'proposed';
    update indents set status = 'cancelled', rejected_reason = 'Medicine ' || p_status || ': ' || p_reason
     where medicine_id = p_id and status = 'submitted';
  end if;
  perform log_audit('medicine.' || p_status, 'medicine', m.id::text, m.name, m.state_id,
                    jsonb_build_object('status', v_old.status), jsonb_build_object('status', m.status, 'date', m.status_date, 'reason', m.status_reason),
                    p_reason);
  return m;
end $$;

-- ---------------------------------------------------------------------
-- 3. REQUESTS FOR A MEDICINE NOT ON THE LIST
-- ---------------------------------------------------------------------
create table if not exists medicine_requests (
  id                  uuid primary key default gen_random_uuid(),
  facility_id         uuid not null references facilities(id),
  state_id            uuid not null references states(id),
  requested_by        uuid not null references profiles(id),
  medicine_name       text not null,
  strength            text,
  unit                text not null,
  category            text,
  is_chronic          boolean not null default false,
  monthly_qty         numeric check (monthly_qty is null or monthly_qty > 0),
  reason              text not null,
  status              text not null default 'with_district'
                      check (status in ('with_district', 'with_state', 'approved', 'rejected', 'cancelled')),
  district_by         uuid references profiles(id),
  district_at         timestamptz,
  district_note       text,
  state_by            uuid references profiles(id),
  state_at            timestamptz,
  state_note          text,
  medicine_id         uuid references medicines(id),
  created_at          timestamptz not null default now()
);
create index if not exists medicine_requests_facility_idx on medicine_requests (facility_id, created_at desc);
create index if not exists medicine_requests_status_idx on medicine_requests (state_id, status);
alter table medicine_requests enable row level security;
drop policy if exists read_medicine_requests on medicine_requests;
create policy read_medicine_requests on medicine_requests for select to authenticated using (can_view_facility(facility_id));
-- all writes go through the functions below

create or replace view v_medicine_requests with (security_invoker = true) as
select r.*, f.name as facility_name, f.district_id, d.name as district_name, s.name as state_name,
       rb.full_name as requested_by_name, rb.phc_position as requested_by_position,
       db.full_name as district_by_name, sb.full_name as state_by_name, m.name as linked_medicine_name
from medicine_requests r
join facilities f on f.id = r.facility_id
join districts d on d.id = f.district_id
join states s on s.id = r.state_id
left join profiles rb on rb.id = r.requested_by
left join profiles db on db.id = r.district_by
left join profiles sb on sb.id = r.state_by
left join medicines m on m.id = r.medicine_id;
grant select on v_medicine_requests to authenticated, service_role;

create or replace function notify_person(p_user uuid, p_title text, p_body text, p_ref_table text, p_ref_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, body, ref_table, ref_id)
  select p_user, 'medicine_request', p_title, p_body, p_ref_table, p_ref_id
  where exists (select 1 from profiles where id = p_user and is_active)
$$;
revoke execute on function notify_person(uuid, text, text, text, uuid) from public, anon, authenticated;

-- PHC doctor (or PHC staff when the PHC has no doctor account) asks for a medicine not on the list.
create or replace function request_new_medicine(p_name text, p_strength text, p_unit text, p_category text,
                                                p_reason text, p_monthly_qty numeric default null, p_is_chronic boolean default false)
returns medicine_requests language plpgsql security definer set search_path = public as $$
declare me_ profiles := me(); r medicine_requests; v_state uuid; v_existing text;
begin
  if me_.id is null or not me_.is_active or me_.role::text <> 'phc_staff' then
    raise exception 'Only PHC logins can request a new medicine';
  end if;
  if me_.phc_position <> 'medical_officer' and facility_has_medical_officer(me_.facility_id) then
    raise exception 'Ask your PHC doctor: new medicines are requested by the medical officer';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_unit), '') = '' then raise exception 'Give the medicine name and unit'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why it is needed'; end if;
  v_state := facility_state(me_.facility_id);
  select name into v_existing from medicines
   where lower(name) = lower(trim(p_name)) and (state_id is null or state_id = v_state) and status = 'active';
  if v_existing is not null then raise exception '% is already on the list. Raise a normal indent for it.', v_existing; end if;
  insert into medicine_requests (facility_id, state_id, requested_by, medicine_name, strength, unit, category, is_chronic, monthly_qty, reason)
  values (me_.facility_id, v_state, me_.id, trim(p_name), nullif(trim(p_strength), ''), trim(p_unit), nullif(trim(p_category), ''),
          coalesce(p_is_chronic, false), p_monthly_qty, trim(p_reason))
  returning * into r;
  perform notify_scope(r.facility_id, array['district_officer']::user_role[], 'medicine_request',
    'New medicine requested — ' || r.medicine_name || ' for ' || (select name from facilities where id = r.facility_id),
    r.reason, 'medicine_requests', r.id);
  return r;
end $$;

-- The requester can withdraw it while it is still with the district.
create or replace function cancel_medicine_request(p_id uuid)
returns medicine_requests language plpgsql security definer set search_path = public as $$
declare r medicine_requests;
begin
  select * into r from medicine_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.requested_by <> auth.uid() then raise exception 'Only the person who asked can withdraw it'; end if;
  if r.status <> 'with_district' then raise exception 'It has already been decided on by the district'; end if;
  update medicine_requests set status = 'cancelled' where id = p_id returning * into r;
  return r;
end $$;

-- Step 2: the district officer supports it (sends to the state) or turns it down.
create or replace function district_decide_medicine_request(p_id uuid, p_support boolean, p_note text default null)
returns medicine_requests language plpgsql security definer set search_path = public as $$
declare r medicine_requests; me_ profiles := me();
begin
  select * into r from medicine_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not (me_.is_active and me_.role::text = 'district_officer' and me_.district_id = facility_district(r.facility_id)) then
    raise exception 'Only this district''s officer can decide at this step';
  end if;
  if r.status <> 'with_district' then raise exception 'This request is no longer with the district'; end if;
  if not p_support and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for turning it down'; end if;
  update medicine_requests
     set status = case when p_support then 'with_state' else 'rejected' end,
         district_by = me_.id, district_at = now(), district_note = nullif(trim(p_note), '')
   where id = p_id returning * into r;
  if p_support then
    perform notify_scope(r.facility_id, array['state_admin']::user_role[], 'medicine_request',
      'Medicine request to decide — ' || r.medicine_name, 'Supported by ' || me_.full_name || coalesce(': ' || r.district_note, ''), 'medicine_requests', r.id);
    perform notify_person(r.requested_by, 'District supports your request for ' || r.medicine_name,
      'It has gone to the state admin for a decision.', 'medicine_requests', r.id);
  else
    perform notify_person(r.requested_by, 'Medicine request not supported — ' || r.medicine_name, r.district_note, 'medicine_requests', r.id);
  end if;
  return r;
end $$;

-- Step 3: the state admin (or national admin) approves, adding it to the state list, or declines.
-- p_existing links the request to a medicine already on a list (e.g. the same drug under another name).
create or replace function state_decide_medicine_request(p_id uuid, p_approve boolean, p_note text default null,
                                                         p_existing uuid default null, p_name text default null,
                                                         p_unit text default null, p_category text default null)
returns medicine_requests language plpgsql security definer set search_path = public as $$
declare r medicine_requests; me_ profiles := me(); m medicines;
begin
  select * into r from medicine_requests where id = p_id for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not (is_national() or is_admin_of_state(r.state_id)) then raise exception 'Only this state''s admin can decide'; end if;
  if r.status <> 'with_state' then raise exception 'This request is not waiting for the state'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for declining'; end if;
    update medicine_requests set status = 'rejected', state_by = me_.id, state_at = now(), state_note = trim(p_note)
     where id = p_id returning * into r;
    perform notify_person(r.requested_by, 'Medicine request declined — ' || r.medicine_name, r.state_note, 'medicine_requests', r.id);
    perform log_audit('medicine_request.decline', 'medicine', r.id::text, r.medicine_name, r.state_id, null, to_jsonb(r), r.state_note);
    return r;
  end if;

  if p_existing is not null then
    select * into m from medicines where id = p_existing and (state_id is null or state_id = r.state_id);
    if m.id is null then raise exception 'That medicine is not on this state''s lists'; end if;
  else
    insert into medicines (name, generic_name, strength, unit, category, is_chronic, stocked_at, state_id)
    values (coalesce(nullif(trim(p_name), ''), r.medicine_name), null, r.strength, coalesce(nullif(trim(p_unit), ''), r.unit),
            coalesce(nullif(trim(p_category), ''), r.category, 'Other'), r.is_chronic, '{phc,chc,warehouse}', r.state_id)
    returning * into m;
    perform log_audit('medicine.create', 'medicine', m.id::text, m.name, m.state_id, null, to_jsonb(m),
                      'Added to the state list on request from ' || (select name from facilities where id = r.facility_id));
  end if;
  -- every active facility in the state gets a stock line (the requesting PHC at least)
  insert into stock (facility_id, medicine_id, quantity)
  select f.id, m.id, 0 from facilities f join districts d on d.id = f.district_id
   where f.is_active and d.state_id = r.state_id and f.type = any (m.stocked_at)
  on conflict do nothing;
  insert into stock (facility_id, medicine_id, quantity) values (r.facility_id, m.id, 0) on conflict do nothing;

  update medicine_requests set status = 'approved', state_by = me_.id, state_at = now(), state_note = nullif(trim(p_note), ''), medicine_id = m.id
   where id = p_id returning * into r;
  perform notify_person(r.requested_by, m.name || ' is now on the ' || (select name from states where id = r.state_id) || ' list',
    'You can now raise an indent for it.', 'medicine_requests', r.id);
  perform notify_scope(r.facility_id, array['district_officer']::user_role[], 'medicine_request',
    'Medicine request approved — ' || m.name, null, 'medicine_requests', r.id);
  perform log_audit('medicine_request.approve', 'medicine', r.id::text, m.name, r.state_id, null, to_jsonb(r), r.state_note);
  return r;
exception when unique_violation then
  raise exception 'A medicine with that name is already on a list: choose it under "Already on the list" instead';
end $$;

-- ---------------------------------------------------------------------
-- 4. LIVE UPDATES
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'medicine_requests') then
    execute 'alter publication supabase_realtime add table public.medicine_requests';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. CHECK
-- ---------------------------------------------------------------------
select 'migration 004 applied' as status,
       (select count(*) from information_schema.columns where table_name = 'medicines' and column_name = 'state_id') as state_list_column,
       (select count(*) from information_schema.tables where table_name = 'medicine_requests') as requests_table,
       (select count(*) from medicines where state_id is null) as national_medicines;
