create table if not exists public.pickleball_shared_schedules (
  id text primary key,
  payload jsonb not null,
  checked_matches integer[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.pickleball_share_edit_tokens (
  share_id text primary key references public.pickleball_shared_schedules(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.pickleball_shared_schedules
  add column if not exists checked_matches integer[] not null default '{}';

alter table public.pickleball_shared_schedules
  add column if not exists updated_at timestamptz not null default now();

alter table public.pickleball_shared_schedules enable row level security;
alter table public.pickleball_share_edit_tokens enable row level security;

drop policy if exists "Public can read shared pickleball schedules"
  on public.pickleball_shared_schedules;

create policy "Public can read shared pickleball schedules"
  on public.pickleball_shared_schedules
  for select
  using (true);

create index if not exists pickleball_shared_schedules_created_at_idx
  on public.pickleball_shared_schedules (created_at desc);

create index if not exists pickleball_share_edit_tokens_share_id_idx
  on public.pickleball_share_edit_tokens (share_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'pickleball_shared_schedules'
  ) then
    alter publication supabase_realtime
      add table public.pickleball_shared_schedules;
  end if;
end $$;

-- Write/update operations use Next.js API routes with SUPABASE_SERVICE_ROLE_KEY.
-- Public clients can only read shared schedules and subscribe to their updates.
