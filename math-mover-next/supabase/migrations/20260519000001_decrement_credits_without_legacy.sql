-- Keep the backend RPC aligned with the current profiles schema.
CREATE OR REPLACE FUNCTION public.decrement_credits_atomic(user_uuid uuid)
RETURNS void AS $$
DECLARE
  v_monthly int;
  v_permanent int;
BEGIN
  SELECT monthly_credits, permanent_credits
  INTO v_monthly, v_permanent
  FROM public.profiles
  WHERE id = user_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF COALESCE(v_monthly, 0) + COALESCE(v_permanent, 0) <= 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  IF COALESCE(v_monthly, 0) > 0 THEN
    UPDATE public.profiles
    SET monthly_credits = COALESCE(monthly_credits, 0) - 1
    WHERE id = user_uuid;
  ELSE
    UPDATE public.profiles
    SET permanent_credits = COALESCE(permanent_credits, 0) - 1
    WHERE id = user_uuid;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
