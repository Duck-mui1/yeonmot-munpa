-- ============================================================================
--  연못 (Yeonmot Munpa) · '🦆 연못 생존기 문파 랭킹' 마이그레이션
--    (파일 이름: supabase/migration-survival.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text/edit-posts/clan-contents/
--        gyeongdan/dosul/sinsupang/sinsumoa/guest-links 로 설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 더해지나 ① 🦆 연못 생존기 문파 랭킹
--     · private.survival_scores 표
--         member_id  uuid   (문파원 한 명에 한 줄 · 기본 키)
--         best_score int    (가장 오래 버틴 시간 · **센티초 정수** — 4285 = 42.85초)
--         updated_at timestamptz (최고 기록을 마지막으로 올린 때)
--     · public.submit_survival_score(p_token, p_score)
--         로그인한 문파원의 최고 기록일 때만 갱신하고
--         { ok, best_score, is_new_best, rank } 를 돌려줍니다.
--     · public.list_survival_ranking(p_token, p_limit = 20)
--         랭킹 목록 { rank, member_id, nickname, role, avatar, best_score, updated_at }
--         (오래 버틴 순 · 같으면 먼저 올린 사람이 위 · 활성 문파원만 · 최대 50명)
--
--  ■ 무엇이 더해지나 ② 외부 체험 링크의 네 번째 게임 (체험 링크를 이미 쓰는 DB 라면)
--     · private.guest_game_links.game · private.guest_game_scores.game 이 허용하는 게임에
--       'survival'(연못 생존기)을 더합니다. (이미 만든 링크·게스트 기록은 그대로)
--     · create_guest_game_link · submit_guest_game_score · list_guest_game_ranking 을
--       'survival' 을 아는 판으로 다시 만듭니다. (동작·권한·거절 규칙은 v46 과 같습니다)
--     · 체험 링크 표가 아직 없는 DB(마이그레이션 전)에서는 **이 부분만 건너뛰고 안내를 띄웁니다.**
--       연못 생존기 랭킹은 그대로 설치되며, 체험 링크를 쓰려면 supabase/migration-guest-links.sql 을
--       먼저(또는 이 파일 뒤에) 실행하면 됩니다.
--
--  ■ 게임은 마이그레이션 전에도 그대로 돕니다
--     앱은 함수가 없으면(PGRST202) 이 기기(localStorage)의 최고 기록으로 계속 플레이하고,
--     랭킹 탭에만 '아직 준비되지 않았어요' 안내를 보여 줍니다.
--
--  ■ 안전한가
--     · 멱등: create table if not exists · create or replace · 권한 재부여
--     · 문파원 PIN·세션·다른 게임 기록은 건드리지 않습니다(표 하나를 더하고, 체험 링크의
--       게임 이름 목록에 한 가지를 더할 뿐입니다).
--     · 확인 블록이 임시 문파원·세션·체험 링크를 만들어 실제로 넣고·비교하고·거절되는지 본 뒤
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
-- ① private.survival_scores — 한 사람당 한 줄, 최고 기록만
--     (best_score 는 **센티초** — 4285 = 42.85초)
-- ============================================================================
create table if not exists private.survival_scores (
  member_id  uuid primary key references private.members (id) on delete cascade,
  best_score integer not null default 0
               constraint survival_scores_score_range check (best_score between 0 and 100000000),
  updated_at timestamptz not null default now()
);

comment on table private.survival_scores is '연못 생존기 문파 랭킹 — 문파원마다 최고 기록 한 줄. 랭킹 RPC 로만 읽고 씁니다.';
comment on column private.survival_scores.best_score is '가장 오래 버틴 시간(센티초) — 4285 = 42.85초.';

create index if not exists survival_scores_best_idx
  on private.survival_scores (best_score desc, updated_at asc);

alter table private.survival_scores enable row level security;
revoke all on table private.survival_scores from public, anon, authenticated;


-- ============================================================================
-- ② 점수 올리기 — 최고 기록일 때만 갱신
-- ============================================================================
create or replace function public.submit_survival_score(
  p_token text,
  p_score integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_prev  private.survival_scores;
  v_best  integer;
  v_new   boolean := false;
  v_rank  integer;
begin
  if p_score is null or p_score < 0 or p_score > 100000000 then
    raise exception '생존 시간이 올바르지 않아요.' using errcode = '22023';
  end if;

  select * into v_prev
    from private.survival_scores s
   where s.member_id = v_actor.member_id;

  if not found then
    v_best := p_score;
    v_new  := p_score > 0;
    insert into private.survival_scores (member_id, best_score)
    values (v_actor.member_id, v_best);
  else
    v_best := greatest(v_prev.best_score, p_score);
    v_new  := p_score > v_prev.best_score;
    if v_best <> v_prev.best_score then
      update private.survival_scores
         set best_score = v_best,
             updated_at = now()
       where member_id = v_actor.member_id;
    end if;
  end if;

  select count(*) + 1
    into v_rank
    from private.survival_scores s
    join private.members m on m.id = s.member_id
   where m.status = 'active'
     and s.best_score > v_best;

  return jsonb_build_object(
    'ok', true,
    'best_score', v_best,
    'is_new_best', v_new,
    'rank', v_rank
  );
end;
$fn$;

comment on function public.submit_survival_score(text, integer) is
  '연못 생존기 점수 제출(센티초) — 로그인한 문파원의 최고 기록만 갱신하고 { ok, best_score, is_new_best, rank } 를 돌려줍니다.';


-- ============================================================================
-- ③ 문파 랭킹 — 오래 버틴 순
-- ============================================================================
create or replace function public.list_survival_ranking(
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
                 s.updated_at,
                 rank() over (order by s.best_score desc, s.updated_at asc) as rank_no
            from private.survival_scores s
            join private.members m on m.id = s.member_id
           where m.status = 'active'
        ) r
       order by r.rank_no, r.nickname
       limit v_limit
    ) s;

  return v_result;
end;
$fn$;

comment on function public.list_survival_ranking(text, integer) is
  '연못 생존기 문파 랭킹 — 오래 버틴 순(같으면 먼저 올린 사람이 위). 활성 문파원만, 최대 50명.';


-- ============================================================================
-- ④ 외부 체험 링크 — 게임 목록에 'survival'(연못 생존기) 더하기
--     · 표의 check 제약을 새 목록으로 다시 겁니다(이미 있는 행은 그대로 통과).
--     · 체험 링크를 아직 설치하지 않은 DB 면 이 부분만 건너뜁니다(연못 생존기 랭킹은 그대로 설치).
-- ============================================================================
do $guest$
begin
  if to_regclass('private.guest_game_links') is null
     or to_regclass('private.guest_game_scores') is null then
    raise notice '외부 체험 링크 표가 아직 없어 [체험 링크의 네 번째 게임] 부분을 건너뜁니다. 연못 생존기 랭킹은 설치되었습니다. 체험 링크까지 쓰려면 supabase/migration-guest-links.sql 을 실행한 뒤 이 파일을 한 번 더 실행해 주세요.';
    return;
  end if;

  execute $ddl$
alter table private.guest_game_links
  drop constraint if exists guest_game_links_game_kind;
alter table private.guest_game_links
  add constraint guest_game_links_game_kind
  check (game in ('all', 'gyeongdan', 'sinsupang', 'sinsumoa', 'survival'));

alter table private.guest_game_scores
  drop constraint if exists guest_game_scores_game_kind;
alter table private.guest_game_scores
  add constraint guest_game_scores_game_kind
  check (game in ('gyeongdan', 'sinsupang', 'sinsumoa', 'survival'));

comment on column private.guest_game_links.game is
  'all = 네 게임 모두 · gyeongdan = 경단만들기 · sinsupang = 신수팡 · sinsumoa = 신수모아 · survival = 연못 생존기.';

comment on column private.guest_game_scores.meta is
  '곁들임 값 — 경단만들기는 { tier }, 신수팡·신수모아는 { combo }, 연못 생존기는 쓰지 않습니다. 2KB 를 넘지 않습니다.';


-- ============================================================================
-- ⑤ 체험 링크 만들기 — 'survival' 을 아는 판 (권한·기간 규칙은 v46 과 같습니다)
-- ============================================================================
create or replace function public.create_guest_game_link(
  p_session text,
  p_game    text,
  p_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_session);
  v_game    text := lower(btrim(coalesce(p_game, '')));
  v_minutes integer := coalesce(p_minutes, 0);
  v_link    private.guest_game_links;
  v_token   text;
  v_try     integer := 0;
begin
  if v_actor.member_role not in ('admin', 'officer') then
    raise exception '문주·운영진만 체험 링크를 만들 수 있어요.' using errcode = '42501';
  end if;

  if v_game not in ('all', 'gyeongdan', 'sinsupang', 'sinsumoa', 'survival') then
    raise exception '게임을 골라 주세요. (all · gyeongdan · sinsupang · sinsumoa · survival)' using errcode = '22023';
  end if;

  if v_minutes < 1 or v_minutes > 10080 then
    raise exception '기간은 1분에서 10080분(7일) 사이로 정해 주세요.' using errcode = '22023';
  end if;

  loop
    v_try := v_try + 1;
    v_token := private.guest_link_token();
    begin
      insert into private.guest_game_links (token, game, expires_at, created_by, created_at)
      values (v_token, v_game, now() + make_interval(mins => v_minutes), v_actor.member_id,
              clock_timestamp())
      returning * into v_link;
      exit;
    exception when unique_violation then
      if v_try >= 5 then
        raise exception '체험 링크 주소를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.' using errcode = '22023';
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'id', v_link.id,
    'token', v_link.token,
    'game', v_link.game,
    'expires_at', v_link.expires_at,
    'minutes', v_minutes
  );
