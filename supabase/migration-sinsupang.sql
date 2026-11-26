-- ============================================================================
--  연못 (Yeonmot Munpa) · '🐾 신수팡 문파 랭킹' 마이그레이션
--    (파일 이름: supabase/migration-sinsupang.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text/edit-posts/clan-contents/
--        gyeongdan/dosul 로 설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 더해지나 — 홈 위쪽 🐾 신수팡(3매치 퍼즐)의 '문파 랭킹'
--     · private.sinsupang_scores 표
--         member_id  uuid   (문파원 한 명에 한 줄 · 기본 키)
--         best_score int    (그 사람의 최고 점수 · 0 ~ 1,000,000)
--         best_combo int2   (그 판에서 이어 간 가장 긴 콤보 · 0 ~ 999)
--         updated_at timestamptz (최고 기록을 마지막으로 올린 때)
--     · public.submit_sinsupang_score(p_token, p_score, p_combo)
--         로그인한 문파원의 최고 기록일 때만 갱신하고
--         { ok, best_score, best_combo, is_new_best, rank } 를 돌려줍니다.
--     · public.list_sinsupang_ranking(p_token, p_limit = 20)
--         랭킹 목록 { rank, member_id, nickname, role, avatar, best_score, best_combo, updated_at }
--         (점수 높은 순 · 같으면 먼저 올린 사람이 위 · 활성 문파원만 · 최대 50명)
--
--  ■ 게임은 마이그레이션 전에도 그대로 돕니다
--     앱은 함수가 없으면(PGRST202) 이 기기(localStorage)의 최고 점수로 계속 플레이하고,
--     랭킹 탭에만 '아직 준비되지 않았어요' 안내를 보여 줍니다.
--
--  ■ 안전한가
--     · 멱등: create table if not exists · create or replace · 권한 재부여
--     · 문파원 PIN·세션·경단 기록 같은 기존 기록은 건드리지 않습니다(표 하나를 더할 뿐).
--     · 확인 블록이 임시 문파원·세션을 만들어 실제로 넣고·비교하고·거절되는지 본 뒤
--       마지막에 전부 되돌립니다 — 문파에 남는 행은 없습니다.
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
-- ① private.sinsupang_scores — 한 사람당 한 줄, 최고 기록만
-- ============================================================================
create table if not exists private.sinsupang_scores (
  member_id  uuid primary key references private.members (id) on delete cascade,
  best_score integer not null default 0
               constraint sinsupang_scores_score_range check (best_score between 0 and 100000000),
  best_combo smallint not null default 0
               constraint sinsupang_scores_combo_range check (best_combo between 0 and 999),
  updated_at timestamptz not null default now()
);

comment on table private.sinsupang_scores is '신수팡 문파 랭킹 — 문파원마다 최고 점수 한 줄. 랭킹 RPC 로만 읽고 씁니다.';
comment on column private.sinsupang_scores.best_combo is '그 문파원이 한 판에서 이어 간 가장 긴 콤보(연쇄) 수.';

create index if not exists sinsupang_scores_best_idx
  on private.sinsupang_scores (best_score desc, updated_at asc);

alter table private.sinsupang_scores enable row level security;
revoke all on table private.sinsupang_scores from public, anon, authenticated;


-- ============================================================================
-- ② 점수 올리기 — 최고 기록일 때만 갱신
-- ============================================================================
create or replace function public.submit_sinsupang_score(
  p_token  text,
  p_score  integer,
  p_combo  integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_prev  private.sinsupang_scores;
  v_best  integer;
  v_combo smallint;
  v_new   boolean := false;
  v_rank  integer;
begin
  if p_score is null or p_score < 0 or p_score > 100000000 then
    raise exception '점수가 올바르지 않아요.' using errcode = '22023';
  end if;

  if p_combo is null or p_combo < 0 or p_combo > 999 then
    raise exception '콤보가 올바르지 않아요.' using errcode = '22023';
  end if;

  select * into v_prev
    from private.sinsupang_scores s
   where s.member_id = v_actor.member_id;

  if not found then
    v_best := p_score;
    v_combo := p_combo::smallint;
    v_new  := p_score > 0;
    insert into private.sinsupang_scores (member_id, best_score, best_combo)
    values (v_actor.member_id, v_best, v_combo);
  else
    v_best := greatest(v_prev.best_score, p_score);
    v_combo := greatest(v_prev.best_combo, p_combo::smallint);
    v_new  := p_score > v_prev.best_score;
    if v_best <> v_prev.best_score or v_combo <> v_prev.best_combo then
      update private.sinsupang_scores
         set best_score = v_best,
             best_combo = v_combo,
             updated_at = now()
       where member_id = v_actor.member_id;
    end if;
  end if;

  select count(*) + 1
    into v_rank
    from private.sinsupang_scores s
    join private.members m on m.id = s.member_id
   where m.status = 'active'
     and s.best_score > v_best;

  return jsonb_build_object(
    'ok', true,
    'best_score', v_best,
    'best_combo', v_combo,
    'is_new_best', v_new,
    'rank', v_rank
  );
end;
$fn$;

comment on function public.submit_sinsupang_score(text, integer, integer) is
  '신수팡 점수 제출 — 로그인한 문파원의 최고 점수만 갱신하고 { ok, best_score, best_combo, is_new_best, rank } 를 돌려줍니다.';


-- ============================================================================
-- ③ 문파 랭킹 — 점수 높은 순
-- ============================================================================
create or replace function public.list_sinsupang_ranking(
  p_token text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.rank_no, s.nickname), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'rank', r.rank_no,
               'member_id', r.id,
               'nickname', r.nickname,
               'role', r.member_role,
               'avatar', r.avatar,
               'best_score', r.best_score,
               'best_combo', r.best_combo,
               'updated_at', r.updated_at
             ) as item,
             r.rank_no,
             r.nickname
        from (
          select m.id,
                 m.nickname,
                 m.member_role,
                 m.avatar,
                 s.best_score,
                 s.best_combo,
                 s.updated_at,
                 rank() over (order by s.best_score desc, s.updated_at asc) as rank_no
            from private.sinsupang_scores s
            join private.members m on m.id = s.member_id
           where m.status = 'active'
        ) r
       order by r.rank_no, r.nickname
       limit v_limit
    ) s;

  return v_result;
