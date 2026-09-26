-- =====================================================================
-- AarogyaGrid — simulate_outbreak.sql   (DEMO ONLY)
--
-- Simulates a diarrhoea/fever outbreak in Dungarpur: at PHC Sagwara, Simalwara and
-- Bichhiwara, Paracetamol and ORS use jumps to ~3x normal for the last 4 days
-- (3 days ago → today) and patient footfall roughly doubles. An emergency
-- supply is received 4 days ago so the extra use never takes stock below zero.
--
-- After running it, open the app as the Dungarpur district officer (or state /
-- national admin) and press "Run analysis": the engine raises demand-surge
-- alerts at the three PHCs and a "possible outbreak" alert for the district.
-- Running it twice doubles the spike; reset the demo data to undo it.
-- =====================================================================

do $$
declare
  f record; m record; v_base numeric; v_extra numeric; k int;
begin
  for f in select id, code, name from facilities where code in ('PHC-DGP-01', 'PHC-DGP-03', 'PHC-DGP-04') loop
    for m in select id, name from medicines where name in ('Paracetamol 500mg', 'ORS') loop
      -- normal daily use: average of the 28 days before the spike (at least 10/day so the spike is visible)
      select greatest(10, coalesce(sum(qty_used), 0) / 28.0) into v_base
      from stock_log where facility_id = f.id and medicine_id = m.id
        and log_date between current_date - 31 and current_date - 4;
      v_extra := round(v_base * 2);                      -- on top of normal use -> ~3x

      -- emergency supply first, sized for the whole spike
      insert into stock_log (facility_id, medicine_id, log_date, qty_received, source, note)
      values (f.id, m.id, current_date - 4, v_extra * 4 + round(v_base * 4), 'manual', 'Emergency supply (outbreak simulation)');

      for k in 0 .. 3 loop
        insert into stock_log (facility_id, medicine_id, log_date, qty_used, source, note)
        values (f.id, m.id, current_date - k,
                v_extra + case when k = 0 then round(v_base) else 0 end,   -- today has no normal entry yet
                'manual', 'Outbreak simulation: surge in cases');
      end loop;
    end loop;

    -- footfall roughly doubles over the same days
    insert into daily_reports (facility_id, report_date, footfall, occupied_beds)
    select f.id, current_date - g.n, 0, 0 from generate_series(0, 3) as g(n)
    on conflict (facility_id, report_date) do nothing;
    update daily_reports r
       set footfall = greatest(r.footfall, 40) * 2 + 15,
           occupied_beds = (select total_beds from facilities where id = f.id)
     where r.facility_id = f.id and r.report_date between current_date - 3 and current_date;
  end loop;
end $$;

select f.name as facility, m.name as medicine,
       sum(l.qty_used) filter (where l.log_date >= current_date - 3) as used_last_4_days,
       round(sum(l.qty_used) filter (where l.log_date between current_date - 31 and current_date - 4) / 28.0, 1) as normal_per_day
from stock_log l
join facilities f on f.id = l.facility_id
join medicines m on m.id = l.medicine_id
where f.code in ('PHC-DGP-01', 'PHC-DGP-03', 'PHC-DGP-04') and m.name in ('Paracetamol 500mg', 'ORS')
group by f.name, m.name order by f.name, m.name;
