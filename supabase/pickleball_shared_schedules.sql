create table if not exists public.pickleball_shared_schedules (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.pickleball_shared_schedules enable row level security;

create index if not exists pickleball_shared_schedules_created_at_idx
  on public.pickleball_shared_schedules (created_at desc);

-- The app reads and writes this table through Next.js API routes using
-- SUPABASE_SERVICE_ROLE_KEY, so no public RLS policy is required.
