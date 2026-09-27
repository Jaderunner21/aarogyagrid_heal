-- =====================================================================
-- AarogyaGrid — 006_faster_engine_series.sql   (run after 005; safe to re-run)
--
-- engine_series3: the forecasting engine's history per stock line, returned sparse.
-- Only days with entries come back (idx = day number from start_date); the engine
-- fills the other days with zero. Same data as engine_series2, a fraction of the rows,
-- so a whole district loads well inside the database's statement time limit.
-- =====================================================================

create index if not exists stock_log_date_facility on stock_log (log_date, facility_id);

create or replace function engine_series3(p_district uuid default null, p_days int default 425)
returns table (facility_id uuid, medicine_id uuid, facility_type facility_type, district_id uuid,
               resupply_days int, stock numeric, start_date date,
               idx int[], used numeric[], received numeric[], outflow numeric[], wasted numeric[],
               reported_idx int[])
language sql stable security definer set search_path = public as $$
  with fac as (
    select f.id, f.type, f.district_id, f.resupply_days
    from facilities f
    where f.is_active and (p_district is null or f.district_id = p_district)
  ),
  logs as (
    select l.facility_id, l.medicine_id, (l.log_date - (current_date - p_days)) as i,
           l.source::text as source, l.qty_used, l.qty_received, l.qty_out
    from stock_log l join fac on fac.id = l.facility_id
    where l.log_date >= current_date - p_days and l.log_date < current_date
  ),
  agg as (
    select g.facility_id, g.medicine_id, g.i,
           sum(g.qty_used)::numeric as used, sum(g.qty_received)::numeric as received,
           sum(case when g.source = 'wastage' then 0 else g.qty_out end)::numeric as outflow,
           sum(case when g.source = 'wastage' then g.qty_out else 0 end)::numeric as wasted
    from logs g
    group by 1, 2, 3
  ),
  series as (
    select a.facility_id, a.medicine_id,
           array_agg(a.i order by a.i) as idx,
           array_agg(a.used order by a.i) as used,
           array_agg(a.received order by a.i) as received,
           array_agg(a.outflow order by a.i) as outflow,
           array_agg(a.wasted order by a.i) as wasted
    from agg a
    group by 1, 2
  ),
  rep as (
    select g.facility_id, array_agg(distinct g.i order by g.i) as idx
    from logs g
    where g.source <> 'wastage'
    group by 1
  )
  select s.facility_id, s.medicine_id, fac.type, fac.district_id, fac.resupply_days, s.quantity::numeric,
         current_date - p_days,
         coalesce(se.idx, '{}'), coalesce(se.used, '{}'), coalesce(se.received, '{}'),
         coalesce(se.outflow, '{}'), coalesce(se.wasted, '{}'),
         coalesce(r.idx, '{}')
  from stock s
  join fac on fac.id = s.facility_id
  left join series se on se.facility_id = s.facility_id and se.medicine_id = s.medicine_id
  left join rep r on r.facility_id = s.facility_id
$$;
revoke execute on function engine_series3(uuid, int) from public, anon, authenticated;
grant  execute on function engine_series3(uuid, int) to service_role;

select 'migration 006 applied' as status;
