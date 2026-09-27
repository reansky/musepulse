update storage.buckets
set public = true
where id = 'user-media';

drop policy if exists user_media_public_read on storage.objects;
create policy user_media_public_read on storage.objects
for select to public
using (bucket_id = 'user-media');
