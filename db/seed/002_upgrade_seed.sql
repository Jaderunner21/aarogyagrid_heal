-- =====================================================================
-- AarogyaGrid — 002_upgrade_seed.sql   (run after db/migrations/002_upgrade.sql)
--
-- 1. A second state, Gujarat: Aravalli and Sabarkantha districts, one district
--    drug warehouse + 6 PHCs each, the same 15 medicines, and ~14 months of daily
--    history generated exactly like db/base/02_seed.sql. Two Sabarkantha PHCs
--    (Vijaynagar, Poshina) opened ~5 months ago, so they have < 1 year of history
--    and borrow their seasonal pattern from the district / state / nation.
-- 2. Batches with expiry dates for every stock line in both states (a few are
--    near expiry or already expired, to exercise the expiry alerts and write-offs).
--
-- Facility names are real places; coordinates are approximate; all numbers are
-- synthetic. Deterministic (setseed). Takes ~10–30 s.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GEOGRAPHY
-- ---------------------------------------------------------------------
insert into states (name, code) values ('Gujarat', 'GJ') on conflict (code) do nothing;

insert into districts (state_id, name, code)
select s.id, x.name, x.code
from states s, (values ('Aravalli', 'GJ-ARV'), ('Sabarkantha', 'GJ-SKT')) as x(name, code)
where s.code = 'GJ'
on conflict (code) do nothing;

insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, address)
select d.id, 'warehouse', x.name, x.code, x.lat, x.lng, 0, 3, x.addr
from districts d
join (values
  ('GJ-ARV', 'District Drug Warehouse Aravalli',    'WH-ARV', 23.4650, 73.2980, 'Modasa'),
  ('GJ-SKT', 'District Drug Warehouse Sabarkantha', 'WH-SKT', 23.5980, 72.9660, 'Himmatnagar')
) as x(dcode, name, code, lat, lng, addr) on x.dcode = d.code
on conflict (code) do nothing;

insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, supplying_warehouse, opened_on)
select d.id, 'phc', 'PHC ' || x.name, x.code, x.lat, x.lng, x.beds, x.resupply, w.id,
       case when x.new_days is not null then current_date - x.new_days end
