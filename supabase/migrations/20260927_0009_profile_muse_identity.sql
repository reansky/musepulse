alter table public.profiles
  add column if not exists musebook_muse_id text unique,
  add column if not exists musebook_name text,
  add column if not exists musebook_avatar_url text,
  add column if not exists musebook_bio text,
  add column if not exists musebook_visibility text not null default 'anonymous',
  add column if not exists musebook_public_key text,
  add column if not exists musebook_created_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_musebook_visibility_check;

alter table public.profiles
  add constraint profiles_musebook_visibility_check
  check (musebook_visibility in ('anonymous', 'linked'));
