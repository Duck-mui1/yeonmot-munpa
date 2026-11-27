-- ============================================================================
--  연못 (Yeonmot Munpa) · '🔗 기간제한 외부 체험 링크 + 게스트 전용 랭킹' 마이그레이션
--    (파일 이름: supabase/migration-guest-links.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text/edit-posts/clan-contents/
--        gyeongdan/dosul/sinsupang/sinsumoa 로 설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 더해지나 ① 기간제한 체험 링크
--     · private.guest_game_links 표
--         id         uuid
--         token      text  (URL 에 넣는 무작위 문자열 · 난수 UUID 122비트 → 32자)
--         game       'all' | 'gyeongdan' | 'sinsupang' | 'sinsumoa'
--         expires_at timestamptz  (이때부터 못 씁니다)
--         revoked    boolean default false  (운영진이 '만료시키기'를 누르면 true)
--         created_by uuid   (만든 문주·운영진 — 응답에는 나가지 않습니다)
--         created_at timestamptz default now()
--     · public.verify_guest_game_link(p_token text)          — 로그인 없이(anon) 부를 수 있음
--         유효하면 { valid:true, game, expires_at, remaining_seconds }
--         아니면   { valid:false, reason } — reason 은 'expired' | 'revoked' | 'invalid'
--         * 문파 데이터(문파 이름·문파원·랭킹·초대 코드)는 하나도 돌려주지 않습니다.
--     · public.create_guest_game_link(p_session text, p_game text, p_minutes integer)
--         문주·운영진만 · 기간 1분 ~ 10080분(7일) · { ok, id, token, game, expires_at, minutes }
--     · public.list_guest_game_links(p_session text, p_limit integer default 20)
--         문주·운영진만 · 최근 발급 목록(새것부터)
--     · public.revoke_guest_game_link(p_session text, p_id uuid)
--         문주·운영진만 · 그 링크를 지금부터 못 쓰게(revoked = true)
--
--  ■ 무엇이 더해지나 ② 게스트 전용 랭킹판 (문파 랭킹과 완전히 따로)
--     · private.guest_game_scores 표
--         id, game('gyeongdan'|'sinsupang'|'sinsumoa'), nickname(1~12자), score,
--         meta jsonb(경단 단계·콤보 같은 곁들임), created_at
--         * 한 게임에서 같은 닉네임은 한 줄 — 최고 점수만 남습니다(대소문자 무시).
--         * 문파 랭킹 표(gyeongdan_scores·sinsupang_scores·sinsumoa_scores)와 섞이지 않습니다.
--           문파원 정보(member_id·아바타·직위)는 이 표에 아예 들어가지 않습니다.
--     · public.submit_guest_game_score(p_token text, p_game text, p_nickname text,
--                                      p_score integer, p_meta jsonb default '{}'::jsonb)
--         유효한(미만료·미회수) 체험 링크의 토큰일 때만, 그 링크가 허용한 게임일 때만 저장
--         → { ok, nickname, score, best_score, is_new_best, rank }
--     · public.list_guest_game_ranking(p_token text, p_game text, p_limit integer default 20)
--         유효한 체험 링크의 토큰일 때만 게스트 랭킹 상위 목록
--         → [ { rank, nickname, score, meta, created_at } ]  (문파원 정보 없음)
--
--  ■ 안전한가
--     · 표는 private 스키마 + RLS 켜고 정책 없음 + anon/authenticated 권한 회수
--       → 앱의 공개 키로 표를 직접 읽거나 쓸 수 없습니다. RPC 로만 동작합니다.
--     · verify·submit·ranking 은 로그인 없이 부를 수 있지만, 유효한 토큰이 없으면 아무것도
--       돌려주지 않고 거절합니다(28000).
--     · 토큰은 난수 UUID(122비트)에서 하이픈을 뺀 32자라 짐작해서 맞힐 수 없습니다.
--     · 멱등: create table if not exists · create or replace · 권한 재부여
--     · 확인 블록이 임시 문주·운영진·문파원과 세션을 만들어 실제로 발급·검증·만료·회수·거절과
--       게스트 점수 등록·조회·문파 랭킹 분리를 해 본 뒤 마지막에 전부 되돌립니다.
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
-- ① private.guest_game_links — 발급된 체험 링크 한 줄에 하나
-- ============================================================================
create table if not exists private.guest_game_links (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique
               constraint guest_game_links_token_shape
               check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  game       text not null default 'all'
               constraint guest_game_links_game_kind
               check (game in ('all', 'gyeongdan', 'sinsupang', 'sinsumoa')),
  expires_at timestamptz not null,
  revoked    boolean not null default false,
  created_by uuid references private.members (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table private.guest_game_links is
  '기간제한 외부 체험 링크 — 문파원이 아닌 사람에게 미니게임만 열어 주는 주소(?guest=TOKEN). RPC 로만 읽고 씁니다.';
comment on column private.guest_game_links.token is
  'URL 에 들어가는 무작위 문자열(난수 UUID 122비트 → 32자). 이 값만으로는 문파 자료에 닿을 수 없습니다.';
comment on column private.guest_game_links.game is
  'all = 세 게임 모두 · gyeongdan = 경단만들기 · sinsupang = 신수팡 · sinsumoa = 신수모아.';
comment on column private.guest_game_links.revoked is
  '운영진이 만료시키기를 누르면 true — 기간이 남아 있어도 바로 못 씁니다.';

create index if not exists guest_game_links_created_idx
  on private.guest_game_links (created_at desc);

alter table private.guest_game_links enable row level security;
revoke all on table private.guest_game_links from public, anon, authenticated;


-- ============================================================================
-- ② private.guest_game_scores — 게스트 전용 랭킹 (문파 랭킹과 별개)
--     · 문파원 표(members)와 이어지지 않습니다 — 닉네임 글자만 남습니다.
--     · 한 게임 · 같은 닉네임(대소문자 무시)은 한 줄. 최고 점수만 갱신됩니다.
-- ============================================================================
create table if not exists private.guest_game_scores (
  id         uuid primary key default gen_random_uuid(),
  game       text not null
               constraint guest_game_scores_game_kind
               check (game in ('gyeongdan', 'sinsupang', 'sinsumoa')),
  nickname   text not null
               constraint guest_game_scores_nickname_len
               check (char_length(btrim(nickname)) between 1 and 12)
               constraint guest_game_scores_nickname_trim
               check (nickname = btrim(nickname)),
  score      integer not null default 0
               constraint guest_game_scores_score_range
               check (score between 0 and 100000000),
  meta       jsonb not null default '{}'::jsonb
               constraint guest_game_scores_meta_size
               check (octet_length(meta::text) <= 2000),
  created_at timestamptz not null default now()
);

comment on table private.guest_game_scores is
  '게스트 전용 랭킹 — 체험 링크로 놀러 온 사람들의 게임별 최고 점수. 문파 랭킹 표와 섞이지 않습니다.';
comment on column private.guest_game_scores.meta is
  '곁들임 값 — 경단만들기는 { tier }, 신수팡·신수모아는 { combo }. 2KB 를 넘지 않습니다.';

create unique index if not exists guest_game_scores_nick_uniq
  on private.guest_game_scores (game, lower(nickname));

create index if not exists guest_game_scores_best_idx
  on private.guest_game_scores (game, score desc, created_at asc);

alter table private.guest_game_scores enable row level security;
revoke all on table private.guest_game_scores from public, anon, authenticated;


-- ============================================================================
-- ③ 토큰 만들기 — 난수 UUID 를 URL 에 안전한 글자로
--     (pgcrypto 는 extensions 스키마에 있으므로 search_path 를 지정합니다)
-- ============================================================================
--   · PostgreSQL 13+ 의 내장 난수 UUID(122비트)를 하이픈만 빼서 32자로 씁니다.
--     (pgcrypto 의 gen_random_bytes 를 쓰지 않아 설치 환경에 상관없이 동작합니다)
create or replace function private.guest_link_token()
returns text
language sql
volatile
set search_path = ''
as $fn$
  select replace(gen_random_uuid()::text, '-', '');
$fn$;

comment on function private.guest_link_token() is
  '체험 링크 토큰 — 내장 난수 UUID(122비트)에서 하이픈을 뺀 32자. URL 에 그대로 쓸 수 있습니다.';


-- ============================================================================
-- ④ 링크 확인 — 로그인 없이(anon) 부를 수 있는 함수
--     유효: { valid:true, game, expires_at, remaining_seconds }
--     무효: { valid:false, reason } → 'expired' | 'revoked' | 'invalid'
--     ※ 문파 이름·문파원·랭킹·초대 코드 등 문파 안쪽 정보는 절대 담지 않습니다.
-- ============================================================================
create or replace function public.verify_guest_game_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_link      private.guest_game_links;
  v_remaining integer;
begin
  if p_token is null or char_length(btrim(p_token)) < 16 or char_length(p_token) > 64 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select * into v_link
    from private.guest_game_links g
   where g.token = btrim(p_token);

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  if v_link.revoked then
    return jsonb_build_object('valid', false, 'reason', 'revoked');
  end if;

  v_remaining := ceil(extract(epoch from (v_link.expires_at - now())))::integer;

  if v_link.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  return jsonb_build_object(
    'valid', true,
    'game', v_link.game,
    'expires_at', v_link.expires_at,
    'remaining_seconds', greatest(v_remaining, 1)
  );
end;
$fn$;

comment on function public.verify_guest_game_link(text) is
  '체험 링크 확인 — 유효하면 { valid:true, game, expires_at, remaining_seconds }, 아니면 { valid:false, reason }. 문파 자료는 돌려주지 않습니다.';


-- ============================================================================
-- ⑤ 링크 발급 — 문주·운영진만 · 기간 1분 ~ 10080분(7일)
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

  if v_game not in ('all', 'gyeongdan', 'sinsupang', 'sinsumoa') then
    raise exception '게임을 골라 주세요. (all · gyeongdan · sinsupang · sinsumoa)' using errcode = '22023';
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

comment on function public.create_guest_game_link(text, text, integer) is
  '체험 링크 발급 — 문주·운영진만, 1~10080분. { ok, id, token, game, expires_at, minutes } 를 돌려줍니다.';


-- ============================================================================
-- ⑥ 링크 목록 — 문주·운영진만 · 최근 발급 순
-- ============================================================================
create or replace function public.list_guest_game_links(
  p_session text,
  p_limit   integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_session);
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_result jsonb;
begin
  if v_actor.member_role not in ('admin', 'officer') then
    raise exception '문주·운영진만 체험 링크를 볼 수 있어요.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(g.item order by g.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', l.id,
               'token', l.token,
               'game', l.game,
               'expires_at', l.expires_at,
               'created_at', l.created_at,
               'revoked', l.revoked,
               'active', (not l.revoked and l.expires_at > now()),
               'remaining_seconds',
                 case when not l.revoked and l.expires_at > now()
                      then ceil(extract(epoch from (l.expires_at - now())))::integer
                      else 0 end
             ) as item,
             l.created_at
        from private.guest_game_links l
       order by l.created_at desc
       limit v_limit
    ) g;

  return v_result;
end;
$fn$;

comment on function public.list_guest_game_links(text, integer) is
  '체험 링크 목록 — 문주·운영진만, 새것부터 최대 50개. active · remaining_seconds 포함.';


-- ============================================================================
-- ⑦ 링크 만료시키기 — 문주·운영진만 · 기간이 남아 있어도 바로 못 쓰게
-- ============================================================================
create or replace function public.revoke_guest_game_link(
  p_session text,
  p_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_session);
  v_link    private.guest_game_links;
  v_already boolean;
begin
  if v_actor.member_role not in ('admin', 'officer') then
    raise exception '문주·운영진만 체험 링크를 만료시킬 수 있어요.' using errcode = '42501';
  end if;

  select * into v_link
    from private.guest_game_links l
   where l.id = p_id
   for update;

  if not found then
    raise exception '체험 링크를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요.' using errcode = '22023';
  end if;

  v_already := v_link.revoked;

  if not v_already then
    update private.guest_game_links
       set revoked = true
     where id = p_id;
  end if;

  return jsonb_build_object('ok', true, 'id', p_id, 'revoked', true, 'already', v_already);
end;
$fn$;

comment on function public.revoke_guest_game_link(text, uuid) is
  '체험 링크 만료시키기 — 문주·운영진만. 기간이 남아 있어도 즉시 못 쓰게 만듭니다. { ok, id, revoked, already }.';


-- ============================================================================
-- ⑧ 체험 링크 하나를 확인하는 속마음 — 게스트 함수 셋이 함께 씁니다
--     (없거나 · 만료·회수면 28000 예외. 유효하면 그 줄을 돌려줍니다)
--
--     · 새로 접속·새로고침은 verify_guest_game_link 가 expires_at 그대로 막습니다.
--     · 이미 들어와 놀던 사람이 한 판을 마칠 수 있도록, 점수·랭킹만 만료 뒤 10분 여유를 둡니다
--       (만료된 링크를 새로 열면 여전히 만료 화면 · '만료시키기'한 링크는 여유 없이 즉시 막힘).
-- ============================================================================
create or replace function private.guest_link_for_score(p_token text)
returns private.guest_game_links
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_link private.guest_game_links;
begin
  if p_token is null or char_length(btrim(p_token)) < 16 or char_length(p_token) > 64 then
    raise exception '체험 링크를 확인하지 못했어요. 받은 주소를 다시 열어 주세요.' using errcode = '28000';
  end if;

  select * into v_link
    from private.guest_game_links g
   where g.token = btrim(p_token);

  if not found then
    raise exception '체험 링크를 확인하지 못했어요. 받은 주소를 다시 열어 주세요.' using errcode = '28000';
  end if;

  if v_link.revoked then
    raise exception '이 체험 링크는 만료되었어요. 새 링크를 받아 주세요.' using errcode = '28000';
  end if;

  if v_link.expires_at + interval '10 minutes' <= now() then
    raise exception '체험 기간이 끝났어요. 새 링크를 받아 주세요.' using errcode = '28000';
  end if;

  return v_link;
end;
$fn$;

comment on function private.guest_link_for_score(text) is
  '게스트 점수 함수 공통 확인 — 유효한 체험 링크 한 줄을 돌려주고, 아니면 28000 으로 거절합니다. 시간 만료만 10분 여유(한 판 마무리).';


-- ============================================================================
-- ⑨ 게스트 점수 올리기 — 체험 링크가 허용한 게임일 때만
--     같은 닉네임이 이미 있으면 최고 점수만 갱신(한 줄 유지)
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

  if v_game not in ('gyeongdan', 'sinsupang', 'sinsumoa') then
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

comment on function public.submit_guest_game_score(text, text, text, integer, jsonb) is
  '게스트 점수 올리기 — 유효한 체험 링크가 허용한 게임일 때만. 같은 닉네임은 최고 점수 한 줄. { ok, nickname, score, best_score, is_new_best, rank }.';


-- ============================================================================
-- ⑩ 게스트 랭킹 — 유효한 체험 링크의 토큰일 때만, 그 게임의 게스트 기록만
--     문파원 닉네임·아바타·직위는 절대 섞이지 않습니다.
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

  if v_game not in ('gyeongdan', 'sinsupang', 'sinsumoa') then
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

comment on function public.list_guest_game_ranking(text, text, integer) is
  '게스트 랭킹 — 유효한 체험 링크의 토큰만. 그 게임의 게스트 기록 상위(점수 높은 순, 같으면 먼저 올린 사람). 문파원 정보 없음.';


-- ============================================================================
-- ⑪ 함수는 이름마다 하나씩 (PostgREST 가 고르지 못하는 상태가 아님)
-- ============================================================================
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('verify_guest_game_link', 'create_guest_game_link',
                       'list_guest_game_links', 'revoke_guest_game_link',
                       'submit_guest_game_score', 'list_guest_game_ranking');
  if v_count <> 6 then
    raise exception '체험 링크 함수가 %개입니다(6개여야 합니다). 이 파일을 처음부터 다시 실행해 주세요.', v_count;
  end if;
end $$;


-- ============================================================================
-- ⑫ 함수 실행 권한
--     · verify·submit·ranking 은 로그인 없이도(anon) — 링크를 연 사람이 부릅니다.
--       함수 안에서 토큰을 다시 확인합니다.
--     · create·list·revoke 는 함수 안에서 문주·운영진인지 다시 확인합니다.
-- ============================================================================
revoke all on function public.verify_guest_game_link(text) from public;
grant execute on function public.verify_guest_game_link(text) to anon, authenticated;

revoke all on function public.create_guest_game_link(text, text, integer) from public;
grant execute on function public.create_guest_game_link(text, text, integer) to anon, authenticated;

revoke all on function public.list_guest_game_links(text, integer) from public;
grant execute on function public.list_guest_game_links(text, integer) to anon, authenticated;

revoke all on function public.revoke_guest_game_link(text, uuid) from public;
grant execute on function public.revoke_guest_game_link(text, uuid) to anon, authenticated;

revoke all on function public.submit_guest_game_score(text, text, text, integer, jsonb) from public;
grant execute on function public.submit_guest_game_score(text, text, text, integer, jsonb) to anon, authenticated;

revoke all on function public.list_guest_game_ranking(text, text, integer) from public;
grant execute on function public.list_guest_game_ranking(text, text, integer) to anon, authenticated;

revoke all on function private.guest_link_token() from public;
revoke all on function private.guest_link_for_score(text) from public;


-- ============================================================================
-- ⑬ 확인 — 임시 문주·운영진·문파원으로 실제로 해 보고, 마지막에 전부 되돌립니다
-- ============================================================================
do $$
declare
  v_admin    private.members;
  v_officer  private.members;
  v_member   private.members;
  v_t_admin  text;
  v_t_off    text;
  v_t_mem    text;
  v_json     jsonb;
  v_rows     jsonb;
  v_id       uuid;
  v_token    text;
  v_rem      int;
  v_rank     int;
  v_own      int;
  v_n1       text;
  v_n2       text;
  v_family0  bigint;
begin
  if has_function_privilege('anon', 'public.verify_guest_game_link(text)', 'execute') = false
     or has_function_privilege('anon', 'public.create_guest_game_link(text,text,integer)', 'execute') = false
     or has_function_privilege('anon', 'public.list_guest_game_links(text,integer)', 'execute') = false
     or has_function_privilege('anon', 'public.revoke_guest_game_link(text,uuid)', 'execute') = false
     or has_function_privilege('anon', 'public.submit_guest_game_score(text,text,text,integer,jsonb)', 'execute') = false
     or has_function_privilege('anon', 'public.list_guest_game_ranking(text,text,integer)', 'execute') = false then
    raise exception 'anon 이 체험 링크 함수를 부를 수 없습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('링크문주' || substr(md5(random()::text), 1, 4), 'gl-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('링크운영' || substr(md5(random()::text), 1, 4), 'gl-verify', 'officer')
    returning * into v_officer;
    insert into private.members (nickname, pin_hash, member_role)
    values ('링크친구' || substr(md5(random()::text), 1, 4), 'gl-verify', 'member')
    returning * into v_member;

    v_t_admin := 'glverify' || md5(random()::text) || md5(random()::text);
    v_t_off   := 'glverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'glverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id,   private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_officer.id, private.token_hash(v_t_off),   now() + interval '10 minutes'),
           (v_member.id,  private.token_hash(v_t_mem),   now() + interval '10 minutes');

    -- 문파 랭킹 표의 지금 줄 수 (게스트 기록이 여기에 섞이지 않는지 비교)
    select count(*) into v_family0 from private.gyeongdan_scores;

    -- ① 문주가 10분짜리 전체 게임 링크를 만든다
    v_json := public.create_guest_game_link(v_t_admin, 'all', 10);
    if (v_json->>'ok')::boolean is not true
       or v_json->>'token' is null
       or char_length(v_json->>'token') < 16
       or v_json->>'game' <> 'all' then
      raise exception '체험 링크 발급이 이상합니다: %', v_json;
    end if;
    v_id    := (v_json->>'id')::uuid;
    v_token := v_json->>'token';
    if (v_json->>'expires_at')::timestamptz < now() + interval '9 minutes' then
      raise exception '10분짜리 링크의 만료 시각이 너무 이릅니다: %', v_json;
    end if;

    -- ② 토큰 모양 — URL 에 그대로 넣을 수 있는 글자만
    if v_token !~ '^[A-Za-z0-9_-]{16,64}$' then
      raise exception '토큰 모양이 URL 에 안전하지 않습니다: %', v_token;
    end if;

    -- ③ 확인 — 유효 · 게임 종류 · 남은 시간 · 문파 정보 없음
    v_json := public.verify_guest_game_link(v_token);
    if (v_json->>'valid')::boolean is not true or v_json->>'game' <> 'all' then
      raise exception '유효한 링크가 통과하지 못했습니다: %', v_json;
    end if;
    v_rem := (v_json->>'remaining_seconds')::int;
    if v_rem is null or v_rem < 500 or v_rem > 600 then
      raise exception '남은 시간(초)이 10분 근처가 아닙니다: %', v_json;
    end if;
    if v_json ? 'id' or v_json ? 'created_by' or v_json ? 'token'
       or v_json ? 'clan' or v_json ? 'members' or v_json ? 'ranking'
       or v_json ? 'invite_code' then
      raise exception '확인 응답에 문파 안쪽 정보가 섞였습니다: %', v_json;
    end if;

    -- ④ 운영진도 만들 수 있고, 한 게임만 고를 수 있다
    v_json := public.create_guest_game_link(v_t_off, 'gyeongdan', 60);
    if v_json->>'game' <> 'gyeongdan' then
      raise exception '운영진이 한 게임 링크를 만들지 못했습니다: %', v_json;
    end if;
    if public.verify_guest_game_link(v_json->>'token')->>'game' <> 'gyeongdan' then
      raise exception '한 게임 링크가 다른 게임으로 확인됩니다: %', v_json;
    end if;

    -- ⑤ 문파원은 만들 수 없다 (42501)
    begin
      perform public.create_guest_game_link(v_t_mem, 'all', 10);
      raise exception '문파원이 체험 링크를 만들었습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑥ 기간·게임 값이 틀리면 22023
    begin
      perform public.create_guest_game_link(v_t_admin, 'all', 0);
      raise exception '0분이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.create_guest_game_link(v_t_admin, 'all', 10081);
      raise exception '10081분이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.create_guest_game_link(v_t_admin, 'puzzle', 10);
      raise exception '없는 게임 이름이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑦ 로그인 없이 부르면 28000 (없는 세션)
    begin
      perform public.create_guest_game_link('glverifybadtokenglverifybad', 'all', 10);
      raise exception '없는 세션이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑧ 게스트 점수 — 올리고, 최고점만 남고, 순위가 맞는다
    --    (이미 놀던 게스트 기록이 있는 DB 에서도 돌 수 있도록 이름은 매번 새로,
    --     순위는 그때그때 표에서 셈해 비교합니다)
    v_n1 := '연꽃' || substr(md5(random()::text), 1, 4);
    v_n2 := '물결' || substr(md5(random()::text), 1, 4);

    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', v_n1, 1200, '{"tier":3}'::jsonb);
    if (v_json->>'ok')::boolean is not true or (v_json->>'is_new_best')::boolean is not true
       or (v_json->>'best_score')::int <> 1200 then
      raise exception '게스트 첫 기록이 이상합니다: %', v_json;
    end if;
    select count(*) + 1 into v_rank from private.guest_game_scores
     where game = 'gyeongdan' and score > 1200;
    if (v_json->>'rank')::int <> v_rank then
      raise exception '1200점의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_rank, v_json;
    end if;
    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', v_n1, 900, '{"tier":2}'::jsonb);
    if (v_json->>'is_new_best')::boolean is not false or (v_json->>'best_score')::int <> 1200 then
      raise exception '낮은 게스트 점수가 최고점을 덮었습니다: %', v_json;
    end if;
    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', '   ' || v_n1 || '  ', 3000, '{"tier":5}'::jsonb);
    if v_json->>'nickname' <> v_n1 or (v_json->>'best_score')::int <> 3000 then
      raise exception '앞뒤 공백 닉네임이 같은 사람으로 합쳐지지 않았습니다: %', v_json;
    end if;
    select count(*) into v_own from private.guest_game_scores
     where game = 'gyeongdan' and lower(nickname) = lower(v_n1);
    if v_own <> 1 then
      raise exception '같은 닉네임이 %줄로 늘었습니다(1줄이어야 합니다).', v_own;
    end if;

    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', v_n2, 5000, '{}'::jsonb);
    select count(*) + 1 into v_rank from private.guest_game_scores
     where game = 'gyeongdan' and score > 5000;
    if (v_json->>'rank')::int <> v_rank then
      raise exception '5000점의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_rank, v_json;
    end if;
    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', v_n1, 10, '{}'::jsonb);
    select count(*) + 1 into v_rank from private.guest_game_scores
     where game = 'gyeongdan' and score > 3000;
    if (v_json->>'rank')::int <> v_rank then
      raise exception '3000점의 순위가 %인데 %이어야 합니다: %', (v_json->>'rank')::int, v_rank, v_json;
    end if;

    -- ⑨ 게스트 랭킹 — 점수 높은 순 · 문파원 정보 없음
    v_rows := public.list_guest_game_ranking(v_token, 'gyeongdan');
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 2 then
      raise exception '게스트 랭킹이 비었습니다: %', v_rows;
    end if;
    if not exists (select 1 from jsonb_array_elements(v_rows) e
                    where (e->>'nickname') = v_n2 and (e->>'score')::int = 5000)
       or not exists (select 1 from jsonb_array_elements(v_rows) e
                    where (e->>'nickname') = v_n1 and (e->>'score')::int = 3000) then
      raise exception '게스트 랭킹에 방금 올린 두 사람이 없습니다: %', v_rows;
    end if;
    if exists (select 1 from jsonb_array_elements(v_rows) e
                where e ? 'member_id' or e ? 'avatar' or e ? 'role'
                   or e ? 'best_score' or e ? 'id') then
      raise exception '게스트 랭킹에 문파원 정보 칸이 섞였습니다: %', v_rows;
    end if;
    if jsonb_array_length(public.list_guest_game_ranking(v_token, 'sinsupang')) <> 0 then
      raise exception '하지 않은 게임의 게스트 랭킹이 비어 있지 않습니다.';
    end if;

    -- ⑩ 게스트 기록은 문파 랭킹 표에 닿지 않는다
    if (select count(*) from private.gyeongdan_scores) <> v_family0 then
      raise exception '게스트 기록이 문파 경단 랭킹 표에 들어갔습니다.';
    end if;
    if exists (select 1 from private.guest_game_scores g
                join private.members m on lower(m.nickname) = lower(g.nickname)) then
      raise exception '게스트 기록이 문파원과 이어졌습니다.';
    end if;

    -- ⑪ 한 게임만 연 링크로 다른 게임 점수는 못 올린다 (42501)
    v_json := public.create_guest_game_link(v_t_admin, 'sinsumoa', 10);
    begin
      perform public.submit_guest_game_score(v_json->>'token', 'gyeongdan', '몰래손님', 100, '{}'::jsonb);
      raise exception '한 게임 링크로 다른 게임 점수가 올라갔습니다.';
    exception when sqlstate '42501' then null;
    end;
    begin
      perform public.list_guest_game_ranking(v_json->>'token', 'sinsupang');
      raise exception '한 게임 링크로 다른 게임 랭킹이 보였습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑫ 값 검증 — 빈 닉네임·긴 닉네임·음수 점수·이상한 meta 는 22023
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', '   ', 10, '{}'::jsonb);
      raise exception '빈 닉네임이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', repeat('가', 13), 10, '{}'::jsonb);
      raise exception '13자 닉네임이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', '연꽃손님', -1, '{}'::jsonb);
      raise exception '음수 점수가 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', '연꽃손님', 10, '[1,2,3]'::jsonb);
      raise exception '배열 meta 가 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑬ 없는 토큰으로는 점수·랭킹 모두 28000
    begin
      perform public.submit_guest_game_score(repeat('y', 24), 'gyeongdan', '몰래손님', 10, '{}'::jsonb);
      raise exception '없는 토큰으로 점수가 올라갔습니다.';
    exception when sqlstate '28000' then null;
    end;
    begin
      perform public.list_guest_game_ranking(repeat('y', 24), 'gyeongdan');
      raise exception '없는 토큰으로 랭킹이 보였습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑭ 만료 10분 여유 — 이미 들어와 놀던 사람은 한 판을 마칠 수 있다
    update private.guest_game_links
       set expires_at = now() - interval '1 minute'
     where id = v_id;
    v_json := public.verify_guest_game_link(v_token);
    if v_json->>'reason' <> 'expired' then
      raise exception '만료 1분 뒤에도 새 접속이 막히지 않습니다: %', v_json;
    end if;
    v_json := public.submit_guest_game_score(v_token, 'gyeongdan', '연꽃손님', 4000, '{}'::jsonb);
    if (v_json->>'ok')::boolean is not true then
      raise exception '만료 직후(여유 시간)의 점수가 막혔습니다: %', v_json;
    end if;
    if jsonb_array_length(public.list_guest_game_ranking(v_token, 'gyeongdan')) < 2 then
      raise exception '만료 직후(여유 시간)의 랭킹이 막혔습니다.';
    end if;

    -- ⑭-b 여유(10분)까지 지나면 점수·랭킹도 막힌다
    update private.guest_game_links
       set expires_at = now() - interval '11 minutes'
     where id = v_id;
    v_json := public.verify_guest_game_link(v_token);
    if (v_json->>'valid')::boolean is not false or v_json->>'reason' <> 'expired' then
      raise exception '기간이 지난 링크가 expired 로 오지 않았습니다: %', v_json;
    end if;
    if v_json ? 'game' or v_json ? 'expires_at' then
      raise exception '무효 응답에 게임 정보가 남았습니다: %', v_json;
    end if;
    begin
      perform public.submit_guest_game_score(v_token, 'gyeongdan', '연꽃손님', 5000, '{}'::jsonb);
      raise exception '기간이 지난 링크로 점수가 올라갔습니다.';
    exception when sqlstate '28000' then null;
    end;
    begin
      perform public.list_guest_game_ranking(v_token, 'gyeongdan');
      raise exception '기간이 지난 링크로 랭킹이 보였습니다.';
    exception when sqlstate '28000' then null;
    end;

    -- ⑮ 없는 토큰은 invalid (예외 없이)
    v_json := public.verify_guest_game_link(repeat('x', 24));
    if (v_json->>'valid')::boolean is not false or v_json->>'reason' <> 'invalid' then
      raise exception '없는 토큰의 응답이 다릅니다: %', v_json;
    end if;
    v_json := public.verify_guest_game_link(null);
    if (v_json->>'reason') <> 'invalid' then
      raise exception '빈 토큰의 응답이 다릅니다: %', v_json;
    end if;

    -- ⑯ 만료시키기 — 기간이 남아 있어도 바로 revoked
    v_json := public.create_guest_game_link(v_t_admin, 'sinsumoa', 30);
    if public.verify_guest_game_link(v_json->>'token')->>'valid' <> 'true' then
      raise exception '새 링크가 유효하지 않습니다: %', v_json;
    end if;
    v_json := public.revoke_guest_game_link(v_t_admin, (v_json->>'id')::uuid);
    if (v_json->>'ok')::boolean is not true or (v_json->>'already')::boolean is not false then
      raise exception '만료시키기가 이상합니다: %', v_json;
    end if;
    v_json := public.verify_guest_game_link((select l.token from private.guest_game_links l where l.id = (v_json->>'id')::uuid));
    if v_json->>'reason' <> 'revoked' then
      raise exception '만료시킨 링크가 revoked 로 시험되지 않았습니다: %', v_json;
    end if;

    -- ⑰ 목록 — 문주·운영진만, 새것부터, active 표시
    v_rows := public.list_guest_game_links(v_t_admin, 20);
    if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) < 2 then
      raise exception '링크 목록이 비었습니다: %', v_rows;
    end if;
    if not ((v_rows->0) ? 'active') or not ((v_rows->0) ? 'remaining_seconds')
       or not ((v_rows->0) ? 'token') or not ((v_rows->0) ? 'expires_at') then
      raise exception '목록 응답에 필요한 칸이 없습니다: %', v_rows->0;
    end if;
    begin
      perform public.list_guest_game_links(v_t_mem, 20);
      raise exception '문파원이 링크 목록을 보았습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑱ 문파원은 만료시키지도 못한다 (42501) · 없는 링크는 22023
    begin
      perform public.revoke_guest_game_link(v_t_mem, v_id);
      raise exception '문파원이 링크를 만료시켰습니다.';
    exception when sqlstate '42501' then null;
    end;
    begin
      perform public.revoke_guest_game_link(v_t_admin, gen_random_uuid());
      raise exception '없는 링크 만료시키기가 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '체험 링크 확인 — 발급(문주·운영진) · 유효 확인 · 남은 시간 · 한 게임 링크 · 기간 만료 · 회수 · 권한 거절 · 목록이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '게스트 랭킹 확인 — 점수 등록 · 최고점 한 줄 · 순위 · 게스트 랭킹 조회 · 문파 랭킹 분리가 모두 정상입니다.';
  raise notice '연못 마이그레이션 완료 — 🔗 기간제한 외부 체험 링크와 게스트 전용 랭킹을 쓸 수 있습니다.';
end $$;
