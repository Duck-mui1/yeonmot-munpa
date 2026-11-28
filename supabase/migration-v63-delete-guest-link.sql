-- ============================================================================
-- 연못 v63 — 「만료된 체험 링크 삭제」 마이그레이션
-- 이미 설치해 쓰는 DB용 — Supabase SQL Editor에 전체를 붙여 넣고 Run 하세요.
-- (여러 번 실행해도 안전합니다)
--
-- · 내정보 → 🔗 외부 체험 링크 목록에서 「만료됨」 카드를 지우는 기능입니다.
-- · 기간이 지났거나(expires_at ≤ now) 만료시키기 한(revoked) 링크만 지울 수 있습니다.
--   아직 열려 있는 링크는 거절합니다 — 먼저 「만료시키기」를 눌러 주세요.
-- · 게스트 랭킹(private.guest_game_scores)은 링크 줄과 연결되어 있지 않아서
--   링크를 지워도 게스트 기록은 그대로 남습니다.
-- ============================================================================

create or replace function public.delete_guest_game_link(
  p_session text,
  p_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_session);
  v_link  private.guest_game_links;
begin
  if v_actor.member_role not in ('admin', 'officer') then
    raise exception '문주·운영진만 체험 링크를 지울 수 있어요.' using errcode = '42501';
  end if;

  select * into v_link
    from private.guest_game_links l
   where l.id = p_id;

  if not found then
    raise exception '체험 링크를 찾지 못했어요. 새로고침한 뒤 다시 시도해 주세요.' using errcode = '22023';
  end if;

  if not v_link.revoked and v_link.expires_at > now() then
    raise exception '아직 열려 있는 링크는 지울 수 없어요. 먼저 만료시켜 주세요.' using errcode = '22023';
  end if;

  delete from private.guest_game_links where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id, 'deleted', true);
end;
$fn$;

comment on function public.delete_guest_game_link(text, uuid) is
  '만료된 체험 링크 삭제 — 문주·운영진만. 기간이 지났거나 만료시킨 링크만 목록에서 지웁니다. { ok, id, deleted }.';

-- 함수 실행 권한 — 기본값(EXECUTE to PUBLIC)을 회수하고 anon/authenticated 에만 허용
revoke all on function public.delete_guest_game_link(text, uuid) from public;
grant execute on function public.delete_guest_game_link(text, uuid) to anon, authenticated;

-- ============================================================================
-- 확인 — 함수가 생겼고 실행 권한이 anon/authenticated 에만 있는지 스스로 점검
-- ============================================================================
do $$
declare
  v_open boolean;
begin
  if to_regprocedure('public.delete_guest_game_link(text, uuid)') is null then
    raise exception 'delete_guest_game_link 함수가 만들어지지 않았습니다.';
  end if;

  if has_function_privilege('anon', 'public.delete_guest_game_link(text, uuid)', 'execute') is not true
     or has_function_privilege('authenticated', 'public.delete_guest_game_link(text, uuid)', 'execute') is not true then
    raise exception 'delete_guest_game_link 실행 권한이 anon/authenticated 에 없습니다.';
  end if;

  select exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'delete_guest_game_link'
       and p.proacl is not null
       and exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
  ) into v_open;

  if v_open then
    raise exception 'delete_guest_game_link 이 아직 PUBLIC 에 열려 있습니다.';
  end if;

  raise notice '연못 v63 확인 — delete_guest_game_link 준비 완료 (문주·운영진만, 만료·회수된 링크만 삭제 · 게스트 랭킹은 유지).';
end $$;
