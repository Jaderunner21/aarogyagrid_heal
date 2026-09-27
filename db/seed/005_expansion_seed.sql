-- =====================================================================
-- AarogyaGrid — 005_expansion_seed.sql   (run after db/migrations/005_hierarchy_items_beds.sql)
--
-- 1. Item types: the existing 15 medicines are classified and put on the tier catalogue
--    (a subset on sub-centres, all on district hospitals); 11 new items: oxygen, consumables,
--    diagnostics, a vaccine and two maternal medicines kept only at 24x7 PHCs and above.
-- 2. PHCs with 6+ beds become 24x7; new facilities in Dungarpur and Aravalli: a district hospital,
--    a CHC and 12 sub-centres (3 under each of four PHCs, supplied by that PHC).
-- 3. Beds by type for every facility with beds, and daily occupancy by type.
-- 4. ~6 months of history for every new facility–item line (the new facilities and items joined
--    the system half a year ago); oxygen use follows critical-care bed occupancy.
-- 5. Batches, staff, attendance statuses, HFR ids, LaQshya certifications, Jan Aushadhi Kendras.
--
-- Facility names are real places; sub-centre names and all coordinates are approximate;
-- all numbers and registry ids are synthetic. Deterministic (setseed). Takes ~20–60 s.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. HELPERS
-- ---------------------------------------------------------------------
-- GS1 GTIN-13 check digit
create or replace function pg_temp.gtin13(p12 text) returns text language sql immutable as $$
  select p12 || ((10 - (sum(substr(p12, i, 1)::int * case when i % 2 = 0 then 3 else 1 end) % 10)) % 10)::text
  from generate_series(1, 12) i
$$;

-- ---------------------------------------------------------------------
-- 1. ITEMS
-- ---------------------------------------------------------------------
update medicines set item_type = 'vaccine' where name = 'Anti-Rabies Vaccine' and item_type = 'medicine';

-- tier catalogue for the original 15: every one at district hospitals; a primary-care subset at sub-centres
update medicines set stocked_at = array(select distinct unnest(stocked_at || array['dh']::facility_type[]))
where state_id is null and not ('dh' = any (stocked_at));
update medicines set stocked_at = array(select distinct unnest(stocked_at || array['shc']::facility_type[]))
where state_id is null and not ('shc' = any (stocked_at))
  and name in ('Paracetamol 500mg', 'ORS', 'Zinc 20mg', 'Iron Folic Acid', 'Albendazole 400mg', 'Chloroquine 250mg',
               'Amoxicillin 500mg', 'Cetirizine 10mg', 'Metformin 500mg', 'Amlodipine 5mg');

insert into medicines (name, generic_name, strength, unit, category, is_chronic, stocked_at, item_type, phc_24x7_only, program)
select x.name, x.generic, x.strength, x.unit, x.category, false, x.stocked::facility_type[], x.item_type, x.only24, x.program
from (values
  ('Medical Oxygen Cylinder (D-type)', 'Oxygen', '46.7 L', 'cylinder', 'Medical gas', '{chc,dh,warehouse}', 'oxygen', false, null),
  ('Oxygen Cylinder (B-type, portable)', 'Oxygen', '10 L', 'cylinder', 'Medical gas', '{phc,warehouse}', 'oxygen', true, null),
  ('Oxytocin 10 IU Injection', 'Oxytocin', '10 IU/ml', 'ampoule', 'Uterotonic', '{phc,chc,dh,warehouse}', 'medicine', true, 'maternal'),
  ('Magnesium Sulphate 50% Injection', 'Magnesium sulphate', '50% w/v', 'ampoule', 'Anticonvulsant', '{phc,chc,dh,warehouse}', 'medicine', true, 'maternal'),
  ('Disposable Syringe 5 ml', null, '5 ml', 'piece', 'Syringes & needles', '{shc,phc,chc,dh,warehouse}', 'consumable', false, null),
  ('Surgical Gloves (sterile)', null, 'size 7', 'pair', 'Gloves', '{shc,phc,chc,dh,warehouse}', 'consumable', false, null),
  ('N95 Mask', null, null, 'piece', 'Protective equipment', '{phc,chc,dh,warehouse}', 'consumable', false, null),
  ('IV Infusion Set', null, null, 'piece', 'IV consumables', '{phc,chc,dh,warehouse}', 'consumable', false, null),
  ('Malaria Rapid Test Kit', 'Pf/Pv antigen RDT', null, 'test', 'Rapid tests', '{shc,phc,chc,dh,warehouse}', 'diagnostic', false, null),
  ('Urine Pregnancy Test Kit', 'hCG card', null, 'test', 'Rapid tests', '{shc,phc,chc,dh,warehouse}', 'diagnostic', false, 'maternal'),
  ('Td Vaccine', 'Tetanus-diphtheria', '0.5 ml', 'vial', 'Vaccine', '{shc,phc,chc,dh,warehouse}', 'vaccine', false, 'maternal')
) as x(name, generic, strength, unit, category, stocked, item_type, only24, program)
where not exists (select 1 from medicines m where lower(m.name) = lower(x.name));

