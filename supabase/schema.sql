-- ============================================================================
--  연못 (Yeonmot Munpa) · Supabase 스키마 v1
--  대상: Supabase 프로젝트의 SQL Editor 에서 한 번 실행 (Postgres 15+)
--
--  ■ 무엇을 담당하나
--    1) 초대 코드 + 닉네임 + 4자리 PIN 으로 가입/로그인 (앱 자체 계정, 이메일 없음)
--    2) 역할: admin(문주) / officer(운영진) / member(문파원)
--       · 화면의 문주 → admin, 부문주·장로·정예 → officer, 문파원 → member 로 옮겨 쓰면 됩니다.
--    3) 관리자: 강퇴·차단·직위 변경·초대 코드 변경·공지·문파컨텐츠·쿠폰·채팅/앨범 삭제
--    4) 문파원: 출석(물결), 채팅, 앨범 업로드(용량 제한) + 좋아요
--    5) Realtime: chat_messages / notices / events
--
--  ■ 보안 모델 (anon 키가 공개되어 있어도 안전하도록)
--    · 실명·전화번호·이메일·주소 컬럼 없음. 닉네임 외의 개인 식별 정보를 저장하지 않습니다.
--    · PIN 은 bcrypt 해시로만 저장하고, 어떤 경로로도 SELECT 되지 않습니다(컬럼 단위 노출 없음).
--    · 읽기/쓰기 모두 RPC(SECURITY DEFINER) 로 처리합니다.
--      - 쓰기: anon 에게 INSERT/UPDATE/DELETE 권한을 주지 않습니다 → 테이블 직접 쓰기 불가.
--      - 읽기: 로그인 계정이 필요한 데이터(문파원·출석·앨범·쿠폰·설정)는 RPC 만.
--      - 채팅·공지·문파컨텐츠는 Realtime 구독 때문에 anon SELECT 만 열어 둡니다(개인정보 없는 공개 내용).
--      - 삭제된 채팅은 본문을 빈 문자열로 지우고 남깁니다(실시간으로 삭제가 전달되도록).
--    · 로그인은 PIN 오입력 5회부터 잠금(최대 5분)으로 무차별 대입을 늦춥니다.
--    · 세션은 32바이트 랜덤 토큰이며 DB 에는 SHA-256 해시만 저장합니다.
--      → DB 가 유출되어도 토큰 원문을 되살릴 수 없고, PIN 해시도 bcrypt 라 바로 못 씁니다.
--
--  ■ 클라이언트 흐름
--    const { data: s } = await supabase.rpc('register_member',
--        { p_nickname:'청연', p_pin:'1234', p_invite_code:'YEONMOT' });
--    // s.token 을 저장 → 이후 모든 RPC 에 p_token 으로 전달
--    await supabase.rpc('post_chat_message', { p_token: s.token, p_body:'안녕하세요' });
--    supabase.channel('clan').on('postgres_changes',
--        { event:'INSERT', schema:'public', table:'chat_messages' }, cb).subscribe();
--
--    로그인은 예외 대신 결과 객체를 돌려줍니다(오입력 횟수를 저장하려면 트랜잭션이 살아 있어야 해서):
--      const { data } = await supabase.rpc('login_member', { p_nickname:'청연', p_pin:'1234' });
--      if (!data.ok) { showError(data.message); }        // code: invalid_credentials | locked | blocked
--      else { saveToken(data.token); }
--
--  ■ 실행 순서
--    이 파일은 "새 프로젝트에 처음 넣는 설치본" 입니다. 이미 만든 뒤 구조를 바꿨다면
--    Supabase 대시보드에서 테이블을 지우고 다시 실행하거나, 아래 DROP 블록(맨 끝)을 참고하세요.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. 확장 / 스키마
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

-- private 스키마는 API 로 노출하지 않습니다. anon 은 접근 권한 자체가 없습니다.
revoke all on schema private from public;
grant usage on schema public to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 1. 내부 타입 / 공통 함수
-- ---------------------------------------------------------------------------

-- 로그인한 사람의 최소 정보 (함수 사이에서만 주고받습니다)
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'private' and t.typname = 'session_actor') then
    create type private.session_actor as (
      member_id   uuid,
      nickname    text,
      member_role text,
      member_level integer
    );
  end if;
end $$;

-- 한국 시간 기준 '오늘'
create or replace function private.today_kst()
returns date
language sql
stable
set search_path = ''
as $fn$
  select (now() at time zone 'Asia/Seoul')::date;
$fn$;

-- 세션 토큰 → 저장용 해시 (원문은 저장하지 않습니다)
--   sha256 은 pgcrypto 함수라, 설치 위치(extensions 또는 public)에 상관없이 찾도록
--   실행 시점 search_path 를 지정합니다.
create or replace function private.token_hash(p_token text)
returns text
language plpgsql
immutable
set search_path = extensions, public, pg_temp
as $fn$
begin
  return encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
end;
$fn$;

-- PIN → bcrypt 해시 (pgcrypto 가 extensions/public 어디에 있든 찾도록 search_path 지정)
create or replace function private.pin_hash(p_pin text)
returns text
language plpgsql
volatile
set search_path = extensions, public, pg_temp
as $fn$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN은 숫자 4자리로 입력해 주세요.' using errcode = '22023';
  end if;
  return crypt(p_pin, gen_salt('bf', 10));
end;
$fn$;

create or replace function private.pin_matches(p_pin text, p_hash text)
returns boolean
language plpgsql
stable
set search_path = extensions, public, pg_temp
as $fn$
begin
  if p_pin is null or p_hash is null or p_pin !~ '^[0-9]{4}$' then
    return false;
  end if;
  return crypt(p_pin, p_hash) = p_hash;
end;
$fn$;

-- updated_at 자동 갱신
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. 테이블
-- ---------------------------------------------------------------------------

-- 2-1. 문파 설정 (한 줄짜리 테이블)
create table if not exists private.clan_settings (
  id                    smallint primary key default 1 check (id = 1),
  clan_name             text not null default '연못'
                          check (char_length(clan_name) between 1 and 40),
  clan_motto            text not null default '물결이 모여 연못이 되고, 연못이 모여 강이 된다'
                          check (char_length(clan_motto) between 1 and 120),
  member_capacity       smallint not null default 30
                          check (member_capacity between 1 and 200),
  -- 초대 코드: 관리자가 화면에서 다시 확인·복사할 수 있어야 해서 평문으로 둡니다.
  --   (DB 유출 시에도 계정은 PIN 으로 보호됩니다. 평문을 피하려면 해시로 바꾸고
  --    admin_get_settings 에서 코드를 돌려주지 않으면 됩니다.)
  invite_code           text not null default 'YEONMOT'
                          check (invite_code ~ '^[가-힣A-Z0-9_-]{4,20}$'),
  invite_code_updated_at timestamptz not null default now(),
  -- 초기 문주 복구용 설치 코드(bcrypt). SQL Editor 에서 private.set_setup_code('...') 로 지정.
  setup_code_hash       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table private.clan_settings is '문파 설정 한 줄. 초대 코드는 관리자가 언제든 변경(admin_update_invite_code).';

-- 2-2. 문파원 (개인정보 없음: 닉네임 + PIN 해시뿐)
create table if not exists private.members (
  id                 uuid primary key default gen_random_uuid(),
  nickname           text not null
                       constraint members_nickname_format
                       check (nickname ~ '^[가-힣a-zA-Z0-9_]{2,10}$'),
  -- 대소문자 무시 중복 방지용 보조 컬럼 (예: CheonYeon / cheonyeon 은 같은 닉네임)
  nickname_key       text generated always as (lower(nickname)) stored,
  pin_hash           text not null,
  member_role        text not null default 'member'
                       check (member_role in ('admin', 'officer', 'member')),
  member_level       integer not null default 1
                       check (member_level between 1 and 500),
  status             text not null default 'active'
                       check (status in ('active', 'kicked', 'banned')),
  status_reason      text check (status_reason is null or char_length(status_reason) <= 200),
  status_changed_at  timestamptz,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until       timestamptz,
  -- 프로필 그림: 'preset:lotus' … 'preset:duck' 9종 또는 클라이언트에서 128×128 로 줄인
  --   data:image/(jpeg|webp|png);base64,… (최대 65,000자 ≈ 48KB). null 이면 닉네임 첫 글자.
  avatar             text
                       constraint members_avatar_len
                       check (avatar is null or char_length(avatar) <= 65000),
  joined_at          timestamptz not null default now(),
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column private.members.pin_hash is 'bcrypt 해시. 어떤 RPC/뷰로도 밖으로 나가지 않습니다.';
comment on column private.members.status is 'kicked=강퇴, banned=차단. 행을 지우지 않아 닉네임이 예약되고 재가입이 막힙니다.';

create unique index if not exists members_nickname_key_uidx
  on private.members (nickname_key);

create index if not exists members_status_idx
  on private.members (status, member_role);

-- 2-3. 로그인 세션 (토큰 원문은 저장하지 않음)
create table if not exists private.member_sessions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references private.members (id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null default (now() + interval '30 days'),
  revoked_at     timestamptz,
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) <= 40)
);

create index if not exists member_sessions_member_idx
  on private.member_sessions (member_id, created_at desc);

create index if not exists member_sessions_alive_idx
  on private.member_sessions (token_hash)
  where revoked_at is null;

-- 2-4. 출석 (오늘의 물결) — 하루 한 번
create table if not exists private.attendance (
  member_id  uuid not null references private.members (id) on delete cascade,
  day        date not null,
  created_at timestamptz not null default now(),
  primary key (member_id, day)
);

create index if not exists attendance_day_idx
  on private.attendance (day);

-- 2-5. 문파채팅 (Realtime 대상 · 공개 읽기)
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  -- 문파원 행은 지우지 않고 status 로만 다룹니다(닉네임 예약·기록 보존).
  member_id  uuid references private.members (id) on delete restrict,
  kind       text not null default 'text' check (kind in ('text', 'system')),
  body       text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references private.members (id) on delete set null,

  -- 삭제되면 본문을 남기지 않습니다(관리자 삭제 = 내용 즉시 소거).
  constraint chat_messages_body_state check (
    (deleted_at is null and char_length(body) between 1 and 500)
    or (deleted_at is not null and body = '')
  ),
  constraint chat_messages_author_state check (
    (kind = 'text' and member_id is not null)
    or (kind = 'system' and member_id is null)
  )
);

create index if not exists chat_messages_created_idx
  on public.chat_messages (id desc);

create index if not exists chat_messages_live_idx
  on public.chat_messages (created_at desc)
  where deleted_at is null;

comment on table public.chat_messages is '문파채팅. 쓰기는 post_chat_message RPC만, 읽기는 Realtime 구독을 위해 anon SELECT 허용(개인정보 없음).';

-- 2-6. 공지 (Realtime 대상)
create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 60),
  body       text not null check (char_length(body) between 1 and 4000),
  tag        text not null default '공지' check (char_length(tag) between 1 and 10),
  pinned     boolean not null default false,
  author_id  uuid references private.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists notices_pinned_created_idx
  on public.notices (pinned desc, created_at desc)
  where deleted_at is null;

