-- ===========================================================================
-- 마이홈 업데이트 1/3: 테이블 + RLS
--   · 포인트: private.members.point_balance + private.point_ledger (신규)
--   · shop_items 만 public 카탈로그(SELECT 정책 true), 나머지는 private + RLS(정책 없음)
--   · 개인 데이터는 전부 security definer RPC 로만 접근 (02·03 파일)
--   · 멱등: if not exists / drop ... if exists 사용. SQL Editor에서 그대로 실행.
-- ===========================================================================

alter table private.members add column if not exists point_balance int not null default 0;

create table if not exists private.point_ledger (
  id bigserial primary key,
  member_id uuid not null references private.members(id),
  delta int not null,
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_items (
  id text primary key,
  name text not null,
  category text not null check (category in ('room','furniture','tree','avatar','costume','acc_head','acc_hand')),
  price int not null check (price >= 0),
  rarity text not null default 'normal',
  is_limited boolean not null default false,
  sale_start date,
  sale_end date,
  active boolean not null default true,
  asset_path text
);

create table if not exists private.myhome_rooms (
  member_id uuid primary key references private.members(id),
  bg_item_id text references public.shop_items(id),
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists private.user_items (
  id bigserial primary key,
  member_id uuid not null references private.members(id),
  item_id text not null references public.shop_items(id),
  placed boolean not null default false,
  x int check (x between 0 and 1000),
  y int check (y between 0 and 1000),
  z int not null default 0,
  equipped_slot text,
  acquired_at timestamptz not null default now(),
  unique (member_id, item_id)
);

create table if not exists private.myhome_comments (
  id bigserial primary key,
  room_user_id uuid not null references private.members(id),
  author_id uuid not null references private.members(id),
  body text not null check (char_length(body) <= 200),
  created_at timestamptz not null default now()
);

create table if not exists private.visit_logs (
  id bigserial primary key,
  room_user_id uuid not null,
  visitor_id uuid not null,
  visited_at timestamptz not null default now()
);

create table if not exists private.likes (
  room_user_id uuid not null,
  user_id uuid not null,
  primary key (room_user_id, user_id)
);

create table if not exists private.lottery_weekly_pool (
  week_key text primary key,
  sold int not null default 0,
  max_total int not null default 100
);

create table if not exists private.user_lottery_weekly (
  user_id uuid not null,
  week_key text not null,
  cnt int not null default 0,
  primary key (user_id, week_key)
);

create table if not exists private.lottery_prizes (
  tier int primary key,
  weight_permille int not null,
  kind text not null check (kind in ('item','points','choice','none')),
  item_id text references public.shop_items(id),
  points int not null default 0,
  choice_items text[]   -- kind='choice' 일 때 수령 선택지 (예: 남/여 코스튬)
);

create table if not exists private.lottery_draws (
  id bigserial primary key,
  member_id uuid not null,
  week_key text not null,
  tier int,
  item_id text,
  points int,
  refunded int not null default 0,
  claimed boolean not null default true,   -- 즉시 지급은 true, 선택 수령 대기(pending)만 false
  pending_choices text[],                  -- pending 시 수령 가능한 선택지 스냅샷
  created_at timestamptz not null default now()
);

-- RLS: shop_items 는 SELECT 정책만, private 테이블은 RLS enable + 정책 없음(직접 접근 전면 차단)
alter table public.shop_items enable row level security;
drop policy if exists shop_read on public.shop_items;
create policy shop_read on public.shop_items for select using (true);

do $$ declare t text; begin
  foreach t in array array['point_ledger','myhome_rooms','user_items','myhome_comments','visit_logs','likes','lottery_weekly_pool','user_lottery_weekly','lottery_prizes','lottery_draws'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on table private.%I from public, anon, authenticated', t);
  end loop; end $$;

-- 카탈로그: anon/authenticated 는 SELECT 만 (쓰기는 대시보드/마이그레이션에서만)
revoke insert, update, delete on public.shop_items from anon, authenticated;
grant select on public.shop_items to anon, authenticated;
