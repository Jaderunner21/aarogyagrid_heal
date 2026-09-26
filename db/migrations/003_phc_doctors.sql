-- =====================================================================
-- AarogyaGrid 003: PHC doctor (medical officer) accounts
--   * profiles.phc_position: a PHC login is either 'staff' or 'medical_officer'
--     (same role, same data access; the doctor also signs off the PHC's requests)
--   * a request (indent) raised by PHC staff waits for the PHC's medical officer
--     before it reaches the district officer; the doctor's own requests go straight up
--   * admin_set_phc_position for the Admin console
--   * data fix: PHC Poshina's location
-- Safe to run more than once. Run after 002_upgrade.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. COLUMNS
-- ---------------------------------------------------------------------
alter table profiles add column if not exists phc_position text not null default 'staff';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phc_position_check') then
    alter table profiles add constraint profiles_phc_position_check check (phc_position in ('staff', 'medical_officer'));
  end if;
end $$;

alter table indents add column if not exists awaiting_mo   boolean not null default false;
alter table indents add column if not exists mo_decided_by uuid references auth.users(id);
alter table indents add column if not exists mo_decided_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. HELPERS
-- ---------------------------------------------------------------------
create or replace function is_medical_officer_of(p_facility uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.is_active and p.role::text = 'phc_staff'
                 and p.phc_position = 'medical_officer' and p.facility_id = p_facility)
$$;

create or replace function facility_has_medical_officer(p_facility uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.is_active and p.role::text = 'phc_staff'
                 and p.phc_position = 'medical_officer' and p.facility_id = p_facility)
$$;

-- ---------------------------------------------------------------------
-- 3. RAISING A REQUEST: staff requests wait for the doctor when the PHC has one
-- ---------------------------------------------------------------------
create or replace function raise_indent(p_medicine uuid, p_qty numeric, p_note text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles; v_wh uuid; v_status text; v_wait boolean;
begin
  p := me();
  if p.role <> 'phc_staff' or not p.is_active then raise exception 'Only PHC staff raise indents'; end if;
  select status into v_status from medicines where id = p_medicine;
  if v_status <> 'active' then raise exception 'This medicine is % — no new indents. Return or quarantine remaining stock.', v_status; end if;
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

-- The PHC doctor approves (sends on to the district) or rejects a staff request.
create or replace function mo_decide_indent(p_id uuid, p_approve boolean, p_reason text default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; v_med text; v_fac text; v_me text;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Request not found'; end if;
  if not is_medical_officer_of(i.facility_id) then raise exception 'Only this PHC''s medical officer can decide'; end if;
  if i.status <> 'submitted' or not i.awaiting_mo then raise exception 'This request is not waiting for the medical officer'; end if;
  select full_name into v_me from profiles where id = auth.uid();
  if p_approve then
    update indents set awaiting_mo = false, mo_decided_by = auth.uid(), mo_decided_at = now()
     where id = p_id returning * into i;
    select name into v_med from medicines where id = i.medicine_id;
    select name into v_fac from facilities where id = i.facility_id;
    perform notify_scope(i.facility_id, array['district_officer']::user_role[], 'indent',
      'Indent to approve — ' || v_med || ' for ' || v_fac || ' x' || i.qty_requested,
      'Signed off by ' || coalesce(v_me, 'the medical officer') || coalesce('. ' || i.note, ''), 'indents', i.id);
  else
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason'; end if;
    update indents set status = 'rejected', awaiting_mo = false, rejected_reason = 'Medical officer: ' || p_reason,
           mo_decided_by = auth.uid(), mo_decided_at = now()
     where id = p_id returning * into i;
  end if;
  return i;
end $$;

-- ---------------------------------------------------------------------
-- 4. DISTRICT OFFICER: cannot act on a request the doctor has not signed off
-- ---------------------------------------------------------------------
create or replace function approve_indent(p_id uuid, p_qty_approved numeric default null)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status <> 'submitted' then raise exception 'Only submitted indents can be approved (current: %)', i.status; end if;
  if i.awaiting_mo then raise exception 'Waiting for the PHC medical officer to sign off this request'; end if;
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

create or replace function reject_indent(p_id uuid, p_reason text)
returns indents language plpgsql security definer set search_path = public as $$
declare i indents; p profiles;
begin
  select * into i from indents where id = p_id for update;
  if i.id is null then raise exception 'Indent not found'; end if;
  if i.status not in ('submitted', 'approved') then raise exception 'Cannot reject a % indent', i.status; end if;
  if i.awaiting_mo then raise exception 'Waiting for the PHC medical officer to sign off this request'; end if;
  p := me();
  if not p.is_active or not (p.role = 'district_officer' and p.district_id = facility_district(i.facility_id)) then
    raise exception 'Only the district officer can reject indents';
  end if;
  update indents set status = 'rejected', rejected_reason = p_reason where id = p_id returning * into i;
  return i;
end $$;

-- ---------------------------------------------------------------------
-- 5. NOTIFICATIONS: a staff request goes to the doctor first
-- ---------------------------------------------------------------------
create or replace function on_indent_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_med text; v_fac text; v_title text;
begin
  if tg_op = 'UPDATE' and new.status = old.status then return new; end if;
  select name into v_med from medicines  where id = new.medicine_id;
  select name into v_fac from facilities where id = new.facility_id;
  v_title := v_med || ' for ' || v_fac;

  if new.status = 'submitted' then
    if new.awaiting_mo then
      insert into notifications (user_id, type, title, body, ref_table, ref_id)
      select p.id, 'indent', 'Request to sign off — ' || v_med || ' x' || new.qty_requested,
             coalesce(new.note, 'Raised by ' || coalesce((select full_name from profiles where id = new.raised_by), 'PHC staff')),
             'indents', new.id
      from profiles p
      where p.is_active and p.role::text = 'phc_staff' and p.phc_position = 'medical_officer' and p.facility_id = new.facility_id;
    else
      perform notify_scope(new.facility_id, array['district_officer']::user_role[], 'indent',
        'Indent to approve — ' || v_title || ' x' || new.qty_requested, coalesce(new.ai_reason, new.note), 'indents', new.id);
    end if;
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

-- ---------------------------------------------------------------------
-- 6. VIEW: v_indents gains the doctor sign-off columns (recreated: i.* is fixed at creation)
-- ---------------------------------------------------------------------
drop view if exists v_indents;
create view v_indents with (security_invoker = true) as
select
  i.id, i.facility_id, i.warehouse_id, i.medicine_id, i.qty_requested, i.qty_approved, i.origin, i.status,
  i.ai_reason, i.ai_generated_at, i.note, i.raised_by, i.approved_by, i.approved_at, i.rejected_reason,
  i.carrier_type, i.carrier_name, i.dispatched_by, i.dispatched_at, i.received_by, i.received_at, i.received_qty,
  i.created_at, i.updated_at,
  m.name as medicine_name, m.unit,
  f.name as facility_name, f.district_id, w.name as warehouse_name,
  rb.full_name as raised_by_name, ab.full_name as approved_by_name,
  i.awaiting_mo, i.mo_decided_by, i.mo_decided_at, mo.full_name as mo_decided_by_name
from indents i
join medicines m  on m.id = i.medicine_id
join facilities f on f.id = i.facility_id
join facilities w on w.id = i.warehouse_id
left join profiles rb on rb.id = i.raised_by
left join profiles ab on ab.id = i.approved_by
left join profiles mo on mo.id = i.mo_decided_by;
grant select on v_indents to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. ADMIN CONSOLE: make a PHC login a doctor or staff (scoped + audited)
-- ---------------------------------------------------------------------
create or replace function admin_set_phc_position(p_id uuid, p_position text)
returns profiles language plpgsql security definer set search_path = public as $$
declare v_old profiles; p profiles;
begin
  if p_position not in ('staff', 'medical_officer') then raise exception 'Choose staff or medical officer'; end if;
  select * into v_old from profiles where id = p_id for update;
  if v_old.id is null then raise exception 'Person not found'; end if;
  if v_old.role::text <> 'phc_staff' then raise exception 'Only PHC logins can be a medical officer or staff'; end if;
  if not admin_can_manage(v_old.role::text, v_old.facility_id, v_old.district_id, v_old.state_id) then
    raise exception 'This person is outside your scope';
  end if;
  update profiles set phc_position = p_position where id = p_id returning * into p;
  if v_old.phc_position is distinct from p.phc_position then
    perform log_audit('person.phc_position', 'person', p.id::text, p.full_name, scope_state(p),
                      jsonb_build_object('phc_position', v_old.phc_position), jsonb_build_object('phc_position', p.phc_position));
  end if;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 8. DATA FIX: PHC Poshina sits in Sabarkantha (the seed had it across the border)
-- ---------------------------------------------------------------------
update facilities set lat = 24.3731, lng = 73.0325 where code = 'PHC-SKT-06' and abs(lat - 24.23) < 0.01;

-- ---------------------------------------------------------------------
-- 9. CHECK
-- ---------------------------------------------------------------------
select 'migration 003 applied' as status,
       (select count(*) from information_schema.columns where table_name = 'profiles' and column_name = 'phc_position') as phc_position_column,
       (select count(*) from information_schema.columns where table_name = 'v_indents' and column_name = 'awaiting_mo') as view_updated,
       (select lat || ', ' || lng from facilities where code = 'PHC-SKT-06') as poshina;
