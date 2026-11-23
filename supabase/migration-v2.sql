-- ============================================================================
--  연못 (Yeonmot Munpa) · v2 마이그레이션 — ① 프로필 그림  ② 홈 '공략' 유튜브 영상
--  대상: 이미 schema.sql(v1)로 설치해 쓰고 있는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과가 됩니다 · 기존 데이터는 그대로)
--
--  ① 프로필 그림
--     · private.members.avatar 추가
--       'preset:lotus' | 'preset:koi' | 'preset:frog' | 'preset:firefly'
--       'preset:moon'  | 'preset:leaf' | 'preset:turtle' | 'preset:lantern'
--       'data:image/(jpeg|webp|png);base64,…' (앱이 128×128 · 10~25KB 로 줄여 보냄)
--       null 이면 지금처럼 닉네임 첫 글자
--     · public.public_members 뷰에 avatar 추가 (끝에 덧붙임 → 기존 열 순서 유지)
--     · register_member · login_member · my_profile · clan_overview ·
--       post_chat_message · list_chat_messages · list_album_posts · admin_list_members 에 avatar 포함
--     · 새 RPC public.update_my_avatar(p_token, p_avatar)
--
--  ② 공략 (홈 '사냥 팁' → 유튜브 영상 2×2)
--     · public.guides (id, title, youtube_url, video_id, created_by, created_at, deleted_at)
--     · public.list_guides(p_token)   — 문파원 누구나
--     · public.create_guide(p_token, p_title, p_youtube_url)
--         올리기: 로그인한 문파원 누구나. 유튜브 주소에서 영상 ID 를 서버에서도 다시 확인.
--     · public.delete_guide(p_token, p_guide_id)
--         삭제: 올린 본인(created_by) 또는 운영진(admin · officer)만.
--
--  ■ 안전한가
--    · 멱등: add column if not exists / create table if not exists /
--      create or replace function · view / drop policy if exists 후 생성
--    · avatar 는 65,000자(≈48KB) 이하, 사진은 48KB 이하만 받습니다.
--    · 세션 검증은 private.current_member 가 담당하고,
--      삭제 권한은 본인 여부와 member_role 로 함수 안에서 확인합니다.
-- ============================================================================


-- ============================================================================
-- ① 프로필 그림
-- ============================================================================
alter table private.members add column if not exists avatar text;

alter table private.members drop constraint if exists members_avatar_len;
alter table private.members add constraint members_avatar_len
  check (avatar is null or char_length(avatar) <= 65000);

comment on column private.members.avatar is
  '프로필 그림. preset:(lotus|koi|frog|firefly|moon|leaf|turtle|lantern) 또는 data:image/…;base64 (65,000자 이하). null=닉네임 첫 글자.';

-- 공개 뷰 — 기존 열 순서를 유지하고 avatar 를 끝에 붙입니다
create or replace view public.public_members
with (security_invoker = false)
as
select
  m.id,
  m.nickname,
  m.member_role,
  m.member_level,
  m.joined_at,
  m.last_seen_at,
  m.avatar
from private.members m
where m.status = 'active';

comment on view public.public_members is '문파원 목록(활성). pin_hash·상태 사유 등은 노출하지 않습니다.';

