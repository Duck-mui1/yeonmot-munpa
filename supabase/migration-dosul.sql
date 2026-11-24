-- ============================================================================
--  연못 (Yeonmot Munpa) · '⚔️ 도술 계산기 — 문파 공유 조합' 마이그레이션
--    (파일 이름: supabase/migration-dosul.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text/edit-posts/
--        clan-contents/gyeongdan 으로 설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 저장된 조합은 그대로 남습니다)
--
--  ■ 무엇이 더해지나 — 하단 「⚔️ 도술」 탭의 '📌 문파 공유 조합'
--     · private.dosul_builds 표
--         id         uuid   (조합 하나)
--         member_id  uuid   (올린 문파원 · 탈퇴하면 함께 지워짐)
--         title      text   (제목 1~40자 · 예: 사냥용 파멸3 주술3)
--         memo       text   (메모 0~200자)
--         slots      jsonb  (장착 8칸 — 도술 id 8개, 빈 칸은 null)
--         config     jsonb  (전투 시간·쿨감·시전 기준·평타·신식 토글 등 계산 설정)
--         idle_pct   numeric(5,1)  (그때 계산된 '평타 빈 시간 %')
--         dps        numeric(8,2)  (그때 계산된 초당 피해 %)
--         created_at timestamptz
--     · public.save_dosul_build(p_token, p_title, p_memo, p_slots, p_config,
--                               p_idle_pct, p_dps)
--         로그인한 문파원 이름으로 조합을 저장하고 { ok, id, count } 를 돌려줍니다.
--     · public.list_dosul_builds(p_token, p_limit = 40)
--         최근에 올린 순서로 { id, title, memo, slots, config, idle_pct, dps,
--         member_id, nickname, avatar, role, mine, can_delete, created_at }
--     · public.delete_dosul_build(p_token, p_build_id)
--         올린 본인 또는 운영진(admin·officer)만 지울 수 있습니다.
--
--  ■ SQL 을 실행하기 전에도 계산기는 그대로 돕니다
--     앱은 함수가 없으면(PGRST202) 이 기기(localStorage)에만 조합을 저장하고,
--     공유 목록에 '아직 문파 서버에 준비되지 않았어요' 안내를 보여 줍니다.
--
--  ■ 안전한가
--     · 멱등: create table if not exists · create or replace · 권한 재부여
--     · 문파원 PIN·세션 같은 기존 기록은 건드리지 않습니다(표 하나를 더할 뿐).
--     · 확인 블록이 임시 문파원·세션을 만들어 실제로 저장하고·목록을 읽고·권한을
--       거절하는지 본 뒤 마지막에 전부 되돌립니다 — 문파에 남는 행은 없습니다.
--       실패하면 아무것도 바뀌지 않고 오류로 알려 줍니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.members') is null
     or to_regprocedure('private.current_member(text)') is null then
    raise exception '연못 DB 가 아직 준비되지 않았습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① private.dosul_builds — 문파원이 저장한 도술 조합
-- ============================================================================
create table if not exists private.dosul_builds (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references private.members (id) on delete cascade,
  title      text not null,
  memo       text not null default '',
  slots      jsonb not null,
  config     jsonb not null default '{}'::jsonb,
  idle_pct   numeric(5, 1) not null default 0,
  dps        numeric(8, 2) not null default 0,
  created_at timestamptz not null default now()
);

comment on table private.dosul_builds is
  '⚔️ 도술 계산기 — 문파원이 저장한 8칸 조합. RPC(저장·목록·삭제)로만 읽고 씁니다.';
comment on column private.dosul_builds.slots is
  '장착 8칸 — 도술 id 8개(빈 칸은 null). 예: [1010010, 1070050, null, …]';
comment on column private.dosul_builds.config is
  '계산 설정 — 전투 시간·쿨감·시전 기준·평타 1회 시간/계수·신식 토글·도술별 수정값.';
