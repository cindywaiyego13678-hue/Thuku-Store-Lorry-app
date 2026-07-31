-- ============================================================
-- Thuku Enterprise — Store & Lorry app schema
-- Run this AFTER migration_v3.sql (from the shop app) in the
-- SAME Supabase project (ipbqeyeanlyvklrjcbxl.supabase.co) —
-- this is what lets a transfer made here show up in the shop app.
-- ============================================================

-- ---------- Add store/lorry roles to the shared staff table ----------
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('admin','manager','cashier','owner','store_staff','lorry_seller'));

-- ---------- STORE PRODUCTS ----------
-- Differentiated by size + manufacturer, e.g. "5x6 Mattress — Ndovu" vs "5x6 Mattress — Tuff"
create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,              -- e.g. "Mattress"
  size text,                       -- e.g. "5x6"
  manufacturer text,               -- e.g. "Ndovu"
  category text,                   -- e.g. "Bedding", optional type grouping
  cost numeric(12,2) default 0,
  price numeric(12,2) not null,
  stock_quantity numeric(12,2) not null default 0,
  reorder_level numeric(12,2) default 5,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- Convenience view: a friendly display name combining size + name + manufacturer
create or replace view v_store_products_display as
select *,
  trim(concat_ws(' ', size, name, case when manufacturer is not null then '— '||manufacturer else null end)) as display_name
from store_products;

-- ---------- STORE → SHOP TRANSFERS ----------
create table if not exists stock_transfers (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references staff(id),
  notes text,
  total_value numeric(12,2) default 0,
  payment_status text default 'unpaid' check (payment_status in ('paid','unpaid','partial')),
  amount_paid numeric(12,2) default 0,
  created_at timestamptz default now()
);

create table if not exists stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid references stock_transfers(id) on delete cascade,
  store_product_id uuid references store_products(id),
  product_name text not null,
  quantity numeric(12,2) not null,
  unit_cost numeric(12,2) default 0,
  unit_price numeric(12,2) default 0
);

-- ---------- LORRY ----------
create table if not exists lorry_stock (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid references store_products(id) unique,
  quantity numeric(12,2) not null default 0
);

create table if not exists lorry_issues (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid references store_products(id),
  product_name text,
  quantity numeric(12,2) not null,
  staff_id uuid references staff(id),
  notes text,
  created_at timestamptz default now()
);

create table if not exists lorry_sales (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid references store_products(id),
  product_name text,
  quantity numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  customer_name text,
  customer_phone text,
  payment_method text check (payment_method in ('mpesa','cash','card')) default 'cash',
  staff_id uuid references staff(id),
  synced boolean default true,   -- false = made offline, synced later
  created_at timestamptz default now()
);

