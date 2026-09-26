-- =====================================================================
-- AarogyaGrid — 02_seed.sql  (run after 01_schema.sql)
-- Realistic demo data: 1 state, 3 districts, 3 district drug warehouses,
-- 24 PHCs, 15 essential medicines, ~14 months of daily consumption with
-- real seasonality (monsoon diarrhoea, post-monsoon malaria/fever, winter
-- respiratory, spring allergy, snakebite season, deworming days).
--
-- Supply story built in: monthly top-ups to ~40 days of cover are sized on the
-- *last 90 days* average (how indents are commonly planned), so seasonal medicines run
-- short when a season turns — exactly what forecasting catches early.
--
-- Facility names are real places in Udaipur / Rajsamand / Dungarpur;
-- facility data, coordinates (approximate) and all numbers are SYNTHETIC.
-- Deterministic: same output every run (setseed).
-- Takes ~10-30 s in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. GEOGRAPHY
-- ---------------------------------------------------------------------
insert into states (name, code) values ('Rajasthan', 'RJ');

insert into districts (state_id, name, code)
select s.id, x.name, x.code
from states s, (values ('Udaipur', 'RJ-UDR'), ('Rajsamand', 'RJ-RSD'), ('Dungarpur', 'RJ-DGP')) as x(name, code)
where s.code = 'RJ';

-- warehouses first (PHCs point at them)
insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, address)
select d.id, 'warehouse', x.name, x.code, x.lat, x.lng, 0, 3, x.addr
from districts d
join (values
  ('RJ-UDR', 'District Drug Warehouse Udaipur',   'WH-UDR', 24.5854, 73.7125, 'Udaipur'),
  ('RJ-RSD', 'District Drug Warehouse Rajsamand', 'WH-RSD', 25.0710, 73.8800, 'Rajsamand'),
  ('RJ-DGP', 'District Drug Warehouse Dungarpur', 'WH-DGP', 23.8420, 73.7150, 'Dungarpur')
) as x(dcode, name, code, lat, lng, addr) on x.dcode = d.code;

insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, supplying_warehouse)
select d.id, 'phc', 'PHC ' || x.name, x.code, x.lat, x.lng, x.beds, x.resupply, w.id
from districts d
join (values
  -- Udaipur
  ('RJ-UDR', 'Gogunda',      'PHC-UDR-01', 24.7570, 73.5330,  6,  7),
  ('RJ-UDR', 'Jhadol',       'PHC-UDR-02', 24.3840, 73.5000,  6,  7),
  ('RJ-UDR', 'Kotra',        'PHC-UDR-03', 24.3680, 73.1700,  4, 10),
  ('RJ-UDR', 'Kherwara',     'PHC-UDR-04', 23.9840, 73.5920,  6,  7),
  ('RJ-UDR', 'Rishabhdev',   'PHC-UDR-05', 24.0730, 73.6940,  6,  7),
  ('RJ-UDR', 'Mavli',        'PHC-UDR-06', 24.7870, 73.9850, 10,  7),
  ('RJ-UDR', 'Vallabhnagar', 'PHC-UDR-07', 24.6760, 74.0240,  6,  7),
  ('RJ-UDR', 'Badgaon',      'PHC-UDR-08', 24.6360, 73.7000, 10,  5),
  -- Rajsamand
  ('RJ-RSD', 'Nathdwara',    'PHC-RSD-01', 24.9380, 73.8220, 10,  5),
  ('RJ-RSD', 'Kelwara',      'PHC-RSD-02', 25.1590, 73.5800,  4, 10),
  ('RJ-RSD', 'Amet',         'PHC-RSD-03', 25.3060, 73.9250,  6,  7),
  ('RJ-RSD', 'Deogarh',      'PHC-RSD-04', 25.5250, 73.9050,  6,  7),
  ('RJ-RSD', 'Railmagra',    'PHC-RSD-05', 25.0000, 74.1200,  6,  7),
  ('RJ-RSD', 'Khamnor',      'PHC-RSD-06', 24.9100, 73.6900,  6,  7),
  ('RJ-RSD', 'Bhim',         'PHC-RSD-07', 25.7280, 74.0680,  4, 10),
  ('RJ-RSD', 'Charbhuja',    'PHC-RSD-08', 25.2000, 73.7300,  6,  7),
  -- Dungarpur
  ('RJ-DGP', 'Sagwara',      'PHC-DGP-01', 23.6680, 74.0240, 10,  5),
  ('RJ-DGP', 'Aspur',        'PHC-DGP-02', 23.9600, 74.1000,  6,  7),
  ('RJ-DGP', 'Simalwara',    'PHC-DGP-03', 23.7400, 73.8800,  6,  7),
  ('RJ-DGP', 'Bichhiwara',   'PHC-DGP-04', 23.9500, 73.6000,  6,  7),
  ('RJ-DGP', 'Galiyakot',    'PHC-DGP-05', 23.5350, 74.0200,  6,  7),
  ('RJ-DGP', 'Sabla',        'PHC-DGP-06', 23.8800, 74.0400,  4,  7),
  ('RJ-DGP', 'Chikhli',      'PHC-DGP-07', 23.6000, 73.8000,  4, 10),
  ('RJ-DGP', 'Dovda',        'PHC-DGP-08', 23.8000, 73.6500,  6,  7)
) as x(dcode, name, code, lat, lng, beds, resupply) on x.dcode = d.code
join facilities w on w.district_id = d.id and w.type = 'warehouse';

