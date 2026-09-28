-- =====================================================================
-- AarogyaGrid — fill_history_gap.sql   (DEMO DATA, safe to re-run)
--
-- When demo data files are loaded on different days, some items' daily history stops a few days
-- before others at the same facility. Those days then look like "reported, none of this item used",
-- which drags the forecasts down. This fills each item's missing days, up to the last day its
-- facility reported, with that item's usual use there (the average of its previous 28 days, with
-- a little day-to-day variation), never more than the stock on hand. Then run the analysis.
-- =====================================================================

do $$
declare
  p record; d date; v_avg numeric; v_qty numeric; v_stock numeric; v_rows int := 0;
begin
  for p in
    with fac_last as (
      select facility_id, max(log_date) as last_day
      from stock_log
      where source::text in ('seed', 'manual', 'voice') and log_date < current_date
      group by facility_id
    ),
    item_last as (
      select facility_id, medicine_id, max(log_date) as last_day
      from stock_log
      where source::text = 'seed' and log_date < current_date
      group by facility_id, medicine_id
    )
    select i.facility_id, i.medicine_id, i.last_day as item_last, f.last_day as fac_last
    from item_last i
    join fac_last f on f.facility_id = i.facility_id
    join facilities fx on fx.id = i.facility_id and fx.type::text <> 'warehouse'
    where i.last_day < f.last_day and f.last_day - i.last_day <= 14
  loop
    select coalesce(avg(qty_used), 0) into v_avg from stock_log
    where facility_id = p.facility_id and medicine_id = p.medicine_id
      and log_date > p.item_last - 28 and log_date <= p.item_last and source::text = 'seed';
    continue when v_avg <= 0;

    d := p.item_last + 1;
    while d <= p.fac_last loop
      -- skip a day that already has a use entry for this item
      if not exists (select 1 from stock_log where facility_id = p.facility_id and medicine_id = p.medicine_id
                     and log_date = d and qty_used > 0) then
        v_qty := round(v_avg * (0.8 + (abs(hashtext(p.facility_id::text || p.medicine_id::text || d::text)) % 41) / 100.0));
        select quantity into v_stock from stock where facility_id = p.facility_id and medicine_id = p.medicine_id;
        v_qty := least(v_qty, greatest(coalesce(v_stock, 0), 0));
        if v_qty > 0 then
          insert into stock_log (facility_id, medicine_id, log_date, qty_used, source)
          values (p.facility_id, p.medicine_id, d, v_qty, 'seed');
          v_rows := v_rows + 1;
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  raise notice 'Filled % item-days. Now run the analysis.', v_rows;
end $$;

select 'history gap filled: now run the analysis' as status;