-- synthetic GS1 barcodes (GTIN-13, India prefix 890) for every national item
with numbered as (
  select id, row_number() over (order by name) as n from medicines where state_id is null and gtin is null
)
update medicines m set gtin = pg_temp.gtin13('8901234' || lpad((500 + n.n)::text, 5, '0'))
from numbered n where n.id = m.id;

-- ---------------------------------------------------------------------
-- 2. FACILITIES
-- ---------------------------------------------------------------------
update facilities set phc_24x7 = true where type = 'phc' and total_beds >= 6 and not phc_24x7;

insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, supplying_warehouse, address, phc_24x7)
select d.id, x.type::facility_type, x.name, x.code, x.lat, x.lng, 0, x.resupply, w.id, x.addr, false
from districts d
join (values
  ('RJ-DGP', 'dh',  'District Hospital Dungarpur', 'DH-DGP',     23.8335, 73.7050, 3, 'Dungarpur'),
  ('RJ-DGP', 'chc', 'CHC Jhonthri',                'CHC-DGP-01', 23.9020, 73.7650, 5, 'Jhonthri'),
  ('GJ-ARV', 'dh',  'District Hospital Aravalli',  'DH-ARV',     23.4700, 73.3070, 3, 'Modasa'),
  ('GJ-ARV', 'chc', 'CHC Tintoi',                  'CHC-ARV-01', 23.5570, 73.3470, 5, 'Tintoi')
) as x(dcode, type, name, code, lat, lng, resupply, addr) on x.dcode = d.code
join facilities w on w.district_id = d.id and w.type = 'warehouse'
on conflict (code) do nothing;

