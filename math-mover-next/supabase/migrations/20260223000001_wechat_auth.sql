-- Add wechat_openid to profiles if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'wechat_openid') THEN
        ALTER TABLE profiles ADD COLUMN wechat_openid TEXT UNIQUE;
    END IF;
END $$;

-- Create wechat_codes table
CREATE TABLE IF NOT EXISTS wechat_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    openid TEXT NOT NULL,
    code VARCHAR(6) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_wechat_codes_openid_code ON wechat_codes(openid, code);

-- RLS Policies (Optional: if needed for client access, but here we use admin mainly)
ALTER TABLE wechat_codes ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access" ON wechat_codes
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
