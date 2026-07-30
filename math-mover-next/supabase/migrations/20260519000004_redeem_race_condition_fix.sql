-- Make redemption RPCs authenticated-user bound and race-safe.

CREATE OR REPLACE FUNCTION public.redeem_code(code_input text, user_uuid uuid)
RETURNS table (success boolean, message text, points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_record public.redemption_codes%rowtype;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> user_uuid THEN
    RETURN QUERY SELECT false, '未授权的兑换请求', 0;
    RETURN;
  END IF;

  SELECT * INTO v_code_record
  FROM public.redemption_codes
  WHERE code = code_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '无效的兑换码', 0;
    RETURN;
  END IF;

  IF v_code_record.is_used THEN
    RETURN QUERY SELECT false, '兑换码已被使用', 0;
    RETURN;
  END IF;

  UPDATE public.redemption_codes
  SET is_used = true,
      used_by = user_uuid,
      used_at = now()
  WHERE id = v_code_record.id
    AND is_used = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '兑换码已被使用', 0;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET permanent_credits = COALESCE(permanent_credits, 0) + v_code_record.points
  WHERE id = user_uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  RETURN QUERY SELECT true, '兑换成功', v_code_record.points;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_membership(code_input text, user_uuid uuid)
RETURNS table (success boolean, message text, days integer, tier text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code_record public.membership_codes%rowtype;
  v_current_expiry timestamp with time zone;
  v_current_tier text;
  v_new_expiry timestamp with time zone;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> user_uuid THEN
    RETURN QUERY SELECT false, '未授权的会员兑换请求'::text, 0, ''::text;
    RETURN;
  END IF;

  SELECT * INTO v_code_record
  FROM public.membership_codes
  WHERE code = code_input
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '无效的会员兑换码'::text, 0, ''::text;
    RETURN;
  END IF;

  IF v_code_record.is_used THEN
    RETURN QUERY SELECT false, '会员兑换码已被使用'::text, 0, ''::text;
    RETURN;
  END IF;

  SELECT subscription_expires_at, subscription_type
  INTO v_current_expiry, v_current_tier
  FROM public.profiles
  WHERE id = user_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF v_current_expiry IS NULL OR v_current_expiry < now() OR v_current_tier != v_code_record.subscription_tier THEN
    v_new_expiry := now() + (v_code_record.duration_days || ' days')::interval;
  ELSE
    v_new_expiry := v_current_expiry + (v_code_record.duration_days || ' days')::interval;
  END IF;

  UPDATE public.membership_codes
  SET is_used = true,
      used_by = user_uuid,
      used_at = now()
  WHERE id = v_code_record.id
    AND is_used = false;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '会员兑换码已被使用'::text, 0, ''::text;
    RETURN;
  END IF;

  UPDATE public.profiles
  SET subscription_type = v_code_record.subscription_tier,
      subscription_expires_at = v_new_expiry,
      is_pro = (v_code_record.subscription_tier != 'free'),
      monthly_credits = CASE
        WHEN v_code_record.subscription_tier = 'pro'
          AND (v_current_tier != 'pro' OR v_current_expiry IS NULL OR v_current_expiry < now())
        THEN 60
        ELSE monthly_credits
      END
  WHERE id = user_uuid;

  RETURN QUERY SELECT true, '兑换成功'::text, v_code_record.duration_days, v_code_record.subscription_tier;
END;
$$;

REVOKE ALL ON public.redemption_codes FROM anon, authenticated;
REVOKE ALL ON public.membership_codes FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.redeem_code(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_membership(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_code(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_membership(text, uuid) TO authenticated;