-- sub-centres: supplied by their PHC, positioned a few km from it
insert into facilities (district_id, type, name, code, lat, lng, total_beds, resupply_days, supplying_warehouse, address)
select p.district_id, 'shc', 'SHC ' || x.name, x.code, p.lat + x.dlat, p.lng + x.dlng, 0, 7, p.id, x.name
from (values
  ('PHC-DGP-01', 'Obri',       'SHC-DGP-01',  0.040, -0.050),
  ('PHC-DGP-01', 'Jetana',     'SHC-DGP-02', -0.030, -0.060),
  ('PHC-DGP-01', 'Poonali',    'SHC-DGP-03',  0.070, -0.020),
  ('PHC-DGP-03', 'Pindawal',   'SHC-DGP-04',  0.050,  0.030),
  ('PHC-DGP-03', 'Dhambola',   'SHC-DGP-05', -0.040,  0.020),
  ('PHC-DGP-03', 'Rampur',     'SHC-DGP-06',  0.020, -0.060),
  ('PHC-ARV-03', 'Anandpura',  'SHC-ARV-01',  0.050, -0.040),
  ('PHC-ARV-03', 'Ambaliyara', 'SHC-ARV-02',  0.020, -0.070),
  ('PHC-ARV-03', 'Dholiya',    'SHC-ARV-03', -0.020, -0.050),
  ('PHC-ARV-01', 'Torda',      'SHC-ARV-04',  0.050,  0.040),
  ('PHC-ARV-01', 'Jitpur',     'SHC-ARV-05', -0.030,  0.050),
  ('PHC-ARV-01', 'Kishangadh', 'SHC-ARV-06', -0.060,  0.020)
) as x(parent, name, code, dlat, dlng)
join facilities p on p.code = x.parent
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. BEDS BY TYPE
-- ---------------------------------------------------------------------
-- existing PHCs: 24x7 ones have 2 labour/maternity beds, day-only ones keep observation beds
insert into facility_beds (facility_id, bed_type, total)
select f.id, b.bed_type, b.total
from facilities f
cross join lateral (
  select 'maternity' as bed_type, 2 as total where f.phc_24x7
  union all select 'general', f.total_beds - 2 where f.phc_24x7 and f.total_beds > 2
  union all select 'observation', f.total_beds where not f.phc_24x7 and f.total_beds > 0
) b
where f.type = 'phc' and not exists (select 1 from facility_beds fb where fb.facility_id = f.id);

insert into facility_beds (facility_id, bed_type, total)
select f.id, x.bed_type, x.total
from facilities f
join (values
  ('chc', 'general', 18), ('chc', 'maternity', 6), ('chc', 'paediatric', 4), ('chc', 'isolation', 2), ('chc', 'hdu', 2),
  ('dh', 'general', 60), ('dh', 'maternity', 24), ('dh', 'paediatric', 16), ('dh', 'isolation', 6),
  ('dh', 'icu', 8), ('dh', 'hdu', 6), ('dh', 'nicu', 12)
) as x(ftype, bed_type, total) on x.ftype = f.type::text
where not exists (select 1 from facility_beds fb where fb.facility_id = f.id);

-- ---------------------------------------------------------------------
-- 4. DAILY REPORTS + OCCUPANCY BY TYPE
-- ---------------------------------------------------------------------
do $$ begin perform setseed(0.41); end $$;

-- footfall for the new facilities (~6 months)
insert into daily_reports (facility_id, report_date, footfall, occupied_beds)
select f.id, d::date,
       greatest(0, round(case f.type::text when 'shc' then 14 when 'chc' then 140 else 480 end
             * (array[1.0,0.9,0.9,1.0,1.0,1.1,1.3,1.5,1.6,1.5,1.2,1.1])[extract(month from d)::int]
             * case extract(dow from d) when 0 then 0.35 when 1 then 1.2 else 1.0 end
             * (0.8 + random() * 0.4))), 0
from facilities f
cross join generate_series(current_date - 180, current_date - 1, interval '1 day') d
where f.type::text in ('shc', 'chc', 'dh')
on conflict (facility_id, report_date) do nothing;

-- existing PHCs: split each day's occupied beds across their bed types
insert into daily_bed_occupancy (facility_id, report_date, bed_type, occupied)
select r.facility_id, r.report_date, fb.bed_type,
       case
         when fb.bed_type = 'observation' then least(fb.total, r.occupied_beds)
         when fb.bed_type = 'maternity'   then least(fb.total, round(r.occupied_beds * 0.3)::int)
         else least(fb.total, r.occupied_beds - least(2, round(r.occupied_beds * 0.3)::int))
       end
from daily_reports r
join facilities f on f.id = r.facility_id and f.type = 'phc'
join facility_beds fb on fb.facility_id = f.id
where r.report_date >= current_date - 425
on conflict do nothing;