end;
$fn$;

-- ============================================================================
-- ⑥ 게스트 점수 올리기 — 'survival' 을 아는 판
-- ============================================================================
create or replace function public.submit_guest_game_score(
  p_token    text,
  p_game     text,
  p_nickname text,
  p_score    integer,
  p_meta     jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_link  private.guest_game_links;
  v_game  text := lower(btrim(coalesce(p_game, '')));
  v_nick  text := regexp_replace(btrim(coalesce(p_nickname, '')), '[[:cntrl:]]', '', 'g');
  v_meta  jsonb := coalesce(p_meta, '{}'::jsonb);
  v_prev  private.guest_game_scores;
  v_best  integer;
  v_new   boolean := false;
  v_rank  integer;
begin
  v_link := private.guest_link_for_score(p_token);

  if v_game not in ('gyeongdan', 'sinsupang', 'sinsumoa', 'survival') then
    raise exception '게임 이름이 올바르지 않아요.' using errcode = '22023';
  end if;

  if v_link.game <> 'all' and v_link.game <> v_game then
    raise exception '이 체험 링크로는 그 게임을 할 수 없어요.' using errcode = '42501';
  end if;

  if char_length(v_nick) < 1 or char_length(v_nick) > 12 then
    raise exception '이름은 1~12자로 적어 주세요.' using errcode = '22023';
  end if;

  if p_score is null or p_score < 0 or p_score > 100000000 then
    raise exception '점수가 올바르지 않아요.' using errcode = '22023';
  end if;

  if jsonb_typeof(v_meta) <> 'object' or octet_length(v_meta::text) > 2000 then
    raise exception '기록에 담을 값이 올바르지 않아요.' using errcode = '22023';
  end if;

  select * into v_prev
    from private.guest_game_scores s
   where s.game = v_game
     and lower(s.nickname) = lower(v_nick);

  if not found then
    v_best := p_score;
    v_new  := p_score > 0;
    insert into private.guest_game_scores (game, nickname, score, meta)
    values (v_game, v_nick, v_best, v_meta);
  else
    v_best := greatest(v_prev.score, p_score);
    v_new  := p_score > v_prev.score;
    if v_new then
      update private.guest_game_scores
         set score = v_best,
             meta = v_meta,
             created_at = clock_timestamp()
       where id = v_prev.id;
    end if;
  end if;

  select count(*) + 1
    into v_rank
    from private.guest_game_scores s
   where s.game = v_game
     and s.score > v_best;

  /* 게스트 판이 끝없이 불어나지 않도록 — 한 게임 300줄까지만 남깁니다
     (아주 낮은 점수의 옛 기록부터 정리, 문파 랭킹과는 무관) */
  delete from private.guest_game_scores d
   where d.game = v_game
     and d.id not in (
       select t.id from private.guest_game_scores t
        where t.game = v_game
        order by t.score desc, t.created_at asc
        limit 300
     );

  return jsonb_build_object(
    'ok', true,
    'nickname', v_nick,
    'score', v_best,
    'best_score', v_best,
    'is_new_best', v_new,
    'rank', v_rank
  );
end;
$fn$;

-- ============================================================================
-- ⑦ 게스트 랭킹 — 'survival' 을 아는 판
-- ============================================================================
create or replace function public.list_guest_game_ranking(
  p_token text,
  p_game  text,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_link   private.guest_game_links;
  v_game   text := lower(btrim(coalesce(p_game, '')));
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_result jsonb;
begin
  v_link := private.guest_link_for_score(p_token);

  if v_game not in ('gyeongdan', 'sinsupang', 'sinsumoa', 'survival') then
    raise exception '게임 이름이 올바르지 않아요.' using errcode = '22023';
  end if;

  if v_link.game <> 'all' and v_link.game <> v_game then
    raise exception '이 체험 링크로는 그 게임을 할 수 없어요.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(t.item order by t.rank_no, t.nickname), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'rank', s.rank_no,
               'nickname', s.nickname,
               'score', s.score,
               'meta', s.meta,
               'created_at', s.created_at
             ) as item,
             s.rank_no,
             s.nickname
        from (
          select g.nickname,
                 g.score,
                 g.meta,
                 g.created_at,
                 rank() over (order by g.score desc, g.created_at asc) as rank_no
            from private.guest_game_scores g
           where g.game = v_game
        ) s
       where s.rank_no <= v_limit
       order by s.rank_no, s.nickname
    ) t;

  return coalesce(v_result, '[]'::jsonb);
