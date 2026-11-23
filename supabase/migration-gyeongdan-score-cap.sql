-- ============================================================================
-- 경단만들기 — 점수 상한을 1,000,000 → 100,000,000 으로 올리기
-- 파일 이름: supabase/migration-gyeongdan-score-cap.sql
--
--   · 「경단 도감」 점수표(백운단 +140,000 · 백운단 보너스 +280,000)로 한 판에
--     100만 점을 넘길 수 있게 되어, 서버가 정상 점수를 거절하지 않도록 상한만 올립니다.
--   · 이미 supabase/migration-gyeongdan.sql 을 실행한 프로젝트에서 한 번만 실행하세요.
--   · 하는 일
--       ① private.gyeongdan_scores 의 점수 범위 제약을 0 ~ 100,000,000 으로 교체
--       ② public.submit_gyeongdan_score 를 같은 상한으로 다시 만듦 (검사만 바뀜)
--   · 되돌리려면 두 곳의 100000000 을 1000000 으로 바꿔 다시 실행하면 됩니다.
-- ============================================================================

-- ① 점수 범위 제약 교체
alter table private.gyeongdan_scores
  drop constraint if exists gyeongdan_scores_score_range;

alter table private.gyeongdan_scores
  add constraint gyeongdan_scores_score_range
  check (best_score between 0 and 100000000);

-- ② 점수 올리기 — 상한만 넓힌 같은 함수
create or replace function public.submit_gyeongdan_score(
  p_token    text,
  p_score    integer,
  p_max_tier integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_prev  private.gyeongdan_scores;
  v_best  integer;
  v_tier  smallint;
  v_new   boolean := false;
  v_rank  integer;
begin
  if p_score is null or p_score < 0 or p_score > 100000000 then
    raise exception '점수가 올바르지 않아요.' using errcode = '22023';
  end if;

  if p_max_tier is null or p_max_tier < 1 or p_max_tier > 11 then
    raise exception '경단 단계가 올바르지 않아요. (1=박쥐단 … 11=백운단)' using errcode = '22023';
  end if;

  select * into v_prev
    from private.gyeongdan_scores g
   where g.member_id = v_actor.member_id;

  if not found then
    v_best := p_score;
    v_tier := p_max_tier::smallint;
    v_new  := p_score > 0;
    insert into private.gyeongdan_scores (member_id, best_score, max_tier)
    values (v_actor.member_id, v_best, v_tier);
  else
    v_best := greatest(v_prev.best_score, p_score);
    v_tier := greatest(v_prev.max_tier, p_max_tier::smallint);
    v_new  := p_score > v_prev.best_score;
    if v_best <> v_prev.best_score or v_tier <> v_prev.max_tier then
      update private.gyeongdan_scores
         set best_score = v_best,
             max_tier   = v_tier,
             updated_at = now()
       where member_id = v_actor.member_id;
    end if;
  end if;

  select count(*) + 1
    into v_rank
    from private.gyeongdan_scores g
    join private.members m on m.id = g.member_id
   where m.status = 'active'
     and g.best_score > v_best;

  return jsonb_build_object(
    'ok', true,
    'best_score', v_best,
    'max_tier', v_tier,
    'is_new_best', v_new,
    'rank', v_rank
  );
end;
$fn$;

comment on function public.submit_gyeongdan_score(text, integer, integer) is
  '경단만들기 점수 제출 — 로그인한 문파원의 최고 점수만 갱신하고 { ok, best_score, max_tier, is_new_best, rank } 를 돌려줍니다.';


-- 확인 — 표에 100만 점이 넘는 기록도 들어갈 수 있는지 봅니다.
select conname, pg_get_constraintdef(c.oid) as 정의
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
 where n.nspname = 'private' and t.relname = 'gyeongdan_scores'
   and c.conname = 'gyeongdan_scores_score_range';
