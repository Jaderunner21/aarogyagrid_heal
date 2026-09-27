-- =====================================================================
-- AarogyaGrid — 008_stockout_reports.sql   (run after 007; safe to re-run)
--
-- "We've run out": one tap by facility staff or the doctor when an item runs out mid-day.
-- The district officer, the warehouse (and for a sub-centre, its PHC) are notified at once;
-- the engine treats the item as out (whatever the record says) until stock is received or
-- the report is withdrawn. The evening entry still records what was actually used.
-- =====================================================================

create table if not exists stockout_reports (
  id              uuid primary key default gen_random_uuid(),
  facility_id     uuid not null references facilities(id) on delete cascade,
  medicine_id     uuid not null references medicines(id) on delete cascade,
  reported_by     uuid references auth.users(id),
  reported_at     timestamptz not null default now(),
  note            text,
  stock_on_record numeric not null default 0,
  resolved_at     timestamptz,
  resolved_reason text
);
-- one open report per facility and item
create unique index if not exists stockout_reports_open on stockout_reports (facility_id, medicine_id) where resolved_at is null;
create index if not exists stockout_reports_facility on stockout_reports (facility_id, reported_at desc);
alter table stockout_reports enable row level security;
drop policy if exists read_stockout_reports on stockout_reports;
create policy read_stockout_reports on stockout_reports for select to authenticated using (can_view_facility(facility_id));

-- report (or re-confirm) that an item has run out
create or replace function report_stockout(p_facility uuid, p_medicine uuid, p_note text default null)
returns stockout_reports language plpgsql security definer set search_path = public as $$
declare r stockout_reports; v_stock numeric; f facilities; v_med text; v_who text; v_supplier facilities;
begin
  if not can_write_facility(p_facility) then raise exception 'Only this facility''s staff can report a stock-out'; end if;
  select * into f from facilities where id = p_facility;
  select quantity into v_stock from stock where facility_id = p_facility and medicine_id = p_medicine;
  if v_stock is null then raise exception 'This item is not on this facility''s list'; end if;
  select name into v_med from medicines where id = p_medicine;
  select full_name into v_who from profiles where id = auth.uid();

  select * into r from stockout_reports where facility_id = p_facility and medicine_id = p_medicine and resolved_at is null;
  if r.id is not null then
    update stockout_reports set note = coalesce(nullif(trim(p_note), ''), note) where id = r.id returning * into r;
    return r;  -- already reported: no second round of notifications
  end if;

  insert into stockout_reports (facility_id, medicine_id, reported_by, note, stock_on_record)
  values (p_facility, p_medicine, auth.uid(), nullif(trim(p_note), ''), v_stock)
  returning * into r;

  perform notify_scope(p_facility, array['district_officer', 'warehouse_manager', 'phc_staff']::user_role[], 'alert',
    'Out of stock now: ' || v_med || ' at ' || f.name,
    'Reported by ' || coalesce(v_who, 'staff') || ' at ' || to_char(r.reported_at at time zone 'Asia/Kolkata', 'HH24:MI')
      || '. Record showed ' || trim(to_char(v_stock, 'FM999999990')) || '.' || coalesce(' ' || r.note, ''),
    'stockout_reports', r.id);
  -- a sub-centre's supplier is its PHC: tell that PHC's staff and doctor too
  if f.type::text = 'shc' and f.supplying_warehouse is not null then
    select * into v_supplier from facilities where id = f.supplying_warehouse;
    perform notify_scope(v_supplier.id, array['phc_staff']::user_role[], 'alert',
      'Out of stock now: ' || v_med || ' at ' || f.name,
      'Your sub-centre has run out. Reported by ' || coalesce(v_who, 'staff') || '.' || coalesce(' ' || r.note, ''),
      'stockout_reports', r.id);
  end if;
  return r;
end $$;

-- withdraw a report (e.g. found more on another shelf)
create or replace function withdraw_stockout(p_id uuid)
returns stockout_reports language plpgsql security definer set search_path = public as $$
declare r stockout_reports;
begin
  select * into r from stockout_reports where id = p_id;
  if r.id is null then raise exception 'Report not found'; end if;
  if not can_write_facility(r.facility_id) then raise exception 'Only this facility''s staff can withdraw it'; end if;
  update stockout_reports set resolved_at = now(), resolved_reason = 'withdrawn' where id = p_id and resolved_at is null returning * into r;
  return r;
end $$;

-- stock arriving closes the report
create or replace function close_stockout_on_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.qty_received > 0 then
    update stockout_reports set resolved_at = now(), resolved_reason = 'stock received'
    where facility_id = new.facility_id and medicine_id = new.medicine_id and resolved_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_close_stockout_on_receipt on stock_log;
create trigger trg_close_stockout_on_receipt after insert on stock_log for each row execute function close_stockout_on_receipt();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stockout_reports') then
    alter publication supabase_realtime add table stockout_reports;
  end if;
end $$;

select 'migration 008 applied' as status;
