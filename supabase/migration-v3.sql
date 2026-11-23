-- ============================================================================
--  연못 (Yeonmot Munpa) · v3 마이그레이션
--    ① 쿠폰 코드에 한글 허용
--    ② 홈 맨 아래 '문파원 자리비움' 게시판 (public.member_absences + RPC 3개)
--
--  대상: 이미 schema.sql(v1)로 설치해 쓰고 있는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과가 됩니다 · 기존 쿠폰·문파원 데이터는 그대로)
--
--  ■ ① 쿠폰 코드 한글 허용
--     전: 영문(대문자)·숫자로 시작, 영문·숫자·-·_ 3~24자          예) LOTUS2026
--     후: 한글·영문·숫자로 시작, 한글·영문·숫자·-·_ 3~24자        예) 연꽃2026
--     · 앞뒤 공백은 지우고 영문은 대문자로 저장합니다(예전과 같음).
--     · private.coupons.code 의 check 제약과 public.admin_create_coupon 안내 문구를 바꿉니다.
--
--  ■ ② 문파원 자리비움
--     · public.member_absences (id · member_id · start_date · end_date · reason · created_at · deleted_at)
--     · public.list_absences(p_token)                — 진행 중·예정 항목(지난 기간은 제외), 시작일 순
--     · public.create_absence(p_token, p_start_date, p_end_date, p_reason)
--         등록: 로그인한 active 문파원 누구나. 시작일은 한국 시간 오늘 이후, 종료일 >= 시작일, 이유 1~60자.
--     · public.delete_absence(p_token, p_absence_id)
--         삭제: 운영진(admin · officer)만. 일반 문파원은 올린 본인이어도 42501.
--     · 테이블은 RLS 를 켜고 정책을 두지 않습니다 → anon 직접 접근 불가, RPC(SECURITY DEFINER)만.
--
--  ■ 안전한가
--     · 멱등: create table/index if not exists · create or replace function ·
--       제약은 지우고 다시 달기 · RLS 는 enable(이미 켜져 있어도 그대로).
--     · 기존 쿠폰 코드는 새 규칙을 모두 통과하므로 사라지는 데이터는 없습니다.
--     · 확인 블록이 한글 쿠폰을 넣어 봤다가 되돌리고(저장 안 됨), 자리비움 테이블·RLS·RPC 를 점검합니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.coupons') is null or to_regclass('private.members') is null then
    raise exception '연못 DB 가 아직 없습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① 쿠폰 코드 한글 허용
-- ============================================================================

-- code 를 검사하는 check 제약을 모두 지우고 새 규칙으로 다시 답니다(이름이 달라도 안전)
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'private.coupons'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%code%'
  loop
    execute format('alter table private.coupons drop constraint %I', c.conname);
  end loop;
end $$;

alter table private.coupons
  add constraint coupons_code_check
  check (code ~ '^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$');

comment on column private.coupons.code is
  '게임 내 쿠폰 등록창에 입력할 코드. 한글·영문·숫자로 시작, 한글·영문·숫자·-·_ 3~24자. 저장은 대문자·앞뒤 공백 제거.';

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


-- ============================================================================
-- ② 문파원 자리비움
-- ============================================================================
create table if not exists public.member_absences (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references private.members (id) on delete cascade,
  start_date date not null,
  end_date   date not null,
  reason     text not null check (char_length(reason) between 1 and 60),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint absences_date_order check (end_date >= start_date)
);

create index if not exists absences_dates_idx
  on public.member_absences (start_date)
  where deleted_at is null;

comment on table public.member_absences is
  '문파원 자리비움 기간(시작일·종료일)과 이유. 읽기/쓰기는 RPC(list_absences · create_absence · delete_absence)만.';

alter table public.member_absences enable row level security;
revoke all on table public.member_absences from public, anon, authenticated;
drop policy if exists absences_read on public.member_absences;   -- 정책 없음 = anon 직접 접근 불가(RPC 만)


-- 목록 — 지난 기간(end_date < 오늘)은 빼고, 진행 중·예정만 시작일 순으로
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
               'nickname', m.nickname,
               'avatar', m.avatar,
               'start_date', a.start_date,
               'end_date', a.end_date,
               'reason', a.reason,
               'created_at', a.created_at
             ) as item,
             a.start_date, a.created_at
        from public.member_absences a
        join private.members m on m.id = a.member_id
       where a.deleted_at is null
         and a.end_date >= v_today
       order by a.start_date asc, a.created_at desc
       limit 60
    ) s;

  return v_result;
end;
$fn$;

