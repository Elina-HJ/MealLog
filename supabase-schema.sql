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

-- 식사 사진은 private Storage bucket에 계정별로 저장합니다. 같은 계정만 사진을 읽고 추가/삭제할 수 있습니다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "MealLog photos readable by owner" on storage.objects;
create policy "MealLog photos readable by owner"
  on storage.objects for select to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "MealLog photos insertable by owner" on storage.objects;
create policy "MealLog photos insertable by owner"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "MealLog photos deletable by owner" on storage.objects;
create policy "MealLog photos deletable by owner"
  on storage.objects for delete to authenticated
  using (bucket_id = 'meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