end;
$fn$;

comment on function public.list_sinsupang_ranking(text, integer) is
  '신수팡 문파 랭킹 — 점수 높은 순(같으면 먼저 올린 사람이 위). 활성 문파원만, 최대 50명.';


-- ============================================================================
-- ④ 함수는 이름마다 하나씩 (PostgREST 가 고르지 못하는 상태가 아님)
-- ============================================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('submit_sinsupang_score', 'list_sinsupang_ranking');
  if v_count <> 2 then
    raise exception '신수팡 랭킹 함수가 %개입니다(2개여야 합니다). 이 파일을 처음부터 다시 실행해 주세요.', v_count;
  end if;
end $$;


-- ============================================================================
-- ⑤ 함수 실행 권한 — 앱(anon 키)이 부를 수 있게
-- ============================================================================
revoke all on function public.submit_sinsupang_score(text, integer, integer) from public;
grant execute on function public.submit_sinsupang_score(text, integer, integer) to anon, authenticated;

revoke all on function public.list_sinsupang_ranking(text, integer) from public;
grant execute on function public.list_sinsupang_ranking(text, integer) to anon, authenticated;


-- ============================================================================
-- ⑥ 확인 — 임시 문파원 셋으로 실제로 넣어 보고, 마지막에 전부 되돌립니다
--     (이미 기록이 있는 문파에서도 돌 수 있도록 순위는 그때그때 표에서 셈해 비교합니다)
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
  v_expect  int;
  v_pos_a   int := -1;
  v_pos_m   int := -1;
  v_pos_o   int := -1;
  v_i       int := 0;
  v_prev    int := 0;
  v_rank    int;