from districts d
join (values
  -- Aravalli
  ('GJ-ARV', 'Bhiloda',     'PHC-ARV-01', 23.7470, 73.1530,  6,  7, null::int),
  ('GJ-ARV', 'Meghraj',     'PHC-ARV-02', 23.4990, 73.5040,  6,  7, null),
  ('GJ-ARV', 'Malpur',      'PHC-ARV-03', 23.3600, 73.4650,  4, 10, null),
  ('GJ-ARV', 'Dhansura',    'PHC-ARV-04', 23.3500, 73.2100,  6,  7, null),
  ('GJ-ARV', 'Bayad',       'PHC-ARV-05', 23.2230, 73.2210, 10,  5, null),
  ('GJ-ARV', 'Shamlaji',    'PHC-ARV-06', 23.6880, 73.3870,  4, 10, null),
  -- Sabarkantha
  ('GJ-SKT', 'Idar',        'PHC-SKT-01', 23.8390, 73.0020, 10,  5, null),
  ('GJ-SKT', 'Khedbrahma',  'PHC-SKT-02', 24.0290, 73.0410,  6,  7, null),
  ('GJ-SKT', 'Prantij',     'PHC-SKT-03', 23.4380, 72.8570,  6,  7, null),
  ('GJ-SKT', 'Talod',       'PHC-SKT-04', 23.3500, 72.9500,  6,  7, null),
  ('GJ-SKT', 'Vijaynagar',  'PHC-SKT-05', 23.9960, 73.2520,  4, 10, 150),
  ('GJ-SKT', 'Poshina',     'PHC-SKT-06', 24.3731, 73.0325,  4, 10, 150)
) as x(dcode, name, code, lat, lng, beds, resupply, new_days) on x.dcode = d.code
join facilities w on w.district_id = d.id and w.type = 'warehouse'
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. SIMULATION (same method as db/base/02_seed.sql, Gujarat facilities only)
-- ---------------------------------------------------------------------
create temp table med_profile (medicine text primary key, base numeric, season numeric[]);
insert into med_profile values
  ('Paracetamol 500mg',       60,  '{1.0,0.9,0.9,1.0,1.0,1.1,1.3,1.5,1.6,1.5,1.2,1.1}'),
  ('ORS',                     12,  '{0.6,0.6,0.8,1.2,1.6,1.7,1.8,1.6,1.3,1.0,0.7,0.6}'),
  ('Zinc 20mg',               10,  '{0.6,0.6,0.8,1.2,1.6,1.7,1.8,1.6,1.3,1.0,0.7,0.6}'),
  ('Amoxicillin 500mg',       30,  '{1.3,1.2,1.0,0.9,0.9,1.0,1.1,1.1,1.1,1.0,1.1,1.3}'),
  ('Artemether-Lumefantrine',  4,  '{0.3,0.2,0.2,0.3,0.4,0.7,1.5,2.4,2.8,2.4,1.2,0.5}'),
  ('Chloroquine 250mg',        6,  '{0.3,0.2,0.2,0.3,0.4,0.7,1.5,2.4,2.8,2.4,1.2,0.5}'),
  ('Iron Folic Acid',         40,  '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Metformin 500mg',         25,  '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Amlodipine 5mg',          20,  '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Cetirizine 10mg',         15,  '{1.0,1.3,1.6,1.5,1.1,0.9,0.9,0.9,1.0,1.2,1.1,1.0}'),
  ('Salbutamol 4mg',           8,  '{1.6,1.4,1.1,0.9,0.8,0.8,0.9,0.9,0.9,1.1,1.4,1.6}'),
  ('Albendazole 400mg',        5,  '{1.0,2.5,1.0,1.0,1.0,1.0,1.0,2.5,1.0,1.0,1.0,1.0}'),
  ('Anti-Snake Venom',       0.4,  '{0.2,0.2,0.3,0.5,0.8,1.5,2.5,2.5,2.0,1.2,0.5,0.3}'),
  ('Anti-Rabies Vaccine',    1.5,  '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Metronidazole 400mg',     15,  '{0.8,0.8,0.9,1.1,1.3,1.4,1.4,1.3,1.1,1.0,0.9,0.8}');

create temp table sim_receipts (facility_id uuid, district_id uuid, medicine_id uuid, log_date date, qty numeric);

do $$
declare
  v_days     constant int := 425;
  v_start    date := current_date - v_days;
  f          record;
  m          record;
  v_size     numeric;
  v_supply   numeric;
  v_stock    numeric;
  v_demand   numeric;
  v_used     numeric;
  v_recv     numeric;
  v_day      date;
  v_expected numeric;
  v_wd       numeric;
  v_sum90    numeric;
  v_hist     numeric[];
  v_dates    date[];
  v_useds    numeric[];
  v_recvs    numeric[];
  v_recv_day int;
  v_intensity numeric;
  v_season   numeric;
  v_u        double precision;
  v_first    int;
  i          int;
