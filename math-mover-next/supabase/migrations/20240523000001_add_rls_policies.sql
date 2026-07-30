-- Enable RLS
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

-- Policy for SELECT
CREATE POLICY "Users can view their own generations"
ON generations FOR SELECT
USING (auth.uid() = user_id);

-- Policy for INSERT
CREATE POLICY "Users can insert their own generations"
ON generations FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Policy for UPDATE
CREATE POLICY "Users can update their own generations"
ON generations FOR UPDATE
USING (auth.uid() = user_id);

-- Policy for DELETE
CREATE POLICY "Users can delete their own generations"
ON generations FOR DELETE
USING (auth.uid() = user_id);