-- 등록 — 로그인한 active 문파원 누구나
--   · 시작일은 한국 시간 오늘 이후(과거 불가) · 종료일은 시작일과 같거나 뒤 · 이유 1~60자
create or replace function public.create_absence(
  p_token      text,
  p_start_date date,
  p_end_date   date,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_today  date := private.today_kst();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_row    public.member_absences;
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

  insert into public.member_absences (member_id, start_date, end_date, reason)
  values (v_actor.member_id, p_start_date, p_end_date, v_reason)
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'member_id', v_row.member_id,
    'nickname', v_actor.nickname,
    'start_date', v_row.start_date,
    'end_date', v_row.end_date,
    'reason', v_row.reason,
    'created_at', v_row.created_at
  );
end;
$fn$;

-- 삭제 — 운영진(문주 · 운영진)만 (올린 본인이라도 일반 문파원은 불가)
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


-- 앱(anon 키)만 호출할 수 있게 권한을 그대로 맞춥니다(멱등)
revoke all on function public.admin_create_coupon(text, text, text, text, date, text) from public;
revoke all on function public.list_absences(text) from public;
revoke all on function public.create_absence(text, date, date, text) from public;
revoke all on function public.delete_absence(text, uuid) from public;
grant execute on function public.admin_create_coupon(text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.list_absences(text) to anon, authenticated;
grant execute on function public.create_absence(text, date, date, text) to anon, authenticated;
grant execute on function public.delete_absence(text, uuid) to anon, authenticated;


-- ============================================================================
-- ③ 확인 — 스스로 점검합니다(넣어 본 행은 되돌아가 저장되지 않음)
-- ============================================================================
do $$
declare
  v_def  text;
  v_src  text;
  n      integer;
begin
  -- 한글 쿠폰
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'private.coupons'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%code%';
  if v_def is null or position('가-힣' in v_def) = 0 then
    raise exception '쿠폰 코드 제약에 한글이 들어가지 않았습니다: %', coalesce(v_def, '(제약 없음)');
  end if;

  begin
    insert into private.coupons (code, title, reward) values ('한글코드확인', '확인용', '확인용');
    raise exception 'rollback-check';   -- 일부러 실패시켜 위 insert 를 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then
        raise exception '한글 쿠폰 코드가 DB 제약에서 거절되었습니다: %', sqlerrm;
      end if;
  end;

  if to_regprocedure('public.admin_create_coupon(text,text,text,text,date,text)') is null then
    raise exception 'public.admin_create_coupon 이 없습니다.';
  end if;
  select pg_get_functiondef('public.admin_create_coupon(text,text,text,text,date,text)'::regprocedure)
    into v_src;
  if position('가-힣' in v_src) = 0 then
    raise exception 'admin_create_coupon 함수가 한글 코드를 받지 않습니다.';
  end if;

  -- 자리비움
  if to_regclass('public.member_absences') is null then
    raise exception 'public.member_absences 테이블이 없습니다.';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.member_absences'::regclass) then
    raise exception 'public.member_absences 의 RLS 가 꺼져 있습니다.';
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'member_absences';
  if n <> 0 then
    raise exception 'member_absences 에 정책이 있으면 anon 이 직접 읽을 수 있습니다(정책 % 개).', n;
  end if;

  if to_regprocedure('public.list_absences(text)') is null
     or to_regprocedure('public.create_absence(text,date,date,text)') is null
     or to_regprocedure('public.delete_absence(text,uuid)') is null then
    raise exception '자리비움 RPC(list_absences · create_absence · delete_absence)가 없습니다.';
  end if;

  select pg_get_functiondef('public.delete_absence(text,uuid)'::regprocedure) into v_src;
  if position('운영진만' in v_src) = 0 then
    raise exception 'delete_absence 가 운영진 전용 규칙을 담고 있지 않습니다.';
  end if;
  select pg_get_functiondef('public.create_absence(text,date,date,text)'::regprocedure) into v_src;
  if position('빠를 수 없어요' in v_src) = 0 then
    raise exception 'create_absence 가 과거 시작일을 막지 않습니다.';
  end if;

  -- 기간 역전은 테이블 제약으로도 막힙니다(넣어 봤다가 되돌림)
  begin
    insert into public.member_absences (member_id, start_date, end_date, reason)
    select id, private.today_kst() + 5, private.today_kst() + 1, '확인용'
      from private.members limit 1;
    if not found then
      raise notice '문파원이 아직 없어 기간 제약 확인은 건너뜁니다(가입 뒤 RPC 가 막습니다).';
    else
      raise exception 'rollback-check';
    end if;
  exception
    when check_violation then
      raise notice '기간 역전(종료일 < 시작일)은 테이블 제약이 거절합니다.';
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '연못 v3 준비 완료 — ① 쿠폰 코드 한글 허용 ② 문파원 자리비움(member_absences · RPC 3개) 확인.';
end $$;
