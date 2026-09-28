-- =====================================================================
-- AarogyaGrid — realistic_month.sql   (DEMO DATA)
--
-- Makes the demo look like an ordinary month in a district: most shelves hold one to three
-- months of stock, a few items are low, and a handful of places have a real shortage.
-- It records the last monthly supply each facility received (dated on its last reporting
-- day, so no new "reported" day appears in its history) and leaves the rest alone:
--   * about 1 in 12 stock lines keep whatever they have (the everyday gaps)
--   * about 1 in 12 are topped up only to "low" (under two deliveries' worth)
--   * everything else to 30–90 days of forecast use; warehouses to 100–200 days
--   * story lines kept short: Sub-centre Obri (Chloroquine, malaria test kits) so its PHC
--     can be seen supplying it, and oxygen at District Hospital Dungarpur (ICU full)
-- Notifications already sent are marked read. Then run the analysis (nightly job, or
-- "Run analysis" as a district officer) to refresh alerts and suggestions.
-- Needs forecasts to exist (the analysis has run at least once).
-- =====================================================================

do $$
declare
  p record; v_target numeric; v_qty numeric; v_day date; v_lines int := 0; v_units numeric := 0;
begin
  for p in
    select s.facility_id, s.medicine_id, s.quantity, f.type::text as ftype, f.code, f.resupply_days, m.name,
           fc.predicted_daily_use as pdu,
           abs(hashtext(s.facility_id::text || ':' || s.medicine_id::text)) % 100 as h
    from stock s
    join facilities f on f.id = s.facility_id and f.is_active
    join medicines m on m.id = s.medicine_id and m.status = 'active'
    join forecasts fc on fc.facility_id = s.facility_id and fc.medicine_id = s.medicine_id
    where fc.predicted_daily_use > 0
  loop
    -- story shortages stay as they are
    continue when p.code = 'SHC-DGP-01' and p.name in ('Chloroquine 250mg', 'Malaria Rapid Test Kit');
    continue when p.code = 'DH-DGP' and p.name = 'Medical Oxygen Cylinder (D-type)';
    -- an item already reported out by staff stays out
    continue when exists (select 1 from stockout_reports r where r.facility_id = p.facility_id and r.medicine_id = p.medicine_id and r.resolved_at is null);

    if p.ftype = 'warehouse' then
      v_target := p.pdu * (100 + p.h);                         -- 100–199 days
    elsif p.h < 8 then
      continue;                                                -- the everyday gaps
    elsif p.h < 16 then
      v_target := p.pdu * p.resupply_days * 1.6;               -- low, not critical
    else
      v_target := p.pdu * (30 + (p.h * 61 / 100));             -- 30–90 days
    end if;

    v_qty := ceil((v_target - p.quantity) / 10.0) * 10;
    continue when v_qty <= 0;

    -- the facility's last reporting day before today (keeps the history's reported days unchanged)
    select max(log_date) into v_day from stock_log
    where facility_id = p.facility_id and log_date < current_date and source::text <> 'wastage';
    v_day := coalesce(v_day, current_date - 1);

    insert into stock_log (facility_id, medicine_id, log_date, qty_received, source, note)
    values (p.facility_id, p.medicine_id, v_day, v_qty, 'manual', 'Monthly supply received');
    v_lines := v_lines + 1;
    v_units := v_units + v_qty;
  end loop;

  update notifications set read_at = now() where read_at is null;
  raise notice 'Restocked % stock lines (% units). Now run the analysis.', v_lines, v_units;
end $$;

select 'realistic month applied: now run the analysis' as status;
