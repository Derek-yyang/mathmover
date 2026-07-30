-- 创建存储桶
insert into storage.buckets (id, name, public)
values ('problem-images', 'problem-images', true)
on conflict (id) do nothing;

-- 允许公开访问 (SELECT)
create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'problem-images' );

-- 允许认证用户上传 (INSERT)
create policy "Authenticated Uploads"
  on storage.objects for insert
  with check ( bucket_id = 'problem-images' and auth.role() = 'authenticated' );