comment on column private.dosul_builds.idle_pct is
  '저장할 때 계산된 평타 빈 시간 비율(%). 목록에서 한눈에 비교하는 값입니다.';

-- 값이 망가진 줄이 들어가지 않도록 표에서도 한 번 더 막습니다
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'dosul_builds_title_len' and conrelid = 'private.dosul_builds'::regclass
  ) then
    alter table private.dosul_builds
      add constraint dosul_builds_title_len check (char_length(btrim(title)) between 1 and 40),
      add constraint dosul_builds_memo_len check (char_length(memo) <= 200),
      add constraint dosul_builds_slots_shape check (
        jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) = 8),
      add constraint dosul_builds_config_shape check (jsonb_typeof(config) = 'object'),
      add constraint dosul_builds_idle_range check (idle_pct between 0 and 100),
      add constraint dosul_builds_dps_range check (dps between 0 and 1000000);
  end if;
end $$;

create index if not exists dosul_builds_recent_idx
  on private.dosul_builds (created_at desc);
create index if not exists dosul_builds_member_idx
  on private.dosul_builds (member_id, created_at desc);

alter table private.dosul_builds enable row level security;
revoke all on table private.dosul_builds from public, anon, authenticated;


-- ============================================================================
-- ② 조합 저장 — 로그인한 문파원 이름으로
-- ============================================================================
create or replace function public.save_dosul_build(
  p_token    text,
  p_title    text,
  p_memo     text,
  p_slots    jsonb,
  p_config   jsonb,
  p_idle_pct numeric,
  p_dps      numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_memo  text := btrim(coalesce(p_memo, ''));
  v_count integer;
  v_id    uuid;
begin
  if char_length(v_title) < 1 then
    raise exception '조합 이름을 1~40자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_title) > 40 then
    raise exception '조합 이름은 40자까지 쓸 수 있어요.' using errcode = '22023';
  end if;
  if char_length(v_memo) > 200 then
    raise exception '메모는 200자까지 쓸 수 있어요.' using errcode = '22023';
  end if;

  if p_slots is null or jsonb_typeof(p_slots) is distinct from 'array'
     or jsonb_array_length(p_slots) <> 8 then
    raise exception '도술 8칸이 올바르지 않아요.' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_slots) e
     where case
             when jsonb_typeof(e) = 'null' then false
             when jsonb_typeof(e) = 'number' then
               (e #>> '{}')::numeric < 1
               or (e #>> '{}')::numeric > 99999999
               or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
             else true
           end
  ) then
    raise exception '도술 8칸에 숫자(도술 id) 또는 빈 칸만 넣을 수 있어요.' using errcode = '22023';
  end if;

  if p_config is null or jsonb_typeof(p_config) is distinct from 'object' then
    raise exception '계산 설정이 올바르지 않아요.' using errcode = '22023';
  end if;
  if char_length(p_config::text) > 6000 then
    raise exception '계산 설정이 너무 큽니다.' using errcode = '22023';
  end if;

  if p_idle_pct is null or p_idle_pct < 0 or p_idle_pct > 100 then
    raise exception '평타 빈 시간이 올바르지 않아요.' using errcode = '22023';
  end if;
  if p_dps is null or p_dps < 0 or p_dps > 1000000 then
    raise exception '초당 피해가 올바르지 않아요.' using errcode = '22023';
  end if;

  select count(*) into v_count
    from private.dosul_builds b
   where b.member_id = v_actor.member_id;
  if v_count >= 30 then
    raise exception '공유 조합은 한 사람당 30개까지 저장할 수 있어요. 쓰지 않는 조합을 지워 주세요.'
      using errcode = '22023';
  end if;

  insert into private.dosul_builds (member_id, title, memo, slots, config, idle_pct, dps)
  values (v_actor.member_id, v_title, v_memo, p_slots, p_config,
          round(p_idle_pct, 1), round(p_dps, 2))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'count', v_count + 1);
end;
$fn$;

