-- ============================================================================
--  연못 (Yeonmot Munpa) · 프로필 그림 '오리' 추가 마이그레이션
--    (파일 이름: supabase/migration-duck.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4 로 설치해 쓰고 있는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 바뀌나
--     · 프로필 그림 8종에 'preset:duck'(오리)을 더해 9종이 됩니다.
--     · public.update_my_avatar(p_token, p_avatar) 의 프리셋 화이트리스트에만
--       'preset:duck' 을 추가합니다. 사진(data:image/…) 저장 규칙·48KB 제한·
--       null(기본 글자) 동작은 예전과 똑같습니다.
--     · 앱 화면(js/art.js · js/app.js)은 오리 그림을 앱이 직접 그리므로
--       DB 에는 'preset:duck' 이라는 짧은 값만 저장됩니다.
--
--  ■ 안전한가
--     · 멱등: create or replace function 이라 여러 번 실행해도 같습니다.
--     · 표 구조·RLS·다른 함수·기존 기록은 건드리지 않습니다.
--     · 확인 블록이 임시 문파원·세션을 만들어 실제 RPC 를 돌려 보고
--       (오리 저장 · 읽기 · 잘못된 그림 거절 · 실행 권한) 마지막에 전부 되돌립니다
--       — 문파에 남는 행은 없습니다. 실패하면 아무것도 바뀌지 않고 오류로 알려 줍니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.members') is null
     or to_regprocedure('public.update_my_avatar(text,text)') is null then
    raise exception '연못 DB 가 아직 준비되지 않았습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① 프로필 그림 바꾸기 — 프리셋 9종 (오리 추가)
-- ============================================================================
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


-- ============================================================================
-- ② 실행 권한 — 앱(anon · authenticated)이 그대로 부를 수 있게
-- ============================================================================
revoke all on function public.update_my_avatar(text, text) from public;
grant execute on function public.update_my_avatar(text, text) to anon, authenticated;


-- ============================================================================
-- ③ 확인 — 실제로 오리를 저장해 보고, 모두 되돌립니다
-- ============================================================================
do $$
declare
  v_src text;
begin
  select pg_get_functiondef('public.update_my_avatar(text,text)'::regprocedure) into v_src;
  if position('preset:duck' in v_src) = 0 then
    raise exception 'update_my_avatar 에 preset:duck 이 들어 있지 않습니다.';
  end if;
  if has_function_privilege('anon', 'public.update_my_avatar(text,text)', 'execute') = false then
    raise exception 'anon 이 update_my_avatar 를 부를 수 없습니다.';
  end if;

  begin
    declare
      v_member  private.members;
      v_token   text;
      v_result  jsonb;
      v_saved   text;
    begin
      insert into private.members (nickname, pin_hash, member_role)
      values ('확인' || substr(md5(random()::text), 1, 6), 'duck-verify', 'member')
      returning * into v_member;

      v_token := 'duckverify' || md5(random()::text) || md5(random()::text);
      insert into private.member_sessions (member_id, token_hash, expires_at)
      values (v_member.id, private.token_hash(v_token), now() + interval '10 minutes');

      -- ① 오리 그림을 저장한다
      v_result := public.update_my_avatar(v_token, 'preset:duck');
      if v_result->>'avatar' <> 'preset:duck' or coalesce((v_result->>'ok')::boolean, false) = false then
        raise exception '오리 그림 저장 응답이 이상합니다: %', v_result;
      end if;

      -- ② DB 에도 그대로 남아 있다
      select avatar into v_saved from private.members where id = v_member.id;
      if v_saved <> 'preset:duck' then
        raise exception '저장된 그림이 다릅니다: %', v_saved;
      end if;

      -- ③ 없는 그림은 예전처럼 거절한다
      begin
        perform public.update_my_avatar(v_token, 'preset:swan');
        raise exception '없는 그림이 통과되었습니다.';
      exception
        when sqlstate '22023' then null;
      end;

      -- ④ 예전 그림(연꽃)과 기본 글자(null)도 그대로 동작한다
      perform public.update_my_avatar(v_token, 'preset:lotus');
      v_result := public.update_my_avatar(v_token, null);
      if v_result->>'avatar' is not null then
        raise exception '기본 글자 되돌리기가 이상합니다: %', v_result;
      end if;

      raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
    exception
      when others then
        if sqlerrm <> 'rollback-check' then raise; end if;
    end;

    raise notice '오리 확인 — preset:duck 저장·읽기 · 없는 그림 거절 · 기본 글자 되돌리기가 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  end;

  raise notice '연못 오리 마이그레이션 완료 — 프로필 그림 9종을 쓸 수 있습니다.';
end $$;
