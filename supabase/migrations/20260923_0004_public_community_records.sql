update storage.buckets
set public = true
where id = 'user-media';

alter table public.projects alter column visibility set default 'public';
alter table public.tools alter column visibility set default 'public';
alter table public.signals alter column visibility set default 'public';

update public.projects set visibility = 'public' where visibility <> 'public';
update public.tools set visibility = 'public' where visibility <> 'public';
update public.signals set visibility = 'public' where visibility <> 'public';
update public.signals set status = 'PUBLISHED' where status <> 'PUBLISHED';