-- CHCs and district hospitals: occupancy by type with seasons; Dungarpur's ICU fills up during the outbreak
insert into daily_bed_occupancy (facility_id, report_date, bed_type, occupied)
select fb.facility_id, d::date, fb.bed_type,
       least(fb.total, greatest(0, round(fb.total
         * case fb.bed_type when 'icu' then 0.72 when 'hdu' then 0.6 when 'nicu' then 0.7 when 'maternity' then 0.62
                            when 'paediatric' then 0.55 when 'isolation' then 0.2 else 0.66 end
         * (array[0.85,0.85,0.85,0.9,0.95,1.05,1.2,1.3,1.35,1.25,1.05,0.9])[extract(month from d)::int]
         * (0.85 + random() * 0.3)
         + case when f.code = 'DH-DGP' and fb.bed_type in ('icu', 'hdu') and d::date >= current_date - 4 then fb.total else 0 end))::int)
from facility_beds fb
join facilities f on f.id = fb.facility_id and f.type::text in ('chc', 'dh')
cross join generate_series(current_date - 180, current_date - 1, interval '1 day') d
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. HISTORY FOR EVERY NEW FACILITY–ITEM LINE (~6 months)
-- ---------------------------------------------------------------------
create temp table item_profile (item text primary key, base numeric, season numeric[]);
insert into item_profile values
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
  ('Metronidazole 400mg',     15,  '{0.8,0.8,0.9,1.1,1.3,1.4,1.4,1.3,1.1,1.0,0.9,0.8}'),
  ('Oxygen Cylinder (B-type, portable)', 0.3, '{1.0,1.0,1.0,1.0,1.0,1.1,1.2,1.3,1.3,1.2,1.0,1.0}'),
  ('Oxytocin 10 IU Injection',         1.6, '{1.0,1.0,1.0,1.0,1.0,1.0,1.05,1.1,1.1,1.05,1.0,1.0}'),
  ('Magnesium Sulphate 50% Injection', 0.5, '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Disposable Syringe 5 ml',           38, '{1.0,0.95,0.95,1.0,1.0,1.1,1.25,1.4,1.45,1.35,1.1,1.05}'),
  ('Surgical Gloves (sterile)',         14, '{1.0,1.0,1.0,1.0,1.0,1.05,1.1,1.15,1.15,1.1,1.0,1.0}'),
  ('N95 Mask',                           5, '{1.3,1.2,1.0,0.9,0.9,1.0,1.1,1.2,1.2,1.1,1.2,1.3}'),
  ('IV Infusion Set',                    4, '{0.8,0.8,0.9,1.1,1.3,1.4,1.5,1.5,1.4,1.2,0.9,0.8}'),
  ('Malaria Rapid Test Kit',             7, '{0.3,0.2,0.2,0.3,0.4,0.7,1.5,2.4,2.8,2.4,1.2,0.5}'),
  ('Urine Pregnancy Test Kit',           2, '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}'),
  ('Td Vaccine',                       1.2, '{1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0}');

create temp table sim_receipts (facility_id uuid, district_id uuid, medicine_id uuid, log_date date, qty numeric);

do $$
declare
  v_days     constant int := 180;
  v_start    date := current_date - v_days;
  p          record;
  v_scale    numeric;
  v_supply   numeric;
  v_stock    numeric;
  v_demand   numeric;
  v_used     numeric;
  v_recv     numeric;
  v_day      date;
  v_expected numeric;
  v_sum60    numeric;
  v_hist     numeric[];
  v_dates    date[];
  v_useds    numeric[];
  v_recvs    numeric[];
  v_season   numeric;
  v_occ_crit numeric;
  v_occ_gen  numeric;
  v_u        double precision;
  v_recv_day int;
  i          int;