begin
  perform setseed(0.52);
  perform set_config('heal.skip_stock_trigger', 'on', true);

  for f in select fa.id, fa.district_id, fa.resupply_days, fa.code, fa.opened_on
           from facilities fa join districts d on d.id = fa.district_id
           where fa.type = 'phc' and d.code like 'GJ-%'
             and not exists (select 1 from stock s where s.facility_id = fa.id)
           order by fa.code loop
    v_size := 0.6 + random() * 0.9;
    v_intensity := 0.3 + random() * 1.0;
    v_recv_day := case when f.resupply_days >= 10 then 5 else 1 end;
    -- new PHCs only have history since they opened
    v_first := case when f.opened_on is not null then greatest(0, f.opened_on - v_start) else 0 end;

    for m in select md.id, mp.base, mp.season from medicines md join med_profile mp on mp.medicine = md.name order by md.name loop
      v_u := random();
      v_supply := case
        when v_u < 0.12 then 2.2 + random() * 0.6
        when v_u < 0.22 then 0.5 + random() * 0.2
        else 0.95 + random() * 0.2 end;

      v_hist := '{}'; v_dates := '{}'; v_useds := '{}'; v_recvs := '{}';
      v_sum90 := 0;
      v_stock := round(m.base * v_size * m.season[extract(month from v_start + v_first)::int] * 30);

      for i in v_first .. v_days - 1 loop
        v_day := v_start + i;

        v_recv := 0;
        if extract(day from v_day) = v_recv_day and i > v_first then
          v_expected := case when i - v_first >= 90 then v_sum90 / 90 else m.base * v_size end;
          v_recv := greatest(0, round(v_expected * 40 * v_supply - v_stock));
          v_stock := v_stock + v_recv;
          insert into sim_receipts values (f.id, f.district_id, m.id, v_day, v_recv);
        end if;

        v_wd := case extract(dow from v_day) when 0 then 0.4 when 1 then 1.2 else 1.0 end;
        v_season := greatest(0.1, 1 + (m.season[extract(month from v_day)::int] - 1) * v_intensity);
        v_demand := m.base * v_size * v_season * v_wd * (0.75 + random() * 0.5);
        v_demand := floor(v_demand + random());
        v_used := least(v_demand, v_stock);
        v_stock := v_stock - v_used;

        v_hist := v_hist || v_demand;
        v_sum90 := v_sum90 + v_used - case when i - v_first >= 90 then v_hist[i - v_first - 89] else 0 end;

        v_dates := v_dates || v_day; v_useds := v_useds || v_used; v_recvs := v_recvs || v_recv;
      end loop;

      insert into stock_log (facility_id, medicine_id, log_date, qty_used, qty_received, source, note)
      select f.id, m.id, d, u, r, 'seed', null
      from unnest(v_dates, v_useds, v_recvs) as t(d, u, r);

      insert into stock (facility_id, medicine_id, quantity) values (f.id, m.id, v_stock);
    end loop;
  end loop;
  perform set_config('heal.skip_stock_trigger', 'off', true);
end $$;

do $$
declare
  w record; m record; v_stock numeric; v_factor numeric; r record;
