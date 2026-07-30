-- 1. 为 profiles 表增加上次重置日期字段
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_credit_reset date DEFAULT CURRENT_DATE;

-- 2. 创建或更新积分同步函数
-- 该函数负责检查用户状态并执行每日/每月重置逻辑
CREATE OR REPLACE FUNCTION public.sync_user_credits(user_uuid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_sub_type text;
    v_last_reset date;
    v_now_date date := CURRENT_DATE;
BEGIN
    -- 获取用户信息
    SELECT subscription_type, last_credit_reset
    INTO v_sub_type, v_last_reset
    FROM public.profiles
    WHERE id = user_uuid;

    -- 如果是体验版用户 (free)
    IF v_sub_type = 'free' OR v_sub_type IS NULL THEN
        -- 如果今天还没重置过
        IF v_last_reset IS NULL OR v_last_reset < v_now_date THEN
            UPDATE public.profiles
            SET 
                monthly_credits = 3, -- 每日赠送 3 积分
                last_credit_reset = v_now_date
            WHERE id = user_uuid;
            
            RAISE NOTICE 'User % (Free) credits reset to 3 for date %', user_uuid, v_now_date;
        END IF;
    END IF;

    -- 注意：Pro 会员的 60 积分是按月或按兑换发放的，
    -- 目前 Pro 的每月发放逻辑在 sync_user_credits 中暂不实现（通常在兑换或定时任务中处理），
    -- 这里主要解决 Free 用户的每日 3 积分需求。
END;
$$;

-- 3. 修改新用户创建逻辑，确保初始状态正确
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, permanent_credits, monthly_credits, subscription_type, last_credit_reset)
  VALUES (NEW.id, 5, 3, 'free', CURRENT_DATE);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
