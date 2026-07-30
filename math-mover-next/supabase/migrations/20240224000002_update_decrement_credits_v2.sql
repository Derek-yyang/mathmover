-- 更新扣分逻辑：增加过期时间检查
CREATE OR REPLACE FUNCTION decrement_credits(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_monthly_credits int;
  v_permanent_credits int;
  v_expires_at timestamptz;
BEGIN
  -- 首先同步积分（处理每日赠送等逻辑）
  PERFORM public.sync_user_credits(user_uuid);

  -- 获取当前用户状态
  SELECT monthly_credits, permanent_credits, subscription_expires_at
  INTO v_monthly_credits, v_permanent_credits, v_expires_at
  FROM profiles
  WHERE id = user_uuid;

  -- 如果会员已过期，则视为 monthly_credits 为 0 (即使数据库里还有值)
  IF v_expires_at IS NOT NULL AND v_expires_at < now() THEN
     v_monthly_credits := 0;
  END IF;

  -- 扣分逻辑
  IF v_monthly_credits > 0 THEN
    UPDATE profiles SET monthly_credits = monthly_credits - 1 WHERE id = user_uuid;
  ELSIF v_permanent_credits > 0 THEN
    UPDATE profiles SET permanent_credits = permanent_credits - 1 WHERE id = user_uuid;
  ELSE
    -- 如果都不足，抛出异常 (前端 RPC 调用会捕获到 error)
    RAISE EXCEPTION '积分不足';
  END IF;
END;
$$;