create table if not exists lorry_returns (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid references store_products(id),
  product_name text,
  quantity numeric(12,2) not null,
  reason text,
  staff_id uuid references staff(id),
  created_at timestamptz default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table store_products enable row level security;
alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;
alter table lorry_stock enable row level security;
alter table lorry_issues enable row level security;
alter table lorry_sales enable row level security;
alter table lorry_returns enable row level security;

-- All logged-in store/lorry/admin staff can read everything here
create policy "store_products_select" on store_products for select using (auth.uid() is not null);
create policy "store_products_write" on store_products for all using (current_role_name() in ('admin','store_staff'));

create policy "transfers_select" on stock_transfers for select using (auth.uid() is not null);
create policy "transfers_write" on stock_transfers for all using (current_role_name() in ('admin','store_staff'));

create policy "transfer_items_select" on stock_transfer_items for select using (auth.uid() is not null);
create policy "transfer_items_write" on stock_transfer_items for all using (current_role_name() in ('admin','store_staff'));

create policy "lorry_stock_select" on lorry_stock for select using (auth.uid() is not null);
create policy "lorry_stock_write" on lorry_stock for all using (current_role_name() in ('admin','store_staff','lorry_seller'));

create policy "lorry_issues_select" on lorry_issues for select using (auth.uid() is not null);
create policy "lorry_issues_write" on lorry_issues for all using (current_role_name() in ('admin','store_staff'));

create policy "lorry_sales_select" on lorry_sales for select using (auth.uid() is not null);
create policy "lorry_sales_write" on lorry_sales for all using (current_role_name() in ('admin','store_staff','lorry_seller'));

create policy "lorry_returns_select" on lorry_returns for select using (auth.uid() is not null);
create policy "lorry_returns_write" on lorry_returns for all using (current_role_name() in ('admin','store_staff','lorry_seller'));

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Record a transfer from store to shop. Decrements store stock,
-- writes a detailed record here, AND writes into the shop app's
-- incoming_transfers table (same project) so the shop can see it
-- and mark payment status.
-- p_items shape: [{ "store_product_id": "...", "product_name": "...", "quantity": 5, "unit_cost": 1000, "unit_price": 1500 }]
create or replace function record_transfer(
  p_staff_id uuid,
  p_notes text,
  p_items jsonb
) returns uuid as $$
declare
  v_transfer_id uuid;
  v_staff_name text;
  v_item jsonb;
  v_total numeric := 0;
  v_current_stock numeric;
begin
  select full_name into v_staff_name from staff where id = p_staff_id;

  insert into stock_transfers (staff_id, notes) values (p_staff_id, p_notes)
  returning id into v_transfer_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select stock_quantity into v_current_stock from store_products
      where id = (v_item->>'store_product_id')::uuid for update;

    if v_current_stock is null or v_current_stock < (v_item->>'quantity')::numeric then
      raise exception 'Not enough store stock for %', v_item->>'product_name';
    end if;

    update store_products set stock_quantity = stock_quantity - (v_item->>'quantity')::numeric
      where id = (v_item->>'store_product_id')::uuid;

    insert into stock_transfer_items (transfer_id, store_product_id, product_name, quantity, unit_cost, unit_price)
    values (
      v_transfer_id,
      (v_item->>'store_product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::numeric,
      coalesce((v_item->>'unit_cost')::numeric, 0),
      coalesce((v_item->>'unit_price')::numeric, 0)
    );

    v_total := v_total + ((v_item->>'quantity')::numeric * coalesce((v_item->>'unit_price')::numeric, 0));
  end loop;

  update stock_transfers set total_value = v_total where id = v_transfer_id;

  -- Mirror into the shop app's incoming_transfers table
  insert into incoming_transfers (transfer_ref, sent_by, items, total_value, payment_status)
  values (v_transfer_id::text, v_staff_name, p_items, v_total, 'unpaid');

  return v_transfer_id;
end;
$$ language plpgsql security definer;

-- Issue stock from store to the lorry
create or replace function issue_to_lorry(
  p_store_product_id uuid,
  p_quantity numeric,
  p_staff_id uuid,
  p_notes text
) returns void as $$
declare
  v_current_stock numeric;
  v_name text;
begin
  select stock_quantity, name into v_current_stock, v_name from store_products where id = p_store_product_id for update;
  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Not enough store stock to load onto the lorry';
  end if;

  update store_products set stock_quantity = stock_quantity - p_quantity where id = p_store_product_id;

  insert into lorry_stock (store_product_id, quantity) values (p_store_product_id, p_quantity)
  on conflict (store_product_id) do update set quantity = lorry_stock.quantity + p_quantity;

  insert into lorry_issues (store_product_id, product_name, quantity, staff_id, notes)
  values (p_store_product_id, v_name, p_quantity, p_staff_id, p_notes);
end;
$$ language plpgsql security definer;

-- Record a sale made from the lorry
create or replace function record_lorry_sale(
  p_store_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_customer_name text,
  p_customer_phone text,
  p_payment_method text,
  p_staff_id uuid,
  p_synced boolean default true
) returns void as $$
declare
  v_current_stock numeric;
  v_name text;
begin
  select quantity, (select name from store_products where id = p_store_product_id)
    into v_current_stock, v_name from lorry_stock where store_product_id = p_store_product_id for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Not enough lorry stock for this sale';
  end if;

  update lorry_stock set quantity = quantity - p_quantity where store_product_id = p_store_product_id;

  insert into lorry_sales (store_product_id, product_name, quantity, unit_price, customer_name, customer_phone, payment_method, staff_id, synced)
  values (p_store_product_id, v_name, p_quantity, p_unit_price, p_customer_name, p_customer_phone, p_payment_method, p_staff_id, p_synced);
end;
$$ language plpgsql security definer;

-- Record stock returned from the lorry back into the store
create or replace function record_lorry_return(
  p_store_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_staff_id uuid
) returns void as $$
declare
  v_current_stock numeric;
  v_name text;
begin
  select quantity, (select name from store_products where id = p_store_product_id)
    into v_current_stock, v_name from lorry_stock where store_product_id = p_store_product_id for update;

  if v_current_stock is null or v_current_stock < p_quantity then
    raise exception 'Not enough lorry stock to return that much';
  end if;

  update lorry_stock set quantity = quantity - p_quantity where store_product_id = p_store_product_id;
  update store_products set stock_quantity = stock_quantity + p_quantity where id = p_store_product_id;

  insert into lorry_returns (store_product_id, product_name, quantity, reason, staff_id)
  values (p_store_product_id, v_name, p_quantity, p_reason, p_staff_id);
end;
$$ language plpgsql security definer;

-- Low stock view for the store
create or replace view v_store_low_stock as
select id, name, size, manufacturer, stock_quantity, reorder_level
from store_products
where is_active = true and stock_quantity <= reorder_level;
