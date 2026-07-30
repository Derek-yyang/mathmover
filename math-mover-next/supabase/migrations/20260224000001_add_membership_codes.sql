-- 创建会员兑换码表
create table if not exists public.membership_codes (
    id uuid default gen_random_uuid() primary key,
    code text not null unique,
    duration_days integer not null, -- 增加的天数
    subscription_tier text not null, -- 会员等级: basic, pro
    is_used boolean default false,
    used_by uuid references auth.users(id),
    used_at timestamp with time zone,
    created_at timestamp with time zone default now()
);

-- 开启 RLS
alter table public.membership_codes enable row level security;

-- 创建兑换会员码的 RPC 函数
create or replace function public.redeem_membership(code_input text, user_uuid uuid)
returns table (success boolean, message text, days integer, tier text)
language plpgsql
security definer
as $$
declare
  v_code_record public.membership_codes%rowtype;
  v_current_expiry timestamp with time zone;
  v_current_tier text;
  v_new_expiry timestamp with time zone;
begin
  -- 1. 查询卡密
  select * into v_code_record
  from public.membership_codes
  where code = code_input;

  -- 2. 校验是否存在
  if not found then
    return query select false, '无效的会员兑换码'::text, 0, ''::text;
    return;
  end if;

  -- 3. 校验是否已使用
  if v_code_record.is_used then
    return query select false, '会员兑换码已被使用'::text, 0, ''::text;
    return;
  end if;

  -- 4. 获取当前用户的过期时间和等级
  select subscription_expires_at, subscription_type 
  into v_current_expiry, v_current_tier
  from public.profiles
  where id = user_uuid;

  -- 5. 计算新的过期时间
  -- 如果当前过期时间为空，或已过期，或当前等级与兑换码等级不一致（升级/降级），则从当前时间开始计算
  if v_current_expiry is null or v_current_expiry < now() or v_current_tier != v_code_record.subscription_tier then
    v_new_expiry := now() + (v_code_record.duration_days || ' days')::interval;
  else
    -- 如果当前会员有效且等级一致，则追加时间
    v_new_expiry := v_current_expiry + (v_code_record.duration_days || ' days')::interval;
  end if;

  -- 6. 执行兑换 (事务性操作)
  -- 标记为已用
  update public.membership_codes
  set is_used = true,
      used_by = user_uuid,
      used_at = now()
  where id = v_code_record.id;

  -- 更新用户会员状态
  update public.profiles
  set subscription_type = v_code_record.subscription_tier,
      subscription_expires_at = v_new_expiry,
      is_pro = (v_code_record.subscription_tier != 'free'),
      -- 如果兑换的是 Pro 且当前不是有效的 Pro 会员，则立即发放本月 60 积分
      monthly_credits = case 
          when v_code_record.subscription_tier = 'pro' and (v_current_tier != 'pro' or v_current_expiry < now()) then 60 
          else monthly_credits 
      end
  where id = user_uuid;

  -- 7. 返回成功
  return query select true, '兑换成功'::text, v_code_record.duration_days, v_code_record.subscription_tier;
end;
$$;
