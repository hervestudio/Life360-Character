/*
  # Character Builder Schema

  ## Summary
  Creates the full schema for the Character Builder app: asset library, character saves, admin gating.

  ## New Types (enums)
    - age_group: kid, teen, adult, senior
    - gender: male, female
    - asset_category: body, skin, hair, facial_hair, accessory

  ## New Tables
    1. assets - one PNG per row with category, label, optional age/gender for body, optional swatch_color for skin, storage_path pointer.
    2. characters - saved character configs (jsonb snapshot), optional owner_id for guest saves.
    3. admins - users allowed to access admin panel.

  ## Functions
    - is_admin(): checks if auth.uid() is in admins table.

  ## Security
    - RLS enabled on all three tables.
    - assets: public read of active rows, admin-only writes.
    - characters: owners read/write their rows; guests can insert rows with null owner_id.
    - admins: admins read only.
*/

do $$ begin
  create type age_group as enum ('kid', 'teen', 'adult', 'senior');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender as enum ('male', 'female');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_category as enum ('body', 'skin', 'hair', 'facial_hair', 'accessory');
exception when duplicate_object then null; end $$;

create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

alter table admins enable row level security;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  category asset_category not null,
  label text not null default '',
  age age_group,
  gender gender,
  storage_path text unique not null,
  swatch_color text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint body_requires_age_gender check (
    (category = 'body' and age is not null and gender is not null)
    or (category <> 'body' and age is null and gender is null)
  )
);

alter table assets enable row level security;

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  owner_id uuid references auth.users(id) on delete set null,
  config jsonb not null default '{}'::jsonb,
  preview_url text,
  created_at timestamptz default now()
);

alter table characters enable row level security;

-- Policies: admins
drop policy if exists "Admins can read admins" on admins;
create policy "Admins can read admins"
  on admins for select
  to authenticated
  using (is_admin());

-- Policies: assets
drop policy if exists "Public can read active assets" on assets;
create policy "Public can read active assets"
  on assets for select
  to anon, authenticated
  using (is_active = true or is_admin());

drop policy if exists "Admins can insert assets" on assets;
create policy "Admins can insert assets"
  on assets for insert
  to authenticated
  with check (is_admin());

drop policy if exists "Admins can update assets" on assets;
create policy "Admins can update assets"
  on assets for update
  to authenticated
  using (is_admin())
  with check (is_admin());

drop policy if exists "Admins can delete assets" on assets;
create policy "Admins can delete assets"
  on assets for delete
  to authenticated
  using (is_admin());

-- Policies: characters
drop policy if exists "Owners can read own characters" on characters;
create policy "Owners can read own characters"
  on characters for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Anyone can insert characters" on characters;
create policy "Anyone can insert characters"
  on characters for insert
  to anon, authenticated
  with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "Owners can update own characters" on characters;
create policy "Owners can update own characters"
  on characters for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Owners can delete own characters" on characters;
create policy "Owners can delete own characters"
  on characters for delete
  to authenticated
  using (owner_id = auth.uid());

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('character-assets', 'character-assets', true)
on conflict (id) do nothing;

drop policy if exists "Public can read character-assets" on storage.objects;
create policy "Public can read character-assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'character-assets');

drop policy if exists "Admins can upload character-assets" on storage.objects;
create policy "Admins can upload character-assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'character-assets' and is_admin());

drop policy if exists "Admins can update character-assets" on storage.objects;
create policy "Admins can update character-assets"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'character-assets' and is_admin())
  with check (bucket_id = 'character-assets' and is_admin());

drop policy if exists "Admins can delete character-assets" on storage.objects;
create policy "Admins can delete character-assets"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'character-assets' and is_admin());