begin
  if has_function_privilege('anon', 'public.submit_sinsupang_score(text,integer,integer)', 'execute') = false
     or has_function_privilege('anon', 'public.list_sinsupang_ranking(text,integer)', 'execute') = false then
    raise exception 'anon 이 신수팡 랭킹 함수를 부를 수 없습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('신수검증' || substr(md5(random()::text), 1, 4), 'sp-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('신수친구' || substr(md5(random()::text), 1, 4), 'sp-verify', 'member')
    returning * into v_mem;
    insert into private.members (nickname, pin_hash, member_role)
    values ('신수손님' || substr(md5(random()::text), 1, 4), 'sp-verify', 'member')
    returning * into v_other;

    v_t_admin := 'spverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'spverify' || md5(random()::text) || md5(random()::text);
    v_t_other := 'spverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id, private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_mem.id,   private.token_hash(v_t_mem),   now() + interval '10 minutes'),
           (v_other.id, private.token_hash(v_t_other), now() + interval '10 minutes');

    -- ① 첫 기록 — 새 최고
    v_json := public.submit_sinsupang_score(v_t_admin, 1200, 4);
    if (v_json->>'ok')::boolean is not true
       or (v_json->>'is_new_best')::boolean is not true
       or (v_json->>'best_score')::int <> 1200
       or (v_json->>'best_combo')::int <> 4 then
      raise exception '첫 기록이 최고 기록으로 남지 않았습니다: %', v_json;
    end if;

    -- ② 낮은 점수 — 최고 기록은 그대로, is_new_best = false
    v_json := public.submit_sinsupang_score(v_t_admin, 900, 2);
    if (v_json->>'is_new_best')::boolean is not false
       or (v_json->>'best_score')::int <> 1200
       or (v_json->>'best_combo')::int <> 4 then
      raise exception '낮은 점수가 최고 기록을 덮었습니다: %', v_json;
    end if;

    -- ③ 높은 점수 — 갱신 · 순위는 표에서 직접 셈해 비교
    v_json := public.submit_sinsupang_score(v_t_admin, 3000, 7);
    if (v_json->>'is_new_best')::boolean is not true
       or (v_json->>'best_score')::int <> 3000
       or (v_json->>'best_combo')::int <> 7 then
      raise exception '높은 점수가 갱신되지 않았습니다: %', v_json;
    end if;
    select count(*) + 1 into v_expect
      from private.sinsupang_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 3000;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;

    -- ④ 콤보만 높은 기록 — 점수는 그대로, 콤보만 올라갑니다
    v_json := public.submit_sinsupang_score(v_t_admin, 3000, 12);
    if (v_json->>'best_combo')::int <> 12 or (v_json->>'best_score')::int <> 3000 then
      raise exception '콤보만 올린 기록이 반영되지 않았습니다: %', v_json;
    end if;

    -- ⑤ 다른 문파원의 기록과 순위
    v_json := public.submit_sinsupang_score(v_t_mem, 5000, 15);
    select count(*) + 1 into v_expect
      from private.sinsupang_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 5000;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '5000점의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;
    v_json := public.submit_sinsupang_score(v_t_other, 100, 1);
    select count(*) + 1 into v_expect
      from private.sinsupang_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 100;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '100점의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;

    -- ⑥ 랭킹 목록 — 점수 높은 순 · 필요한 칸이 모두 있다
    v_rows := public.list_sinsupang_ranking(v_t_admin, 50);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 3 then
      raise exception '랭킹 목록이 비었습니다: %', v_rows;
    end if;
    for v_i in 0 .. jsonb_array_length(v_rows) - 1 loop
      v_rank := (v_rows->v_i->>'rank')::int;
      if v_rank < v_prev then
        raise exception '랭킹 순서가 뒤섞였습니다: %', v_rows;
      end if;
      v_prev := v_rank;
      if (v_rows->v_i->>'nickname') = v_admin.nickname then v_pos_a := v_i; end if;
      if (v_rows->v_i->>'nickname') = v_mem.nickname   then v_pos_m := v_i; end if;
      if (v_rows->v_i->>'nickname') = v_other.nickname then v_pos_o := v_i; end if;
    end loop;
    if v_pos_a < 0 or v_pos_m < 0 or v_pos_o < 0 then
      raise exception '랭킹 목록에서 확인용 문파원을 찾지 못했습니다: %', v_rows;
    end if;
    if not (v_pos_m < v_pos_a and v_pos_a < v_pos_o) then
      raise exception '점수 순서가 틀렸습니다(5000 → 3000 → 100): % / % / %', v_pos_m, v_pos_a, v_pos_o;
    end if;
    if (v_rows->v_pos_m->>'best_score')::int <> 5000
       or (v_rows->v_pos_m->>'best_combo')::int <> 15
       or (v_rows->v_pos_a->>'best_score')::int <> 3000
       or (v_rows->v_pos_a->>'best_combo')::int <> 12 then
      raise exception '랭킹에 적힌 점수·콤보가 다릅니다: %', v_rows;
    end if;
    if (v_rows->0) ? 'member_id' is not true or (v_rows->0) ? 'role' is not true
       or (v_rows->0) ? 'avatar' is not true or (v_rows->0) ? 'updated_at' is not true then
      raise exception '랭킹 응답에 필요한 칸이 없습니다: %', v_rows->0;
    end if;

    -- ⑦ 잘못된 점수·콤보는 22023
    begin
      perform public.submit_sinsupang_score(v_t_admin, -1, 3);
      raise exception '음수 점수가 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.submit_sinsupang_score(v_t_admin, 10, 1000);
      raise exception '콤보 1000 이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑧ 로그인 없이 부르면 28000
    begin
      perform public.list_sinsupang_ranking('spverifybadtokenspverifybad', 20);
      raise exception '없는 토큰이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑨ 강퇴된 문파원은 랭킹에서 빠집니다
    update private.members set status = 'kicked' where id = v_other.id;
    v_rows := public.list_sinsupang_ranking(v_t_admin, 50);
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e->>'nickname') = v_other.nickname) then
      raise exception '강퇴된 문파원이 랭킹에 남았습니다: %', v_rows;
    end if;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '신수팡 랭킹 확인 — 첫 기록 · 최고 기록만 갱신 · 순위 · 랭킹 목록 · 잘못된 값 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '연못 마이그레이션 완료 — 🐾 신수팡 문파 랭킹을 쓸 수 있습니다.';
end $$;