begin
  perform setseed(0.61);
  perform set_config('heal.skip_stock_trigger', 'on', true);

  for p in
    select f.id as fid, f.district_id, f.type::text as ftype, f.code, f.resupply_days, f.supplying_warehouse,
           (select type::text from facilities s where s.id = f.supplying_warehouse) as supplier_type,
           m.id as mid, m.name, m.item_type, ip.base, ip.season
    from facilities f
    join medicines m on m.status = 'active' and item_allowed(f.id, m.id)
    left join item_profile ip on ip.item = m.name
    where f.is_active and f.type::text <> 'warehouse'
      and not exists (select 1 from stock s where s.facility_id = f.id and s.medicine_id = m.id)
    order by f.code, m.name
  loop
    -- the D-type oxygen line is simulated from bed occupancy below
    continue when p.name = 'Medical Oxygen Cylinder (D-type)';
    continue when p.base is null;

    v_scale := case p.ftype when 'shc' then 0.14 when 'chc' then 2.4 when 'dh' then 6.5 else 1 end
               * (0.7 + (abs(hashtext(p.code)) % 60) / 100.0);
    v_u := random();
    v_supply := case when v_u < 0.12 then 2.0 + random() * 0.5 when v_u < 0.24 then 0.5 + random() * 0.2 else 0.95 + random() * 0.2 end;
    v_hist := '{}'; v_dates := '{}'; v_useds := '{}'; v_recvs := '{}'; v_sum60 := 0;
    v_stock := round(p.base * v_scale * p.season[extract(month from v_start)::int] * 30);
    v_recv_day := case when p.resupply_days >= 10 then 5 else 1 end;

    for i in 0 .. v_days - 1 loop
      v_day := v_start + i;
      v_recv := 0;
      if extract(day from v_day) = v_recv_day and i > 0 then
        v_expected := case when i >= 60 then v_sum60 / 60 else p.base * v_scale end;
        v_recv := greatest(0, round(v_expected * 40 * v_supply - v_stock));
        v_stock := v_stock + v_recv;
        if p.supplier_type = 'warehouse' then
          insert into sim_receipts values (p.fid, p.district_id, p.mid, v_day, v_recv);
        end if;
      end if;
      v_season := p.season[extract(month from v_day)::int];
      v_demand := p.base * v_scale * v_season
                  * case extract(dow from v_day) when 0 then 0.4 when 1 then 1.2 else 1.0 end * (0.75 + random() * 0.5);
      v_demand := floor(v_demand + random());
      v_used := least(v_demand, v_stock);
      v_stock := v_stock - v_used;
      v_hist := v_hist || v_demand;
      v_sum60 := v_sum60 + v_used - case when i >= 60 then v_hist[i - 59] else 0 end;
      v_dates := v_dates || v_day; v_useds := v_useds || v_used; v_recvs := v_recvs || v_recv;
    end loop;

    insert into stock_log (facility_id, medicine_id, log_date, qty_used, qty_received, source, note)
    select p.fid, p.mid, d, u, r, 'seed', null from unnest(v_dates, v_useds, v_recvs) as t(d, u, r);
    insert into stock (facility_id, medicine_id, quantity) values (p.fid, p.mid, v_stock);
  end loop;

  -- D-type oxygen: cylinders used follow occupied critical-care beds (plus a little on the wards)
  for p in
    select f.id as fid, f.district_id, f.code, m.id as mid
    from facilities f join medicines m on m.name = 'Medical Oxygen Cylinder (D-type)'
    where f.is_active and f.type::text in ('chc', 'dh') and item_allowed(f.id, m.id)
      and not exists (select 1 from stock s where s.facility_id = f.id and s.medicine_id = m.id)
  loop
    v_dates := '{}'; v_useds := '{}'; v_recvs := '{}'; v_sum60 := 0; v_hist := '{}';
    v_stock := case when p.code like 'DH-%' then 180 else 40 end;
    for i in 0 .. v_days - 1 loop
      v_day := v_start + i;
      select coalesce(sum(occupied) filter (where bed_type in ('icu', 'hdu', 'nicu')), 0),
             coalesce(sum(occupied) filter (where bed_type not in ('icu', 'hdu', 'nicu')), 0)
        into v_occ_crit, v_occ_gen
        from daily_bed_occupancy where facility_id = p.fid and report_date = v_day;
      v_recv := 0;
      -- cylinders are refilled twice a week (Mon, Thu) up to ~10 days of use
      if extract(dow from v_day) in (1, 4) and i > 0 then
        v_expected := case when i >= 14 then v_sum60 / least(i, 60) else v_occ_crit * 0.9 + v_occ_gen * 0.04 + 1 end;
        v_recv := greatest(0, round(v_expected * 10 - v_stock));
        v_stock := v_stock + v_recv;
        insert into sim_receipts values (p.fid, p.district_id, p.mid, v_day, v_recv);
      end if;
      v_demand := floor(v_occ_crit * (0.8 + random() * 0.25) + v_occ_gen * 0.04 * (0.6 + random() * 0.8) + random());
      v_used := least(v_demand, v_stock);
      v_stock := v_stock - v_used;
      v_hist := v_hist || v_used;
      v_sum60 := v_sum60 + v_used - case when i >= 60 then v_hist[i - 59] else 0 end;
      v_dates := v_dates || v_day; v_useds := v_useds || v_used; v_recvs := v_recvs || v_recv;
    end loop;
    insert into stock_log (facility_id, medicine_id, log_date, qty_used, qty_received, source, note)
    select p.fid, p.mid, d, u, r, 'seed', null from unnest(v_dates, v_useds, v_recvs) as t(d, u, r);
    insert into stock (facility_id, medicine_id, quantity) values (p.fid, p.mid, v_stock);
  end loop;

  perform set_config('heal.skip_stock_trigger', 'off', true);
