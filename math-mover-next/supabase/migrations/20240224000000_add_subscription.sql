-- Rename credits to permanent_credits
ALTER TABLE profiles RENAME COLUMN credits TO permanent_credits;

-- Add new columns
ALTER TABLE profiles ADD COLUMN subscription_type text DEFAULT 'free';
ALTER TABLE profiles ADD COLUMN subscription_expires_at timestamptz;
ALTER TABLE profiles ADD COLUMN monthly_credits integer DEFAULT 0;

-- Update decrement_credits function to prioritize monthly_credits
CREATE OR REPLACE FUNCTION decrement_credits(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET 
    monthly_credits = CASE 
      WHEN monthly_credits > 0 THEN monthly_credits - 1
      ELSE monthly_credits
    END,
    permanent_credits = CASE 
      WHEN monthly_credits <= 0 AND permanent_credits > 0 THEN permanent_credits - 1
      ELSE permanent_credits
    END
  WHERE id = user_uuid AND (monthly_credits > 0 OR permanent_credits > 0);
END;
$$;