-- 2-6b. 공략 영상 (홈 '공략' 섹션 · 유튜브 썸네일 2×2)
--   · 개인정보 없음 — 제목·유튜브 주소·영상 ID 만 담습니다(공개 읽기).
--   · 올리기: 로그인한 문파원 누구나(create_guide) · 삭제: 올린 본인 또는 운영진(delete_guide).
create table if not exists public.guides (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  youtube_url text not null check (char_length(youtube_url) between 8 and 300),
  video_id    text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  created_by  uuid references private.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists guides_created_idx
  on public.guides (created_at desc)
  where deleted_at is null;

comment on table public.guides is '홈 공략 섹션의 유튜브 영상. 썸네일은 i.ytimg.com/vi/{video_id}/hqdefault.jpg.';

-- 2-7. 문파컨텐츠 (예전 이름: 모임 일정 · Realtime 대상)
--   · repeat_weekly = true 이면 repeat_weekdays(0=일 … 6=토)의 요일마다 같은 시간에 열립니다.
--   · starts_at 은 '다음 예정 시각'을 담습니다(매주 반복도 정렬이 자연스럽도록 매번 다시 계산).
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(title) between 1 and 60),
  place      text not null default '' check (char_length(place) <= 60),
  tag        text not null default '모임' check (char_length(tag) between 1 and 10),
  note       text not null default '' check (char_length(note) <= 200),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  repeat_weekly   boolean not null default false,
  repeat_weekdays smallint[] not null default '{}',
  created_by uuid references private.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_time_order check (ends_at is null or ends_at >= starts_at),
  constraint events_repeat_weekdays_range
    check (repeat_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  constraint events_repeat_weekdays_shape
    check (not repeat_weekly or cardinality(repeat_weekdays) between 1 and 7)
);

create index if not exists events_starts_idx
  on public.events (starts_at)
  where deleted_at is null;

comment on column public.events.repeat_weekly is '매주 반복 여부. true 면 repeat_weekdays 의 요일마다 같은 시간에 열립니다.';
comment on column public.events.repeat_weekdays is '반복 요일 (0=일 … 6=토). repeat_weekly = false 면 빈 배열입니다.';