end $$;

-- warehouses: every new item they hold, stocked from what their district drew over the period
do $$
declare w record; m record; v_stock numeric; r record;
begin
  perform set_config('heal.skip_stock_trigger', 'on', true);
  for w in select fa.id, fa.district_id from facilities fa where fa.type = 'warehouse' and fa.is_active loop
    for m in select md.id from medicines md
             where md.status = 'active' and item_allowed(w.id, md.id)
               and not exists (select 1 from stock s where s.facility_id = w.id and s.medicine_id = md.id) loop
      select round(coalesce(sum(qty), 0) / 6.0 * 1.5) into v_stock
      from sim_receipts where district_id = w.district_id and medicine_id = m.id;
      for r in
        select date_trunc('month', log_date)::date as month_start, sum(qty) as issued
        from sim_receipts where district_id = w.district_id and medicine_id = m.id
        group by 1 order by 1
      loop
        insert into stock_log (facility_id, medicine_id, log_date, qty_received, qty_out, source, note)
        values (w.id, m.id, r.month_start, round(r.issued * 1.1), r.issued, 'seed', 'Monthly receipt from state + issues to facilities');
        v_stock := v_stock + round(r.issued * 1.1) - r.issued;
      end loop;
      insert into stock (facility_id, medicine_id, quantity) values (w.id, m.id, greatest(v_stock, 0));
    end loop;
  end loop;
  perform set_config('heal.skip_stock_trigger', 'off', true);
end $$;

drop table if exists item_profile;
drop table if exists sim_receipts;

