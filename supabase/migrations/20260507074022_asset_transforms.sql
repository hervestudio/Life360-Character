/*
  # Asset transforms (per-body defaults + per-asset overrides)

  ## Summary
  Adds a per-body + per-category default transform so admins can position each
  type of asset differently per body type, plus nullable override fields on
  each asset so individual pieces can be nudged without affecting the rest.

  ## New Tables
    1. `category_defaults`
       - `body_id` (uuid, fk assets, body asset only)
       - `category` (asset_category, non-body)
       - `offset_x` (int, pixels in the 1000x1000 reference, default 0)
       - `offset_y` (int, pixels in the 1000x1000 reference, default 0)
       - `scale` (numeric, multiplier, default 1)
       - primary key (body_id, category)

  ## Modified Tables
    - `assets` gains nullable override columns:
       - `offset_x` (int, null means inherit)
       - `offset_y` (int, null means inherit)
       - `scale` (numeric, null means inherit)
      These are meaningful for non-body assets; bodies always render at 0/0/1.

  ## Security
    - RLS enabled on `category_defaults`.
    - Public can read.
    - Admins can insert/update/delete.

  ## Notes
    1. Offsets are stored in pixels of the canonical 1000x1000 canvas.
    2. Scale 1 means the asset renders at its native pixel size inside the
       1000x1000 canvas, anchored from the top-left of its image; the client
       centers it using its intrinsic size at render time.
*/

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'assets' and column_name = 'offset_x'
  ) then
    alter table assets add column offset_x int;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'assets' and column_name = 'offset_y'
  ) then
    alter table assets add column offset_y int;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'assets' and column_name = 'scale'
  ) then
    alter table assets add column scale numeric;
  end if;
end $$;

create table if not exists category_defaults (
  body_id uuid not null references assets(id) on delete cascade,
  category asset_category not null,
  offset_x int not null default 0,
  offset_y int not null default 0,
  scale numeric not null default 1,
  updated_at timestamptz default now(),
  primary key (body_id, category),
  constraint category_defaults_not_body check (category <> 'body')
);

alter table category_defaults enable row level security;

drop policy if exists "Public can read category_defaults" on category_defaults;
create policy "Public can read category_defaults"
  on category_defaults for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert category_defaults" on category_defaults;
create policy "Admins can insert category_defaults"
  on category_defaults for insert
  to authenticated
  with check (is_admin());

drop policy if exists "Admins can update category_defaults" on category_defaults;
create policy "Admins can update category_defaults"
  on category_defaults for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admins can delete category_defaults" on category_defaults;
create policy "Admins can delete category_defaults"
  on category_defaults for delete
  to authenticated
  using (is_admin());
