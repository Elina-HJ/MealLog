-- Supabase SQL Editor에서 한 번 실행하세요.
create table if not exists public.meallog_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  records jsonb not null default '{}'::jsonb,
  alcohol_logs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.meallog_data enable row level security;
grant select, insert, update on public.meallog_data to authenticated;

drop policy if exists "Users can read their own MealLog data" on public.meallog_data;
create policy "Users can read their own MealLog data"
  on public.meallog_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own MealLog data" on public.meallog_data;
create policy "Users can insert their own MealLog data"
  on public.meallog_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own MealLog data" on public.meallog_data;
create policy "Users can update their own MealLog data"
  on public.meallog_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