comment on function public.save_dosul_build(text, text, text, jsonb, jsonb, numeric, numeric) is
  '⚔️ 도술 조합 저장 — 로그인한 문파원 이름으로 8칸·설정·평타 빈 시간·DPS를 남기고 { ok, id, count } 를 돌려줍니다.';


-- ============================================================================
-- ③ 문파 공유 조합 목록 — 최근에 올린 순서
-- ============================================================================
create or replace function public.list_dosul_builds(
  p_token text,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.created_at desc, s.title), '[]'::jsonb)
    into v_result
    from (
      select b.created_at,
             b.title,
             jsonb_build_object(
               'id', b.id,
               'title', b.title,
               'memo', b.memo,
               'slots', b.slots,
               'config', b.config,
               'idle_pct', b.idle_pct,
               'dps', b.dps,
               'member_id', m.id,
               'nickname', m.nickname,
               'avatar', m.avatar,
               'role', m.member_role,
               'mine', (b.member_id = v_actor.member_id),
               'can_delete', (b.member_id = v_actor.member_id
                              or v_actor.member_role in ('admin', 'officer')),
               'created_at', b.created_at
             ) as item
        from private.dosul_builds b
        join private.members m on m.id = b.member_id
       where m.status = 'active'
       order by b.created_at desc
       limit v_limit
    ) s;

  return coalesce(v_result, '[]'::jsonb);
end;
$fn$;

comment on function public.list_dosul_builds(text, integer) is
  '⚔️ 도술 공유 조합 목록 — 최근에 올린 순서. 올린 사람 닉네임·그림과 내가 지울 수 있는지(can_delete)를 함께 돌려줍니다.';


-- ============================================================================
-- ④ 조합 삭제 — 올린 본인 또는 운영진(admin·officer)
-- ============================================================================
create or replace function public.delete_dosul_build(
  p_token    text,
  p_build_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_build private.dosul_builds;
begin
  select * into v_build
    from private.dosul_builds b
   where b.id = p_build_id
   for update;

  if not found then
    raise exception '조합을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_build.member_id is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 조합이나 운영진만 지울 수 있어요.' using errcode = '42501';
  end if;

  delete from private.dosul_builds where id = p_build_id;

  perform private.log_admin(v_actor.member_id, 'dosul.delete', 'dosul_build', p_build_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_build.member_id::text,
                                               'title', v_build.title));

  return jsonb_build_object('id', p_build_id, 'deleted', true);
end;
$fn$;

comment on function public.delete_dosul_build(text, uuid) is
  '⚔️ 도술 공유 조합 삭제 — 올린 본인 또는 운영진만. { id, deleted } 를 돌려줍니다.';


-- ============================================================================
-- ⑤ 함수는 이름마다 하나씩 (PostgREST 가 고르지 못하는 상태가 아님)
-- ============================================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('save_dosul_build', 'list_dosul_builds', 'delete_dosul_build');
  if v_count <> 3 then
    raise exception '도술 공유 함수가 %개입니다(3개여야 합니다). 이 파일을 처음부터 다시 실행해 주세요.', v_count;
  end if;
end $$;


-- ============================================================================
-- ⑥ 함수 실행 권한 — 앱(anon 키)이 부를 수 있게
-- ============================================================================
revoke all on function public.save_dosul_build(text, text, text, jsonb, jsonb, numeric, numeric) from public;
grant execute on function public.save_dosul_build(text, text, text, jsonb, jsonb, numeric, numeric) to anon, authenticated;

revoke all on function public.list_dosul_builds(text, integer) from public;
grant execute on function public.list_dosul_builds(text, integer) to anon, authenticated;

revoke all on function public.delete_dosul_build(text, uuid) from public;
grant execute on function public.delete_dosul_build(text, uuid) to anon, authenticated;