end;
$fn$;
  $ddl$;

  raise notice '외부 체험 링크 — 게임 목록에 survival(연못 생존기)을 더했습니다.';
end $guest$;


-- ============================================================================
-- ⑧ 함수는 이름마다 하나씩 (PostgREST 가 고르지 못하는 상태가 아님)
-- ============================================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('submit_survival_score', 'list_survival_ranking');
  if v_count <> 2 then
    raise exception '연못 생존기 랭킹 함수가 %개입니다(2개여야 합니다). 이 파일을 처음부터 다시 실행해 주세요.', v_count;
  end if;
end $$;


-- ============================================================================
-- ⑨ 함수 실행 권한 — 앱(anon 키)이 부를 수 있게
-- ============================================================================
revoke all on function public.submit_survival_score(text, integer) from public;
grant execute on function public.submit_survival_score(text, integer) to anon, authenticated;

revoke all on function public.list_survival_ranking(text, integer) from public;
grant execute on function public.list_survival_ranking(text, integer) to anon, authenticated;

/* 체험 링크 함수를 다시 만들었으므로 권한도 다시 겁니다 (표가 없는 DB 면 함수도 없으니 건너뜁니다) */
do $grant$
begin
  if to_regprocedure('public.create_guest_game_link(text,text,integer)') is null then
    return;
  end if;
  execute 'revoke all on function public.create_guest_game_link(text, text, integer) from public';
  execute 'grant execute on function public.create_guest_game_link(text, text, integer) to anon, authenticated';
  execute 'revoke all on function public.submit_guest_game_score(text, text, text, integer, jsonb) from public';
  execute 'grant execute on function public.submit_guest_game_score(text, text, text, integer, jsonb) to anon, authenticated';
  execute 'revoke all on function public.list_guest_game_ranking(text, text, integer) from public';
  execute 'grant execute on function public.list_guest_game_ranking(text, text, integer) to anon, authenticated';
