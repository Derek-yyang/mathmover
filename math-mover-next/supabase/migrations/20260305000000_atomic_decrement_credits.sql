-- 数据库层原子扣费函数
-- 逻辑：优先扣除 monthly_credits，不足时扣除 permanent_credits，再不足时扣除 legacy credits。
-- 如果总积分不足，抛出异常，阻止扣费。

CREATE OR REPLACE FUNCTION decrement_credits_atomic(user_uuid UUID)
RETURNS void AS $$
DECLARE
  v_monthly INT;
  v_permanent INT;
  v_legacy INT;
BEGIN
  -- 锁定行，防止并发扣费 (FOR UPDATE)
  SELECT monthly_credits, permanent_credits, credits 
  INTO v_monthly, v_permanent, v_legacy
  FROM profiles 
  WHERE id = user_uuid 
  FOR UPDATE;

  -- 检查总积分是否充足
  IF (COALESCE(v_monthly, 0) + COALESCE(v_permanent, 0) + COALESCE(v_legacy, 0)) <= 0 THEN
    RAISE EXCEPTION 'Insufficient credits';
  END IF;

  -- 执行扣费逻辑 (优先级：monthly -> permanent -> legacy)
  IF COALESCE(v_monthly, 0) > 0 THEN
    UPDATE profiles SET monthly_credits = COALESCE(monthly_credits, 0) - 1 WHERE id = user_uuid;
  ELSIF COALESCE(v_permanent, 0) > 0 THEN
    UPDATE profiles SET permanent_credits = COALESCE(permanent_credits, 0) - 1 WHERE id = user_uuid;
  ELSE
    UPDATE profiles SET credits = COALESCE(credits, 0) - 1 WHERE id = user_uuid;
  END IF;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
