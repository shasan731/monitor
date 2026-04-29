-- Monitor: initial schema with multi-tenant RLS, retention, and public status tokens.
-- Run via:  supabase db push    (or paste into SQL editor)

create extension if not exists "pgcrypto";
create extension if not exists "pg_cron";

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  is_public   boolean not null default false,
  public_token text unique default encode(gen_random_bytes(18), 'hex'),
  created_at  timestamptz not null default now()
);

create table if not exists public.hosts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  os_type       text not null check (os_type in ('linux','windows','macos')),
  api_key       text not null unique default encode(gen_random_bytes(24), 'hex'),
  last_beat     timestamptz,
  status        text not null default 'pending' check (status in ('pending','online','offline')),
  created_at    timestamptz not null default now()
);

create table if not exists public.metrics (
  id                bigserial primary key,
  host_id           uuid not null references public.hosts(id) on delete cascade,
  cpu_usage         real not null,
  ram_usage         real not null,
  disk_usage        real not null,
  process_count     integer,
  top_cpu_processes jsonb,
  top_ram_processes jsonb,
  interfaces        jsonb,
  ping_latency_ms   real,
  ping_loss_pct     real,
  ping_target       text,
  created_at        timestamptz not null default now()
);

create table if not exists public.host_commands (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.hosts(id) on delete cascade,
  kind          text not null check (kind in ('traceroute')),
  target        text,
  status        text not null default 'pending'
                  check (status in ('pending','running','completed','failed','timeout')),
  result        jsonb,
  error         text,
  requested_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz
);

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- Hot-path indexes
create index if not exists idx_hosts_workspace      on public.hosts(workspace_id);
create index if not exists idx_metrics_host_time    on public.metrics(host_id, created_at desc);
-- Speed up the hourly retention sweep that filters on created_at alone.
create index if not exists idx_metrics_created_at   on public.metrics(created_at);
create index if not exists idx_commands_host_status  on public.host_commands(host_id, status);
create index if not exists idx_workspaces_owner     on public.workspaces(owner_id);
create index if not exists idx_workspaces_pubtok    on public.workspaces(public_token) where is_public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-create profile + default workspace on signup
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_id uuid;
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;

  insert into public.workspaces (name, owner_id)
  values ('My Servers', new.id)
  returning id into ws_id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.profiles           enable row level security;
alter table public.workspaces         enable row level security;
alter table public.hosts              enable row level security;
alter table public.metrics            enable row level security;
alter table public.host_commands      enable row level security;
alter table public.push_subscriptions enable row level security;

-- profiles: a user reads/updates only their own profile.
drop policy if exists "profiles self read"   on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);

-- workspaces: owner-only.
drop policy if exists "workspaces owner all" on public.workspaces;
create policy "workspaces owner all" on public.workspaces
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- hosts: only readable/writable if the workspace belongs to the caller.
drop policy if exists "hosts via workspace" on public.hosts;
create policy "hosts via workspace" on public.hosts
  for all using (
    exists (select 1 from public.workspaces w
            where w.id = hosts.workspace_id and w.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.workspaces w
            where w.id = hosts.workspace_id and w.owner_id = auth.uid())
  );

-- metrics: read via host→workspace ownership. Writes go through the
-- service-role Edge Function (which bypasses RLS), so no insert policy
-- is granted to authenticated users.
drop policy if exists "metrics read via host" on public.metrics;
create policy "metrics read via host" on public.metrics
  for select using (
    exists (
      select 1 from public.hosts h
      join public.workspaces w on w.id = h.workspace_id
      where h.id = metrics.host_id and w.owner_id = auth.uid()
    )
  );

-- host_commands: scoped through hosts→workspace ownership.
drop policy if exists "host_commands via workspace" on public.host_commands;
create policy "host_commands via workspace" on public.host_commands
  for all using (
    exists (
      select 1 from public.hosts h
      join public.workspaces w on w.id = h.workspace_id
      where h.id = host_commands.host_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.hosts h
      join public.workspaces w on w.id = h.workspace_id
      where h.id = host_commands.host_id and w.owner_id = auth.uid()
    )
  );

-- push_subscriptions: per-user.
drop policy if exists "push self all" on public.push_subscriptions;
create policy "push self all" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- Public status page: read-only access via workspaces.public_token
-- These views are exposed to the anon role so an unauthenticated visitor
-- with a token can read sanitised host status. The api_key is never exposed.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace view public.public_hosts as
  select h.id, h.name, h.os_type, h.last_beat, h.status, w.public_token, w.name as workspace_name
  from public.hosts h
  join public.workspaces w on w.id = h.workspace_id
  where w.is_public;

create or replace view public.public_metrics as
  select m.id, m.host_id, m.cpu_usage, m.ram_usage, m.disk_usage, m.created_at, w.public_token
  from public.metrics m
  join public.hosts h     on h.id = m.host_id
  join public.workspaces w on w.id = h.workspace_id
  where w.is_public;

grant select on public.public_hosts   to anon;
grant select on public.public_metrics to anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Retention: delete metrics older than 24h every hour.
-- Keeps the database under the 500MB Supabase free-tier ceiling.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.cleanup_old_metrics()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.metrics where created_at < now() - interval '24 hours';
end;
$$;

-- Idempotent: re-running this migration shouldn't pile up duplicate cron rows.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'monitor-cleanup-metrics') then
    perform cron.unschedule('monitor-cleanup-metrics');
  end if;
end $$;
select cron.schedule(
  'monitor-cleanup-metrics',
  '7 * * * *',                       -- once per hour at :07
  $$ select public.cleanup_old_metrics(); $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Offline detection: flip 'online' → 'offline' if last_beat is older than 2m.
-- Runs every minute via pg_cron — no HTTP needed.
-- For richer behavior (push notifications), deploy the heartbeat Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.flip_offline_hosts()
returns void
language sql
security definer
set search_path = public
as $$
  update public.hosts
     set status = 'offline'
   where status = 'online'
     and last_beat is not null
     and last_beat < now() - interval '2 minutes';
$$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'monitor-flip-offline') then
    perform cron.unschedule('monitor-flip-offline');
  end if;
end $$;
select cron.schedule(
  'monitor-flip-offline',
  '* * * * *',
  $$ select public.flip_offline_hosts(); $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: stream metrics + host status changes to subscribed clients.
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.metrics;
alter publication supabase_realtime add table public.hosts;
alter publication supabase_realtime add table public.host_commands;

-- Drop completed/failed commands after a week (don't pile up).
create or replace function public.cleanup_old_commands()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.host_commands where created_at < now() - interval '7 days';
$$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'monitor-cleanup-commands') then
    perform cron.unschedule('monitor-cleanup-commands');
  end if;
end $$;
select cron.schedule(
  'monitor-cleanup-commands',
  '13 * * * *',
  $$ select public.cleanup_old_commands(); $$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Rotate workspaces.public_token whenever sharing is disabled.
-- Anyone holding a stale URL loses access on next re-enable, which matches
-- user intent of "stop sharing = revoke."
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.rotate_public_token_on_disable()
returns trigger
language plpgsql
as $$
begin
  if old.is_public = true and new.is_public = false then
    new.public_token := encode(gen_random_bytes(18), 'hex');
  end if;
  return new;
end;
$$;

drop trigger if exists workspace_public_token_rotate on public.workspaces;
create trigger workspace_public_token_rotate
  before update of is_public on public.workspaces
  for each row execute function public.rotate_public_token_on_disable();
