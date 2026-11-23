-- ============================================================================
--  연못 (Yeonmot Munpa) · '모든 글 수정' 마이그레이션
--    (파일 이름: supabase/migration-edit-posts.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text 으로 설치해 쓰는
--        Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 바뀌나 — 자리비움만 빼고 모든 글을 고칠 수 있습니다
--     · 공지  admin_update_notice   — 문주(만들기·지우기와 같은 권한)
--     · 일정  admin_update_event    — 문주
--     · 쿠폰  update_coupon         — 문주 · 코드와 마지막 날만 바뀝니다
--     · 공략  update_guide          — 올린 본인 또는 운영진 · 제목·유튜브 주소
--     · 앨범  update_album_post_text — 올린 본인 또는 운영진 · 글만(사진은 그대로),
--                                     빈 글로 지우는 것도 됩니다
--     · 자리비움  수정 함수를 만들지 않습니다. 기간·이유를 바꾸려면 지우고 다시 등록합니다.
--
--  ■ 권한과 검증 (schema.sql 의 만들기 규칙과 같습니다)
--     · 로그인하지 않으면 28000 · 권한이 없으면 42501
--     · 공지 제목 1~60자 · 내용 1~4000자 · 태그 1~10자
--     · 일정 이름 1~60자 · 장소 60자 · 태그 10자 · 메모 200자 · 끝이 시작보다 빠르면 거절
--     · 쿠폰 코드 한글·영문·숫자·-·_ 3~24자 · 같은 코드가 이미 있으면 23505
--     · 공략 제목 1~80자 · 유튜브 주소에서 영상 ID(11자)를 다시 뽑아 저장
--     · 앨범 글 300자 · 제목 자리(예전 호환)는 글의 첫 줄 40자로 맞춤
--
--  ■ 기존 기록
--     · 글을 고치지 않으면 아무것도 바뀌지 않습니다. 표 구조·RLS·다른 함수는 건드리지 않습니다.
--
--  ■ 안전한가
--     · 멱등: 모든 함수가 create or replace, 권한은 다시 부여합니다.
--     · 확인 블록이 임시 문파원·세션을 만들어 실제로 고쳐 보고(권한 거절 포함)
--       마지막에 전부 되돌립니다 — 문파에 남는 행은 없습니다.
--       실패하면 아무것도 바뀌지 않고 오류로 알려 줍니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.members') is null
     or to_regclass('public.notices') is null
     or to_regclass('public.guides') is null
     or to_regclass('private.coupons') is null
     or to_regclass('private.album_posts') is null
     or to_regprocedure('private.current_member(text)') is null
     or to_regprocedure('private.require_admin(text)') is null then
    raise exception '연못 DB 가 아직 준비되지 않았습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① 공지 수정 — 문주만 (schema.sql 과 같은 정의)
-- ============================================================================
create or replace function public.admin_update_notice(
  p_token   text,
  p_notice_id uuid,
  p_title   text,
  p_body    text,
  p_tag     text default null,
  p_pinned  boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '공지 제목은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) = 0 or char_length(v_body) > 4000 then
    raise exception '공지 내용은 1~4000자로 적어 주세요.' using errcode = '22023';
  end if;

  update public.notices
     set title = v_title,
         body = v_body,
         tag = coalesce(nullif(btrim(p_tag), ''), tag),
         pinned = coalesce(p_pinned, pinned)
   where id = p_notice_id
     and deleted_at is null;

  if not found then
    raise exception '공지를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'notice.update', 'notice', p_notice_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_notice_id, 'ok', true);
end;
$fn$;


-- ============================================================================
-- ② 일정 수정 — 문주만 (schema.sql 과 같은 정의)
-- ============================================================================
create or replace function public.admin_update_event(
  p_token     text,
  p_event_id  uuid,
  p_title     text,
  p_starts_at timestamptz,
  p_place     text default null,
  p_tag       text default null,
  p_note      text default null,
  p_ends_at   timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '일정 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception '일정 날짜와 시간을 정해 주세요.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception '끝나는 시간이 시작보다 빨라요.' using errcode = '22023';
  end if;

  update public.events
     set title = v_title,
         starts_at = p_starts_at,
         place = coalesce(btrim(p_place), place),
         tag = coalesce(nullif(btrim(p_tag), ''), tag),
         note = coalesce(btrim(p_note), note),
         ends_at = coalesce(p_ends_at, ends_at)
   where id = p_event_id
     and deleted_at is null;

  if not found then
    raise exception '일정을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  perform private.log_admin(v_actor.member_id, 'event.update', 'event', p_event_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_event_id, 'ok', true);
end;
$fn$;


-- ============================================================================
-- ③ 쿠폰 수정 — 문주만 · 코드와 마지막 날만 바뀝니다
-- ============================================================================
create or replace function public.update_coupon(
  p_token      text,
  p_coupon_id  uuid,
  p_code       text,
  p_expires_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_code  text := upper(btrim(coalesce(p_code, '')));
  v_coupon private.coupons;
begin
  if v_code !~ '^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$' then
    raise exception '쿠폰 코드는 한글·영문·숫자·-·_ 3~24자로 정해 주세요.' using errcode = '22023';
  end if;

  select * into v_coupon
    from private.coupons c
   where c.id = p_coupon_id
     and c.deleted_at is null
   for update;

  if not found then
    raise exception '쿠폰을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if exists (select 1 from private.coupons c
              where upper(c.code) = v_code
                and c.deleted_at is null
                and c.id <> p_coupon_id) then
    raise exception '같은 쿠폰 코드가 이미 있어요.' using errcode = '23505';
  end if;

  update private.coupons
     set code = v_code,
         expires_on = p_expires_on
   where id = p_coupon_id;

  perform private.log_admin(v_actor.member_id, 'coupon.update', 'coupon', p_coupon_id::text,
                            jsonb_build_object('code', v_code));

  return jsonb_build_object(
    'id', p_coupon_id,
    'code', v_code,
    'expires_on', p_expires_on
  );
end;
$fn$;


-- ============================================================================
-- ④ 공략 수정 — 올린 본인 또는 운영진(admin·officer)
-- ============================================================================
create or replace function public.update_guide(
  p_token       text,
  p_guide_id    uuid,
  p_title       text,
  p_youtube_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_url   text := btrim(coalesce(p_youtube_url, ''));
  v_video text;
  v_guide public.guides;
begin
  select * into v_guide
    from public.guides g
   where g.id = p_guide_id
     and g.deleted_at is null
   for update;

  if not found then
    raise exception '공략을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_guide.created_by is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 공략이나 운영진만 고칠 수 있어요.' using errcode = '42501';
  end if;

  if char_length(v_title) = 0 or char_length(v_title) > 80 then
    raise exception '공략 제목은 1~80자로 적어 주세요.' using errcode = '22023';
  end if;

  if char_length(v_url) = 0 or char_length(v_url) > 300 then
    raise exception '유튜브 주소를 넣어 주세요.' using errcode = '22023';
  end if;

  if v_url ~ '^[A-Za-z0-9_-]{11}$' then
    v_video := v_url;
    v_url := 'https://www.youtube.com/watch?v=' || v_url;
  else
    v_video := substring(v_url from '(?:youtu\.be/|youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/|v/))([A-Za-z0-9_-]{11})');
  end if;

  if v_video is null then
    raise exception '유튜브 주소를 알아보지 못했어요. youtu.be/… 또는 youtube.com/watch?v=… 를 붙여 넣어 주세요.' using errcode = '22023';
  end if;

  update public.guides
     set title = v_title,
         youtube_url = v_url,
         video_id = v_video
   where id = p_guide_id;

  perform private.log_admin(v_actor.member_id, 'guide.update', 'guide', p_guide_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_guide.created_by::text,
                                               'video_id', v_video));

  return jsonb_build_object(
    'id', p_guide_id,
    'title', v_title,
    'youtube_url', v_url,
    'video_id', v_video
  );
end;
$fn$;


-- ============================================================================
-- ⑤ 앨범 글 수정 — 올린 본인 또는 운영진(admin·officer) · 사진은 그대로
-- ============================================================================
create or replace function public.update_album_post_text(
  p_token   text,
  p_post_id uuid,
  p_caption text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_token);
  v_caption text := btrim(coalesce(p_caption, ''));
  v_post    private.album_posts;
  v_title   text;
begin
  if char_length(v_caption) > 300 then
    raise exception '글은 300자까지 쓸 수 있어요.' using errcode = '22023';
  end if;

  select * into v_post
    from private.album_posts p
   where p.id = p_post_id
     and p.deleted_at is null
   for update;

  if not found then
    raise exception '사진을 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  if v_post.member_id is distinct from v_actor.member_id
     and v_actor.member_role not in ('admin', 'officer') then
    raise exception '내가 올린 사진이나 운영진만 글을 고칠 수 있어요.' using errcode = '42501';
  end if;

  select left(btrim(s), 40) into v_title
    from regexp_split_to_table(v_caption, E'\n') s
   where btrim(s) <> ''
   limit 1;
  v_title := coalesce(v_title, '');

  update private.album_posts
     set caption = v_caption,
         title = v_title
   where id = p_post_id;

  perform private.log_admin(v_actor.member_id, 'album.update_text', 'album_post', p_post_id::text,
                            jsonb_build_object('owner', v_post.member_id::text,
                                               'chars', char_length(v_caption)));

  return jsonb_build_object(
    'id', p_post_id,
    'caption', v_caption,
    'title', v_title,
    'ok', true
  );
end;
$fn$;


-- ============================================================================
-- ⑥ 실행 권한 — 앱(anon · authenticated)이 그대로 부를 수 있게
-- ============================================================================
revoke all on function public.admin_update_notice(text, uuid, text, text, text, boolean) from public;
revoke all on function public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz) from public;
revoke all on function public.update_coupon(text, uuid, text, date) from public;
revoke all on function public.update_guide(text, uuid, text, text) from public;
revoke all on function public.update_album_post_text(text, uuid, text) from public;

grant execute on function public.admin_update_notice(text, uuid, text, text, text, boolean) to anon, authenticated;
grant execute on function public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz) to anon, authenticated;
grant execute on function public.update_coupon(text, uuid, text, date) to anon, authenticated;
grant execute on function public.update_guide(text, uuid, text, text) to anon, authenticated;
grant execute on function public.update_album_post_text(text, uuid, text) to anon, authenticated;


-- ============================================================================
-- ⑦ 확인 — 실제로 고쳐 보고, 모두 되돌립니다
-- ============================================================================
do $$
declare
  v_admin   private.members;
  v_officer private.members;
  v_member  private.members;
  v_other   private.members;
  v_t_admin text;
  v_t_off   text;
  v_t_mem   text;
  v_t_other text;
  v_notice  jsonb;
  v_event   jsonb;
  v_coupon  jsonb;
  v_guide   jsonb;
  v_post    jsonb;
  v_id      uuid;
  v_row     record;
  v_code_a  text := 'EDIT' || upper(substr(md5(random()::text), 1, 8));
  v_code_b  text := 'EDIT' || upper(substr(md5(random()::text), 1, 8));
  v_photo   text := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AH9Lm7cWQAAAABJRU5ErkJggg==';
begin
  -- 실행 권한 확인
  if has_function_privilege('anon', 'public.update_guide(text,uuid,text,text)', 'execute') = false
     or has_function_privilege('anon', 'public.update_coupon(text,uuid,text,date)', 'execute') = false
     or has_function_privilege('anon', 'public.update_album_post_text(text,uuid,text)', 'execute') = false then
    raise exception 'anon 이 수정 함수를 부를 수 없습니다.';
  end if;

  -- 자리비움 수정 함수는 없어야 합니다
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'update_absence') then
    raise exception '자리비움 수정 함수가 만들어졌습니다. 자리비움은 수정 대상이 아닙니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('확인문주' || substr(md5(random()::text), 1, 4), 'edit-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('확인운영' || substr(md5(random()::text), 1, 4), 'edit-verify', 'officer')
    returning * into v_officer;
    insert into private.members (nickname, pin_hash, member_role)
    values ('확인문파' || substr(md5(random()::text), 1, 4), 'edit-verify', 'member')
    returning * into v_member;
    insert into private.members (nickname, pin_hash, member_role)
    values ('확인남남' || substr(md5(random()::text), 1, 4), 'edit-verify', 'member')
    returning * into v_other;

    v_t_admin := 'editverify' || md5(random()::text) || md5(random()::text);
    v_t_off   := 'editverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'editverify' || md5(random()::text) || md5(random()::text);
    v_t_other := 'editverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id, private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_officer.id, private.token_hash(v_t_off), now() + interval '10 minutes'),
           (v_member.id, private.token_hash(v_t_mem), now() + interval '10 minutes'),
           (v_other.id, private.token_hash(v_t_other), now() + interval '10 minutes');

    -- ① 공지 — 문주가 고친다 · 문파원은 42501
    v_notice := public.admin_create_notice(v_t_admin, '수정 전 공지', '처음 내용', '공지', false);
    v_id := (v_notice->>'id')::uuid;
    perform public.admin_update_notice(v_t_admin, v_id, '수정한 공지', '고친 내용', '축제', true);
    select * into v_row from public.notices where id = v_id;
    if v_row.title <> '수정한 공지' or v_row.body <> '고친 내용' or v_row.tag <> '축제' or v_row.pinned = false then
      raise exception '공지 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    begin
      perform public.admin_update_notice(v_t_mem, v_id, '몰래', '몰래', null, null);
      raise exception '문파원이 공지를 고쳤습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ② 일정 — 문주가 고친다 · 시작일 없으면 22023
    v_event := public.admin_create_event(v_t_admin, '수정 전 일정', now() + interval '1 day', '연못', '모임', '메모');
    v_id := (v_event->>'id')::uuid;
    perform public.admin_update_event(v_t_admin, v_id, '수정한 일정', now() + interval '2 days', '3구역', '원정', '고친 메모');
    select * into v_row from public.events where id = v_id;
    if v_row.title <> '수정한 일정' or v_row.place <> '3구역' or v_row.note <> '고친 메모' then
      raise exception '일정 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    begin
      perform public.admin_update_event(v_t_admin, v_id, '날짜 없음', null, null, null, null, null);
      raise exception '시작일 없는 일정이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ③ 공략 — 본인이 고친다 · 남은 42501 · 운영진은 고친다 · 영상 ID 다시 뽑기
    v_guide := public.create_guide(v_t_mem, '수정 전 공략', 'https://youtu.be/aqz-KE-bpKQ');
    v_id := (v_guide->>'id')::uuid;
    perform public.update_guide(v_t_mem, v_id, '내가 고친 공략', 'https://youtu.be/jNQXAC9IVRw');
    select * into v_row from public.guides where id = v_id;
    if v_row.title <> '내가 고친 공략' or v_row.video_id <> 'jNQXAC9IVRw' then
      raise exception '공략 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    begin
      perform public.update_guide(v_t_other, v_id, '남의 공략', 'https://youtu.be/jNQXAC9IVRw');
      raise exception '다른 문파원이 남의 공략을 고쳤습니다.';
    exception when sqlstate '42501' then null;
    end;
    begin
      perform public.update_guide(v_t_mem, v_id, '', 'https://youtu.be/jNQXAC9IVRw');
      raise exception '빈 공략 제목이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    -- 운영진은 남의 공략도 고칩니다 (성공해야 함)
    perform public.update_guide(v_t_off, v_id, '운영진이 고친 공략', 'https://youtu.be/aqz-KE-bpKQ');
    select * into v_row from public.guides where id = v_id;
    if v_row.title <> '운영진이 고친 공략' or v_row.video_id <> 'aqz-KE-bpKQ' then
      raise exception '운영진의 공략 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;

    -- ④ 쿠폰 — 문주가 고친다 · 같은 코드 23505 · 잘못된 코드 22023 · 문파원 42501
    v_coupon := public.admin_create_coupon(v_t_admin, v_code_a, '-', '-', null, 'lotus');
    v_id := (v_coupon->>'id')::uuid;
    perform public.update_coupon(v_t_admin, v_id, v_code_a || 'X', date '2026-12-31');
    select * into v_row from private.coupons where id = v_id;
    if v_row.code <> v_code_a || 'X' or v_row.expires_on <> date '2026-12-31' then
      raise exception '쿠폰 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    perform public.admin_create_coupon(v_t_admin, v_code_b, '-', '-', null, 'lotus');
    begin
      perform public.update_coupon(v_t_admin, v_id, v_code_b, null);
      raise exception '같은 쿠폰 코드가 통과되었습니다.';
    exception when sqlstate '23505' then null;
    end;
    begin
      perform public.update_coupon(v_t_admin, v_id, '한 글', null);
      raise exception '잘못된 쿠폰 코드가 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;
    begin
      perform public.update_coupon(v_t_mem, v_id, 'EDIT2028', null);
      raise exception '문파원이 쿠폰을 고쳤습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑤ 앨범 — 본인이 글을 고친다 · 빈 글로 지우기 · 남은 42501 · 운영진은 고친다 · 301자 22023
    v_post := public.create_album_post(v_t_mem, '', v_photo, '처음 글', 'image/png');
    v_id := (v_post->>'id')::uuid;
    perform public.update_album_post_text(v_t_mem, v_id, E'고친 글\n둘째 줄');
    select * into v_row from private.album_posts where id = v_id;
    if v_row.caption <> E'고친 글\n둘째 줄' or v_row.title <> '고친 글' then
      raise exception '앨범 글 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    begin
      perform public.update_album_post_text(v_t_other, v_id, '남의 글');
      raise exception '다른 문파원이 남의 앨범 글을 고쳤습니다.';
    exception when sqlstate '42501' then null;
    end;
    perform public.update_album_post_text(v_t_off, v_id, '운영진이 고친 글');
    select * into v_row from private.album_posts where id = v_id;
    if v_row.caption <> '운영진이 고친 글' or v_row.title <> '운영진이 고친 글' then
      raise exception '운영진의 앨범 글 수정 결과가 다릅니다: %', row_to_json(v_row);
    end if;
    perform public.update_album_post_text(v_t_mem, v_id, '');
    select * into v_row from private.album_posts where id = v_id;
    if v_row.caption <> '' or v_row.title <> '' then
      raise exception '빈 글로 지우기가 안 됩니다: %', row_to_json(v_row);
    end if;
    begin
      perform public.update_album_post_text(v_t_mem, v_id, repeat('가', 301));
      raise exception '301자 글이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑥ 로그인하지 않은 토큰은 28000
    begin
      perform public.update_guide('editverifybadtokeneditverifybadtoken', v_id, '제목', 'https://youtu.be/aqz-KE-bpKQ');
      raise exception '없는 토큰이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '글 수정 확인 — 공지 · 일정 · 쿠폰 · 공략 · 앨범 수정과 권한 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '연못 글 수정 마이그레이션 완료 — 자리비움만 빼고 모든 글을 고칠 수 있습니다.';
end $$;
