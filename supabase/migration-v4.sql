-- ============================================================================
--  연못 (Yeonmot Munpa) · v4 마이그레이션
--    운영진(문주·부문주)의 '대신 자리비움 등록' — 대상 문파원 선택 / 이름 직접 입력
--
--  대상: 이미 schema.sql · migration-v2/v3 로 설치해 쓰고 있는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 기존 자리비움 기록은 그대로 남습니다)
--
--  ■ 무엇이 바뀌나
--     · public.member_absences 에 두 칸을 더합니다.
--         created_by  uuid  — 자리비움을 올린 문파원. 대상(member_id)과 다르면 '대신 올린 것'.
--                             예전 기록은 비어 있습니다(올린 본인 = member_id).
--         target_name text  — 아직 사이트에 가입하지 않은 문파원의 이름을 직접 적은 경우(2~20자).
--                             값이 있으면 member_id 는 올린 운영진입니다.
--     · public.create_absence(p_token, p_start_date, p_end_date, p_reason,
--                             p_target_member_id uuid default null,
--                             p_target_name      text default null)
--         · 예전처럼 4개 인자로 부르면 그대로 본인 자리비움입니다(100% 하위 호환).
--         · p_target_member_id 가 본인이 아니거나 p_target_name 을 적었다면
--           부른 사람이 운영진(admin·officer)이어야 합니다 — 아니면 42501.
--         · 가입 문파원 대상: member_id = 대상 문파원, created_by = 올린 운영진
--           → 카드에 그 문파원의 닉네임·아바타가 보입니다.
--         · 미가입자 직접 입력: member_id = 올린 운영진, target_name = 적은 이름
--           → 카드에 그 이름(아바타는 첫 글자)이 보입니다.
--     · public.list_absences(p_token) 가 대상 기준의 nickname · avatar 와
--       대리 등록 여부(is_proxy) · 올린 운영진(proxy_by) 을 함께 돌려줍니다.
--     · public.delete_absence 는 그대로 — 운영진만 지울 수 있습니다.
--
--  ■ 안전한가
--     · 멱등: add column if not exists · 제약은 지우고 다시 달기(이름이 달라도 안전) ·
--       create or replace function. RLS 설정과 기존 기록은 건드리지 않습니다.
--     · 옛 4인자 create_absence 를 남겨 두면 새 6인자와 함께 '호출이 모호하다'는 오류가 나므로,
--       옛 함수를 지우고 같은 이름·같은 동작에 인자만 늘린 새 함수를 만듭니다.
--     · 확인 블록이 임시 문파원·세션을 만들어 실제 RPC 를 한 번씩 돌려 보고(권한 포함)
--       마지막에 전부 되돌립니다 — 문파에 남는 행은 없습니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.members') is null or to_regclass('public.member_absences') is null then
    raise exception '연못 자리비움 테이블이 아직 없습니다. 먼저 supabase/schema.sql (또는 migration-v3.sql) 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① 표에 '올린 사람'과 '직접 입력한 이름' 칸 더하기
-- ============================================================================
alter table public.member_absences add column if not exists created_by  uuid;
alter table public.member_absences add column if not exists target_name text;

-- created_by → private.members (이미 있으면 그대로)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.member_absences'::regclass
       and conname  = 'absences_created_by_fkey'
  ) then
    alter table public.member_absences
      add constraint absences_created_by_fkey
      foreign key (created_by) references private.members (id) on delete set null;
  end if;
end $$;

-- target_name 길이 제약(2~20자) — 예전에 다른 이름으로 붙어 있어도 지우고 다시 답니다
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.member_absences'::regclass
       and con.contype  = 'c'
       and pg_get_constraintdef(con.oid) ilike '%target_name%'
  loop
    execute format('alter table public.member_absences drop constraint %I', c.conname);
  end loop;

  alter table public.member_absences
    add constraint absences_target_name_len
    check (target_name is null or char_length(btrim(target_name)) between 2 and 20);
end $$;

comment on column public.member_absences.created_by is
  '자리비움을 올린 문파원. 대상(member_id)과 다르면 대신 올린 것(운영진). 예전 기록은 비어 있습니다.';
comment on column public.member_absences.target_name is
  '아직 사이트에 가입하지 않은 문파원의 이름을 직접 적은 경우(2~20자). 값이 있으면 member_id 는 올린 운영진.';
comment on table public.member_absences is
  '문파원 자리비움 기간(시작일·종료일)과 이유. 읽기/쓰기는 RPC(list_absences · create_absence · delete_absence)만.';


-- ============================================================================
-- ② 목록 — 대상의 닉네임·아바타와 대리 등록 여부를 함께
-- ============================================================================
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
               -- 보여 줄 이름·아바타는 '대상' 기준: 직접 입력한 이름이 있으면 그것, 없으면 대상 문파원 것
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


-- ============================================================================
-- ③ 등록 — 본인은 누구나, 다른 문파원 대신은 운영진만
-- ============================================================================
-- 옛 4인자 함수를 먼저 지웁니다(새 6인자와 함께 있으면 4인자 호출이 모호해집니다)
drop function if exists public.create_absence(text, date, date, text);

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


-- ============================================================================
-- ④ 함수 실행 권한 (앱의 anon 키로만 부를 수 있게, 멱등)
-- ============================================================================
revoke all on function public.list_absences(text) from public;
revoke all on function public.create_absence(text, date, date, text, uuid, text) from public;
revoke all on function public.delete_absence(text, uuid) from public;
grant execute on function public.list_absences(text) to anon, authenticated;
grant execute on function public.create_absence(text, date, date, text, uuid, text) to anon, authenticated;
grant execute on function public.delete_absence(text, uuid) to anon, authenticated;


