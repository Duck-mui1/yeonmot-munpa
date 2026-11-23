-- ============================================================================
--  연못 (Yeonmot Munpa) · 문파앨범 '글(선택)' 마이그레이션
--    (파일 이름: supabase/migration-album-text.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck 으로 설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 바뀌나
--     · 앨범 사진에 '글(선택)'을 남길 수 있습니다 — 안 적어도 사진만 올라갑니다.
--     · 지금까지 제목은 1~40자 필수였습니다. 이제 비워 둘 수 있습니다
--       (제목 칸은 앱에서 없어지고, 화면에는 글 한 칸만 있습니다).
--     · 글은 300자까지 — 넘으면 서버가 22023 으로 거절합니다.
--     · public.create_album_post(p_token, p_title, p_image_data, p_caption, p_image_mime)
--       의 인자는 예전과 똑같고, 빈 제목을 받아 주며 응답에 글(caption)을 함께 돌려 줍니다.
--
--  ■ 기존 기록
--     · 이미 올린 사진과 그 제목·설명은 하나도 지우지 않습니다.
--     · 제목만 있던 예전 사진은 앱이 그 제목을 그대로 카드에 보여 줍니다.
--
--  ■ 안전한가
--     · 멱등: 제약 이름을 확인해 지우고 다시 만들며, 함수는 create or replace 입니다.
--     · 다른 표·RLS·다른 함수는 건드리지 않습니다.
--     · 확인 블록이 임시 문파원·세션을 만들어 실제 RPC 를 돌려 보고
--       (글 없이 올리기 · 글과 함께 올리기 · 300자 제한 · 목록 조회) 마지막에 전부 되돌립니다
--       — 문파에 남는 행은 없습니다. 실패하면 아무것도 바뀌지 않고 오류로 알려 줍니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.album_posts') is null
     or to_regprocedure('public.create_album_post(text,text,text,text,text)') is null then
    raise exception '연못 DB 가 아직 준비되지 않았습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① 제목을 비워 둘 수 있게 — 기본값 '' · 길이만 40자 이하로 확인
-- ============================================================================
alter table private.album_posts alter column title set default '';

do $$
declare
  r record;
begin
  -- 예전 '제목 1~40자' 제약(이름은 설치 시점에 따라 다를 수 있음)을 찾아 지웁니다.
  for r in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
     where n.nspname = 'private'
       and rel.relname = 'album_posts'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%title%'
  loop
    execute format('alter table private.album_posts drop constraint %I', r.conname);
  end loop;

  if not exists (
       select 1
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace n on n.oid = rel.relnamespace
        where n.nspname = 'private'
          and rel.relname = 'album_posts'
          and con.contype = 'c'
          and pg_get_constraintdef(con.oid) ilike '%char_length(title)%'
     ) then
    alter table private.album_posts
      add constraint album_posts_title_len check (char_length(title) <= 40);
  end if;
end $$;


-- ============================================================================
-- ② 앨범 사진 올리기 — 글(설명)은 선택, 제목은 비워도 됩니다
-- ============================================================================
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


-- ============================================================================
-- ③ 실행 권한 — 앱(anon · authenticated)이 그대로 부를 수 있게
-- ============================================================================
revoke all on function public.create_album_post(text, text, text, text, text) from public;
grant execute on function public.create_album_post(text, text, text, text, text) to anon, authenticated;


-- ============================================================================
-- ④ 확인 — 실제로 사진을 올려 보고, 모두 되돌립니다
-- ============================================================================
do $$
declare
  v_member  private.members;
  v_token   text;
  v_photo   text := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH9Lm7cWQAAAABJRU5ErkJggg==';
  v_post    jsonb;
  v_rows    jsonb;
  v_long    text;
  v_msg     text;
begin
  if has_function_privilege('anon', 'public.create_album_post(text,text,text,text,text)', 'execute') = false then
    raise exception 'anon 이 create_album_post 를 부를 수 없습니다.';
  end if;

  if exists (
       select 1
         from pg_constraint con
         join pg_class rel on rel.oid = con.conrelid
         join pg_namespace n on n.oid = rel.relnamespace
        where n.nspname = 'private'
          and rel.relname = 'album_posts'
          and con.contype = 'c'
          and pg_get_constraintdef(con.oid) ilike '%between 1 and 40%'
     ) then
    raise exception '제목 1~40자 필수 제약이 아직 남아 있습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('확인' || substr(md5(random()::text), 1, 6), 'album-verify', 'member')
    returning * into v_member;

    v_token := 'albumverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_member.id, private.token_hash(v_token), now() + interval '10 minutes');

    -- ① 글 없이 사진만 올린다
    v_post := public.create_album_post(v_token, '', v_photo, '', 'image/png');
    if v_post->>'id' is null or coalesce(v_post->>'caption', 'x') <> '' then
      raise exception '글 없이 올리기 응답이 이상합니다: %', v_post;
    end if;

    -- ② 여러 줄 글과 함께 올린다
    v_post := public.create_album_post(v_token, '', v_photo, E'첫째 줄\n둘째 줄', null);
    if v_post->>'caption' <> E'첫째 줄\n둘째 줄' then
      raise exception '글과 함께 올리기 응답이 이상합니다: %', v_post;
    end if;

    -- ③ 목록에도 두 장이 글과 함께 그대로 온다 (확인용 문파원이 올린 것만)
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_rows
      from jsonb_array_elements(public.list_album_posts(v_token, 30, null)) e
     where e->>'author_id' = v_member.id::text;
    if jsonb_array_length(v_rows) <> 2 then
      raise exception '목록 장수가 다릅니다: %', v_rows;
    end if;
    if not exists (select 1 from jsonb_array_elements(v_rows) e where e->>'caption' = E'첫째 줄\n둘째 줄')
       or not exists (select 1 from jsonb_array_elements(v_rows) e where coalesce(e->>'caption', 'x') = '') then
      raise exception '목록의 글이 다릅니다: %', v_rows;
    end if;

    -- ④ 300자는 되고 301자는 22023 으로 거절된다
    v_long := repeat('가', 300);
    perform public.create_album_post(v_token, '', v_photo, v_long, null);
    begin
      perform public.create_album_post(v_token, '', v_photo, v_long || '가', null);
      raise exception '301자 글이 통과되었습니다.';
    exception
      when sqlstate '22023' then
        get stacked diagnostics v_msg = message_text;
        if position('300' in v_msg) = 0 then raise exception '안내 문구: %', v_msg; end if;
    end;

    -- ⑤ 제목 41자는 여전히 거절되고, 빈 제목은 표 제약도 통과한다
    begin
      perform public.create_album_post(v_token, repeat('가', 41), v_photo, '', null);
      raise exception '41자 제목이 통과되었습니다.';
    exception
      when sqlstate '22023' then null;
    end;

    raise exception 'rollback-check';   -- 확인용 행·사진·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '앨범 글 확인 — 글 없이 올리기 · 여러 줄 글 · 목록 · 300자 제한 · 41자 제목 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '연못 앨범 글 마이그레이션 완료 — 이제 글을 안 적어도 사진이 올라갑니다.';
end $$;