-- 2-8. 쿠폰
create table if not exists private.coupons (
  id         uuid primary key default gen_random_uuid(),
  code       text not null check (code ~ '^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$'),
  title      text not null check (char_length(title) between 1 and 60),
  reward     text not null check (char_length(reward) between 1 and 60),
  expires_on date,
  tone       text not null default 'lotus' check (tone in ('lotus', 'jade', 'gold')),
  is_active  boolean not null default true,
  created_by uuid references private.members (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists coupons_code_uidx
  on private.coupons (upper(code))
  where deleted_at is null;

-- 2-9. 문파앨범 : 글(메타) 과 이미지(본문) 를 나눠 목록 조회가 가볍게
--   · title 은 글 기능 이전(제목 필수 시절)에 올린 사진을 위한 자리입니다 — 지금은 빈 값도 됩니다.
--   · caption 이 화면에 보이는 '글(선택)' 이며, 비워 두고 사진만 올려도 됩니다.
create table if not exists private.album_posts (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references private.members (id) on delete cascade,
  title       text not null default '' check (char_length(title) <= 40),
  caption     text not null default '' check (char_length(caption) <= 300),
  image_mime  text not null default 'image/jpeg'
                check (image_mime in ('image/jpeg', 'image/png', 'image/webp')),
  image_bytes integer not null default 0 check (image_bytes between 0 and 819200),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references private.members (id) on delete set null
);

create index if not exists album_posts_created_idx
  on private.album_posts (created_at desc)
  where deleted_at is null;

create table if not exists private.album_images (
  post_id    uuid primary key references private.album_posts (id) on delete cascade,
  data_url   text not null,
  byte_len   integer not null check (byte_len between 1 and 819200),
  created_at timestamptz not null default now(),
  -- data:image/...;base64, 형식만, 원본 800KB(≈ base64 1.1MB) 이하만
  constraint album_images_data_url_format
    check (data_url like 'data:image/%'
           and data_url like '%;base64,%'
           and octet_length(data_url) <= 1120000)
);

create table if not exists private.album_likes (
  post_id    uuid not null references private.album_posts (id) on delete cascade,
  member_id  uuid not null references private.members (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, member_id)
);

-- 2-9b. 문파원 자리비움 (홈 맨 아래 '문파원 자리비움' 게시판)
--   · 개인정보 없음 — 닉네임(대상 문파원 표에서 가져오거나, 미가입자는 직접 입력한 이름)·기간·이유만 담습니다.
--   · 등록: 로그인한 active 문파원 누구나(create_absence, 본인) — 다른 문파원 대신 올리기는 운영진(admin · officer)만.
--   · 삭제: 운영진(admin · officer)만.
create table if not exists public.member_absences (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references private.members (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text not null check (char_length(reason) between 1 and 60),
  -- 대리 등록: 올린 운영진(created_by)이 대상(member_id) 대신 올렸거나,
  --   아직 사이트에 가입하지 않은 문파원의 이름(target_name)을 직접 적어 올린 경우.
  created_by  uuid references private.members (id) on delete set null,
  target_name text
                constraint absences_target_name_len
                check (target_name is null or char_length(btrim(target_name)) between 2 and 20),
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint absences_date_order check (end_date >= start_date)
);

comment on column public.member_absences.created_by is
  '자리비움을 올린 문파원. 대상(member_id)과 다르면 대신 올린 것(운영진). 예전 기록은 비어 있습니다.';
comment on column public.member_absences.target_name is
  '아직 사이트에 가입하지 않은 문파원의 이름을 직접 적은 경우(2~20자). 값이 있으면 member_id 는 올린 운영진.';

create index if not exists absences_dates_idx
  on public.member_absences (start_date)
  where deleted_at is null;

comment on table public.member_absences is
  '문파원 자리비움 기간(시작일·종료일)과 이유. 읽기/쓰기는 RPC(list_absences · create_absence · delete_absence)만.';

-- 2-10. 관리자 행동 기록
create table if not exists private.admin_audit (
  id          bigint generated always as identity primary key,
  actor_id    uuid references private.members (id) on delete set null,
  action      text not null check (char_length(action) between 1 and 60),
  target_kind text check (target_kind is null or char_length(target_kind) <= 20),
  target_id   text check (target_id is null or char_length(target_id) <= 60),
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_created_idx
  on private.admin_audit (created_at desc);


-- ---------------------------------------------------------------------------
-- 2-11. 관리자 행동 기록 함수 (테이블 생성 뒤에 정의해야 합니다)
--       개인정보 없음: 누가/무엇을/언제
-- ---------------------------------------------------------------------------
create or replace function private.log_admin(
  p_actor_id    uuid,
  p_action      text,
  p_target_kind text,
  p_target_id   text,
  p_detail      jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into private.admin_audit (actor_id, action, target_kind, target_id, detail)
  values (p_actor_id, p_action, p_target_kind, p_target_id, coalesce(p_detail, '{}'::jsonb));
$fn$;


-- ---------------------------------------------------------------------------
-- 3. 트리거
-- ---------------------------------------------------------------------------
drop trigger if exists clan_settings_touch on private.clan_settings;
create trigger clan_settings_touch before update on private.clan_settings
  for each row execute function private.touch_updated_at();

drop trigger if exists members_touch on private.members;
create trigger members_touch before update on private.members
  for each row execute function private.touch_updated_at();

drop trigger if exists notices_touch on public.notices;
create trigger notices_touch before update on public.notices
  for each row execute function private.touch_updated_at();

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function private.touch_updated_at();

drop trigger if exists coupons_touch on private.coupons;
create trigger coupons_touch before update on private.coupons
  for each row execute function private.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 4. 공개 뷰 (문파원 목록) — pin_hash 등 민감 컬럼은 절대 포함하지 않음
--    security_invoker = off (기본값) 이라 private.members 의 RLS 를 우회하지만,
--    아래 컬럼만 노출하므로 안전합니다.
-- ---------------------------------------------------------------------------
create or replace view public.public_members
with (security_invoker = false)
as
select
  m.id,
  m.nickname,
  m.member_role,
  m.member_level,
  m.joined_at,
  m.last_seen_at,
  m.avatar
from private.members m
where m.status = 'active';

comment on view public.public_members is '문파원 목록(활성). pin_hash·상태 사유 등은 노출하지 않습니다.';

revoke all on public.public_members from public;
grant select on public.public_members to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. RLS
--    · public.chat_messages / notices / events : SELECT 만 허용 (쓰기는 RPC)
--    · private.* : RLS 켜고 정책 없음 → anon 직접 접근 전면 차단 (RPC=owner 는 우회)
-- ---------------------------------------------------------------------------
alter table public.chat_messages enable row level security;
alter table public.notices      enable row level security;
alter table public.events       enable row level security;
alter table public.guides       enable row level security;
alter table public.member_absences enable row level security;

alter table private.clan_settings   enable row level security;
alter table private.members         enable row level security;
alter table private.member_sessions enable row level security;
alter table private.attendance      enable row level security;
alter table private.coupons         enable row level security;
alter table private.album_posts     enable row level security;
alter table private.album_images    enable row level security;
alter table private.album_likes     enable row level security;
alter table private.admin_audit     enable row level security;

-- 테이블 직접 권한 정리: anon/authenticated 는 세 테이블의 SELECT 만.
revoke all on table public.chat_messages from public, anon, authenticated;
revoke all on table public.notices       from public, anon, authenticated;
revoke all on table public.events        from public, anon, authenticated;
revoke all on table public.guides        from public, anon, authenticated;
revoke all on table public.member_absences from public, anon, authenticated;
grant select on table public.chat_messages to anon, authenticated;
grant select on table public.notices       to anon, authenticated;
grant select on table public.events        to anon, authenticated;
grant select on table public.guides        to anon, authenticated;

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages
  for select to anon, authenticated
  using (true);   -- 삭제된 메시지는 본문이 '' 이므로 내용이 남지 않습니다.

--  ↑ 채팅은 '문파 안의 공개 대화'를 전제로 한 읽기 정책입니다.
--     anon 키(= 앱 소스에 들어가는 공개 키)를 아는 사람이면 초대 코드 없이도 읽을 수 있습니다.
--     더 좁히려면 ① Supabase Anonymous Sign-in 을 켜고 auth.uid() 기준 정책으로 바꾸거나,
--     ② using (created_at > now() - interval '30 days') 처럼 최근 글만 남기는 방법이 있습니다.
--     (Realtime 구독은 구독자 역할로 RLS 를 검사하므로, 테이블 읽기를 완전히 막으면 실시간 채팅도 함께 막힙니다.)

drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices
  for select to anon, authenticated
  using (deleted_at is null);

drop policy if exists events_read on public.events;
create policy events_read on public.events
  for select to anon, authenticated
  using (deleted_at is null);

drop policy if exists guides_read on public.guides;
create policy guides_read on public.guides
  for select to anon, authenticated
  using (deleted_at is null);


-- ---------------------------------------------------------------------------
-- 6. Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = 'chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = 'notices') then
      alter publication supabase_realtime add table public.notices;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime'
                      and schemaname = 'public' and tablename = 'events') then
      alter publication supabase_realtime add table public.events;
    end if;
  else
    create publication supabase_realtime
      for table public.chat_messages, public.notices, public.events;
  end if;
end $$;


-- ===========================================================================
-- 7. 세션 / 로그인 처리 (내부)
-- ===========================================================================

-- 세션 발급: 32바이트 랜덤 토큰 → 원문은 클라이언트만, DB 에는 해시만.
-- 한 사람당 살아있는 세션은 최근 3개까지만 유지합니다.
create or replace function private.issue_session(p_member_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_token text;
  v_hash  text;
begin
  v_token := replace(gen_random_uuid()::text, '-', '')
             || replace(gen_random_uuid()::text, '-', '');
  v_hash := private.token_hash(v_token);

  insert into private.member_sessions (member_id, token_hash)
  values (p_member_id, v_hash);

  -- 만료·폐기된 세션 정리
  delete from private.member_sessions s
   where s.member_id = p_member_id
     and (s.revoked_at is not null or s.expires_at <= now());

  -- 최근 3개만 남기기
  delete from private.member_sessions s
   where s.member_id = p_member_id
     and s.id not in (
       select s2.id from private.member_sessions s2
        where s2.member_id = p_member_id
        order by s2.created_at desc
        limit 3
     );

  return v_token;
end;
$fn$;

-- 토큰 → 로그인한 사람. 없으면 예외. 90초에 한 번 접속 시각 갱신.
create or replace function private.current_member(p_token text)
returns private.session_actor
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_session private.member_sessions;
  v_member  private.members;
  v_actor   private.session_actor;
begin
  if p_token is null or char_length(p_token) < 32 then
    raise exception '로그인이 필요해요. 다시 로그인해 주세요.' using errcode = '28000';
  end if;

  select * into v_session
    from private.member_sessions s
   where s.token_hash = private.token_hash(p_token);

  if not found then
    raise exception '로그인이 필요해요. 다시 로그인해 주세요.' using errcode = '28000';
  end if;

  if v_session.revoked_at is not null or v_session.expires_at <= now() then
    raise exception '로그인 시간이 지났어요. 다시 로그인해 주세요.' using errcode = '28000';
  end if;

  select * into v_member
    from private.members m
   where m.id = v_session.member_id;

  if not found then
    raise exception '로그인이 필요해요. 다시 로그인해 주세요.' using errcode = '28000';
  end if;

  if v_member.status <> 'active' then
    raise exception '이 닉네임으로는 접속할 수 없어요. 운영진에게 문의해 주세요.' using errcode = '28000';
  end if;

  if v_session.last_seen_at < now() - interval '90 seconds' then
    update private.member_sessions set last_seen_at = now() where id = v_session.id;
    update private.members set last_seen_at = now() where id = v_member.id;
  end if;

  v_actor.member_id    := v_member.id;
  v_actor.nickname     := v_member.nickname;
  v_actor.member_role  := v_member.member_role;
  v_actor.member_level := v_member.member_level;
  return v_actor;
end;
$fn$;

-- 관리자(문주) 전용 확인
create or replace function private.require_admin(p_token text)
returns private.session_actor
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor;
begin
  v_actor := private.current_member(p_token);
  if v_actor.member_role <> 'admin' then
    raise exception '문주만 할 수 있는 일이에요.' using errcode = '42501';
  end if;
  return v_actor;
end;
$fn$;


-- ===========================================================================
-- 8. RPC · 가입 / 로그인
-- ===========================================================================

-- 가입: 초대 코드 + 닉네임 + PIN(4자리).
-- 아직 문주가 한 명도 없으면 이 첫 가입자가 자동으로 문주(admin)가 됩니다.
create or replace function public.register_member(
  p_nickname    text,
  p_pin         text,
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_nick      text := btrim(coalesce(p_nickname, ''));
  v_settings  private.clan_settings;
  v_member    private.members;
  v_token     text;
  v_role      text;
  v_admin_cnt integer;
begin
  if v_nick !~ '^[가-힣a-zA-Z0-9_]{2,10}$' then
    raise exception '닉네임은 한글·영문·숫자 2~10자로 정해 주세요.' using errcode = '22023';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN은 숫자 4자리로 입력해 주세요.' using errcode = '22023';
  end if;

  select * into v_settings from private.clan_settings where id = 1;
  if not found then
    raise exception '문파 설정이 아직 준비되지 않았어요.' using errcode = '55000';
  end if;

  -- 가입 처리를 한 줄로 세웁니다. 두 사람이 동시에 첫 가입을 해도
  -- '문주가 없을 때' 판정과 INSERT 사이가 벌어지지 않아 문주가 둘 생기지 않습니다.
  perform pg_advisory_xact_lock(917311);

  -- 초대 코드는 대소문자를 가리지 않습니다(저장은 항상 대문자).
  if p_invite_code is null
     or upper(btrim(p_invite_code)) <> upper(v_settings.invite_code) then
    raise exception '초대 코드가 맞지 않아요. 운영진에게 확인해 주세요.' using errcode = '28000';
  end if;

  select * into v_member
    from private.members m
   where m.nickname_key = lower(v_nick);

  if found then
    raise exception '이미 쓰고 있는 닉네임이에요.' using errcode = '23505';
  end if;

  if (select count(*) from private.members m where m.status = 'active')
       >= v_settings.member_capacity then
    raise exception '문파 정원이 가득 찼어요. 운영진에게 문의해 주세요.' using errcode = '54000';
  end if;

  select count(*) into v_admin_cnt
    from private.members m
   where m.member_role = 'admin' and m.status = 'active';

  v_role := case when v_admin_cnt = 0 then 'admin' else 'member' end;

  insert into private.members (nickname, pin_hash, member_role, last_seen_at)
  values (v_nick, private.pin_hash(p_pin), v_role, now())
  returning * into v_member;

  v_token := private.issue_session(v_member.id);

  perform private.log_admin(v_member.id, 'member.register', 'member', v_member.id::text,
                            jsonb_build_object('role', v_role));

  return jsonb_build_object(
    'token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'nickname', v_member.nickname,
      'role', v_member.member_role,
      'level', v_member.member_level,
      'avatar', v_member.avatar
    ),
    'is_first_admin', v_role = 'admin'
  );
exception
  when unique_violation then
    raise exception '이미 쓰고 있는 닉네임이에요.' using errcode = '23505';
end;
$fn$;

-- 로그인: 닉네임 + PIN. 초대 코드는 필요 없습니다(이미 문파원이므로).
--   ※ 실패하면 예외를 던지지 않고 { ok:false, code } 를 돌려줍니다.
--     예외를 던지면 같은 트랜잭션이 롤백되어 "PIN 오입력 횟수" 기록이 사라지기 때문입니다.
--     (4자리 PIN 은 1만 가지뿐이라, 횟수 제한이 실제로 저장되는 것이 중요합니다.)
--   code: invalid_credentials | locked | blocked
create or replace function public.login_member(
  p_nickname text,
  p_pin      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_nick    text := btrim(coalesce(p_nickname, ''));
  v_member  private.members;
  v_token   text;
  v_fails   integer;
  v_wait    integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_credentials',
      'message', '닉네임 또는 PIN이 맞지 않아요.');
  end if;

  select * into v_member
    from private.members m
   where m.nickname_key = lower(v_nick)
   for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_credentials',
      'message', '닉네임 또는 PIN이 맞지 않아요.');
  end if;

  if v_member.locked_until is not null and v_member.locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'code', 'locked',
      'message', 'PIN을 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.',
      'retry_after', ceil(extract(epoch from (v_member.locked_until - now())))::integer);
  end if;

  if not private.pin_matches(p_pin, v_member.pin_hash) then
    v_fails := v_member.failed_login_count + 1;
    v_wait  := case when v_fails >= 5 then least(300, 30 * (v_fails - 4)) else 0 end;

    update private.members
       set failed_login_count = v_fails,
           locked_until = case
             when v_wait > 0 then now() + (v_wait * interval '1 second')
             else null
           end
     where id = v_member.id;

    return jsonb_build_object(
      'ok', false,
      'code', case when v_wait > 0 then 'locked' else 'invalid_credentials' end,
      'message', case when v_wait > 0
                      then 'PIN을 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.'
                      else '닉네임 또는 PIN이 맞지 않아요.' end,
      'retry_after', v_wait);
  end if;

  -- PIN 이 맞은 뒤에야 상태를 알려 줍니다(닉네임 존재 여부 노출 최소화).
  if v_member.status <> 'active' then
    return jsonb_build_object(
      'ok', false, 'code', 'blocked',
      'message', '이 닉네임으로는 접속할 수 없어요. 운영진에게 문의해 주세요.');
  end if;

  update private.members
     set failed_login_count = 0,
         locked_until = null,
         last_seen_at = now()
   where id = v_member.id;

  v_token := private.issue_session(v_member.id);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'nickname', v_member.nickname,
      'role', v_member.member_role,
      'level', v_member.member_level,
      'avatar', v_member.avatar
    )
  );
end;
$fn$;

-- 로그아웃(이 기기의 세션만 폐기)
create or replace function public.logout_member(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  update private.member_sessions
     set revoked_at = now(), revoked_reason = 'logout'
   where token_hash = private.token_hash(p_token)
     and revoked_at is null;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- PIN 변경: 현재 PIN 확인 후 교체, 다른 기기 세션은 모두 폐기
create or replace function public.change_pin(
  p_token       text,
  p_current_pin text,
  p_new_pin     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_token);
  v_member  private.members;
begin
  select * into v_member from private.members m where m.id = v_actor.member_id;

  if not private.pin_matches(p_current_pin, v_member.pin_hash) then
    raise exception '지금 PIN이 맞지 않아요.' using errcode = '28P01';
  end if;

  update private.members
     set pin_hash = private.pin_hash(p_new_pin),
         failed_login_count = 0,
         locked_until = null
   where id = v_actor.member_id;

  update private.member_sessions
     set revoked_at = now(), revoked_reason = 'pin_changed'
   where member_id = v_actor.member_id
     and revoked_at is null
     and token_hash <> private.token_hash(p_token);

  return jsonb_build_object('ok', true);
end;
$fn$;

-- 내 정보 + 출석 요약
create or replace function public.my_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_member private.members;
  v_today  date := private.today_kst();
  v_streak integer := 0;
  v_total  integer := 0;
begin
  select * into v_member from private.members m where m.id = v_actor.member_id;

  select count(*) into v_total
    from private.attendance a
   where a.member_id = v_actor.member_id;

  select count(*) into v_streak
    from (
      select a.day, row_number() over (order by a.day desc) as rn
        from private.attendance a
       where a.member_id = v_actor.member_id
         and a.day <= v_today
    ) d
   where d.day = v_today - (d.rn - 1)::integer;

  return jsonb_build_object(
    'id', v_member.id,
    'nickname', v_member.nickname,
    'role', v_member.member_role,
    'level', v_member.member_level,
    'avatar', v_member.avatar,
    'joined_at', v_member.joined_at,
    'last_seen_at', v_member.last_seen_at,
    'wave', jsonb_build_object(
      'today_done', exists (select 1 from private.attendance a
                             where a.member_id = v_actor.member_id and a.day = v_today),
      'streak', v_streak,
      'total', v_total
    )
  );
end;
$fn$;

-- 프로필 그림 바꾸기
--   · 'preset:lotus' … 'preset:duck' (앱이 그리는 연못 그림 9종)
--   · 'data:image/(jpeg|png|webp);base64,…' (브라우저에서 128×128 로 줄인 내 사진)
--   · null / '' → 기본(닉네임 첫 글자)
create or replace function public.update_my_avatar(
  p_token  text,
  p_avatar text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_avatar text := nullif(btrim(coalesce(p_avatar, '')), '');
  v_b64    text;
  v_bytes  integer;
begin
  if v_avatar is null then
    update private.members set avatar = null where id = v_actor.member_id;
    return jsonb_build_object('ok', true, 'avatar', null, 'bytes', null);
  end if;

  if char_length(v_avatar) > 65000 then
    raise exception '프로필 그림은 48KB 이하 사진으로 줄여 주세요.' using errcode = '22023';
  end if;

  if v_avatar ~ '^preset:' then
    if v_avatar not in ('preset:lotus', 'preset:koi', 'preset:frog', 'preset:firefly',
                        'preset:moon', 'preset:leaf', 'preset:turtle', 'preset:lantern',
                        'preset:duck') then
      raise exception '고를 수 있는 연못 그림이 아니에요.' using errcode = '22023';
    end if;
  elsif v_avatar ~ '^data:image/(jpeg|png|webp);base64,' then
    v_b64 := substring(v_avatar from 'base64,(.*)$');

    begin
      v_bytes := octet_length(decode(v_b64, 'base64'));
    exception
      when others then
        raise exception '사진을 읽지 못했어요. 다시 올려 주세요.' using errcode = '22023';
    end;

    if v_bytes is null or v_bytes = 0 then
      raise exception '빈 사진은 올릴 수 없어요.' using errcode = '22023';
    end if;

    if v_bytes > 48000 then
      raise exception '프로필 사진은 48KB 이하로 줄여 주세요.' using errcode = '22023';
    end if;
  else
    raise exception '프로필 그림은 연못 그림 9종이나 사진만 쓸 수 있어요.' using errcode = '22023';
  end if;

  update private.members set avatar = v_avatar where id = v_actor.member_id;

  return jsonb_build_object('ok', true, 'avatar', v_avatar, 'bytes', v_bytes);
end;
$fn$;


-- ===========================================================================
-- 9. RPC · 문파원 기능
-- ===========================================================================

-- 오늘의 출석(물결 남기기) — 하루 한 번, 여러 번 눌러도 안전
create or replace function public.mark_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_today  date := private.today_kst();
  v_new    boolean := false;
  v_rows   bigint := 0;
  v_streak integer := 0;
  v_total  integer := 0;
begin
  insert into private.attendance (member_id, day)
  values (v_actor.member_id, v_today)
  on conflict (member_id, day) do nothing;

  get diagnostics v_rows = row_count;
  v_new := v_rows > 0;

  select count(*) into v_total
    from private.attendance a
   where a.member_id = v_actor.member_id;

  select count(*) into v_streak
    from (
      select a.day, row_number() over (order by a.day desc) as rn
        from private.attendance a
       where a.member_id = v_actor.member_id
         and a.day <= v_today
    ) d
   where d.day = v_today - (d.rn - 1)::integer;

  return jsonb_build_object(
    'day', v_today,
    'already', not v_new,
    'streak', v_streak,
    'total', v_total
  );
end;
$fn$;

-- 채팅 보내기 (1분에 20개까지)
create or replace function public.post_chat_message(
  p_token text,
  p_body  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_body  text := btrim(coalesce(p_body, ''));
  v_member private.members;
  v_msg   public.chat_messages;
  v_recent integer;
begin
  if char_length(v_body) = 0 then
    raise exception '보낼 내용을 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) > 500 then
    raise exception '메시지는 500자까지 보낼 수 있어요.' using errcode = '22023';
  end if;

  select count(*) into v_recent
    from public.chat_messages c
   where c.member_id = v_actor.member_id
     and c.created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    raise exception '메시지를 너무 빠르게 보내고 있어요. 잠시 쉬었다 보내 주세요.' using errcode = '53300';
  end if;

  select * into v_member from private.members m where m.id = v_actor.member_id;

  insert into public.chat_messages (member_id, kind, body)
  values (v_actor.member_id, 'text', v_body)
  returning * into v_msg;

  return jsonb_build_object(
    'id', v_msg.id,
    'member_id', v_msg.member_id,
    'nickname', v_actor.nickname,
    'role', v_actor.member_role,
    'avatar', v_member.avatar,
    'body', v_msg.body,
    'created_at', v_msg.created_at
  );
end;
$fn$;

-- 채팅 기록 (오래된 → 최신 순으로 돌려줍니다. p_before 로 위로 더 불러오기)
create or replace function public.list_chat_messages(
  p_token  text,
  p_limit  integer default 50,
  p_before bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_result jsonb;
begin
  with picked as (
    select c.id, c.member_id, c.kind, c.body, c.created_at,
           m.nickname, m.member_role, m.avatar
      from public.chat_messages c
      left join private.members m on m.id = c.member_id
     where c.deleted_at is null
       and (p_before is null or c.id < p_before)
     order by c.id desc
     limit v_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'member_id', p.member_id,
               'nickname', p.nickname,
               'role', p.member_role,
               'avatar', p.avatar,
               'kind', p.kind,
               'body', p.body,
               'created_at', p.created_at
             ) order by p.id
           ),
           '[]'::jsonb
         )
    into v_result
    from picked p;

  return v_result;
end;
$fn$;

-- 홈 화면 요약 (문파 현황 + 내 출석)
create or replace function public.clan_overview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    private.session_actor := private.current_member(p_token);
  v_settings private.clan_settings;
  v_today    date := private.today_kst();
  v_members  integer;
  v_new      integer;
  v_today_w  integer;
  v_week_w   integer;
  v_streak   integer := 0;
  v_total    integer := 0;
begin
  select * into v_settings from private.clan_settings where id = 1;

  select count(*) into v_members from private.members m where m.status = 'active';
  select count(*) into v_new
    from private.members m
   where m.status = 'active' and m.joined_at > now() - interval '7 days';
  select count(*) into v_today_w from private.attendance a where a.day = v_today;
  select count(*) into v_week_w
    from private.attendance a
   where a.day > v_today - 7;

  select count(*) into v_total
    from private.attendance a
   where a.member_id = v_actor.member_id;

  select count(*) into v_streak
    from (
      select a.day, row_number() over (order by a.day desc) as rn
        from private.attendance a
       where a.member_id = v_actor.member_id
         and a.day <= v_today
    ) d
   where d.day = v_today - (d.rn - 1)::integer;

  return jsonb_build_object(
    'clan', jsonb_build_object(
      'name', v_settings.clan_name,
      'motto', v_settings.clan_motto,
      'capacity', v_settings.member_capacity,
      'member_count', v_members,
      'new_members_7d', v_new,
      'today_waves', v_today_w,
      'week_waves', v_week_w
    ),
    'me', jsonb_build_object(
      'id', v_actor.member_id,
      'nickname', v_actor.nickname,
      'role', v_actor.member_role,
      'level', v_actor.member_level,
      'avatar', (select m.avatar from private.members m where m.id = v_actor.member_id),
      'today_wave', exists (select 1 from private.attendance a
                             where a.member_id = v_actor.member_id and a.day = v_today),
      'streak', v_streak,
      'total_waves', v_total
    )
  );
end;
$fn$;

-- 쿠폰 목록
create or replace function public.list_coupons(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', cp.id,
               'code', cp.code,
               'title', cp.title,
               'reward', cp.reward,
               'expires_on', cp.expires_on,
               'tone', cp.tone
             ) as item,
             cp.created_at
        from private.coupons cp
       where cp.deleted_at is null
         and cp.is_active
         and (cp.expires_on is null or cp.expires_on >= private.today_kst())
       order by cp.created_at desc
       limit 50
    ) s;

  return v_result;
end;
$fn$;

-- 공략 영상 목록 (최신 24개)
create or replace function public.list_guides(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', g.id,
               'title', g.title,
               'youtube_url', g.youtube_url,
               'video_id', g.video_id,
               'created_by', g.created_by,
               'created_at', g.created_at
             ) as item,
             g.created_at
        from public.guides g
       where g.deleted_at is null
       order by g.created_at desc
       limit 24
    ) s;

  return v_result;
end;
$fn$;

-- 앨범 목록 (이미지 본문 제외 → 가볍게)
create or replace function public.list_album_posts(
  p_token  text,
  p_limit  integer     default 12,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 12), 30));
  v_result jsonb;