-- ============================================================================
-- ⑤ 확인 — 스스로 점검합니다(임시 문파원·세션으로 실제 호출, 끝나면 전부 되돌림)
-- ============================================================================
do $$
declare
  v_src text;
  n     int;
begin
  -- 칸
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'member_absences'
                    and column_name = 'created_by') then
    raise exception 'public.member_absences.created_by 가 없습니다.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'member_absences'
                    and column_name = 'target_name') then
    raise exception 'public.member_absences.target_name 이 없습니다.';
  end if;
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.member_absences'::regclass
     and conname  = 'absences_target_name_len';
  if n <> 1 then
    raise exception 'target_name 길이 제약이 없습니다.';
  end if;

  -- 함수
  if to_regprocedure('public.create_absence(text,date,date,text,uuid,text)') is null then
    raise exception '새 create_absence(6인자) 가 없습니다.';
  end if;
  if to_regprocedure('public.create_absence(text,date,date,text)') is not null then
    raise exception '옛 create_absence(4인자) 가 남아 있어 4인자 호출이 모호해집니다.';
  end if;
  if to_regprocedure('public.list_absences(text)') is null
     or to_regprocedure('public.delete_absence(text,uuid)') is null then
    raise exception '자리비움 RPC(list_absences · delete_absence)가 없습니다.';
  end if;

  select pg_get_functiondef('public.create_absence(text,date,date,text,uuid,text)'::regprocedure) into v_src;
  if position('운영진' in v_src) = 0 or position('target_name' in v_src) = 0 then
    raise exception 'create_absence 에 대리 등록 규칙이 들어 있지 않습니다.';
  end if;
  if position('빠를 수 없어요' in v_src) = 0 then
    raise exception 'create_absence 가 과거 시작일을 막지 않습니다.';
  end if;

  select pg_get_functiondef('public.list_absences(text)'::regprocedure) into v_src;
  if position('target_name' in v_src) = 0 or position('is_proxy' in v_src) = 0 then
    raise exception 'list_absences 가 대상 닉네임·대리 여부를 돌려주지 않습니다.';
  end if;

  -- 실제 호출 — 임시 문파원 둘(일반 · 운영진)과 세션을 만들고 마지막에 모두 되돌립니다
  begin
    declare
      v_plain  private.members;
      v_chief  private.members;
      v_tp     text;
      v_tc     text;
      c        jsonb;
      rows     jsonb;
      cnt      int;
      v_today  date := private.today_kst();
    begin
      insert into private.members (nickname, pin_hash, member_role)
      values ('확인' || substr(md5(random()::text), 1, 6), 'v4-verify', 'member')
      returning * into v_plain;
      insert into private.members (nickname, pin_hash, member_role)
      values ('확인' || substr(md5(random()::text), 1, 6), 'v4-verify', 'officer')
      returning * into v_chief;

      v_tp := 'v4verify' || md5(random()::text) || md5(random()::text);
      v_tc := 'v4verify' || md5(random()::text) || md5(random()::text);
      insert into private.member_sessions (member_id, token_hash, expires_at)
      values (v_plain.id, private.token_hash(v_tp), now() + interval '10 minutes'),
             (v_chief.id, private.token_hash(v_tc), now() + interval '10 minutes');

      -- ① 예전 그대로 4개 인자(본인) — 그대로 동작해야 합니다
      c := public.create_absence(v_tp, v_today + 1, v_today + 2, 'v4 확인');
      if c->>'nickname' <> v_plain.nickname
         or coalesce((c->>'is_proxy')::boolean, true) then
        raise exception '본인 등록 응답이 예전과 다릅니다: %', c;
      end if;

      -- ② 일반 문파원이 남의 이름으로 올리면 거절(42501)
      begin
        perform public.create_absence(v_tp, v_today + 1, v_today + 2, 'v4 확인', null, '새벽이');
        raise exception '일반 문파원의 대리 등록이 통과되었습니다.';
      exception
        when sqlstate '42501' then null;
      end;

      -- ③ 운영진이 가입 문파원 대신 — 대상의 닉네임이 돌아옵니다
      c := public.create_absence(v_tc, v_today, v_today + 3, 'v4 확인', v_plain.id);
      if c->>'nickname' <> v_plain.nickname
         or not coalesce((c->>'is_proxy')::boolean, false)
         or c->>'proxy_by' <> v_chief.nickname then
        raise exception '문파원 대상 대리 등록 응답이 이상합니다: %', c;
      end if;

      -- ④ 운영진이 미가입자 이름을 직접(앞뒤 공백은 지웁니다)
      c := public.create_absence(v_tc, v_today + 2, v_today + 4, 'v4 확인', null, '  새벽이  ');
      if c->>'nickname' <> '새벽이'
         or c->>'avatar' is not null
         or not coalesce((c->>'is_proxy')::boolean, false) then
        raise exception '직접 입력 대리 등록 응답이 이상합니다: %', c;
      end if;

      -- ⑤ 목록에도 대상 이름·대리 표시가 보입니다
      rows := public.list_absences(v_tp);
      select count(*) into cnt
        from jsonb_array_elements(rows) e
       where e->>'nickname' = '새벽이'
         and coalesce((e->>'is_proxy')::boolean, false)
         and e->>'proxy_by' = v_chief.nickname;
      if cnt <> 1 then
        raise exception '목록에 직접 입력한 대상이 보이지 않습니다.';
      end if;

      raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
    exception
      when others then
        if sqlerrm <> 'rollback-check' then raise; end if;
    end;

    raise notice 'v4 확인 — 본인 등록(4인자) · 운영진 대리 등록(문파원 선택·직접 입력) · 일반 문파원 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  end;

  raise notice '연못 v4 준비 완료 — 운영진이 다른 문파원 대신 자리비움을 올릴 수 있습니다.';
end $$;
