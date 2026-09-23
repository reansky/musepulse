create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  display_name text,
  avatar_url text,
  bio text,
  website text,
  x_handle text,
  location text,
  interests text[] not null default '{}',
  skills text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  description text not null default '',
  logo_url text,
  website_url text,
  x_url text,
  github_url text,
  category text,
  tags text[] not null default '{}',
  related_muse_id text,
  status text not null default 'IDEA' check (status in ('IDEA', 'BUILDING', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  description text not null default '',
  url text not null,
  image_url text,
  category text not null default 'OTHER' check (category in ('AI', 'DEVELOPER', 'ANALYTICS', 'CREATIVE', 'SOCIAL', 'INFRASTRUCTURE', 'AUTOMATION', 'OTHER')),
  tags text[] not null default '{}',
  related_muse_ids text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  source_url text,
  category text not null default 'DISCOVERY',
  related_muse_id text,
  related_project_id uuid references public.projects(id) on delete set null,
  related_tool_id uuid references public.tools(id) on delete set null,
  status text not null default 'COMMUNITY SUBMITTED' check (status in ('COMMUNITY SUBMITTED', 'PENDING REVIEW', 'VERIFIED', 'PUBLISHED', 'REJECTED')),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  object_type text not null check (object_type in ('muse', 'project', 'tool', 'signal')),
  object_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, object_type, object_id)
);

create table if not exists public.follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('muse', 'project')),
  target_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id)
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  object_type text not null check (object_type in ('project', 'tool', 'signal', 'profile', 'saved_item', 'follow')),
  object_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists projects_visibility_idx on public.projects(visibility);
create index if not exists projects_status_idx on public.projects(status);
create index if not exists tools_owner_id_idx on public.tools(owner_id);
create index if not exists tools_visibility_idx on public.tools(visibility);
create index if not exists signals_creator_id_idx on public.signals(creator_id);
create index if not exists signals_visibility_status_idx on public.signals(visibility, status);
create index if not exists saved_items_user_id_idx on public.saved_items(user_id);
create index if not exists follows_user_id_idx on public.follows(user_id);
create index if not exists project_members_user_id_idx on public.project_members(user_id);
create index if not exists activity_actor_id_created_at_idx on public.activity(actor_id, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists tools_set_updated_at on public.tools;
create trigger tools_set_updated_at
before update on public.tools
for each row execute function public.set_updated_at();

drop trigger if exists signals_set_updated_at on public.signals;
create trigger signals_set_updated_at
before update on public.signals
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
  candidate text;
  suffix text;
begin
  base_username := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-z0-9_]+', '-', 'g'));
  base_username := trim(both '-' from base_username);
  if char_length(base_username) < 3 then
    base_username := 'user';
  end if;
  candidate := left(base_username, 30);
  if exists (select 1 from public.profiles where username = candidate) then
    suffix := substr(replace(new.id::text, '-', ''), 1, 8);
    candidate := left(base_username, 21) || '_' || suffix;
  end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tools enable row level security;
alter table public.signals enable row level security;
alter table public.saved_items enable row level security;
alter table public.follows enable row level security;
alter table public.project_members enable row level security;
alter table public.activity enable row level security;

drop policy if exists profiles_public_read on public.profiles;
create policy profiles_public_read on public.profiles
for select using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists projects_public_read on public.projects;
create policy projects_public_read on public.projects
for select using (visibility = 'public' or owner_id = auth.uid());

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects
for insert with check (auth.uid() = owner_id);

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects
for delete using (auth.uid() = owner_id);

drop policy if exists tools_public_read on public.tools;
create policy tools_public_read on public.tools
for select using (visibility = 'public' or owner_id = auth.uid());

drop policy if exists tools_insert_own on public.tools;
create policy tools_insert_own on public.tools
for insert with check (auth.uid() = owner_id);

drop policy if exists tools_update_own on public.tools;
create policy tools_update_own on public.tools
for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists tools_delete_own on public.tools;
create policy tools_delete_own on public.tools
for delete using (auth.uid() = owner_id);

drop policy if exists signals_public_read on public.signals;
create policy signals_public_read on public.signals
for select using (visibility = 'public' or creator_id = auth.uid());

drop policy if exists signals_insert_own on public.signals;
create policy signals_insert_own on public.signals
for insert with check (auth.uid() = creator_id);

drop policy if exists signals_update_own on public.signals;
create policy signals_update_own on public.signals
for update using (auth.uid() = creator_id) with check (auth.uid() = creator_id);

drop policy if exists signals_delete_own on public.signals;
create policy signals_delete_own on public.signals
for delete using (auth.uid() = creator_id);

drop policy if exists saved_items_own on public.saved_items;
create policy saved_items_own on public.saved_items
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists follows_own on public.follows;
create policy follows_own on public.follows
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members
for select using (
  user_id = auth.uid()
  or exists (select 1 from public.projects where id = project_id and visibility = 'public')
  or exists (select 1 from public.projects where id = project_id and owner_id = auth.uid())
);

drop policy if exists project_members_owner_write on public.project_members;
create policy project_members_owner_write on public.project_members
for all using (exists (select 1 from public.projects where id = project_id and owner_id = auth.uid()))
with check (exists (select 1 from public.projects where id = project_id and owner_id = auth.uid()));

drop policy if exists activity_own on public.activity;
create policy activity_own on public.activity
for select using (auth.uid() = actor_id);

drop policy if exists activity_insert_own on public.activity;
create policy activity_insert_own on public.activity
for insert with check (auth.uid() = actor_id);
