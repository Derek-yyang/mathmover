-- 创建 profiles 表
create table public.profiles (
  id uuid references auth.users not null primary key,
  phone text,
  credits integer default 5,
  is_pro boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 启用 Row Level Security (RLS)
alter table public.profiles enable row level security;

-- 创建策略：用户可以查看自己的 profile
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

-- 创建策略：用户可以更新自己的 profile
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- 创建 generations 表
create table public.generations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  image_url text,
  ggb_commands text,
  problem_type text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 启用 RLS
alter table public.generations enable row level security;

-- 创建策略：用户可以查看自己的生成历史
create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id);

-- 创建策略：用户可以插入自己的生成记录
create policy "Users can insert own generations" on public.generations
  for insert with check (auth.uid() = user_id);

-- 创建 redemption_codes 表
create table public.redemption_codes (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  points integer not null,
  is_used boolean default false,
  used_by uuid references auth.users,
  used_at timestamp with time zone
);

-- 启用 RLS
alter table public.redemption_codes enable row level security;

-- 创建策略：仅允许通过存储过程或特定逻辑访问（这里暂时允许读取，实际业务可能需要更严格限制）
-- 暂时只允许 authenticated 用户查询未使用的卡密（用于验证），或者只允许 service role 操作
-- 这里为了简单，暂不开放直接 select 权限给普通用户，通过 Server Action / Edge Function 操作

-- 创建触发器：新用户注册自动创建 profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, credits)
  values (new.id, 5);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