revoke all on public.public_members from public;
grant select on public.public_members to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 회원 정보 RPC (schema.sql 과 같은 본문)
-- ---------------------------------------------------------------------------
create or replace function public.register_member(
  p_nickname    text,
  p_pin         text,
  p_invite_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_nick      text := btrim(coalesce(p_nickname, ''));
  v_settings  private.clan_settings;
  v_member    private.members;
  v_token     text;
  v_role      text;
  v_admin_cnt integer;
begin
  if v_nick !~ '^[가-힣a-zA-Z0-9_]{2,10}$' then
    raise exception '닉네임은 한글·영문·숫자 2~10자로 정해 주세요.' using errcode = '22023';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN은 숫자 4자리로 입력해 주세요.' using errcode = '22023';
  end if;

  select * into v_settings from private.clan_settings where id = 1;
  if not found then
    raise exception '문파 설정이 아직 준비되지 않았어요.' using errcode = '55000';
  end if;

  -- 가입 처리를 한 줄로 세웁니다. 두 사람이 동시에 첫 가입을 해도
  -- '문주가 없을 때' 판정과 INSERT 사이가 벌어지지 않아 문주가 둘 생기지 않습니다.
  perform pg_advisory_xact_lock(917311);

  -- 초대 코드는 대소문자를 가리지 않습니다(저장은 항상 대문자).
  if p_invite_code is null
     or upper(btrim(p_invite_code)) <> upper(v_settings.invite_code) then
    raise exception '초대 코드가 맞지 않아요. 운영진에게 확인해 주세요.' using errcode = '28000';
  end if;

  select * into v_member
    from private.members m
   where m.nickname_key = lower(v_nick);

  if found then
    raise exception '이미 쓰고 있는 닉네임이에요.' using errcode = '23505';
  end if;

  if (select count(*) from private.members m where m.status = 'active')
       >= v_settings.member_capacity then
    raise exception '문파 정원이 가득 찼어요. 운영진에게 문의해 주세요.' using errcode = '54000';
  end if;

  select count(*) into v_admin_cnt
    from private.members m
   where m.member_role = 'admin' and m.status = 'active';

  v_role := case when v_admin_cnt = 0 then 'admin' else 'member' end;

  insert into private.members (nickname, pin_hash, member_role, last_seen_at)
  values (v_nick, private.pin_hash(p_pin), v_role, now())
  returning * into v_member;

  v_token := private.issue_session(v_member.id);

  perform private.log_admin(v_member.id, 'member.register', 'member', v_member.id::text,
                            jsonb_build_object('role', v_role));

  return jsonb_build_object(
    'token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'nickname', v_member.nickname,
      'role', v_member.member_role,
      'level', v_member.member_level,
      'avatar', v_member.avatar
    ),
    'is_first_admin', v_role = 'admin'
  );
exception
  when unique_violation then
    raise exception '이미 쓰고 있는 닉네임이에요.' using errcode = '23505';
end;
$fn$;


create or replace function public.login_member(
  p_nickname text,
  p_pin      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_nick    text := btrim(coalesce(p_nickname, ''));
  v_member  private.members;
  v_token   text;
  v_fails   integer;
  v_wait    integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_credentials',
      'message', '닉네임 또는 PIN이 맞지 않아요.');
  end if;

  select * into v_member
    from private.members m
   where m.nickname_key = lower(v_nick)
   for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_credentials',
      'message', '닉네임 또는 PIN이 맞지 않아요.');
  end if;

  if v_member.locked_until is not null and v_member.locked_until > now() then
    return jsonb_build_object(
      'ok', false, 'code', 'locked',
      'message', 'PIN을 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.',
      'retry_after', ceil(extract(epoch from (v_member.locked_until - now())))::integer);
  end if;

  if not private.pin_matches(p_pin, v_member.pin_hash) then
    v_fails := v_member.failed_login_count + 1;
    v_wait  := case when v_fails >= 5 then least(300, 30 * (v_fails - 4)) else 0 end;

    update private.members
       set failed_login_count = v_fails,
           locked_until = case
             when v_wait > 0 then now() + (v_wait * interval '1 second')
             else null
           end
     where id = v_member.id;

    return jsonb_build_object(
      'ok', false,
      'code', case when v_wait > 0 then 'locked' else 'invalid_credentials' end,
      'message', case when v_wait > 0
                      then 'PIN을 여러 번 틀렸어요. 잠시 후 다시 시도해 주세요.'
                      else '닉네임 또는 PIN이 맞지 않아요.' end,
      'retry_after', v_wait);
  end if;

  -- PIN 이 맞은 뒤에야 상태를 알려 줍니다(닉네임 존재 여부 노출 최소화).
  if v_member.status <> 'active' then
    return jsonb_build_object(
      'ok', false, 'code', 'blocked',
      'message', '이 닉네임으로는 접속할 수 없어요. 운영진에게 문의해 주세요.');
  end if;

  update private.members
     set failed_login_count = 0,
         locked_until = null,
         last_seen_at = now()
   where id = v_member.id;

  v_token := private.issue_session(v_member.id);

  return jsonb_build_object(
    'ok', true,
    'token', v_token,
    'member', jsonb_build_object(
      'id', v_member.id,
      'nickname', v_member.nickname,
      'role', v_member.member_role,
      'level', v_member.member_level,
      'avatar', v_member.avatar
    )
  );
end;
$fn$;