-- ---------------------------------------------------------------------
-- 2. MEDICINES
-- ---------------------------------------------------------------------
insert into medicines (name, generic_name, strength, unit, category) values
  ('Paracetamol 500mg',            'Paracetamol',                'Tab 500 mg',        'tablet', 'Analgesic / antipyretic'),
  ('ORS',                          'Oral Rehydration Salts',     'WHO sachet 20.5 g', 'sachet', 'Rehydration'),
  ('Zinc 20mg',                    'Zinc sulphate',              'Disp tab 20 mg',    'tablet', 'Diarrhoea adjunct'),
  ('Amoxicillin 500mg',            'Amoxicillin',                'Cap 500 mg',        'capsule','Antibiotic'),
  ('Artemether-Lumefantrine',      'Artemether + Lumefantrine',  'Tab 20/120 mg',     'tablet', 'Antimalarial'),
  ('Chloroquine 250mg',            'Chloroquine phosphate',      'Tab 250 mg',        'tablet', 'Antimalarial'),
  ('Iron Folic Acid',              'Ferrous sulphate + Folic acid','Tab 100 mg/0.5 mg','tablet','Supplement'),
  ('Metformin 500mg',              'Metformin',                  'Tab 500 mg',        'tablet', 'Antidiabetic'),
  ('Amlodipine 5mg',               'Amlodipine',                 'Tab 5 mg',          'tablet', 'Antihypertensive'),
  ('Cetirizine 10mg',              'Cetirizine',                 'Tab 10 mg',         'tablet', 'Antihistamine'),
  ('Salbutamol 4mg',               'Salbutamol',                 'Tab 4 mg',          'tablet', 'Respiratory'),
  ('Albendazole 400mg',            'Albendazole',                'Tab 400 mg',        'tablet', 'Anthelmintic'),
  ('Anti-Snake Venom',             'Polyvalent ASV',             'Inj 10 ml vial',    'vial',   'Antivenom'),
  ('Anti-Rabies Vaccine',          'Rabies vaccine (cell culture)','Inj 1 dose vial', 'vial',   'Vaccine'),
  ('Metronidazole 400mg',          'Metronidazole',              'Tab 400 mg',        'tablet', 'Antibiotic / antiprotozoal');

-- ---------------------------------------------------------------------
-- 3. SIMULATION
-- ---------------------------------------------------------------------
-- demand profile per medicine: base daily use at an average PHC + monthly season index (Jan..Dec)
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
  i          int;