begin
  perform set_config('heal.skip_stock_trigger', 'on', true);
  for w in select fa.id, fa.district_id, fa.code from facilities fa join districts d on d.id = fa.district_id
           where fa.type = 'warehouse' and d.code like 'GJ-%'
             and not exists (select 1 from stock s where s.facility_id = fa.id) loop
    for m in select id, category from medicines loop
      -- Sabarkantha's warehouse runs tight on antimalarials (forces PHC-to-PHC and cross-district moves)
      v_factor := case when w.code = 'WH-SKT' and m.category = 'Antimalarial' then 0.95 else 1.12 end;
      select coalesce(sum(qty), 0) / 14.0 * 1.5 into v_stock
      from sim_receipts where district_id = w.district_id and medicine_id = m.id;
      v_stock := round(v_stock);

      for r in
        select date_trunc('month', log_date)::date as month_start, sum(qty) as issued
        from sim_receipts where district_id = w.district_id and medicine_id = m.id
        group by 1 order by 1
      loop
        insert into stock_log (facility_id, medicine_id, log_date, qty_received, qty_out, source, note)
        values (w.id, m.id, r.month_start, round(r.issued * v_factor), r.issued, 'seed', 'Monthly receipt from state + issues to PHCs');
        v_stock := v_stock + round(r.issued * v_factor) - r.issued;
      end loop;

      insert into stock (facility_id, medicine_id, quantity) values (w.id, m.id, greatest(v_stock, 0));
    end loop;
  end loop;
  perform set_config('heal.skip_stock_trigger', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- 3. DAILY REPORTS (footfall, beds) — from the day each PHC opened
-- ---------------------------------------------------------------------
do $$ begin perform setseed(0.72); end $$;
insert into daily_reports (facility_id, report_date, footfall, occupied_beds)
select f.id, d::date,
       greatest(0, round(45 * sz.size
             * (array[1.0,0.9,0.9,1.0,1.0,1.1,1.3,1.5,1.6,1.5,1.2,1.1])[extract(month from d)::int]
             * case extract(dow from d) when 0 then 0.4 when 1 then 1.2 else 1.0 end
             * (0.8 + random() * 0.4))),
       least(f.total_beds, greatest(0, round(f.total_beds * (0.3 + random() * 0.5)
             * (array[0.8,0.8,0.8,0.9,0.9,1.0,1.2,1.4,1.5,1.4,1.1,0.9])[extract(month from d)::int])))
from facilities f
join districts dd on dd.id = f.district_id
cross join lateral (select 0.6 + random() * 0.9 + 0 * f.total_beds as size) sz
cross join generate_series(current_date - 425, current_date - 1, interval '1 day') d
where f.type = 'phc' and dd.code like 'GJ-%' and d::date >= coalesce(f.opened_on, current_date - 425)
on conflict (facility_id, report_date) do nothing;

-- ---------------------------------------------------------------------
-- 4. STAFF + ATTENDANCE (last 30 days; Malpur has poor attendance)
-- ---------------------------------------------------------------------
do $$
declare
  f record; v_rate numeric;
  first_names text[] := array['Jignesh','Hetal','Bhavesh','Nirali','Kalpesh','Dhara','Mehul','Komal','Chirag','Payal',
                              'Hardik','Falguni','Nilesh','Bhumika','Rakesh','Jyoti','Paresh','Minal','Ketan','Asha'];
  last_names  text[] := array['Patel','Parmar','Solanki','Chauhan','Vasava','Damor','Makwana','Desai','Rathod','Bhagora','Joshi','Shah'];
begin
  perform setseed(0.92);
  for f in select fa.id, fa.code from facilities fa join districts d on d.id = fa.district_id
           where fa.type = 'phc' and d.code like 'GJ-%' and not exists (select 1 from staff s where s.facility_id = fa.id)
           order by fa.code loop
    insert into staff (facility_id, name, role)
    select f.id,
           case when r = 'medical_officer' then 'Dr. ' else '' end ||
           first_names[1 + floor(random() * array_length(first_names, 1))::int] || ' ' ||
           last_names [1 + floor(random() * array_length(last_names, 1))::int],
           r::staff_role
    from unnest(array['medical_officer','nurse','nurse','pharmacist','lab_technician','health_worker','health_worker']) as r;

    v_rate := case when f.code = 'PHC-ARV-03' then 0.58 else 0.88 + random() * 0.1 end;
    insert into attendance (staff_id, att_date, present)
    select s.id, d::date, random() < v_rate
    from staff s cross join generate_series(current_date - 30, current_date - 1, interval '1 day') d
    where s.facility_id = f.id and extract(dow from d) <> 0;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. STARTER FORECASTS + ALERTS for Gujarat (the engine replaces these)
-- ---------------------------------------------------------------------
insert into forecasts (facility_id, medicine_id, method, predicted_daily_use, lower_daily, upper_daily,
                       forecast_7d, forecast_30d, days_left, stockout_date)
select s.facility_id, s.medicine_id, 'seed_moving_average',
       round(a.avg_use, 2), round(a.avg_use * 0.8, 2), round(a.avg_use * 1.2, 2),
       round(a.avg_use * 7), round(a.avg_use * 30),
       case when a.avg_use > 0 then round(s.quantity / a.avg_use, 1) end,
       case when a.avg_use > 0 then current_date + floor(s.quantity / a.avg_use)::int end
from stock s
join facilities f on f.id = s.facility_id
join districts d on d.id = f.district_id
cross join lateral (
  select case when f.type = 'warehouse' then coalesce(sum(l.qty_out), 0) / 30.0
              else coalesce(sum(l.qty_used), 0) / 28.0 end as avg_use
  from stock_log l
  where l.facility_id = s.facility_id and l.medicine_id = s.medicine_id
    and l.log_date >= current_date - case when f.type = 'warehouse' then 30 else 28 end
) a
where d.code like 'GJ-%'
on conflict (facility_id, medicine_id) do nothing;

insert into alerts (facility_id, medicine_id, type, severity, days_left, message)
select vs.facility_id, vs.medicine_id, 'stockout_risk',
       case when vs.status = 'critical' then 'critical' else 'warning' end::alert_severity,
       vs.days_left,
       vs.medicine_name || ': ' || vs.quantity || ' ' || vs.unit || 's left (~' || round(vs.days_left, 1)
         || ' days at ' || round(vs.predicted_daily_use, 1) || '/day). Normal resupply takes '
         || vs.resupply_days || ' days.'
from v_stock_status vs
join districts d on d.id = vs.district_id
where d.code like 'GJ-%' and vs.facility_type = 'phc' and vs.status in ('critical', 'low')
  and not exists (select 1 from alerts a where a.facility_id = vs.facility_id and a.medicine_id = vs.medicine_id
                  and a.type = 'stockout_risk' and a.status <> 'resolved');

drop table if exists med_profile;
drop table if exists sim_receipts;

-- ---------------------------------------------------------------------
-- 6. BATCHES for every stock line in both states (1–3 batches each)
--    ~4% of lines have an already-expired batch, and ~18% one expiring within 90 days.
-- ---------------------------------------------------------------------
do $$
declare s record; v_left numeric; v_n int; k int; v_q numeric; v_exp date; v_u double precision;
begin
  perform setseed(0.33);
  for s in select st.facility_id, st.medicine_id, st.quantity, f.code, m.name
           from stock st join facilities f on f.id = st.facility_id join medicines m on m.id = st.medicine_id
           where st.quantity > 0
             and not exists (select 1 from stock_batches b where b.facility_id = st.facility_id and b.medicine_id = st.medicine_id)
           order by f.code, m.name loop
    v_n := 1 + floor(random() * 3)::int;
    v_left := s.quantity;
    for k in 1 .. v_n loop
      v_q := case when k = v_n then v_left else floor(v_left * (0.3 + random() * 0.4)) end;
      continue when v_q <= 0;
      v_u := random();
      v_exp := case
        when k = 1 and v_u < 0.04 then current_date - (3 + floor(random() * 20))::int     -- already expired
        when k = 1 and v_u < 0.10 then current_date + (5 + floor(random() * 24))::int     -- within 30 days
        when k = 1 and v_u < 0.16 then current_date + (31 + floor(random() * 29))::int    -- within 60 days
        when k = 1 and v_u < 0.22 then current_date + (61 + floor(random() * 29))::int    -- within 90 days
        else current_date + (120 + floor(random() * 600))::int end;
      insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
      values (s.facility_id, s.medicine_id,
              upper(left(regexp_replace(s.name, '[^A-Za-z]', '', 'g'), 3)) || to_char(v_exp, 'YYMM') || '-' || k || lpad((floor(random() * 900) + 100)::text, 3, '0'),
              v_exp, v_q, least(current_date - 7, v_exp - 400 + floor(random() * 60)::int));
      v_left := v_left - v_q;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. CHECK
-- ---------------------------------------------------------------------
select s.name as state, count(distinct f.id) filter (where f.type = 'phc') as phcs,
       count(distinct f.id) filter (where f.type = 'warehouse') as warehouses,
       (select count(*) from stock_batches b join facilities bf on bf.id = b.facility_id join districts bd on bd.id = bf.district_id where bd.state_id = s.id) as batches,
       (select count(*) from stock_batches b join facilities bf on bf.id = b.facility_id join districts bd on bd.id = bf.district_id
         where bd.state_id = s.id and b.expiry_date < current_date + 90) as expiring_within_90d
from states s join districts d on d.state_id = s.id join facilities f on f.district_id = d.id
group by s.id, s.name order by s.name;