-- ---------------------------------------------------------------------
-- 6. BATCHES for the new stock lines (same rules as before)
-- ---------------------------------------------------------------------
do $$
declare s record; v_left numeric; v_n int; k int; v_q numeric; v_exp date; v_u double precision;
begin
  perform setseed(0.37);
  for s in select st.facility_id, st.medicine_id, st.quantity, m.name
           from stock st join medicines m on m.id = st.medicine_id
           where st.quantity > 0
             and not exists (select 1 from stock_batches b where b.facility_id = st.facility_id and b.medicine_id = st.medicine_id)
           order by st.facility_id, m.name loop
    v_n := 1 + floor(random() * 3)::int;
    v_left := s.quantity;
    for k in 1 .. v_n loop
      v_q := case when k = v_n then v_left else floor(v_left * (0.3 + random() * 0.4)) end;
      continue when v_q <= 0;
      v_u := random();
      v_exp := case
        when k = 1 and v_u < 0.04 then current_date - (3 + floor(random() * 20))::int
        when k = 1 and v_u < 0.10 then current_date + (5 + floor(random() * 24))::int
        when k = 1 and v_u < 0.16 then current_date + (31 + floor(random() * 29))::int
        when k = 1 and v_u < 0.22 then current_date + (61 + floor(random() * 29))::int
        else current_date + (120 + floor(random() * 600))::int end;
      insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
      values (s.facility_id, s.medicine_id,
              upper(left(regexp_replace(s.name, '[^A-Za-z]', '', 'g'), 3)) || to_char(v_exp, 'YYMM') || '-' || k || lpad((floor(random() * 900) + 100)::text, 3, '0'),
              v_exp, v_q, least(current_date - 7, v_exp - 400 + floor(random() * 60)::int));
      v_left := v_left - v_q;
    end loop;
  end loop;
end $$;

-- starter forecasts for the new lines (the engine replaces these on its next run)
insert into forecasts (facility_id, medicine_id, method, predicted_daily_use, lower_daily, upper_daily,
                       forecast_7d, forecast_30d, days_left, stockout_date)
select s.facility_id, s.medicine_id, 'seed_moving_average',
       round(a.avg_use, 2), round(a.avg_use * 0.8, 2), round(a.avg_use * 1.2, 2),
       round(a.avg_use * 7), round(a.avg_use * 30),
       case when a.avg_use > 0 then round(s.quantity / a.avg_use, 1) end,
       case when a.avg_use > 0 then current_date + floor(s.quantity / a.avg_use)::int end
from stock s
join facilities f on f.id = s.facility_id
cross join lateral (
  select case when f.type = 'warehouse' then coalesce(sum(l.qty_out), 0) / 30.0
              else coalesce(sum(l.qty_used), 0) / 28.0 end as avg_use
  from stock_log l
  where l.facility_id = s.facility_id and l.medicine_id = s.medicine_id
    and l.log_date >= current_date - case when f.type = 'warehouse' then 30 else 28 end
) a
on conflict (facility_id, medicine_id) do nothing;

-- ---------------------------------------------------------------------
-- 7. STAFF + ATTENDANCE (statuses include leave and deputation)
-- ---------------------------------------------------------------------
do $$
declare
  f record; v_roles text[];
  first_names text[] := array['Kavita','Suresh','Meena','Ramesh','Hetal','Jignesh','Asha','Dinesh','Pooja','Mahesh',
                              'Nirali','Kalpesh','Rekha','Bharat','Sunita','Mukesh','Jyoti','Lokesh','Payal','Hardik'];
  last_names  text[] := array['Meena','Patel','Damor','Roat','Parmar','Bhagora','Joshi','Kalal','Vasava','Solanki','Rathod','Pargi'];
begin
  perform setseed(0.93);
  for f in select fa.id, fa.type::text as ftype from facilities fa
           where fa.type::text in ('shc', 'chc', 'dh') and not exists (select 1 from staff s where s.facility_id = fa.id)
           order by fa.code loop
    v_roles := case f.ftype
      when 'shc' then array['other', 'health_worker', 'health_worker']
      when 'chc' then array['medical_officer', 'medical_officer', 'nurse', 'nurse', 'nurse', 'pharmacist', 'lab_technician', 'health_worker']
      else array['medical_officer', 'medical_officer', 'medical_officer', 'medical_officer', 'nurse', 'nurse', 'nurse', 'nurse', 'nurse', 'nurse',
                 'pharmacist', 'pharmacist', 'lab_technician', 'lab_technician', 'health_worker', 'other'] end;
    insert into staff (facility_id, name, role)
    select f.id,
           case when r = 'medical_officer' then 'Dr. ' else '' end ||
           first_names[1 + floor(random() * array_length(first_names, 1))::int] || ' ' ||
           last_names [1 + floor(random() * array_length(last_names, 1))::int],
           r::staff_role
    from unnest(v_roles) as r;
  end loop;

  insert into attendance (staff_id, att_date, present, status)
  select s.id, d::date, false,
         case when random() < 0.86 then 'present_on_duty' when random() < 0.5 then 'on_leave' when random() < 0.5 then 'on_deputation' else 'absent' end
  from staff s join facilities fx on fx.id = s.facility_id
  cross join generate_series(current_date - 30, current_date - 1, interval '1 day') d
  where fx.type::text in ('shc', 'chc', 'dh') and extract(dow from d) <> 0
  on conflict do nothing;