begin
  perform setseed(0.42);
  perform set_config('heal.skip_stock_trigger', 'on', true);

  for f in select id, district_id, resupply_days, code from facilities where type = 'phc' order by code loop
    v_size := 0.6 + random() * 0.9;                       -- facility size factor 0.6 .. 1.5
    v_intensity := 0.3 + random() * 1.0;                  -- how strongly seasons hit this area (0.3 mild .. 1.3 severe)
    v_recv_day := case when f.resupply_days >= 10 then 5 else 1 end;   -- remote PHCs receive later in the month

    for m in select md.id, mp.base, mp.season from medicines md join med_profile mp on mp.medicine = md.name order by md.name loop
      -- how generously this PHC gets supplied for this medicine
      v_u := random();
      v_supply := case
        when v_u < 0.12 then 2.2 + random() * 0.6           -- hoarding / over-supplied (future donors)
        when v_u < 0.22 then 0.5 + random() * 0.2           -- chronically under-supplied
        else 0.95 + random() * 0.2 end;

      v_hist := '{}'; v_dates := '{}'; v_useds := '{}'; v_recvs := '{}';
      v_sum90 := 0;
      v_stock := round(m.base * v_size * m.season[extract(month from v_start)::int] * 30);

      for i in 0 .. v_days - 1 loop
        v_day := v_start + i;

        -- monthly top-up to ~40 days of cover, sized on the trailing 90-day average
        -- (standard min-max indenting; it misses upcoming seasonal turns)
        v_recv := 0;
        if extract(day from v_day) = v_recv_day and i > 0 then
          v_expected := case when i >= 90 then v_sum90 / 90 else m.base * v_size end;
          v_recv := greatest(0, round(v_expected * 40 * v_supply - v_stock));
          v_stock := v_stock + v_recv;
          insert into sim_receipts values (f.id, f.district_id, m.id, v_day, v_recv);
        end if;

        -- today's demand: base x size x season x weekday x noise, stochastic rounding
        v_wd := case extract(dow from v_day) when 0 then 0.4 when 1 then 1.2 else 1.0 end;
        v_season := greatest(0.1, 1 + (m.season[extract(month from v_day)::int] - 1) * v_intensity);
        v_demand := m.base * v_size * v_season * v_wd * (0.75 + random() * 0.5);
        v_demand := floor(v_demand + random());
        v_used := least(v_demand, v_stock);                 -- stock-out = demand unmet
        v_stock := v_stock - v_used;

        v_hist := v_hist || v_demand;                       -- planners size orders on demand (incl. unmet)
        v_sum90 := v_sum90 + v_used - case when i >= 90 then v_hist[i - 89] else 0 end;

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

-- warehouses: receive from the state corporation each month and issue to their PHCs
do $$
declare
  w record; m record; v_start date := current_date - 425; v_stock numeric; v_factor numeric; r record; v_cat text;
begin
  perform set_config('heal.skip_stock_trigger', 'on', true);
  for w in select id, district_id, code from facilities where type = 'warehouse' loop
    for m in select id, category from medicines loop
      -- the Dungarpur warehouse is tight on antimalarials and antivenom (forces PHC-to-PHC redistribution)
      v_factor := case when w.code = 'WH-DGP' and m.category in ('Antimalarial', 'Antivenom') then 0.97 else 1.12 end;
      select coalesce(sum(qty), 0) / 14.0 * 1.5 into v_stock        -- opening buffer ~1.5 months of issues
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
-- 4. DAILY REPORTS (footfall, beds)
-- ---------------------------------------------------------------------
do $$ begin perform setseed(0.7); end $$;
insert into daily_reports (facility_id, report_date, footfall, occupied_beds)
select f.id, d::date,
       greatest(0, round(45 * sz.size
             * (array[1.0,0.9,0.9,1.0,1.0,1.1,1.3,1.5,1.6,1.5,1.2,1.1])[extract(month from d)::int]
             * case extract(dow from d) when 0 then 0.4 when 1 then 1.2 else 1.0 end
             * (0.8 + random() * 0.4))),
       least(f.total_beds, greatest(0, round(f.total_beds * (0.3 + random() * 0.5)
             * (array[0.8,0.8,0.8,0.9,0.9,1.0,1.2,1.4,1.5,1.4,1.1,0.9])[extract(month from d)::int])))
from facilities f
cross join lateral (select 0.6 + random() * 0.9 + 0 * f.total_beds as size) sz
cross join generate_series(current_date - 425, current_date - 1, interval '1 day') d
where f.type = 'phc';

