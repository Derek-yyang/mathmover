-- 1. 允许认证用户更新自己的图片 (UPDATE)
CREATE POLICY "Users can update own images"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'problem-images' AND (storage.foldername(name))[1] = auth.uid()::text );

-- 2. 允许认证用户删除自己的图片 (DELETE)
CREATE POLICY "Users can delete own images"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'problem-images' AND (storage.foldername(name))[1] = auth.uid()::text );

-- 3. 改进上传策略：限制用户只能上传到自己的文件夹 (INSERT)
-- 先删除旧策略 (如果存在)
DROP POLICY IF EXISTS "Authenticated Uploads" ON storage.objects;

CREATE POLICY "Users can upload to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( 
    bucket_id = 'problem-images' 
    AND (storage.foldername(name))[1] = auth.uid()::text 
);