create or replace function public.my_profile(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_member private.members;
  v_today  date := private.today_kst();
  v_streak integer := 0;
  v_total  integer := 0;
begin
  select * into v_member from private.members m where m.id = v_actor.member_id;

  select count(*) into v_total
    from private.attendance a
   where a.member_id = v_actor.member_id;

  select count(*) into v_streak
    from (
      select a.day, row_number() over (order by a.day desc) as rn
        from private.attendance a
       where a.member_id = v_actor.member_id
         and a.day <= v_today
    ) d
   where d.day = v_today - (d.rn - 1)::integer;

  return jsonb_build_object(
    'id', v_member.id,
    'nickname', v_member.nickname,
    'role', v_member.member_role,
    'level', v_member.member_level,
    'avatar', v_member.avatar,
    'joined_at', v_member.joined_at,
    'last_seen_at', v_member.last_seen_at,
    'wave', jsonb_build_object(
      'today_done', exists (select 1 from private.attendance a
                             where a.member_id = v_actor.member_id and a.day = v_today),
      'streak', v_streak,
      'total', v_total
    )
  );
end;
$fn$;


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
                        'preset:moon', 'preset:leaf', 'preset:turtle', 'preset:lantern') then
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
    raise exception '프로필 그림은 연못 그림 8종이나 사진만 쓸 수 있어요.' using errcode = '22023';
  end if;

  update private.members set avatar = v_avatar where id = v_actor.member_id;

  return jsonb_build_object('ok', true, 'avatar', v_avatar, 'bytes', v_bytes);
end;
$fn$;


create or replace function public.post_chat_message(
  p_token text,
  p_body  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
  v_body  text := btrim(coalesce(p_body, ''));
  v_member private.members;
  v_msg   public.chat_messages;
  v_recent integer;
begin
  if char_length(v_body) = 0 then
    raise exception '보낼 내용을 적어 주세요.' using errcode = '22023';
  end if;
  if char_length(v_body) > 500 then
    raise exception '메시지는 500자까지 보낼 수 있어요.' using errcode = '22023';
  end if;

  select count(*) into v_recent
    from public.chat_messages c
   where c.member_id = v_actor.member_id
     and c.created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    raise exception '메시지를 너무 빠르게 보내고 있어요. 잠시 쉬었다 보내 주세요.' using errcode = '53300';
  end if;

  select * into v_member from private.members m where m.id = v_actor.member_id;

  insert into public.chat_messages (member_id, kind, body)
  values (v_actor.member_id, 'text', v_body)
  returning * into v_msg;

  return jsonb_build_object(
    'id', v_msg.id,
    'member_id', v_msg.member_id,
    'nickname', v_actor.nickname,
    'role', v_actor.member_role,
    'avatar', v_member.avatar,
    'body', v_msg.body,
    'created_at', v_msg.created_at
  );
end;
$fn$;


create or replace function public.list_chat_messages(
  p_token  text,
  p_limit  integer default 50,
  p_before bigint  default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_result jsonb;
begin
  with picked as (
    select c.id, c.member_id, c.kind, c.body, c.created_at,
           m.nickname, m.member_role, m.avatar
      from public.chat_messages c
      left join private.members m on m.id = c.member_id
     where c.deleted_at is null
       and (p_before is null or c.id < p_before)
     order by c.id desc
     limit v_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'member_id', p.member_id,
               'nickname', p.nickname,
               'role', p.member_role,
               'avatar', p.avatar,
               'kind', p.kind,
               'body', p.body,
               'created_at', p.created_at
             ) order by p.id
           ),
           '[]'::jsonb
         )
    into v_result
    from picked p;

  return v_result;
end;
$fn$;


create or replace function public.clan_overview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor    private.session_actor := private.current_member(p_token);
  v_settings private.clan_settings;
  v_today    date := private.today_kst();
  v_members  integer;
  v_new      integer;
  v_today_w  integer;
  v_week_w   integer;
  v_streak   integer := 0;
  v_total    integer := 0;