-- ---------------------------------------------------------------------
-- 5. STAFF + ATTENDANCE (last 30 days; Kotra and Bhim have poor attendance)
-- ---------------------------------------------------------------------
do $$
declare
  f record; v_rate numeric; k int;
  first_names text[] := array['Ramesh','Sunita','Mahesh','Kavita','Dinesh','Pooja','Rajendra','Meena','Suresh','Anita',
                              'Mukesh','Rekha','Vikram','Priya','Lokesh','Sarita','Hemant','Kiran','Bharat','Geeta'];
  last_names  text[] := array['Meena','Sharma','Garasia','Patel','Rawat','Joshi','Kumawat','Bhil','Choudhary','Jain','Paliwal','Dangi'];
begin
  perform setseed(0.9);
  for f in select id, code from facilities where type = 'phc' order by code loop
    insert into staff (facility_id, name, role)
    select f.id,
           case when r = 'medical_officer' then 'Dr. ' else '' end ||
           first_names[1 + floor(random() * array_length(first_names, 1))::int] || ' ' ||
           last_names [1 + floor(random() * array_length(last_names, 1))::int],
           r::staff_role
    from unnest(array['medical_officer','nurse','nurse','pharmacist','lab_technician','health_worker','health_worker']) as r;

    v_rate := case when f.code in ('PHC-UDR-03', 'PHC-RSD-07') then 0.55 else 0.88 + random() * 0.1 end;
    insert into attendance (staff_id, att_date, present)
    select s.id, d::date, random() < v_rate
    from staff s cross join generate_series(current_date - 30, current_date - 1, interval '1 day') d
    where s.facility_id = f.id and extract(dow from d) <> 0;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. STARTER FORECASTS (simple 28-day average so the UI has data on day one;
--    the real engine overwrites these with method 'holt_winters_yearly_adj')
-- ---------------------------------------------------------------------
insert into forecasts (facility_id, medicine_id, method, predicted_daily_use, lower_daily, upper_daily,
                       forecast_7d, forecast_30d, days_left, stockout_date)
select s.facility_id, s.medicine_id, 'seed_moving_average',
       round(a.avg_use, 2), round(a.avg_use * 0.8, 2), round(a.avg_use * 1.2, 2),
       round(a.avg_use * 7), round(a.avg_use * 30),
       case when a.avg_use > 0 then round(s.quantity / a.avg_use, 1) end,
       case when a.avg_use > 0 then current_date + floor(s.quantity / a.avg_use)::int end
from stock s
cross join lateral (
  select case when fx.type = 'warehouse' then coalesce(sum(l.qty_out), 0) / 30.0
              else coalesce(sum(l.qty_used), 0) / 28.0 end as avg_use
  from facilities fx
  left join stock_log l on l.facility_id = fx.id and l.medicine_id = s.medicine_id
       and l.log_date >= current_date - case when fx.type = 'warehouse' then 30 else 28 end
  where fx.id = s.facility_id
  group by fx.type
) a;

-- ---------------------------------------------------------------------
-- 7. STARTER ALERTS
-- ---------------------------------------------------------------------
insert into alerts (facility_id, medicine_id, type, severity, days_left, message)
select vs.facility_id, vs.medicine_id, 'stockout_risk',
       case when vs.status = 'critical' then 'critical' else 'warning' end::alert_severity,
       vs.days_left,
       vs.medicine_name || ': ' || vs.quantity || ' ' || vs.unit || 's left (~' || round(vs.days_left, 1)
         || ' days at ' || round(vs.predicted_daily_use, 1) || '/day). Normal resupply takes '
         || vs.resupply_days || ' days.'
from v_stock_status vs
where vs.facility_type = 'phc' and vs.status in ('critical', 'low');

-- v_stock_status is security_invoker; in the SQL editor you run as the table owner, so all rows are visible.

insert into alerts (facility_id, type, severity, message)
select fsum.facility_id, 'staff_shortage', 'warning',
       'Staff attendance ' || round(fsum.rate * 100) || '% over the last 7 days (threshold 70%).'
from (
  select st.facility_id, avg(case when a.present then 1 else 0 end) as rate
  from attendance a join staff st on st.id = a.staff_id
  where a.att_date > current_date - 7
  group by st.facility_id
) fsum
where fsum.rate < 0.7;

