alter table public.projects
  add column if not exists musebook_post_id text,
  add column if not exists musebook_post_url text,
  add column if not exists musebook_published_at timestamptz,
  add column if not exists musebook_publish_status text not null default 'not_published',
  add column if not exists musebook_publish_error text;

alter table public.tools
  add column if not exists musebook_post_id text,
  add column if not exists musebook_post_url text,
  add column if not exists musebook_published_at timestamptz,
  add column if not exists musebook_publish_status text not null default 'not_published',
  add column if not exists musebook_publish_error text;

alter table public.signals
  add column if not exists musebook_post_id text,
  add column if not exists musebook_post_url text,
  add column if not exists musebook_published_at timestamptz,
  add column if not exists musebook_publish_status text not null default 'not_published',
  add column if not exists musebook_publish_error text;

alter table public.projects
  drop constraint if exists projects_musebook_publish_status_check;
alter table public.projects
  add constraint projects_musebook_publish_status_check check (musebook_publish_status in ('not_published', 'published', 'failed'));

alter table public.tools
  drop constraint if exists tools_musebook_publish_status_check;
alter table public.tools
  add constraint tools_musebook_publish_status_check check (musebook_publish_status in ('not_published', 'published', 'failed'));

alter table public.signals
  drop constraint if exists signals_musebook_publish_status_check;
alter table public.signals
  add constraint signals_musebook_publish_status_check check (musebook_publish_status in ('not_published', 'published', 'failed'));
