-- 创建扣减积分的 RPC 函数
create or replace function public.decrement_credits(user_uuid uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.profiles
  set credits = credits - 1
  where id = user_uuid and credits > 0;
end;
$$;
