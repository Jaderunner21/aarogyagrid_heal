-- =====================================================================
-- AarogyaGrid — 007_scanned_batches.sql   (run after 006; safe to re-run)
--
-- Barcode scanning (GS1). A receipt can now carry the batch number and expiry date read off
-- the pack. Before, a plain receipt became a dated placeholder batch ("RCV-20260927", expiry
-- +18 months); now the real batch is kept, so expiry alerts and first-expiry-first-out use
-- the date printed on the pack. Receiving an already-expired batch is refused.
-- Transfers and warehouse orders still carry the sender's batches, as before.
-- =====================================================================

alter table stock_log add column if not exists batch_no text;
alter table stock_log add column if not exists expiry_date date;

create or replace function apply_batches() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_out numeric := new.qty_used + new.qty_out;
  v_left numeric; v_take numeric; v_sent numeric; v_done numeric := 0; v_part numeric;
  b record; m record; v_batch uuid; v_n int; v_i int := 0;
  v_batch_no text := nullif(upper(trim(coalesce(new.batch_no, ''))), '');
begin
  if coalesce(current_setting('heal.skip_stock_trigger', true), 'off') = 'on' then return new; end if;

  -- OUT: a write-off of one specific batch, or oldest-expiry-first for everything else
  if new.source::text = 'wastage' and new.ref_id is not null then
    update stock_batches set qty = greatest(qty - new.qty_out, 0),
           status = case when qty - new.qty_out <= 0 then 'written_off' else status end
     where id = new.ref_id;
    if found then insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, new.ref_id, -new.qty_out); end if;
  elsif v_out > 0 then
    v_left := v_out;
    for b in select * from stock_batches
             where facility_id = new.facility_id and medicine_id = new.medicine_id and status = 'active' and qty > 0
             order by expiry_date, received_on, batch_no for update loop
      v_take := least(b.qty, v_left);
      update stock_batches set qty = qty - v_take where id = b.id;
      insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, b.id, -v_take);
      v_left := v_left - v_take;
      exit when v_left <= 0;
    end loop;
  end if;

  -- IN: a transfer/indent receipt carries the sender's batches; a scanned receipt keeps the pack's
  -- batch and expiry; any other receipt becomes a dated placeholder batch
  if new.qty_received > 0 then
    v_sent := 0;
    if new.ref_id is not null and new.source::text in ('transfer', 'indent') then
      select coalesce(sum(-bm.qty), 0), count(distinct bm.batch_id) into v_sent, v_n
      from batch_movements bm join stock_log l on l.id = bm.stock_log_id
      where l.ref_id = new.ref_id and l.qty_out > 0 and bm.qty < 0;
    end if;
    if v_sent > 0 then
      for m in select sb.batch_no, sb.expiry_date, sum(-bm.qty) as q
               from batch_movements bm
               join stock_log l on l.id = bm.stock_log_id
               join stock_batches sb on sb.id = bm.batch_id
               where l.ref_id = new.ref_id and l.qty_out > 0 and bm.qty < 0
               group by sb.batch_no, sb.expiry_date order by sb.expiry_date loop
        v_i := v_i + 1;
        v_part := case when v_i = v_n then new.qty_received - v_done else round(m.q * new.qty_received / v_sent) end;
        continue when v_part <= 0;
        v_done := v_done + v_part;
        insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
        values (new.facility_id, new.medicine_id, m.batch_no, m.expiry_date, v_part, new.log_date)
        on conflict (facility_id, medicine_id, batch_no)
          do update set qty = stock_batches.qty + excluded.qty, status = 'active'
        returning id into v_batch;
        insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, v_batch, v_part);
      end loop;
    else
      insert into stock_batches (facility_id, medicine_id, batch_no, expiry_date, qty, received_on)
      values (new.facility_id, new.medicine_id,
              coalesce(v_batch_no, 'RCV-' || to_char(new.log_date, 'YYYYMMDD')),
              coalesce(new.expiry_date, new.log_date + 540),
              new.qty_received, new.log_date)
      on conflict (facility_id, medicine_id, batch_no)
        do update set qty = stock_batches.qty + excluded.qty, status = 'active',
                      -- a re-scan of a known batch confirms its printed expiry
                      expiry_date = coalesce(new.expiry_date, stock_batches.expiry_date)
      returning id into v_batch;
      insert into batch_movements (stock_log_id, batch_id, qty) values (new.id, v_batch, new.qty_received);
    end if;
  end if;
  return new;
end $$;

-- checks before the row is written: a scanned receipt must not be expired, and needs both fields
create or replace function check_scanned_receipt() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.batch_no is null and new.expiry_date is null then return new; end if;
  if new.qty_received <= 0 then
    new.batch_no := null; new.expiry_date := null;  -- batch details only mean something on a receipt
    return new;
  end if;
  if nullif(trim(coalesce(new.batch_no, '')), '') is null or new.expiry_date is null then
    raise exception 'A scanned receipt needs both the batch number and the expiry date';
  end if;
  if new.expiry_date <= new.log_date then
    raise exception 'Batch % expired on %. Do not receive expired stock; return it to the sender.', upper(trim(new.batch_no)), new.expiry_date;
  end if;
  new.batch_no := upper(trim(new.batch_no));
  return new;
end $$;
drop trigger if exists trg_check_scanned_receipt on stock_log;
create trigger trg_check_scanned_receipt before insert on stock_log for each row execute function check_scanned_receipt();

select 'migration 007 applied' as status;
