create unique index if not exists profiles_musebook_public_key_unique_idx
  on public.profiles (musebook_public_key)
  where musebook_public_key is not null;

create unique index if not exists profiles_musebook_muse_id_unique_idx
  on public.profiles (musebook_muse_id)
  where musebook_muse_id is not null;