end $grant$;


-- ============================================================================
-- ⑩ 확인 — 임시 문파원 셋과 체험 링크로 실제로 넣어 보고, 마지막에 전부 되돌립니다
--     (이미 기록이 있는 문파에서도 돌 수 있도록 순위는 그때그때 표에서 셈해 비교합니다)
-- ============================================================================
do $$
declare
  v_admin   private.members;
  v_mem     private.members;
  v_other   private.members;
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
  v_link    jsonb;
  v_token   text;
  v_sv_nick text;
begin
  if has_function_privilege('anon', 'public.submit_survival_score(text,integer)', 'execute') = false
     or has_function_privilege('anon', 'public.list_survival_ranking(text,integer)', 'execute') = false then
    raise exception 'anon 이 연못 생존기 랭킹 함수를 부를 수 없습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('생존검증' || substr(md5(random()::text), 1, 4), 'sv-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('생존친구' || substr(md5(random()::text), 1, 4), 'sv-verify', 'member')
    returning * into v_mem;
    insert into private.members (nickname, pin_hash, member_role)
    values ('생존손님' || substr(md5(random()::text), 1, 4), 'sv-verify', 'member')
    returning * into v_other;

    v_t_admin := 'svverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'svverify' || md5(random()::text) || md5(random()::text);
    v_t_other := 'svverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id, private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_mem.id,   private.token_hash(v_t_mem),   now() + interval '10 minutes'),
           (v_other.id, private.token_hash(v_t_other), now() + interval '10 minutes');

    -- ① 첫 기록(4285 = 42.85초) — 새 최고
    v_json := public.submit_survival_score(v_t_admin, 4285);
    if (v_json->>'ok')::boolean is not true
       or (v_json->>'is_new_best')::boolean is not true
       or (v_json->>'best_score')::int <> 4285 then
      raise exception '첫 기록이 최고 기록으로 남지 않았습니다: %', v_json;
    end if;

    -- ② 짧은 기록 — 최고는 그대로, is_new_best = false
    v_json := public.submit_survival_score(v_t_admin, 901);
    if (v_json->>'is_new_best')::boolean is not false
       or (v_json->>'best_score')::int <> 4285 then
      raise exception '짧은 기록이 최고 기록을 덮었습니다: %', v_json;
    end if;

    -- ③ 긴 기록 — 갱신 · 순위는 표에서 직접 셈해 비교
    v_json := public.submit_survival_score(v_t_admin, 7310);
    if (v_json->>'is_new_best')::boolean is not true
       or (v_json->>'best_score')::int <> 7310 then
      raise exception '긴 기록이 갱신되지 않았습니다: %', v_json;
    end if;
    select count(*) + 1 into v_expect
      from private.survival_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 7310;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;

    -- ④ 다른 문파원의 기록과 순위
    v_json := public.submit_survival_score(v_t_mem, 12050);
    select count(*) + 1 into v_expect
      from private.survival_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 12050;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '12050 의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;
    v_json := public.submit_survival_score(v_t_other, 350);
    select count(*) + 1 into v_expect
      from private.survival_scores s
      join private.members m on m.id = s.member_id
     where m.status = 'active' and s.best_score > 350;
    if (v_json->>'rank')::int <> v_expect then
      raise exception '350 의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_expect, v_json;
    end if;

    -- ⑤ 랭킹 목록 — 오래 버틴 순 · 필요한 칸이 모두 있다
    v_rows := public.list_survival_ranking(v_t_admin, 50);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 3 then
      raise exception '랭킹 목록이 비었습니다: %', v_rows;
    end if;
    for v_i in 0 .. jsonb_array_length(v_rows) - 1 loop
      if (v_rows->v_i->>'rank')::int < v_prev then
        raise exception '랭킹 순서가 뒤섞였습니다: %', v_rows;
      end if;
      v_prev := (v_rows->v_i->>'rank')::int;
      if (v_rows->v_i->>'nickname') = v_admin.nickname then v_pos_a := v_i; end if;
      if (v_rows->v_i->>'nickname') = v_mem.nickname   then v_pos_m := v_i; end if;
      if (v_rows->v_i->>'nickname') = v_other.nickname then v_pos_o := v_i; end if;
    end loop;
    if v_pos_a < 0 or v_pos_m < 0 or v_pos_o < 0 then
      raise exception '랭킹 목록에서 확인용 문파원을 찾지 못했습니다: %', v_rows;
    end if;
    if not (v_pos_m < v_pos_a and v_pos_a < v_pos_o) then
      raise exception '기록 순서가 틀렸습니다(12050 → 7310 → 350): % / % / %', v_pos_m, v_pos_a, v_pos_o;
    end if;
    if (v_rows->v_pos_m->>'best_score')::int <> 12050
       or (v_rows->v_pos_a->>'best_score')::int <> 7310 then
      raise exception '랭킹에 적힌 기록이 다릅니다: %', v_rows;
    end if;
    if (v_rows->0) ? 'member_id' is not true or (v_rows->0) ? 'role' is not true
       or (v_rows->0) ? 'avatar' is not true or (v_rows->0) ? 'updated_at' is not true then
      raise exception '랭킹 응답에 필요한 칸이 없습니다: %', v_rows->0;
    end if;

    -- ⑥ 잘못된 값은 22023
    begin
      perform public.submit_survival_score(v_t_admin, -1);
      raise exception '음수 기록이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.submit_survival_score(v_t_admin, 100000001);
      raise exception '너무 큰 기록이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑦ 로그인 없이 부르면 28000
    begin
      perform public.list_survival_ranking('svverifybadtokensvverifybad', 20);
      raise exception '없는 토큰이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑧ 강퇴된 문파원은 랭킹에서 빠집니다
    update private.members set status = 'kicked' where id = v_other.id;
    v_rows := public.list_survival_ranking(v_t_admin, 50);
    if exists (select 1 from jsonb_array_elements(v_rows) e where (e->>'nickname') = v_other.nickname) then
      raise exception '강퇴된 문파원이 랭킹에 남았습니다: %', v_rows;
    end if;

    -- ⑨~⑫ 체험 링크 — 표가 없는 DB(마이그레이션 전)라면 이 부분만 건너뜁니다
    if to_regclass('private.guest_game_links') is null then
      raise notice '연못 생존기 확인 — 체험 링크 표가 없어 [체험 링크 확인] 부분은 건너뜁니다.';
      raise exception 'rollback-check';
    end if;

    -- ⑨ 체험 링크 — '연못 생존기' 하나만 열린 링크로 게스트 기록이 쌓입니다
    v_link := public.create_guest_game_link(v_t_admin, 'survival', 30);
    if v_link->>'game' <> 'survival' then
      raise exception '연못 생존기 체험 링크가 만들어지지 않았습니다: %', v_link;
    end if;
    if public.verify_guest_game_link(v_link->>'token')->>'game' <> 'survival' then
      raise exception '연못 생존기 체험 링크가 확인되지 않습니다: %', v_link;
    end if;
    v_token := v_link->>'token';
    v_sv_nick := '살아남기' || substr(md5(random()::text), 1, 3);

    v_json := public.submit_guest_game_score(v_token, 'survival', v_sv_nick, 5120, '{}'::jsonb);
    if (v_json->>'ok')::boolean is not true or (v_json->>'best_score')::int <> 5120 then
      raise exception '게스트 생존 기록이 쌓이지 않았습니다: %', v_json;
    end if;
    v_json := public.submit_guest_game_score(v_token, 'survival', v_sv_nick, 2100, '{}'::jsonb);
    if (v_json->>'best_score')::int <> 5120 or (v_json->>'is_new_best')::boolean is not false then
      raise exception '짧은 게스트 기록이 최고 기록을 덮었습니다: %', v_json;
    end if;
    /* 이미 다른 게스트 기록이 쌓인 DB 에서도 돌 수 있도록 '내 이름의 기록'을 찾아 비교합니다 */
    if not exists (
      select 1 from jsonb_array_elements(public.list_guest_game_ranking(v_token, 'survival')) e
       where (e->>'nickname') = v_sv_nick and (e->>'score')::int = 5120
    ) then
      raise exception '게스트 생존 랭킹에 확인용 기록이 없습니다: %',
        public.list_guest_game_ranking(v_token, 'survival');
    end if;

    -- ⑩ 연못 생존기만 연 링크로는 다른 게임을 할 수 없습니다(42501)
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', '몰래손님', 100, '{}'::jsonb);
      raise exception '연못 생존기 링크로 다른 게임이 통과되었습니다.';
    exception when sqlstate '42501' then null;
    end;
    -- ⑪ 게임 이름이 목록에 없는 값이면 22023
    begin
      perform public.list_guest_game_ranking(v_token, 'racing');
      raise exception '없는 게임 이름이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    -- ⑫ 전체 4종 링크로도 연못 생존기를 할 수 있습니다
    v_link := public.create_guest_game_link(v_t_admin, 'all', 10);
    v_json := public.submit_guest_game_score(v_link->>'token', 'survival', v_sv_nick, 9990, '{}'::jsonb);
    if v_json->>'ok' is null or (v_json->>'best_score')::int <> 9990 then
      raise exception '전체 링크로 게스트 생존 기록이 쌓이지 않았습니다: %', v_json;
    end if;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '연못 생존기 확인 — 첫 기록 · 최고 기록만 갱신 · 순위 · 랭킹 목록 · 잘못된 값 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  if to_regclass('private.guest_game_links') is not null then
    raise notice '외부 체험 링크 확인 — survival 링크 발급·확인·게스트 기록·다른 게임 거절·전체 링크가 모두 정상입니다.';
  end if;
  raise notice '연못 마이그레이션 완료 — 🦆 연못 생존기 문파 랭킹을 쓸 수 있습니다.';
end $$;