-- ---------------------------------------------------------------------
-- 8. STARTER RECOMMENDATIONS (the engine regenerates these properly)
--    critical PHC item -> nearest facility with surplus, same district first
-- ---------------------------------------------------------------------
with need as (
  select vs.facility_id, vs.medicine_id, vs.district_id, vs.lat, vs.lng, vs.predicted_daily_use,
         greatest(round(vs.predicted_daily_use * 30 - vs.quantity), 1) as need_qty,
         a.id as alert_id
  from v_stock_status vs
  join alerts a on a.facility_id = vs.facility_id and a.medicine_id = vs.medicine_id and a.type = 'stockout_risk'
  where vs.facility_type = 'phc' and vs.status = 'critical'
),
pick as (
  select n.*, d.facility_id as donor_id, d.district_id as donor_district, d.spare,
         round(haversine_km(n.lat, n.lng, d.lat, d.lng)::numeric, 1) as km
  from need n
  cross join lateral (
    select vs2.facility_id, vs2.district_id, vs2.lat, vs2.lng,
           floor(vs2.quantity - vs2.predicted_daily_use * 45) as spare
    from v_stock_status vs2
    where vs2.medicine_id = n.medicine_id
      and vs2.facility_type = 'phc'
      and vs2.facility_id <> n.facility_id
      and vs2.days_left > 60
      and vs2.quantity - vs2.predicted_daily_use * 45 >= 10
      and haversine_km(n.lat, n.lng, vs2.lat, vs2.lng) <= 80
    order by (vs2.district_id <> n.district_id), haversine_km(n.lat, n.lng, vs2.lat, vs2.lng)
    limit 1
  ) d
)
insert into transfers (medicine_id, from_facility_id, to_facility_id, qty, distance_km, is_cross_district,
                       origin, priority, ai_reason, alert_id)
select p.medicine_id, p.donor_id, p.facility_id, least(p.need_qty, p.spare), p.km,
       p.donor_district <> p.district_id, 'ai', 1,
       'Receiver will run out before normal resupply; donor holds more than 60 days of stock and keeps 45 days after this transfer. Distance '
         || p.km || ' km.',
       p.alert_id
from pick p;

-- critical items with no donor nearby -> AI indent to the district warehouse
insert into indents (facility_id, warehouse_id, medicine_id, qty_requested, origin, ai_reason)
select vs.facility_id, f.supplying_warehouse, vs.medicine_id,
       greatest(round(vs.predicted_daily_use * 30 - vs.quantity), 1), 'ai',
       'No facility within 80 km has spare stock; request 30 days of cover from the district warehouse.'
from v_stock_status vs
join facilities f on f.id = vs.facility_id
where vs.facility_type = 'phc' and vs.status = 'critical'
  and not exists (select 1 from transfers t where t.to_facility_id = vs.facility_id and t.medicine_id = vs.medicine_id);

-- move a few recommendations along the pipeline so every column of the board has something
with ranked as (
  select id, row_number() over (order by created_at, id) as rn from transfers where not is_cross_district
)
update transfers t set status = 'approved', approved_at = now() - interval '1 day',
       carrier_type = 'warehouse_vehicle', carrier_name = 'District van RJ27-GA-1024'
from ranked r where r.id = t.id and r.rn in (1, 2);

-- dispatched: deduct from donor through the normal trigger
with ranked as (
  select id, row_number() over (order by created_at, id) as rn from transfers where not is_cross_district and status = 'proposed'
), picked as (
  update transfers t set status = 'dispatched', approved_at = now() - interval '2 days', dispatched_at = now() - interval '6 hours',
         carrier_type = 'facility_staff', carrier_name = 'Pharmacist (sending PHC)'
  from ranked r where r.id = t.id and r.rn = 1
  returning t.*
)
insert into stock_log (facility_id, medicine_id, qty_out, source, ref_id, note)
select from_facility_id, medicine_id, qty, 'transfer', id, 'Transfer dispatched (seed)' from picked;

-- ---------------------------------------------------------------------
-- 9. QUICK CHECK (should show a handful of critical PHCs per district)
-- ---------------------------------------------------------------------
drop table if exists med_profile;
drop table if exists sim_receipts;

select district_name, status, count(*) from v_stock_status
where facility_type = 'phc' group by 1, 2 order by 1, 2;
