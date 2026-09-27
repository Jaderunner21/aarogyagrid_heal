-- =====================================================================
-- AarogyaGrid — 009_fhir_and_fixes.sql   (run after 008; safe to re-run)
--
-- 1. An index for looking up stock movements by the order or transfer they belong to
--    (the FHIR SupplyDelivery export reads the batches each delivery carried).
-- 2. "We've run out": the person who reported it no longer gets their own notification.
-- =====================================================================

create index if not exists stock_log_ref on stock_log (ref_id) where ref_id is not null;

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
  -- the person who tapped the button already knows
  delete from notifications where ref_table = 'stockout_reports' and ref_id = r.id and user_id = auth.uid();
  return r;
end $$;

select 'migration 009 applied' as status;