begin
  select * into v_settings from private.clan_settings where id = 1;

  select count(*) into v_members from private.members m where m.status = 'active';
  select count(*) into v_new
    from private.members m
   where m.status = 'active' and m.joined_at > now() - interval '7 days';
  select count(*) into v_today_w from private.attendance a where a.day = v_today;
  select count(*) into v_week_w
    from private.attendance a
   where a.day > v_today - 7;

  select count(*) into v_total
    from private.attendance a
   where a.member_id = v_actor.member_id;

  select count(*) into v_streak
    from (
      select a.day, row_number() over (order by a.day desc) as rn
        from private.attendance a
       where a.member_id = v_actor.member_id
         and a.day <= v_today
    ) d
   where d.day = v_today - (d.rn - 1)::integer;

  return jsonb_build_object(
    'clan', jsonb_build_object(
      'name', v_settings.clan_name,
      'motto', v_settings.clan_motto,
      'capacity', v_settings.member_capacity,
      'member_count', v_members,
      'new_members_7d', v_new,
      'today_waves', v_today_w,
      'week_waves', v_week_w
    ),
    'me', jsonb_build_object(
      'id', v_actor.member_id,
      'nickname', v_actor.nickname,
      'role', v_actor.member_role,
      'level', v_actor.member_level,
      'avatar', (select m.avatar from private.members m where m.id = v_actor.member_id),
      'today_wave', exists (select 1 from private.attendance a
                             where a.member_id = v_actor.member_id and a.day = v_today),
      'streak', v_streak,
      'total_waves', v_total
    )
  );
end;
$fn$;


create or replace function public.list_album_posts(
  p_token  text,
  p_limit  integer     default 12,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_limit  integer := greatest(1, least(coalesce(p_limit, 12), 30));
  v_result jsonb;
begin
  with picked as (
    select p.id, p.member_id, p.title, p.caption, p.image_mime,
           p.image_bytes, p.created_at
      from private.album_posts p
     where p.deleted_at is null
       and (p_before is null or p.created_at < p_before)
     order by p.created_at desc
     limit v_limit
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', q.id,
               'title', q.title,
               'caption', q.caption,
               'author_id', q.member_id,
               'author', m.nickname,
               'author_role', m.member_role,
               'author_avatar', m.avatar,
               'image_mime', q.image_mime,
               'image_bytes', q.image_bytes,
               'likes', (select count(*) from private.album_likes l where l.post_id = q.id),
               'liked', exists (select 1 from private.album_likes l
                                 where l.post_id = q.id and l.member_id = v_actor.member_id),
               'created_at', q.created_at
             ) order by q.created_at desc
           ),
           '[]'::jsonb
         )
    into v_result
    from picked q
    join private.members m on m.id = q.member_id;

  return v_result;
end;
$fn$;


create or replace function public.admin_list_members(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.require_admin(p_token);
  v_today  date := private.today_kst();
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.x order by s.priority, s.joined_at), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', m.id,
               'nickname', m.nickname,
               'role', m.member_role,
               'level', m.member_level,
               'status', m.status,
               'status_reason', m.status_reason,
               'status_changed_at', m.status_changed_at,
               'avatar', m.avatar,
               'joined_at', m.joined_at,
               'last_seen_at', m.last_seen_at,
               'wave_today', exists (select 1 from private.attendance a
                                      where a.member_id = m.id and a.day = v_today)
             ) as x,
             case m.member_role when 'admin' then 0 when 'officer' then 1 else 2 end as priority,
             m.joined_at,
             case m.status when 'active' then 0 when 'kicked' then 1 else 2 end as status_order
        from private.members m
    ) s;

  return v_result;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 공략 테이블 (개인정보 없음: 제목 · 유튜브 주소 · 영상 ID)