begin
  with picked as (
    select p.id, p.member_id, p.title, p.caption, p.image_mime,
           p.image_bytes, p.created_at
      from private.album_posts p
     where p.deleted_at is null
       and (p_before is null or p.created_at < p_before)
     order by p.created_at desc
     limit v_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', q.id,
               'title', q.title,
               'caption', q.caption,
               'author_id', q.member_id,
               'author', m.nickname,
               'author_role', m.member_role,
               'author_avatar', m.avatar,
               'image_mime', q.image_mime,
               'image_bytes', q.image_bytes,
               'likes', (select count(*) from private.album_likes l where l.post_id = q.id),
               'liked', exists (select 1 from private.album_likes l
                                 where l.post_id = q.id and l.member_id = v_actor.member_id),
               'created_at', q.created_at
             ) order by q.created_at desc
           ),
           '[]'::jsonb
         )
    into v_result
    from picked q
    join private.members m on m.id = q.member_id;

  return v_result;
end;
$fn$;

-- 앨범 사진 올리기 (Base64 data URL, 원본 800KB 이하) — 글(설명)은 선택
create or replace function public.create_album_post(
  p_token      text,
  p_title      text,
  p_image_data text,
  p_caption    text default '',
  p_image_mime text default null   -- 클라이언트 호환용. 실제 형식은 data URL 에서 읽습니다.
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_title  text := btrim(coalesce(p_title, ''));
  v_caption text := btrim(coalesce(p_caption, ''));
  v_mime   text;
  v_b64    text;
  v_bytes  integer;
  v_post   private.album_posts;
  v_today_count integer;
begin
  if char_length(v_title) > 40 then
    raise exception '제목은 40자까지 쓸 수 있어요.' using errcode = '22023';
  end if;
  if char_length(v_caption) > 300 then
    raise exception '글은 300자까지 쓸 수 있어요.' using errcode = '22023';
  end if;

  if p_image_mime is not null
     and lower(btrim(p_image_mime)) not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception '사진은 JPEG·PNG·WebP 형식만 올릴 수 있어요.' using errcode = '22023';
  end if;

  if p_image_data is null
     or p_image_data !~ '^data:image/(jpeg|png|webp);base64,' then
    raise exception '사진은 JPEG·PNG·WebP 형식만 올릴 수 있어요.' using errcode = '22023';
  end if;

  -- 비싼 decode 전에 길이부터 막습니다.
  if char_length(p_image_data) > 1130000 then
    raise exception '사진은 800KB 이하로 줄여서 올려 주세요.' using errcode = '22023';
  end if;

  v_mime := substring(p_image_data from '^data:(image/[a-z]+);base64,');
  v_b64  := substring(p_image_data from 'base64,(.*)$');

  begin
    v_bytes := octet_length(decode(v_b64, 'base64'));
  exception
    when others then
      raise exception '사진을 읽지 못했어요. 다시 올려 주세요.' using errcode = '22023';
  end;

  if v_bytes is null or v_bytes = 0 then
    raise exception '빈 사진은 올릴 수 없어요.' using errcode = '22023';
  end if;

  if v_bytes > 819200 then
    raise exception '사진은 800KB 이하로 줄여서 올려 주세요.' using errcode = '22023';
  end if;

  select count(*) into v_today_count
    from private.album_posts p
   where p.member_id = v_actor.member_id
     and p.deleted_at is null
     and p.created_at > now() - interval '1 day';

  if v_today_count >= 10 then
    raise exception '사진은 하루 10장까지 올릴 수 있어요. 내일 다시 올려 주세요.' using errcode = '53300';
  end if;

  insert into private.album_posts (member_id, title, caption, image_mime, image_bytes)
  values (v_actor.member_id, v_title, v_caption, coalesce(v_mime, 'image/jpeg'), v_bytes)
  returning * into v_post;

  insert into private.album_images (post_id, data_url, byte_len)
  values (v_post.id, p_image_data, v_bytes);

  return jsonb_build_object(
    'id', v_post.id,
    'title', v_post.title,
    'caption', v_post.caption,
    'image_mime', v_post.image_mime,
    'image_bytes', v_post.image_bytes,
    'created_at', v_post.created_at
  );
end;
$fn$;

-- 앨범 사진 한 장 (필요할 때만 부릅니다)
create or replace function public.get_album_image(
  p_token     text,
  p_post_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_row   record;
begin
  select i.data_url, i.byte_len, p.image_mime
    into v_row
    from private.album_images i
    join private.album_posts p on p.id = i.post_id
   where i.post_id = p_post_id
     and p.deleted_at is null;

  if not found then
    raise exception '사진을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'post_id', p_post_id,
    'data_url', v_row.data_url,
    'mime', v_row.image_mime,
    'bytes', v_row.byte_len
  );
end;
$fn$;

-- 좋아요(물결) 토글
create or replace function public.toggle_album_like(
  p_token   text,
  p_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_liked boolean;
  v_count integer;
begin
  if not exists (select 1 from private.album_posts p
                  where p.id = p_post_id and p.deleted_at is null) then
    raise exception '사진을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  delete from private.album_likes l
   where l.post_id = p_post_id and l.member_id = v_actor.member_id;

  if found then
    v_liked := false;
  else
    insert into private.album_likes (post_id, member_id)
    values (p_post_id, v_actor.member_id)
    on conflict do nothing;
    v_liked := true;
  end if;

  select count(*) into v_count from private.album_likes l where l.post_id = p_post_id;

  return jsonb_build_object('post_id', p_post_id, 'liked', v_liked, 'likes', v_count);
end;
$fn$;

-- 내가 올린 사진 지우기
create or replace function public.delete_own_album_post(
  p_token   text,
  p_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
begin
  update private.album_posts p
     set deleted_at = now(), deleted_by = v_actor.member_id
   where p.id = p_post_id
     and p.member_id = v_actor.member_id
     and p.deleted_at is null;

  if not found then
    raise exception '내가 올린 사진만 지울 수 있어요.' using errcode = '42501';
  end if;

  delete from private.album_images i where i.post_id = p_post_id;

  return jsonb_build_object('ok', true);
end;
$fn$;

-- 앨범 사진의 글 고치기 — 올린 본인 또는 운영진(admin·officer). 사진 본문은 건드리지 않습니다.
--   · 글은 300자까지(만들기와 같은 규칙) · 빈 글로 지우는 것도 됩니다.
--   · 제목 자리(title)는 예전 사진 호환용입니다 — 글의 첫 줄(40자)로 맞춰 두고, 글을 비우면 함께 비웁니다.
create or replace function public.update_album_post_text(
  p_token   text,
  p_post_id uuid,
  p_caption text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_token);
  v_caption text := btrim(coalesce(p_caption, ''));
  v_post    private.album_posts;
  v_title   text;
begin
  if char_length(v_caption) > 300 then
    raise exception '글은 300자까지 쓸 수 있어요.' using errcode = '22023';
  end if;

  select * into v_post
    from private.album_posts p
   where p.id = p_post_id
     and p.deleted_at is null
   for update;

  if not found then
    raise exception '사진을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_post.member_id is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 사진이나 운영진만 글을 고칠 수 있어요.' using errcode = '42501';
  end if;

  select left(btrim(s), 40) into v_title
    from regexp_split_to_table(v_caption, E'\n') s
   where btrim(s) <> ''
   limit 1;
  v_title := coalesce(v_title, '');

  update private.album_posts
     set caption = v_caption,
         title = v_title
   where id = p_post_id;

  perform private.log_admin(v_actor.member_id, 'album.update_text', 'album_post', p_post_id::text,
                            jsonb_build_object('owner', v_post.member_id::text,
                                               'chars', char_length(v_caption)));

  return jsonb_build_object(
    'id', p_post_id,
    'caption', v_caption,
    'title', v_title,
    'ok', true
  );
end;
$fn$;


-- ===========================================================================
-- 10. RPC · 관리자(문주)
-- ===========================================================================

-- 초대 코드 변경
create or replace function public.admin_update_invite_code(
  p_token    text,
  p_new_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_code  text := upper(btrim(coalesce(p_new_code, '')));
begin
  if v_code !~ '^[가-힣A-Z0-9_-]{4,20}$' then
    raise exception '초대 코드는 한글·영문·숫자 4~20자로 정해 주세요. (- 와 _ 도 됩니다)' using errcode = '22023';
  end if;

  update private.clan_settings
     set invite_code = v_code,
         invite_code_updated_at = now()
   where id = 1;

  perform private.log_admin(v_actor.member_id, 'invite_code.update', 'clan_settings', '1',
                            jsonb_build_object('invite_code', v_code));

  return jsonb_build_object('invite_code', v_code, 'updated_at', now());
end;
$fn$;

-- 설정 보기 (초대 코드 포함 · 관리자만)
create or replace function public.admin_get_settings(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    private.session_actor := private.require_admin(p_token);
  v_settings private.clan_settings;
begin
  select * into v_settings from private.clan_settings where id = 1;

  return jsonb_build_object(
    'clan_name', v_settings.clan_name,
    'clan_motto', v_settings.clan_motto,
    'invite_code', v_settings.invite_code,
    'invite_code_updated_at', v_settings.invite_code_updated_at,
    'member_capacity', v_settings.member_capacity,
    'member_count', (select count(*) from private.members m where m.status = 'active'),
    'kicked_count', (select count(*) from private.members m where m.status = 'kicked'),
    'banned_count', (select count(*) from private.members m where m.status = 'banned'),
    'setup_code_configured', v_settings.setup_code_hash is not null
  );
end;
$fn$;

-- 문파원 목록 (전체 상태 · 관리자만)
create or replace function public.admin_list_members(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.require_admin(p_token);
  v_today  date := private.today_kst();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.x order by s.priority, s.joined_at), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', m.id,
               'nickname', m.nickname,
               'role', m.member_role,
               'level', m.member_level,
               'status', m.status,
               'status_reason', m.status_reason,
               'status_changed_at', m.status_changed_at,
               'avatar', m.avatar,
               'joined_at', m.joined_at,
               'last_seen_at', m.last_seen_at,
               'wave_today', exists (select 1 from private.attendance a
                                      where a.member_id = m.id and a.day = v_today)
             ) as x,
             case m.member_role when 'admin' then 0 when 'officer' then 1 else 2 end as priority,
             m.joined_at,
             case m.status when 'active' then 0 when 'kicked' then 1 else 2 end as status_order
        from private.members m
    ) s;

  return v_result;
end;
$fn$;

-- 상태 변경 공통(강퇴/차단/복귀)
create or replace function private.set_member_status(
  p_actor  private.session_actor,
  p_target uuid,
  p_status text,
  p_reason text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_target private.members;
begin
  if p_target is null then
    raise exception '대상 문파원을 찾을 수 없어요.' using errcode = '22023';
  end if;

  select * into v_target from private.members m where m.id = p_target for update;
  if not found then
    raise exception '대상 문파원을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_target.id = p_actor.member_id then
    raise exception '자기 자신은 내보낼 수 없어요.' using errcode = '42501';
  end if;

  if v_target.member_role = 'admin' then
    raise exception '문주 계정은 내보낼 수 없어요.' using errcode = '42501';
  end if;

  update private.members
     set status = p_status,
         status_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         status_changed_at = case when p_status = 'active' then null else now() end
   where id = p_target;

  -- 내보내면 그 사람의 모든 기기 세션을 끊습니다.
  if p_status <> 'active' then
    update private.member_sessions s
       set revoked_at = now(), revoked_reason = p_status
     where s.member_id = p_target
       and s.revoked_at is null;
  end if;

  perform private.log_admin(p_actor.member_id, p_action, 'member', p_target::text,
                            jsonb_build_object('status', p_status,
                                               'nickname', v_target.nickname,
                                               'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return jsonb_build_object(
    'id', p_target,
    'nickname', v_target.nickname,
    'status', p_status
  );
end;
$fn$;

-- 강퇴 (kicked) — 재로그인 불가, 닉네임은 예약된 채로 남습니다.
create or replace function public.admin_kick_member(
  p_token     text,
  p_member_id uuid,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  return private.set_member_status(v_actor, p_member_id, 'kicked', p_reason, 'member.kick');
end;
$fn$;

-- 차단 (banned) — 재가입도 막습니다(같은 닉네임 재사용 불가).
create or replace function public.admin_ban_member(
  p_token     text,
  p_member_id uuid,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  return private.set_member_status(v_actor, p_member_id, 'banned', p_reason, 'member.ban');
end;
$fn$;

-- 강퇴/차단 해제(다시 문파원으로)
create or replace function public.admin_restore_member(
  p_token     text,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  update private.members
     set failed_login_count = 0, locked_until = null
   where id = p_member_id;

  return private.set_member_status(v_actor, p_member_id, 'active', null, 'member.restore');
end;
$fn$;

-- 직위 변경 (officer <-> member). 문주 자리는 옮기지 않습니다.
create or replace function public.admin_set_role(
  p_token     text,
  p_member_id uuid,
  p_role      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.require_admin(p_token);
  v_role   text := lower(btrim(coalesce(p_role, '')));
  v_target private.members;
begin
  if v_role not in ('officer', 'member') then
    raise exception '직위는 officer 또는 member 로만 바꿀 수 있어요.' using errcode = '22023';
  end if;

  select * into v_target from private.members m where m.id = p_member_id for update;
  if not found then
    raise exception '대상 문파원을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_target.member_role = 'admin' then
    raise exception '문주 자리는 바꿀 수 없어요.' using errcode = '42501';
  end if;

  if v_target.status <> 'active' then
    raise exception '지금 문파에 없는 사람이에요. 먼저 복귀시켜 주세요.' using errcode = '42501';
  end if;

  update private.members set member_role = v_role where id = p_member_id;

  perform private.log_admin(v_actor.member_id, 'member.set_role', 'member', p_member_id::text,
                            jsonb_build_object('role', v_role, 'nickname', v_target.nickname));

  return jsonb_build_object('id', p_member_id, 'nickname', v_target.nickname, 'role', v_role);
end;
$fn$;

-- 공지 작성
create or replace function public.admin_create_notice(
  p_token  text,
  p_title  text,
  p_body   text,
  p_tag    text default '공지',
  p_pinned boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.require_admin(p_token);
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_tag    text := btrim(coalesce(p_tag, '공지'));
  v_notice public.notices;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '공지 제목은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 4000 then
    raise exception '공지 내용은 1~4000자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_tag) = 0 or char_length(v_tag) > 10 then
    raise exception '태그는 1~10자로 적어 주세요.' using errcode = '22023';
  end if;

  insert into public.notices (title, body, tag, pinned, author_id)
  values (v_title, v_body, v_tag, coalesce(p_pinned, false), v_actor.member_id)
  returning * into v_notice;

  perform private.log_admin(v_actor.member_id, 'notice.create', 'notice', v_notice.id::text, '{}'::jsonb);

  return jsonb_build_object(
    'id', v_notice.id,
    'title', v_notice.title,
    'tag', v_notice.tag,
    'pinned', v_notice.pinned,
    'created_at', v_notice.created_at
  );
end;
$fn$;

-- 공지 수정
create or replace function public.admin_update_notice(
  p_token   text,
  p_notice_id uuid,
  p_title   text,
  p_body    text,
  p_tag     text default null,
  p_pinned  boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '공지 제목은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 4000 then
    raise exception '공지 내용은 1~4000자로 적어 주세요.' using errcode = '22023';
  end if;

  update public.notices
     set title = v_title,
         body = v_body,
         tag = coalesce(nullif(btrim(p_tag), ''), tag),
         pinned = coalesce(p_pinned, pinned)
   where id = p_notice_id
     and deleted_at is null;

  if not found then
    raise exception '공지를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'notice.update', 'notice', p_notice_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_notice_id, 'ok', true);
end;
$fn$;

-- 공지 고정/해제
create or replace function public.admin_pin_notice(
  p_token     text,
  p_notice_id uuid,
  p_pinned    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  update public.notices
     set pinned = coalesce(p_pinned, false)
   where id = p_notice_id
     and deleted_at is null;

  if not found then
    raise exception '공지를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'notice.pin', 'notice', p_notice_id::text,
                            jsonb_build_object('pinned', coalesce(p_pinned, false)));

  return jsonb_build_object('id', p_notice_id, 'pinned', coalesce(p_pinned, false));
end;
$fn$;

-- 공지 삭제
create or replace function public.admin_delete_notice(
  p_token     text,
  p_notice_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  update public.notices
     set deleted_at = now(), pinned = false
   where id = p_notice_id
     and deleted_at is null;

  if not found then
    raise exception '공지를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'notice.delete', 'notice', p_notice_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_notice_id, 'deleted', true);
end;
$fn$;

-- 반복 요일 정리 — 0~6(0=일 … 6=토) 밖의 값은 22023 으로 거절하고, 중복은 지워 차례대로 돌려줍니다.
create or replace function private.normalize_weekdays(p_days smallint[])
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_days smallint[];
begin
  if p_days is null then
    return '{}'::smallint[];
  end if;
  select coalesce(array_agg(d order by d), '{}'::smallint[])
    into v_days
    from (select distinct unnest(p_days) as d) s;
  if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
    raise exception '요일 값이 올바르지 않아요. (0=일 … 6=토)' using errcode = '22023';
  end if;
  return v_days;
end;
$fn$;

-- 매주 반복의 '다음 예정 시각' — 요일 집합과 시작 시각(HH:MM)으로 가장 가까운 다음 날을 찾습니다.
--   · 요일·시각 해석은 한국 시간(Asia/Seoul) 기준입니다. (앱이 한국에서 쓰는 문파 앱)
--   · p_from 을 주면 그 시각부터 셉니다(기본 now()).
create or replace function private.next_weekly_at(
  p_anchor timestamptz,
  p_days   smallint[],
  p_from   timestamptz default null
)
returns timestamptz
language plpgsql
set search_path = ''
as $fn$
declare
  v_tz   text := 'Asia/Seoul';
  v_time time := (p_anchor at time zone 'Asia/Seoul')::time;
  v_from timestamptz := date_trunc('minute', coalesce(p_from, now()));
  v_day  date := (date_trunc('minute', coalesce(p_from, now())) at time zone 'Asia/Seoul')::date;
  v_i    int;
  v_at   timestamptz;
begin
  for v_i in 0..7 loop
    if extract(dow from (v_day + v_i))::smallint = any(p_days) then
      v_at := ((v_day + v_i) + v_time) at time zone 'Asia/Seoul';
      if v_at >= v_from then
        return v_at;
      end if;
    end if;
  end loop;
  -- 요일이 1개 이상이면 위에서 반드시 돌려줍니다. 방어용으로 7일 뒤 같은 시각.
  return ((v_day + 7) + v_time) at time zone 'Asia/Seoul';
end;
$fn$;

-- 문파컨텐츠 작성 (예전 이름: 일정 작성)
--   · 매주 반복이면 p_starts_at 의 시각(HH:MM)만 쓰고 날짜는 '다음 예정일'로 다시 계산합니다.
create or replace function public.admin_create_event(
  p_token           text,
  p_title           text,
  p_starts_at       timestamptz,
  p_place           text default '',
  p_tag             text default '모임',
  p_note            text default '',
  p_ends_at         timestamptz default null,
  p_repeat_weekly   boolean default false,
  p_repeat_weekdays smallint[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_place text := btrim(coalesce(p_place, ''));
  v_tag   text := btrim(coalesce(p_tag, '모임'));
  v_note  text := btrim(coalesce(p_note, ''));
  v_days  smallint[];
  v_start timestamptz;
  v_ends  timestamptz := p_ends_at;
  v_event public.events;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '문파컨텐츠 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception '문파컨텐츠 날짜와 시간을 정해 주세요.' using errcode = '22023';
  end if;
  if char_length(v_place) > 60 or char_length(v_tag) > 10 or char_length(v_note) > 200 then
    raise exception '장소·태그·메모 길이를 확인해 주세요.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception '끝나는 시간이 시작보다 빨라요.' using errcode = '22023';
  end if;

  v_days := private.normalize_weekdays(p_repeat_weekdays);
  if coalesce(p_repeat_weekly, false) then
    if cardinality(v_days) = 0 then
      raise exception '매주 반복은 요일을 하나 이상 골라 주세요.' using errcode = '22023';
    end if;
    v_start := private.next_weekly_at(p_starts_at, v_days);
    if v_ends is not null then
      v_ends := v_start + (p_ends_at - p_starts_at);
    end if;
  else
    v_days  := '{}'::smallint[];
    v_start := p_starts_at;
  end if;

  insert into public.events (title, place, tag, note, starts_at, ends_at,
                             repeat_weekly, repeat_weekdays, created_by)
  values (v_title, v_place, v_tag, v_note, v_start, v_ends,
          coalesce(p_repeat_weekly, false), v_days, v_actor.member_id)
  returning * into v_event;

  perform private.log_admin(v_actor.member_id, 'event.create', 'event', v_event.id::text, '{}'::jsonb);

  return jsonb_build_object(
    'id', v_event.id,
    'title', v_event.title,
    'starts_at', v_event.starts_at,
    'place', v_event.place,
    'repeat_weekly', v_event.repeat_weekly,
    'repeat_weekdays', to_jsonb(v_event.repeat_weekdays)
  );
end;
$fn$;

-- 문파컨텐츠 수정 (예전 이름: 일정 수정) — '한 번만 ↔ 매주 반복' 전환도 여기서 합니다.
create or replace function public.admin_update_event(
  p_token           text,
  p_event_id        uuid,
  p_title           text,
  p_starts_at       timestamptz,
  p_place           text default null,
  p_tag             text default null,
  p_note            text default null,
  p_ends_at         timestamptz default null,
  p_repeat_weekly   boolean default false,
  p_repeat_weekdays smallint[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_days  smallint[];
  v_start timestamptz;
  v_ends  timestamptz;
  v_old   public.events;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '문파컨텐츠 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception '문파컨텐츠 날짜와 시간을 정해 주세요.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception '끝나는 시간이 시작보다 빨라요.' using errcode = '22023';
  end if;

  select * into v_old
    from public.events
   where id = p_event_id
     and deleted_at is null;
  if not found then
    raise exception '문파컨텐츠를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  v_ends := coalesce(p_ends_at, v_old.ends_at);
  v_days := private.normalize_weekdays(p_repeat_weekdays);
  if coalesce(p_repeat_weekly, false) then
    if cardinality(v_days) = 0 then
      raise exception '매주 반복은 요일을 하나 이상 골라 주세요.' using errcode = '22023';
    end if;
    v_start := private.next_weekly_at(p_starts_at, v_days);
    if v_ends is not null then
      v_ends := v_start + (v_ends - v_old.starts_at);
    end if;
  else
    v_days  := '{}'::smallint[];
    v_start := p_starts_at;
  end if;

  update public.events
     set title = v_title,
         starts_at = v_start,
         place = coalesce(btrim(p_place), place),
         tag = coalesce(nullif(btrim(p_tag), ''), tag),
         note = coalesce(btrim(p_note), note),
         ends_at = v_ends,
         repeat_weekly = coalesce(p_repeat_weekly, false),
         repeat_weekdays = v_days
   where id = p_event_id
     and deleted_at is null;

  perform private.log_admin(v_actor.member_id, 'event.update', 'event', p_event_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_event_id, 'ok', true,
                            'repeat_weekly', coalesce(p_repeat_weekly, false),
                            'repeat_weekdays', to_jsonb(v_days));
end;
$fn$;

-- 일정 삭제
create or replace function public.admin_delete_event(
  p_token    text,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  update public.events
     set deleted_at = now()
   where id = p_event_id
     and deleted_at is null;

  if not found then
    raise exception '일정을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'event.delete', 'event', p_event_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_event_id, 'deleted', true);
end;
$fn$;

-- 쿠폰 작성
create or replace function public.admin_create_coupon(
  p_token      text,
  p_code       text,
  p_title      text,
  p_reward     text,
  p_expires_on date default null,
  p_tone       text default 'lotus'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_title text := btrim(coalesce(p_title, ''));
  v_reward text := btrim(coalesce(p_reward, ''));
  v_tone  text := lower(btrim(coalesce(p_tone, 'lotus')));
  v_coupon private.coupons;
begin
  if v_code !~ '^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$' then
    raise exception '쿠폰 코드는 한글·영문·숫자·-·_ 3~24자로 정해 주세요.' using errcode = '22023';
  end if;
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '쿠폰 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_reward) = 0 or char_length(v_reward) > 60 then
    raise exception '보상 내용은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if v_tone not in ('lotus', 'jade', 'gold') then
    v_tone := 'lotus';
  end if;

  if exists (select 1 from private.coupons c
              where upper(c.code) = v_code and c.deleted_at is null) then
    raise exception '같은 쿠폰 코드가 이미 있어요.' using errcode = '23505';
  end if;

  insert into private.coupons (code, title, reward, expires_on, tone, created_by)
  values (v_code, v_title, v_reward, p_expires_on, v_tone, v_actor.member_id)
  returning * into v_coupon;

  perform private.log_admin(v_actor.member_id, 'coupon.create', 'coupon', v_coupon.id::text,
                            jsonb_build_object('code', v_code));

  return jsonb_build_object(
    'id', v_coupon.id,
    'code', v_coupon.code,
    'title', v_coupon.title,
    'reward', v_coupon.reward,
    'expires_on', v_coupon.expires_on,
    'tone', v_coupon.tone
  );
end;
$fn$;

-- 쿠폰 삭제
create or replace function public.admin_delete_coupon(
  p_token     text,
  p_coupon_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
begin
  update private.coupons
     set deleted_at = now(), is_active = false
   where id = p_coupon_id
     and deleted_at is null;

  if not found then
    raise exception '쿠폰을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'coupon.delete', 'coupon', p_coupon_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_coupon_id, 'deleted', true);
end;
$fn$;

-- 쿠폰 수정 — 문주만(만들기·지우기와 같은 권한) · 코드와 마지막 날만 바뀝니다
create or replace function public.update_coupon(
  p_token      text,
  p_coupon_id  uuid,
  p_code       text,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_coupon private.coupons;
begin
  if v_code !~ '^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$' then
    raise exception '쿠폰 코드는 한글·영문·숫자·-·_ 3~24자로 정해 주세요.' using errcode = '22023';
  end if;

  select * into v_coupon
    from private.coupons c
   where c.id = p_coupon_id
     and c.deleted_at is null
   for update;

  if not found then
    raise exception '쿠폰을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if exists (select 1 from private.coupons c
              where upper(c.code) = v_code
                and c.deleted_at is null
                and c.id <> p_coupon_id) then
    raise exception '같은 쿠폰 코드가 이미 있어요.' using errcode = '23505';
  end if;

  update private.coupons
     set code = v_code,
         expires_on = p_expires_on
   where id = p_coupon_id;

  perform private.log_admin(v_actor.member_id, 'coupon.update', 'coupon', p_coupon_id::text,
                            jsonb_build_object('code', v_code));

  return jsonb_build_object(
    'id', p_coupon_id,
    'code', v_code,
    'expires_on', p_expires_on
  );
end;
$fn$;

-- 공략 영상 작성 — 로그인한 문파원이면 누구나 (문주·운영진·문파원)
--   youtu.be/ID · youtube.com/watch?v=ID · youtube.com/shorts/ID · youtube.com/embed/ID · ID(11자)
--   유튜브 주소에서 영상 ID 를 서버에서도 다시 뽑아 11자만 저장합니다.
create or replace function public.create_guide(
  p_token       text,
  p_title       text,
  p_youtube_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_token);
  v_title   text := btrim(coalesce(p_title, ''));
  v_url     text := btrim(coalesce(p_youtube_url, ''));
  v_video   text;
  v_guide   public.guides;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 80 then
    raise exception '공략 제목은 1~80자로 적어 주세요.' using errcode = '22023';
  end if;

  if char_length(v_url) = 0 or char_length(v_url) > 300 then
    raise exception '유튜브 주소를 넣어 주세요.' using errcode = '22023';
  end if;

  if v_url ~ '^[A-Za-z0-9_-]{11}$' then
    v_video := v_url;
    v_url := 'https://www.youtube.com/watch?v=' || v_url;
  else
    v_video := substring(v_url from '(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/|v/))([A-Za-z0-9_-]{11})');
  end if;

  if v_video is null then
    raise exception '유튜브 주소를 알아보지 못했어요. youtu.be/… 또는 youtube.com/watch?v=… 를 붙여 넣어 주세요.' using errcode = '22023';
  end if;

  insert into public.guides (title, youtube_url, video_id, created_by)
  values (v_title, v_url, v_video, v_actor.member_id)
  returning * into v_guide;

  return jsonb_build_object(
    'id', v_guide.id,
    'title', v_guide.title,
    'youtube_url', v_guide.youtube_url,
    'video_id', v_guide.video_id,
    'created_by', v_guide.created_by,
    'created_at', v_guide.created_at
  );
end;
$fn$;

-- 공략 영상 삭제 — 올린 본인 또는 운영진(admin·officer)
--   기록은 남기고 목록에서만 감춥니다(유튜브 영상 자체는 그대로).
create or replace function public.delete_guide(
  p_token    text,
  p_guide_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_guide public.guides;
begin
  select * into v_guide
    from public.guides g
   where g.id = p_guide_id
     and g.deleted_at is null
   for update;

  if not found then
    raise exception '공략을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_guide.created_by is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 공략이나 운영진만 지울 수 있어요.' using errcode = '42501';
  end if;

  update public.guides
     set deleted_at = now()
   where id = p_guide_id;

  perform private.log_admin(v_actor.member_id, 'guide.delete', 'guide', p_guide_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_guide.created_by::text));

  return jsonb_build_object('id', p_guide_id, 'deleted', true);
end;
$fn$;

-- 공략 영상 수정 — 올린 본인 또는 운영진(admin·officer)
--   제목과 유튜브 주소를 바꿉니다. 주소에서 영상 ID 를 다시 뽑아 함께 저장합니다.
create or replace function public.update_guide(
  p_token       text,
  p_guide_id    uuid,
  p_title       text,
  p_youtube_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_url   text := btrim(coalesce(p_youtube_url, ''));
  v_video text;
  v_guide public.guides;
begin
  select * into v_guide
    from public.guides g
   where g.id = p_guide_id
     and g.deleted_at is null
   for update;

  if not found then
    raise exception '공략을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_guide.created_by is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 공략이나 운영진만 고칠 수 있어요.' using errcode = '42501';
  end if;

  if char_length(v_title) = 0 or char_length(v_title) > 80 then
    raise exception '공략 제목은 1~80자로 적어 주세요.' using errcode = '22023';
  end if;

  if char_length(v_url) = 0 or char_length(v_url) > 300 then
    raise exception '유튜브 주소를 넣어 주세요.' using errcode = '22023';
  end if;

  if v_url ~ '^[A-Za-z0-9_-]{11}$' then
    v_video := v_url;
    v_url := 'https://www.youtube.com/watch?v=' || v_url;
  else
    v_video := substring(v_url from '(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/|v/))([A-Za-z0-9_-]{11})');
  end if;

  if v_video is null then
    raise exception '유튜브 주소를 알아보지 못했어요. youtu.be/… 또는 youtube.com/watch?v=… 를 붙여 넣어 주세요.' using errcode = '22023';
  end if;

  update public.guides
     set title = v_title,
         youtube_url = v_url,
         video_id = v_video
   where id = p_guide_id;

  perform private.log_admin(v_actor.member_id, 'guide.update', 'guide', p_guide_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_guide.created_by::text,
                                               'video_id', v_video));

  return jsonb_build_object(
    'id', p_guide_id,
    'title', v_title,
    'youtube_url', v_url,
    'video_id', v_video
  );
end;
$fn$;

-- 부적절한 채팅 삭제 (본문 즉시 소거 → 실시간으로 삭제가 전달됩니다)
create or replace function public.admin_delete_chat_message(
  p_token      text,
  p_message_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_msg   public.chat_messages;
begin
  select * into v_msg from public.chat_messages c where c.id = p_message_id;
  if not found then
    raise exception '메시지를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_msg.deleted_at is not null then
    return jsonb_build_object('id', p_message_id, 'deleted', true, 'already', true);
  end if;

  update public.chat_messages
     set body = '', deleted_at = now(), deleted_by = v_actor.member_id
   where id = p_message_id;

  perform private.log_admin(v_actor.member_id, 'chat.delete', 'chat_message', p_message_id::text,
                            jsonb_build_object('author_id', v_msg.member_id));

  return jsonb_build_object('id', p_message_id, 'deleted', true);
end;
$fn$;

-- 부적절한 앨범 글 삭제 (사진 본문도 함께 제거)
create or replace function public.admin_delete_album_post(
  p_token   text,
  p_post_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_post  private.album_posts;
begin
  select * into v_post from private.album_posts p where p.id = p_post_id;
  if not found then
    raise exception '사진을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  update private.album_posts
     set deleted_at = now(), deleted_by = v_actor.member_id
   where id = p_post_id;

  delete from private.album_images i where i.post_id = p_post_id;

  perform private.log_admin(v_actor.member_id, 'album.delete', 'album_post', p_post_id::text,
                            jsonb_build_object('author_id', v_post.member_id));

  return jsonb_build_object('id', p_post_id, 'deleted', true);
end;
$fn$;

-- 관리자 행동 기록 보기
create or replace function public.admin_list_audit(
  p_token text,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.require_admin(p_token);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.a order by s.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', au.id,
               'actor', m.nickname,
               'action', au.action,
               'target_kind', au.target_kind,
               'target_id', au.target_id,
               'detail', au.detail,
               'created_at', au.created_at
             ) as a,
             au.created_at
        from private.admin_audit au
        left join private.members m on m.id = au.actor_id
       order by au.created_at desc
       limit v_limit
    ) s;

  return v_result;
end;
$fn$;


-- 자리비움 목록 — 지난 기간(end_date < 오늘)은 빼고, 진행 중·예정만 시작일 순으로
--   · 보여 줄 이름·아바타는 '대상' 기준입니다 — 직접 입력한 이름(target_name)이 있으면 그것,
--     없으면 대상 문파원의 닉네임·아바타. 대리 등록이면 is_proxy·proxy_by(올린 운영진)를 함께 돌려줍니다.
create or replace function public.list_absences(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_today  date := private.today_kst();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.start_date asc, s.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', a.id,
               'member_id', a.member_id,
               'nickname', coalesce(a.target_name, m.nickname),
               'avatar', case when a.target_name is null then m.avatar else null end,
               'target_name', a.target_name,
               'is_proxy', (a.target_name is not null
                            or (a.created_by is not null and a.created_by <> a.member_id)),
               'proxy_by', case when a.target_name is not null
                                  or (a.created_by is not null and a.created_by <> a.member_id)
                                 then c.nickname else null end,
               'start_date', a.start_date,
               'end_date', a.end_date,
               'reason', a.reason,
               'created_at', a.created_at
             ) as item,
             a.start_date, a.created_at
        from public.member_absences a
        join private.members m on m.id = a.member_id
        left join private.members c on c.id = a.created_by
       where a.deleted_at is null
         and a.end_date >= v_today
       order by a.start_date asc, a.created_at desc
       limit 60
    ) s;

  return v_result;
end;
$fn$;

-- 자리비움 등록 — 본인은 로그인한 active 문파원 누구나, 다른 문파원 대신은 운영진(admin · officer)만
--   · 시작일은 한국 시간 오늘 이후(과거 불가) · 종료일은 시작일과 같거나 뒤 · 이유는 앞뒤 공백을 지우고 1~60자
--   · p_target_member_id: 가입 문파원을 대상으로 골랐을 때(본인이면 그냥 본인 등록)
--   · p_target_name: 아직 사이트에 없는 문파원의 이름을 직접 적었을 때(2~20자, 아바타 없음)
--   · 둘 다 비우면 예전과 같은 본인 등록입니다(4인자 호출 그대로 동작).
create or replace function public.create_absence(
  p_token            text,
  p_start_date       date,
  p_end_date         date,
  p_reason           text,
  p_target_member_id uuid default null,
  p_target_name      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     private.session_actor := private.current_member(p_token);
  v_today     date := private.today_kst();
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_name      text := nullif(btrim(coalesce(p_target_name, '')), '');
  v_target_id uuid := p_target_member_id;
  v_target    private.members;
  v_proxy     boolean := false;
  v_row       public.member_absences;
begin
  if p_start_date is null or p_end_date is null then
    raise exception '시작일과 종료일을 정해 주세요.' using errcode = '22023';
  end if;
  if p_start_date < v_today then
    raise exception '시작일은 오늘(한국 시간)보다 빠를 수 없어요.' using errcode = '22023';
  end if;
  if p_end_date < p_start_date then
    raise exception '종료일은 시작일과 같거나 뒤여야 해요.' using errcode = '22023';
  end if;
  if char_length(v_reason) = 0 or char_length(v_reason) > 60 then
    raise exception '이유는 1~60자로 적어 주세요.' using errcode = '22023';
  end if;

  -- 대상 정하기: 본인 / 가입한 다른 문파원 / 아직 가입하지 않은 문파원의 이름(직접 입력)
  if v_name is not null then
    if v_target_id is not null and v_target_id <> v_actor.member_id then
      raise exception '대상은 문파원 목록에서 고르거나 이름을 직접 적는 것 중 하나만 해 주세요.' using errcode = '22023';
    end if;
    if char_length(v_name) < 2 or char_length(v_name) > 20 then
      raise exception '대신 올릴 문파원의 이름은 2~20자로 적어 주세요.' using errcode = '22023';
    end if;
    v_proxy := true;
    v_target_id := v_actor.member_id;   -- 미가입자: 대상 행이 없으므로 올린 운영진에게 매답니다
  elsif v_target_id is not null and v_target_id <> v_actor.member_id then
    v_proxy := true;
  else
    v_target_id := v_actor.member_id;
  end if;

  -- 남의 자리비움은 운영진만
  if v_proxy and v_actor.member_role not in ('admin', 'officer') then
    raise exception '다른 문파원의 자리비움은 운영진(문주·부문주)만 대신 올릴 수 있어요.' using errcode = '42501';
  end if;

  -- 응답에 쓸 대상 정보(닉네임·아바타) — 가입 문파원 대상은 실제로 있는 active 문파원이어야 합니다
  if v_name is null then
    select * into v_target from private.members m where m.id = v_target_id;
    if not found or (v_proxy and v_target.status <> 'active') then
      raise exception '대상 문파원을 찾을 수 없어요.' using errcode = 'P0002';
    end if;
  end if;

  insert into public.member_absences (member_id, start_date, end_date, reason, created_by, target_name)
  values (v_target_id, p_start_date, p_end_date, v_reason, v_actor.member_id, v_name)
  returning * into v_row;

  if v_proxy then
    perform private.log_admin(v_actor.member_id, 'absence.proxy_create', 'absence', v_row.id::text,
                              jsonb_build_object('by_role', v_actor.member_role,
                                                 'target_member', case when v_name is null then v_target_id::text else null end,
                                                 'target_name', v_name));
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'member_id', v_row.member_id,
    'nickname', coalesce(v_row.target_name, v_target.nickname),
    'avatar', case when v_row.target_name is not null then null else v_target.avatar end,
    'target_name', v_row.target_name,
    'is_proxy', v_proxy,
    'proxy_by', case when v_proxy then v_actor.nickname else null end,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'reason', v_row.reason,
    'created_at', v_row.created_at
  );
end;
$fn$;

-- 자리비움 삭제 — 운영진(문주 · 운영진)만 (올린 본인이라도 일반 문파원은 삭제 불가)
create or replace function public.delete_absence(
  p_token      text,
  p_absence_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_row   public.member_absences;
begin
  if v_actor.member_role not in ('admin', 'officer') then
    raise exception '자리비움은 운영진만 지울 수 있어요.' using errcode = '42501';
  end if;

  select * into v_row
    from public.member_absences a
   where a.id = p_absence_id
     and a.deleted_at is null
   for update;

  if not found then
    raise exception '자리비움을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  update public.member_absences
     set deleted_at = now()
   where id = p_absence_id;

  perform private.log_admin(v_actor.member_id, 'absence.delete', 'absence', p_absence_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_row.member_id::text));

  return jsonb_build_object('id', p_absence_id, 'deleted', true);
end;
$fn$;


-- ===========================================================================
-- 11. 초기 문주(관리자) 확보
--    · 첫 가입자 규칙: 문주가 한 명도 없을 때 register_member 로 들어온 첫 사람이
--      자동으로 admin 이 됩니다. (배포 직후 본인이 먼저 가입하세요.)
--    · 이미 문파원은 있지만 문주가 없을 때(문주 이탈 등)는 아래 두 단계로 복구합니다.
--        ① SQL Editor:  select private.set_setup_code('원하는-설치-코드');
--        ② 앱/콘솔:     select public.bootstrap_admin('닉네임', '1234', '초대코드', '원하는-설치-코드');
--      설치 코드는 bcrypt 로 저장되고, 성공하면 즉시 지워져 한 번만 쓸 수 있습니다.
-- ===========================================================================
create or replace function private.set_setup_code(p_code text)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $fn$
begin
  if p_code is null or char_length(p_code) < 6 then
    raise exception '설치 코드는 6자 이상으로 정해 주세요.' using errcode = '22023';
  end if;

  update private.clan_settings
     set setup_code_hash = crypt(p_code, gen_salt('bf', 10))
   where id = 1;
end;
$fn$;

create or replace function public.bootstrap_admin(
  p_nickname    text,
  p_pin         text,
  p_invite_code text,
  p_setup_code  text
)
returns jsonb
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $fn$
declare
  v_nick     text := btrim(coalesce(p_nickname, ''));
  v_settings private.clan_settings;
  v_member   private.members;
  v_token    text;
begin
  select * into v_settings from private.clan_settings where id = 1;
  if not found then
    raise exception '문파 설정이 아직 준비되지 않았어요.' using errcode = '55000';
  end if;

  if exists (select 1 from private.members m
              where m.member_role = 'admin' and m.status = 'active') then
    raise exception '이미 문주가 있어요.' using errcode = '42501';
  end if;

  if p_invite_code is null
     or upper(btrim(p_invite_code)) <> upper(v_settings.invite_code) then
    raise exception '초대 코드가 맞지 않아요.' using errcode = '28000';
  end if;

  if v_settings.setup_code_hash is null then
    raise exception '설치 코드가 아직 없어요. SQL Editor 에서 select private.set_setup_code(''...''); 를 먼저 실행해 주세요.'
      using errcode = '55000';
  end if;

  if p_setup_code is null or crypt(p_setup_code, v_settings.setup_code_hash) <> v_settings.setup_code_hash then
    raise exception '설치 코드가 맞지 않아요.' using errcode = '28000';
  end if;

  if v_nick !~ '^[가-힣a-zA-Z0-9_]{2,10}$' then
    raise exception '닉네임은 한글·영문·숫자 2~10자로 정해 주세요.' using errcode = '22023';
  end if;

  if exists (select 1 from private.members m where m.nickname_key = lower(v_nick)) then
    raise exception '이미 쓰고 있는 닉네임이에요.' using errcode = '23505';
  end if;

  insert into private.members (nickname, pin_hash, member_role, last_seen_at)
  values (v_nick, private.pin_hash(p_pin), 'admin', now())
  returning * into v_member;

  update private.clan_settings set setup_code_hash = null where id = 1;

  v_token := private.issue_session(v_member.id);

  perform private.log_admin(v_member.id, 'member.bootstrap_admin', 'member', v_member.id::text, '{}'::jsonb);

  return jsonb_build_object(
    'token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'nickname', v_member.nickname,
      'role', v_member.member_role,
      'level', v_member.member_level
    )
  );
end;
$fn$;


-- ===========================================================================
-- 12. 함수 실행 권한
--     기본값(EXECUTE to PUBLIC)을 모두 회수하고 필요한 RPC 만 anon/authenticated 에 허용.
-- ===========================================================================
revoke all on all functions in schema private from public;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in (
         'register_member', 'login_member', 'logout_member', 'change_pin', 'my_profile',
         'update_my_avatar',
         'mark_attendance', 'post_chat_message', 'list_chat_messages', 'clan_overview',
         'list_coupons', 'list_album_posts', 'create_album_post', 'get_album_image',
         'list_absences', 'create_absence', 'delete_absence',
         'toggle_album_like', 'delete_own_album_post', 'update_album_post_text', 'list_guides',
         'admin_update_invite_code', 'admin_get_settings', 'admin_list_members',
         'admin_kick_member', 'admin_ban_member', 'admin_restore_member', 'admin_set_role',
         'admin_create_notice', 'admin_update_notice', 'admin_pin_notice', 'admin_delete_notice',
         'admin_create_event', 'admin_update_event', 'admin_delete_event',
         'admin_create_coupon', 'update_coupon', 'admin_delete_coupon',
         'create_guide', 'update_guide', 'delete_guide',
         'admin_delete_chat_message', 'admin_delete_album_post', 'admin_list_audit',
         'bootstrap_admin'
       )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;


-- ===========================================================================
-- 13. 초기 데이터
-- ===========================================================================
insert into private.clan_settings (id, clan_name, clan_motto, member_capacity, invite_code)
values (1, '연못', '물결이 모여 연못이 되고, 연못이 모여 강이 된다', 30, 'YEONMOT')
on conflict (id) do nothing;

-- ⚠️ 초대 코드 'YEONMOT' 은 README 에 적힌 체험용 코드입니다.
--    배포 직후 관리자로 가입한 뒤 admin_update_invite_code 로 8자 이상 코드로 바꿔 주세요.

-- 첫 화면이 비어 보이지 않도록 환영 시스템 메시지 한 줄
insert into public.chat_messages (member_id, kind, body)
select null, 'system', '연못 채팅방에 오신 것을 환영합니다. 서로의 속도를 존중해 주세요.'
where not exists (select 1 from public.chat_messages c);


-- ===========================================================================
-- 14. 확인용 (실행하지 않아도 됩니다 · SQL Editor 에서 복사해 확인)
--
--   -- ① 테이블/함수 생성 확인
--   select count(*) as tables from information_schema.tables
--    where table_schema in ('public','private');
--   select count(*) as rpcs from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public';
--
--   -- ② 첫 가입(문주) → 토큰
--   select public.register_member('청연', '1234', 'YEONMOT');
--
--   -- ③ anon 권한 확인: pin_hash 가 어떤 공개 경로로도 안 보여야 함
--   set role anon;
--   select * from public.public_members limit 3;          -- 동작
--   select * from private.members limit 1;                -- permission denied (정상)
--   select pin_hash from public.public_members limit 1;   -- column does not exist (정상)
--   select * from public.chat_messages limit 3;           -- 동작 (Realtime 용 읽기)
--   reset role;
--
--   -- ④ Realtime 등록 확인
--   select schemaname, tablename from pg_publication_tables
--    where pubname = 'supabase_realtime';
-- ===========================================================================


-- ===========================================================================
-- 15. 되돌리기 (필요할 때만 · 주석을 풀고 실행)
-- ===========================================================================
-- drop view if exists public.public_members;
-- drop function if exists public.bootstrap_admin(text, text, text, text);
-- drop function if exists public.admin_list_audit(text, integer);
-- drop function if exists public.delete_absence(text, uuid);
-- drop function if exists public.create_absence(text, date, date, text, uuid, text);
-- drop function if exists public.list_absences(text);
-- drop function if exists public.admin_delete_album_post(text, uuid);
-- drop function if exists public.admin_delete_chat_message(text, bigint);
-- drop function if exists public.admin_delete_coupon(text, uuid);
-- drop function if exists public.update_coupon(text, uuid, text, date);
-- drop function if exists public.admin_create_coupon(text, text, text, text, date, text);
-- drop function if exists public.admin_delete_event(text, uuid);
-- drop function if exists public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]);
-- drop function if exists public.admin_create_event(text, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]);
-- drop function if exists public.admin_delete_notice(text, uuid);
-- drop function if exists public.admin_pin_notice(text, uuid, boolean);
-- drop function if exists public.admin_update_notice(text, uuid, text, text, text, boolean);
-- drop function if exists public.admin_create_notice(text, text, text, text, boolean);
-- drop function if exists public.admin_set_role(text, uuid, text);
-- drop function if exists public.admin_restore_member(text, uuid);
-- drop function if exists public.admin_ban_member(text, uuid, text);
-- drop function if exists public.admin_kick_member(text, uuid, text);
-- drop function if exists public.admin_list_members(text);
-- drop function if exists public.admin_get_settings(text);
-- drop function if exists public.admin_update_invite_code(text, text);
-- drop function if exists public.delete_own_album_post(text, uuid);
-- drop function if exists public.update_album_post_text(text, uuid, text);
-- drop function if exists public.update_guide(text, uuid, text, text);
-- drop function if exists public.toggle_album_like(text, uuid);
-- drop function if exists public.get_album_image(text, uuid);
-- drop function if exists public.create_album_post(text, text, text, text, text);
-- drop function if exists public.list_album_posts(text, integer, timestamptz);
-- drop function if exists public.list_coupons(text);
-- drop function if exists public.clan_overview(text);
-- drop function if exists public.list_chat_messages(text, integer, bigint);
-- drop function if exists public.post_chat_message(text, text);
-- drop function if exists public.mark_attendance(text);
-- drop function if exists public.my_profile(text);
-- drop function if exists public.change_pin(text, text, text);
-- drop function if exists public.logout_member(text);
-- drop function if exists public.login_member(text, text);
-- drop function if exists public.register_member(text, text, text);
-- drop function if exists private.set_setup_code(text);
-- drop function if exists private.set_member_status(private.session_actor, uuid, text, text, text);
-- drop function if exists private.require_admin(text);
-- drop function if exists private.current_member(text);
-- drop function if exists private.issue_session(uuid);
-- drop function if exists private.log_admin(uuid, text, text, text, jsonb);
-- drop function if exists private.touch_updated_at();
-- drop function if exists private.pin_matches(text, text);
-- drop function if exists private.pin_hash(text);
-- drop function if exists private.token_hash(text);
-- drop function if exists private.today_kst();
-- drop table if exists private.admin_audit, private.album_likes, private.album_images,
--   private.album_posts, private.coupons, public.member_absences, public.events, public.notices,
--   public.chat_messages, private.attendance, private.member_sessions,
--   private.members, private.clan_settings cascade;
-- drop type if exists private.session_actor;
-- drop schema if exists private cascade;
-- ===========================================================================