-- ============================================================================
-- ⑦ 확인 — 임시 문파원 셋으로 실제로 저장·목록·삭제를 해 보고, 마지막에 전부 되돌립니다
-- ============================================================================
do $$
declare
  v_admin  private.members;
  v_mem    private.members;
  v_other  private.members;
  v_t_admin text;
  v_t_mem   text;
  v_t_other text;
  v_json    jsonb;
  v_rows    jsonb;
  v_id_a    uuid;
  v_id_m    uuid;
  v_items   jsonb;
  v_i       int;
  v_slots   jsonb := '[1010010, 1070050, null, 1030080, 1040080, 1020080, 1050060, null]'::jsonb;
  v_config  jsonb := '{"duration":60,"cdReducePct":10,"castMode":"delay","toggles":{"cataclysm":["overflow"]}}'::jsonb;
begin
  if has_function_privilege('anon', 'public.save_dosul_build(text,text,text,jsonb,jsonb,numeric,numeric)', 'execute') = false
     or has_function_privilege('anon', 'public.list_dosul_builds(text,integer)', 'execute') = false
     or has_function_privilege('anon', 'public.delete_dosul_build(text,uuid)', 'execute') = false then
    raise exception 'anon 이 도술 공유 함수를 부를 수 없습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('도술검증' || substr(md5(random()::text), 1, 4), 'ds-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('도술친구' || substr(md5(random()::text), 1, 4), 'ds-verify', 'member')
    returning * into v_mem;
    insert into private.members (nickname, pin_hash, member_role)
    values ('도술손님' || substr(md5(random()::text), 1, 4), 'ds-verify', 'member')
    returning * into v_other;

    v_t_admin := 'dsverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'dsverify' || md5(random()::text) || md5(random()::text);
    v_t_other := 'dsverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id, private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_mem.id,   private.token_hash(v_t_mem),   now() + interval '10 minutes'),
           (v_other.id, private.token_hash(v_t_other), now() + interval '10 minutes');

    -- ① 저장 — 값이 그대로 남는다
    v_json := public.save_dosul_build(v_t_mem, '  사냥용 파멸3 주술3  ', '주간 사냥', v_slots, v_config, 42.5, 123.45);
    if (v_json->>'ok')::boolean is not true or (v_json->>'count')::int <> 1 then
      raise exception '첫 조합 저장이 실패했습니다: %', v_json;
    end if;
    v_id_m := (v_json->>'id')::uuid;

    -- ② 운영진 조합도 하나 저장
    v_json := public.save_dosul_build(v_t_admin, '관리자 조합', '', v_slots, '{}'::jsonb, 100, 0);
    if (v_json->>'ok')::boolean is not true then
      raise exception '운영진 조합 저장이 실패했습니다: %', v_json;
    end if;
    v_id_a := (v_json->>'id')::uuid;

    -- ③ 저장된 값 확인
    if (select b.title from private.dosul_builds b where b.id = v_id_m) <> '사냥용 파멸3 주술3' then
      raise exception '제목 앞뒤 공백이 다듬어지지 않았습니다: %',
        (select b.title from private.dosul_builds b where b.id = v_id_m);
    end if;
    if (select b.idle_pct from private.dosul_builds b where b.id = v_id_m) <> 42.5 then
      raise exception '평타 빈 시간이 그대로 저장되지 않았습니다.';
    end if;
    if (select b.slots from private.dosul_builds b where b.id = v_id_m) <> v_slots then
      raise exception '도술 8칸이 그대로 저장되지 않았습니다.';
    end if;

    -- ④ 목록 — 최근 것부터 · 필요한 칸이 모두 있다
    v_rows := public.list_dosul_builds(v_t_other, 50);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 2 then
      raise exception '공유 목록이 비었습니다: %', v_rows;
    end if;
    v_items := v_rows;
    for v_i in 0 .. jsonb_array_length(v_items) - 1 loop
      if not ((v_items->v_i) ? 'id' and (v_items->v_i) ? 'title' and (v_items->v_i) ? 'slots'
              and (v_items->v_i) ? 'config' and (v_items->v_i) ? 'idle_pct' and (v_items->v_i) ? 'dps'
              and (v_items->v_i) ? 'nickname' and (v_items->v_i) ? 'avatar'
              and (v_items->v_i) ? 'mine' and (v_items->v_i) ? 'can_delete') then
        raise exception '공유 목록에 필요한 칸이 없습니다: %', v_items->v_i;
      end if;
    end loop;

    -- ⑤ 내 것 표시 — 손님에게는 둘 다 남의 조합
    if exists (select 1 from jsonb_array_elements(v_items) e
                where (e->>'id')::uuid in (v_id_a, v_id_m) and (e->>'mine')::boolean) then
      raise exception '남의 조합이 내 것으로 표시되었습니다: %', v_items;
    end if;
    if exists (select 1 from jsonb_array_elements(v_items) e
                where (e->>'id')::uuid in (v_id_a, v_id_m) and (e->>'can_delete')::boolean) then
      raise exception '일반 문파원이 남의 조합을 지울 수 있게 표시되었습니다: %', v_items;
    end if;

    -- ⑥ 남의 조합은 못 지운다 (42501)
    begin
      perform public.delete_dosul_build(v_t_other, v_id_m);
      raise exception '남의 조합이 지워졌습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑦ 내 조합은 지운다
    v_json := public.delete_dosul_build(v_t_mem, v_id_m);
    if (v_json->>'deleted')::boolean is not true then
      raise exception '내 조합이 지워지지 않았습니다: %', v_json;
    end if;

    -- ⑧ 운영진은 남의 조합도 지운다
    v_json := public.delete_dosul_build(v_t_admin, v_id_a);
    if (v_json->>'deleted')::boolean is not true then
      raise exception '운영진이 조합을 지우지 못했습니다: %', v_json;
    end if;

    -- ⑨ 잘못된 값은 22023
    begin
      perform public.save_dosul_build(v_t_mem, '', '', v_slots, v_config, 10, 10);
      raise exception '빈 제목이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_dosul_build(v_t_mem, '8칸 아님', '', '[1010010, 1070050]'::jsonb, v_config, 10, 10);
      raise exception '8칸이 아닌 조합이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_dosul_build(v_t_mem, '이상한 칸', '', '[0, 1, 2, 3, 4, 5, 6, "가"]'::jsonb, v_config, 10, 10);
      raise exception '숫자가 아닌 칸이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.save_dosul_build(v_t_mem, '빈 시간 이상', '', v_slots, v_config, 120, 10);
      raise exception '100%를 넘는 평타 빈 시간이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑩ 로그인 없이 부르면 28000
    begin
      perform public.list_dosul_builds('dsverifybadtokendsverifybad', 20);
      raise exception '없는 토큰이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑪ 한 사람 30개까지 — 31번째는 22023
    for v_i in 1 .. 30 loop
      perform public.save_dosul_build(v_t_other, '한도' || v_i, '', v_slots, '{}'::jsonb, 1, 1);
    end loop;
    begin
      perform public.save_dosul_build(v_t_other, '한도31', '', v_slots, '{}'::jsonb, 1, 1);
      raise exception '31번째 조합이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑫ 강퇴된 문파원의 조합은 목록에서 빠집니다
    update private.members set status = 'kicked' where id = v_other.id;
    v_rows := public.list_dosul_builds(v_t_admin, 100);
    if exists (select 1 from jsonb_array_elements(v_rows) e
                where (e->>'nickname') = v_other.nickname) then
      raise exception '강퇴된 문파원의 조합이 목록에 남았습니다: %', v_rows;
    end if;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '도술 공유 조합 확인 — 저장 · 목록 · 내 것 표시 · 삭제 권한 · 잘못된 값 거절 · 30개 한도가 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '연못 마이그레이션 완료 — ⚔️ 도술 계산기의 📌 문파 공유 조합을 쓸 수 있습니다.';
end $$;