-- ---------------------------------------------------------------------------
create table if not exists public.guides (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 80),
  youtube_url text not null check (char_length(youtube_url) between 8 and 300),
  video_id    text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  created_by  uuid references private.members (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists guides_created_idx
  on public.guides (created_at desc)
  where deleted_at is null;

comment on table public.guides is '홈 공략 섹션의 유튜브 영상. 썸네일은 i.ytimg.com/vi/{video_id}/hqdefault.jpg.';

alter table public.guides enable row level security;

revoke all on table public.guides from public, anon, authenticated;
grant select on table public.guides to anon, authenticated;

drop policy if exists guides_read on public.guides;
create policy guides_read on public.guides
  for select to anon, authenticated
  using (deleted_at is null);


-- ---------------------------------------------------------------------------
-- 공략 RPC (schema.sql 과 같은 본문)
-- ---------------------------------------------------------------------------
create or replace function public.list_guides(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  private.session_actor := private.current_member(p_token);
  v_result jsonb;
begin
  select coalesce(jsonb_agg(s.item order by s.created_at desc), '[]'::jsonb)
    into v_result
    from (
      select jsonb_build_object(
               'id', g.id,
               'title', g.title,
               'youtube_url', g.youtube_url,
               'video_id', g.video_id,
               'created_by', g.created_by,
               'created_at', g.created_at
             ) as item,
             g.created_at
        from public.guides g
       where g.deleted_at is null
       order by g.created_at desc
       limit 24
    ) s;

  return v_result;
end;
$fn$;


create or replace function public.create_guide(
  p_token       text,
  p_title       text,
  p_youtube_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor   private.session_actor := private.current_member(p_token);
  v_title   text := btrim(coalesce(p_title, ''));
  v_url     text := btrim(coalesce(p_youtube_url, ''));
  v_video   text;
  v_guide   public.guides;
begin
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

  insert into public.guides (title, youtube_url, video_id, created_by)
  values (v_title, v_url, v_video, v_actor.member_id)
  returning * into v_guide;

  return jsonb_build_object(
    'id', v_guide.id,
    'title', v_guide.title,
    'youtube_url', v_guide.youtube_url,
    'video_id', v_guide.video_id,
    'created_by', v_guide.created_by,
    'created_at', v_guide.created_at
  );
end;
$fn$;


create or replace function public.delete_guide(
  p_token    text,
  p_guide_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.current_member(p_token);
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
    raise exception '내가 올린 공략이나 운영진만 지울 수 있어요.' using errcode = '42501';
  end if;

  update public.guides
     set deleted_at = now()
   where id = p_guide_id;

  perform private.log_admin(v_actor.member_id, 'guide.delete', 'guide', p_guide_id::text,
                            jsonb_build_object('by_role', v_actor.member_role,
                                               'owner', v_guide.created_by::text));

  return jsonb_build_object('id', p_guide_id, 'deleted', true);
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 실행 권한 (새 RPC · 기존 RPC 모두 다시 지정)
-- ---------------------------------------------------------------------------
revoke all on function public.update_my_avatar(text, text) from public;
grant execute on function public.update_my_avatar(text, text) to anon, authenticated;
revoke all on function public.list_guides(text) from public;
grant execute on function public.list_guides(text) to anon, authenticated;
revoke all on function public.create_guide(text, text, text) from public;
grant execute on function public.create_guide(text, text, text) to anon, authenticated;
revoke all on function public.delete_guide(text, uuid) from public;
grant execute on function public.delete_guide(text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 확인 (문제가 있으면 여기서 멈추고 오류를 보여 줍니다)
-- ---------------------------------------------------------------------------
do $$
declare
  v_col    integer;
  v_view   integer;
  v_table  integer;
  v_policy integer;
begin
  select count(*) into v_col
    from information_schema.columns
   where table_schema = 'private' and table_name = 'members' and column_name = 'avatar';
  if v_col <> 1 then
    raise exception 'private.members.avatar 열이 없습니다.';
  end if;

  select count(*) into v_view
    from information_schema.columns
   where table_schema = 'public' and table_name = 'public_members' and column_name = 'avatar';
  if v_view <> 1 then
    raise exception 'public.public_members 에 avatar 열이 없습니다.';
  end if;

  select count(*) into v_table
    from information_schema.tables
   where table_schema = 'public' and table_name = 'guides';
  if v_table <> 1 then
    raise exception 'public.guides 테이블이 없습니다.';
  end if;

  select count(*) into v_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'guides' and policyname = 'guides_read';
  if v_policy <> 1 then
    raise exception 'public.guides 의 guides_read 정책이 없습니다.';
  end if;

  if to_regprocedure('public.update_my_avatar(text,text)') is null then
    raise exception 'public.update_my_avatar(text,text) 가 없습니다.';
  end if;
  if to_regprocedure('public.list_guides(text)') is null then
    raise exception 'public.list_guides(text) 가 없습니다.';
  end if;
  if to_regprocedure('public.create_guide(text,text,text)') is null then
    raise exception 'public.create_guide(text,text,text) 가 없습니다.';
  end if;
  if to_regprocedure('public.delete_guide(text,uuid)') is null then
    raise exception 'public.delete_guide(text,uuid) 가 없습니다.';
  end if;

  raise notice '연못 v2 준비 완료 — 프로필 그림(avatar · update_my_avatar) · 공략(guides · create_guide · delete_guide) 확인.';
end $$;
