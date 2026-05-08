/*
  # Bootstrap admin function

  Adds an RPC `claim_admin()` that lets an authenticated user insert themselves
  into the admins table only if no admin exists yet. This enables the first
  signup to self-promote as admin, subsequent signups must be added manually.
*/

create or replace function claim_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
  any_admin boolean;
begin
  uid := auth.uid();
  if uid is null then
    return false;
  end if;
  select exists(select 1 from admins) into any_admin;
  if any_admin then
    return false;
  end if;
  insert into admins (user_id) values (uid) on conflict do nothing;
  return true;
end;
$$;

grant execute on function claim_admin() to authenticated;