end $$;

-- a sprinkle of leave / deputation in the existing attendance so the new statuses show up
update attendance a set status = case when random() < 0.6 then 'on_leave' else 'on_deputation' end
where a.status = 'absent' and random() < 0.35;

-- ---------------------------------------------------------------------
-- 8. REGISTRY IDS + CERTIFICATIONS (synthetic)
-- ---------------------------------------------------------------------
with numbered as (
  select f.id, s.code as scode, row_number() over (partition by s.code order by f.code) as n
  from facilities f join districts d on d.id = f.district_id join states s on s.id = d.state_id
  where f.hfr_id is null
)
update facilities f set hfr_id = 'IN' || case n.scode when 'RJ' then '08' when 'GJ' then '24' else '99' end
                                 || '1' || lpad((1000 + n.n)::text, 7, '0')
from numbered n where n.id = f.id;

update facilities set hfr_extensions = hfr_extensions || jsonb_build_object('laqshya', jsonb_build_object('labour_room', true, 'maternity_ot', code like 'DH-%', 'since', (current_date - 400)::text))
where code in ('DH-DGP', 'DH-ARV', 'CHC-DGP-01', 'PHC-ARV-05', 'PHC-SKT-01', 'PHC-DGP-01')
  and not (hfr_extensions ? 'laqshya');

update staff set hpr_id = '71-' || lpad((abs(hashtext(id::text)) % 10000)::text, 4, '0') || '-' || lpad((abs(hashtext(name)) % 10000)::text, 4, '0') || '-' || lpad((abs(hashtext(facility_id::text)) % 10000)::text, 4, '0')
where role = 'medical_officer' and hpr_id is null;

-- ---------------------------------------------------------------------
-- 9. JAN AUSHADHI KENDRAS (approximate locations)
-- ---------------------------------------------------------------------
insert into jan_aushadhi_kendras (district_id, name, address, lat, lng)
select d.id, 'Jan Aushadhi Kendra, ' || x.town, x.town, x.lat, x.lng
from districts d
join (values
  ('RJ-UDR', 'Udaipur',     24.5854, 73.7125), ('RJ-UDR', 'Kherwara', 23.9840, 73.5880),
  ('RJ-RSD', 'Rajsamand',   25.0710, 73.8810), ('RJ-RSD', 'Nathdwara', 24.9360, 73.8200),
  ('RJ-DGP', 'Dungarpur',   23.8480, 73.7210), ('RJ-DGP', 'Sagwara',  23.6720, 74.0160),
  ('GJ-ARV', 'Modasa',      23.4680, 73.2950), ('GJ-ARV', 'Bayad',    23.2260, 73.2170),
  ('GJ-SKT', 'Himmatnagar', 23.5990, 72.9580), ('GJ-SKT', 'Idar',     23.8350, 73.0060)
) as x(dcode, town, lat, lng) on x.dcode = d.code
where not exists (select 1 from jan_aushadhi_kendras k where k.district_id = d.id and k.address = x.town);

-- ---------------------------------------------------------------------
-- 10. CHECK
-- ---------------------------------------------------------------------
select facility_tier(f.type::text, f.phc_24x7) as tier, count(*) as facilities,
       sum((select count(*) from stock s where s.facility_id = f.id)) as stock_lines,
       sum(f.total_beds) as beds
from facilities f group by 1 order by 1;
