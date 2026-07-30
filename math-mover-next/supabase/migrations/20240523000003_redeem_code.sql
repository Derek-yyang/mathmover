-- 创建兑换卡密的 RPC 函数
create or replace function public.redeem_code(code_input text, user_uuid uuid)
returns table (success boolean, message text, points integer)
language plpgsql
security definer
as $$
declare
  v_code_record public.redemption_codes%rowtype;
begin
  -- 1. 查询卡密
  select * into v_code_record
  from public.redemption_codes
  where code = code_input;

  -- 2. 校验是否存在
  if not found then
    return query select false, '无效的兑换码', 0;
    return;
  end if;

  -- 3. 校验是否已使用
  if v_code_record.is_used then
    return query select false, '兑换码已被使用', 0;
    return;
  end if;

  -- 4. 执行兑换 (事务性操作)
  -- 标记为已用
  update public.redemption_codes
  set is_used = true,
      used_by = user_uuid,
      used_at = now()
  where id = v_code_record.id;

  -- 增加用户积分
  update public.profiles
  set credits = credits + v_code_record.points
  where id = user_uuid;

  -- 5. 返回成功
  return query select true, '兑换成功', v_code_record.points;
end;
$$;
