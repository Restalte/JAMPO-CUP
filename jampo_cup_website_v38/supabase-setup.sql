-- JAMPO CUP shared public data table and explicit admin allowlist
-- Run this in Supabase Dashboard > SQL Editor before deploying.
create table if not exists public.jampo_site_data (
  id integer primary key check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.jampo_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.jampo_site_data enable row level security;
alter table public.jampo_admins enable row level security;

grant select on public.jampo_site_data to anon, authenticated;
grant insert, update, delete on public.jampo_site_data to authenticated;
grant select on public.jampo_admins to authenticated;
revoke all on public.jampo_admins from anon;

drop policy if exists "Public can read JAMPO CUP data" on public.jampo_site_data;
create policy "Public can read JAMPO CUP data"
  on public.jampo_site_data for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can insert JAMPO CUP data" on public.jampo_site_data;
create policy "Admins can insert JAMPO CUP data"
  on public.jampo_site_data for insert
  to authenticated
  with check (exists (select 1 from public.jampo_admins a where a.user_id = auth.uid()));

drop policy if exists "Admins can update JAMPO CUP data" on public.jampo_site_data;
create policy "Admins can update JAMPO CUP data"
  on public.jampo_site_data for update
  to authenticated
  using (exists (select 1 from public.jampo_admins a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.jampo_admins a where a.user_id = auth.uid()));

drop policy if exists "Admins can delete JAMPO CUP data" on public.jampo_site_data;
create policy "Admins can delete JAMPO CUP data"
  on public.jampo_site_data for delete
  to authenticated
  using (exists (select 1 from public.jampo_admins a where a.user_id = auth.uid()));

drop policy if exists "Users can read their own admin allowlist row" on public.jampo_admins;
create policy "Users can read their own admin allowlist row"
  on public.jampo_admins for select
  to authenticated
  using (user_id = auth.uid());
