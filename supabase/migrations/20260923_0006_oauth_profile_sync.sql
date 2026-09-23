create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider text;
  raw_handle text;
  base_username text;
  candidate text;
  suffix text;
  profile_display_name text;
  profile_avatar_url text;
begin
  provider := lower(coalesce(new.raw_app_meta_data ->> 'provider', ''));
  raw_handle := nullif(regexp_replace(coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'screen_name',
    ''
  ), '^@+', '', 'g'), '');
  base_username := lower(regexp_replace(coalesce(raw_handle, split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9_]+', '-', 'g'));
  base_username := trim(both '-' from base_username);
  if char_length(base_username) < 3 then
    base_username := 'user';
  end if;
  candidate := left(base_username, 30);
  if exists (select 1 from public.profiles where username = candidate) then
    suffix := substr(replace(new.id::text, '-', ''), 1, 8);
    candidate := left(base_username, 21) || '_' || suffix;
  end if;
  profile_display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'display_name'
  );
  profile_avatar_url := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture',
    new.raw_user_meta_data ->> 'profile_image_url'
  );
  insert into public.profiles (id, username, display_name, avatar_url, x_handle)
  values (
    new.id,
    candidate,
    profile_display_name,
    profile_avatar_url,
    case when provider in ('x', 'twitter') and raw_handle is not null then '@' || raw_handle else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.sync_x_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provider text;
  raw_handle text;
  candidate text;
  profile_display_name text;
  profile_avatar_url text;
begin
  provider := lower(coalesce(new.raw_app_meta_data ->> 'provider', ''));
  if provider not in ('x', 'twitter') then
    return new;
  end if;
  raw_handle := nullif(regexp_replace(coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    new.raw_user_meta_data ->> 'username',
    new.raw_user_meta_data ->> 'screen_name',
    ''
  ), '^@+', '', 'g'), '');
  candidate := left(lower(regexp_replace(coalesce(raw_handle, ''), '[^a-z0-9_]+', '-', 'g')), 32);
  candidate := trim(both '-' from candidate);
  profile_display_name := coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'display_name'
  );
  profile_avatar_url := coalesce(
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'picture',
    new.raw_user_meta_data ->> 'profile_image_url'
  );
  update public.profiles
  set display_name = coalesce(nullif(profile_display_name, ''), profiles.display_name),
      avatar_url = coalesce(nullif(profile_avatar_url, ''), profiles.avatar_url),
      x_handle = case when raw_handle is not null then '@' || raw_handle else profiles.x_handle end
  where id = new.id;
  if char_length(candidate) >= 3 and not exists (select 1 from public.profiles where username = candidate and id <> new.id) then
    update public.profiles set username = candidate where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_x_profile_on_auth_user on auth.users;
create trigger sync_x_profile_on_auth_user
after update of raw_user_meta_data, raw_app_meta_data on auth.users
for each row execute function public.sync_x_profile();
