-- ============================================================================
--  연못 (Yeonmot Munpa) · '일정 → 문파컨텐츠 · 매주 반복' 마이그레이션
--    (파일 이름: supabase/migration-clan-contents.sql)
--
--  대상: 이미 schema.sql · migration-v2/v3/v4/duck/album-text/edit-posts 로
--        설치해 쓰는 Supabase 프로젝트
--  실행: Supabase 대시보드 → SQL Editor → 이 파일 전체를 붙여 넣고 Run
--        (여러 번 실행해도 같은 결과입니다 · 문파 기록은 그대로 남습니다)
--
--  ■ 무엇이 바뀌나 — 홈의 '모임 일정' 섹션이 '문파컨텐츠'가 되고, 매주 반복을 담습니다
--     · public.events 에 두 칸을 더합니다
--         repeat_weekly    boolean   기본 false   — 매주 반복 여부
--         repeat_weekdays  smallint[] 기본 '{}'    — 반복 요일 (0=일 · 1=월 … 6=토)
--     · admin_create_event / admin_update_event 에 두 파라미터를 더합니다
--         p_repeat_weekly   boolean   default false
--         p_repeat_weekdays smallint[] default '{}'
--       → 예전 호출(두 파라미터 없이 부르던 앱)도 그대로 동작합니다.
--     · 매주 반복이면 p_starts_at 의 '시각(HH:MM)'만 쓰고 날짜는 가장 가까운 다음
--       예정일로 다시 계산해 저장합니다(카드 정렬이 자연스럽도록).
--     · repeat_weekly = true 인데 요일이 비어 있으면 22023 으로 거절합니다.
--
--  ■ 기존 기록
--     · 이미 있는 문파컨텐츠는 repeat_weekly = false 로 남습니다(한 번만 하는 일정).
--     · 표 구조는 칸을 더할 뿐, 지우거나 바꾸지 않습니다. RLS·다른 함수도 그대로입니다.
--
--  ■ 안전한가
--     · 멱등: add column if not exists · create or replace · 권한 재부여
--     · 확인 블록이 임시 문파원·세션을 만들어 실제로 만들고·고치고·거절되는지 보고
--       마지막에 전부 되돌립니다 — 문파에 남는 행은 없습니다.
--       실패하면 아무것도 바뀌지 않고 오류로 알려 줍니다.
-- ============================================================================

-- 0) 이미 설치된 DB 인지 먼저 확인
do $$
begin
  if to_regclass('private.members') is null
     or to_regclass('public.events') is null
     or to_regprocedure('private.require_admin(text)') is null then
    raise exception '연못 DB 가 아직 준비되지 않았습니다. 먼저 supabase/schema.sql 을 실행해 주세요.';
  end if;
end $$;


-- ============================================================================
-- ① public.events — 매주 반복 칸 두 개
-- ============================================================================
alter table public.events
  add column if not exists repeat_weekly boolean not null default false;

alter table public.events
  add column if not exists repeat_weekdays smallint[] not null default '{}';

comment on column public.events.repeat_weekly is '매주 반복 여부. true 면 repeat_weekdays 의 요일마다 같은 시간에 열립니다.';
comment on column public.events.repeat_weekdays is '반복 요일 (0=일 … 6=토). repeat_weekly = false 면 빈 배열입니다.';

/* 요일 값은 0~6 만, 매주 반복이면 최소 한 요일 — 표에서도 한 번 더 막습니다. */
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'events_repeat_weekdays_range'
                    and conrelid = 'public.events'::regclass) then
    alter table public.events
      add constraint events_repeat_weekdays_range
      check (repeat_weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'events_repeat_weekdays_shape'
                    and conrelid = 'public.events'::regclass) then
    alter table public.events
      add constraint events_repeat_weekdays_shape
      check (not repeat_weekly or cardinality(repeat_weekdays) between 1 and 7);
  end if;
end $$;


-- ============================================================================
-- ② 반복 요일 도우미 — 정리(normalize)와 '다음 예정 시각'
-- ============================================================================
create or replace function private.normalize_weekdays(p_days smallint[])
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_days smallint[];
begin
  if p_days is null then
    return '{}'::smallint[];
  end if;
  select coalesce(array_agg(d order by d), '{}'::smallint[])
    into v_days
    from (select distinct unnest(p_days) as d) s;
  if exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
    raise exception '요일 값이 올바르지 않아요. (0=일 … 6=토)' using errcode = '22023';
  end if;
  return v_days;
end;
$fn$;

/* 요일·시각 해석은 한국 시간(Asia/Seoul) 기준입니다. */
create or replace function private.next_weekly_at(
  p_anchor timestamptz,
  p_days   smallint[],
  p_from   timestamptz default null
)
returns timestamptz
language plpgsql
set search_path = ''
as $fn$
declare
  v_tz   text := 'Asia/Seoul';
  v_time time := (p_anchor at time zone 'Asia/Seoul')::time;
  v_from timestamptz := date_trunc('minute', coalesce(p_from, now()));
  v_day  date := (date_trunc('minute', coalesce(p_from, now())) at time zone 'Asia/Seoul')::date;
  v_i    int;
  v_at   timestamptz;
begin
  for v_i in 0..7 loop
    if extract(dow from (v_day + v_i))::smallint = any(p_days) then
      v_at := ((v_day + v_i) + v_time) at time zone 'Asia/Seoul';
      if v_at >= v_from then
        return v_at;
      end if;
    end if;
  end loop;
  return ((v_day + 7) + v_time) at time zone 'Asia/Seoul';
end;
$fn$;

revoke all on function private.normalize_weekdays(smallint[]) from public;
revoke all on function private.next_weekly_at(timestamptz, smallint[], timestamptz) from public;


-- ============================================================================
-- ③ 문파컨텐츠 작성 — 문주만 (schema.sql 과 같은 정의)
--     예전 함수(파라미터 7개)는 지우고, 두 파라미터를 더한 함수로 바꿉니다.
--     (지우지 않으면 같은 이름의 함수가 둘이 되어 PostgREST 가 어느 쪽인지 고르지 못합니다)
-- ============================================================================
drop function if exists public.admin_create_event(text, text, timestamptz, text, text, text, timestamptz);

create or replace function public.admin_create_event(
  p_token           text,
  p_title           text,
  p_starts_at       timestamptz,
  p_place           text default '',
  p_tag             text default '모임',
  p_note            text default '',
  p_ends_at         timestamptz default null,
  p_repeat_weekly   boolean default false,
  p_repeat_weekdays smallint[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_place text := btrim(coalesce(p_place, ''));
  v_tag   text := btrim(coalesce(p_tag, '모임'));
  v_note  text := btrim(coalesce(p_note, ''));
  v_days  smallint[];
  v_start timestamptz;
  v_ends  timestamptz := p_ends_at;
  v_event public.events;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '문파컨텐츠 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception '문파컨텐츠 날짜와 시간을 정해 주세요.' using errcode = '22023';
  end if;
  if char_length(v_place) > 60 or char_length(v_tag) > 10 or char_length(v_note) > 200 then
    raise exception '장소·태그·메모 길이를 확인해 주세요.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception '끝나는 시간이 시작보다 빨라요.' using errcode = '22023';
  end if;

  v_days := private.normalize_weekdays(p_repeat_weekdays);
  if coalesce(p_repeat_weekly, false) then
    if cardinality(v_days) = 0 then
      raise exception '매주 반복은 요일을 하나 이상 골라 주세요.' using errcode = '22023';
    end if;
    v_start := private.next_weekly_at(p_starts_at, v_days);
    if v_ends is not null then
      v_ends := v_start + (p_ends_at - p_starts_at);
    end if;
  else
    v_days  := '{}'::smallint[];
    v_start := p_starts_at;
  end if;

  insert into public.events (title, place, tag, note, starts_at, ends_at,
                             repeat_weekly, repeat_weekdays, created_by)
  values (v_title, v_place, v_tag, v_note, v_start, v_ends,
          coalesce(p_repeat_weekly, false), v_days, v_actor.member_id)
  returning * into v_event;

  perform private.log_admin(v_actor.member_id, 'event.create', 'event', v_event.id::text, '{}'::jsonb);

  return jsonb_build_object(
    'id', v_event.id,
    'title', v_event.title,
    'starts_at', v_event.starts_at,
    'place', v_event.place,
    'repeat_weekly', v_event.repeat_weekly,
    'repeat_weekdays', to_jsonb(v_event.repeat_weekdays)
  );
end;
$fn$;


-- ============================================================================
-- ④ 문파컨텐츠 수정 — 문주만 · '한 번만 ↔ 매주 반복' 전환도 여기서
-- ============================================================================
drop function if exists public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz);

create or replace function public.admin_update_event(
  p_token           text,
  p_event_id        uuid,
  p_title           text,
  p_starts_at       timestamptz,
  p_place           text default null,
  p_tag             text default null,
  p_note            text default null,
  p_ends_at         timestamptz default null,
  p_repeat_weekly   boolean default false,
  p_repeat_weekdays smallint[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor private.session_actor := private.require_admin(p_token);
  v_title text := btrim(coalesce(p_title, ''));
  v_days  smallint[];
  v_start timestamptz;
  v_ends  timestamptz;
  v_old   public.events;
begin
  if char_length(v_title) = 0 or char_length(v_title) > 60 then
    raise exception '문파컨텐츠 이름은 1~60자로 적어 주세요.' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception '문파컨텐츠 날짜와 시간을 정해 주세요.' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception '끝나는 시간이 시작보다 빨라요.' using errcode = '22023';
  end if;

  select * into v_old
    from public.events
   where id = p_event_id
     and deleted_at is null;
  if not found then
    raise exception '문파컨텐츠를 찾을 수 없어요.' using errcode = 'P0002';
  end if;

  v_ends := coalesce(p_ends_at, v_old.ends_at);
  v_days := private.normalize_weekdays(p_repeat_weekdays);
  if coalesce(p_repeat_weekly, false) then
    if cardinality(v_days) = 0 then
      raise exception '매주 반복은 요일을 하나 이상 골라 주세요.' using errcode = '22023';
    end if;
    v_start := private.next_weekly_at(p_starts_at, v_days);
    if v_ends is not null then
      v_ends := v_start + (v_ends - v_old.starts_at);
    end if;
  else
    v_days  := '{}'::smallint[];
    v_start := p_starts_at;
  end if;

  update public.events
     set title = v_title,
         starts_at = v_start,
         place = coalesce(btrim(p_place), place),
         tag = coalesce(nullif(btrim(p_tag), ''), tag),
         note = coalesce(btrim(p_note), note),
         ends_at = v_ends,
         repeat_weekly = coalesce(p_repeat_weekly, false),
         repeat_weekdays = v_days
   where id = p_event_id
     and deleted_at is null;

  perform private.log_admin(v_actor.member_id, 'event.update', 'event', p_event_id::text, '{}'::jsonb);

  return jsonb_build_object('id', p_event_id, 'ok', true,
                            'repeat_weekly', coalesce(p_repeat_weekly, false),
                            'repeat_weekdays', to_jsonb(v_days));
end;
$fn$;


-- 앞의 create 또는 replace 가 같은 이름의 다른 함수를 남기지 않았는지 — 하나씩만 있어야 합니다
do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('admin_create_event', 'admin_update_event');
  if v_count <> 2 then
    raise exception '문파컨텐츠 함수가 %개입니다(2개여야 합니다). SQL Editor 에서 이 파일을 처음부터 다시 실행해 주세요.', v_count;
  end if;
end $$;


-- ============================================================================
-- ⑤ 함수 실행 권한 — 앱(anon 키)이 부를 수 있게
-- ============================================================================
revoke all on function public.admin_create_event(text, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]) from public;
grant execute on function public.admin_create_event(text, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]) to anon, authenticated;

revoke all on function public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]) from public;
grant execute on function public.admin_update_event(text, uuid, text, timestamptz, text, text, text, timestamptz, boolean, smallint[]) to anon, authenticated;


-- ============================================================================
-- ⑥ 확인 — 임시 문파원으로 실제로 만들어 보고, 마지막에 전부 되돌립니다
-- ============================================================================
do $$
declare
  v_admin   private.members;
  v_member  private.members;
  v_t_admin text;
  v_t_mem   text;
  v_id      uuid;
  v_row     public.events;
  v_json    jsonb;
  v_kst     timestamptz := now();
  v_days    smallint[] := array[1, 3]::smallint[];   -- 월 · 수
begin
  if has_function_privilege('anon',
       'public.admin_create_event(text,text,timestamptz,text,text,text,timestamptz,boolean,smallint[])', 'execute') = false
     or has_function_privilege('anon',
       'public.admin_update_event(text,uuid,text,timestamptz,text,text,text,timestamptz,boolean,smallint[])', 'execute') = false then
    raise exception 'anon 이 문파컨텐츠 함수를 부를 수 없습니다.';
  end if;

  begin
    insert into private.members (nickname, pin_hash, member_role)
    values ('컨텐츠문주' || substr(md5(random()::text), 1, 4), 'clan-verify', 'admin')
    returning * into v_admin;
    insert into private.members (nickname, pin_hash, member_role)
    values ('컨텐츠문파' || substr(md5(random()::text), 1, 4), 'clan-verify', 'member')
    returning * into v_member;

    v_t_admin := 'clanverify' || md5(random()::text) || md5(random()::text);
    v_t_mem   := 'clanverify' || md5(random()::text) || md5(random()::text);
    insert into private.member_sessions (member_id, token_hash, expires_at)
    values (v_admin.id, private.token_hash(v_t_admin), now() + interval '10 minutes'),
           (v_member.id, private.token_hash(v_t_mem), now() + interval '10 minutes');

    -- ① 한 번만 하는 문파컨텐츠 — 요일은 비워 둡니다
    v_json := public.admin_create_event(v_t_admin, '확인용 한 번 컨텐츠', v_kst + interval '1 day', '연못', '모임', '메모');
    v_id := (v_json->>'id')::uuid;
    select * into v_row from public.events where id = v_id;
    if v_row.repeat_weekly or cardinality(v_row.repeat_weekdays) <> 0 then
      raise exception '한 번만 컨텐츠에 반복 요일이 붙었습니다: %', row_to_json(v_row);
    end if;
    if v_row.starts_at <> v_kst + interval '1 day' then
      raise exception '한 번만 컨텐츠의 시각이 그대로 저장되지 않았습니다: %', v_row.starts_at;
    end if;

    -- ② 매주 반복 — 요일을 넣으면 그 요일의 다음 예정일로 맞춰집니다
    v_json := public.admin_create_event(v_t_admin, '확인용 매주 컨텐츠', v_kst + interval '30 days',
                                        '3구역', '원정', '매주', null, true, v_days);
    v_id := (v_json->>'id')::uuid;
    select * into v_row from public.events where id = v_id;
    if v_row.repeat_weekly = false or v_row.repeat_weekdays <> v_days then
      raise exception '매주 반복 컨텐츠의 요일이 다릅니다: %', row_to_json(v_row);
    end if;
    if not (extract(dow from (v_row.starts_at at time zone 'Asia/Seoul'))::smallint = any(v_days)) then
      raise exception '매주 반복의 시작일이 고른 요일이 아닙니다: %', v_row.starts_at;
    end if;
    if v_row.starts_at < date_trunc('minute', now()) then
      raise exception '매주 반복의 시작일이 지난 날입니다: %', v_row.starts_at;
    end if;
    if to_char(v_row.starts_at at time zone 'Asia/Seoul', 'HH24:MI')
       <> to_char((v_kst + interval '30 days') at time zone 'Asia/Seoul', 'HH24:MI') then
      raise exception '매주 반복이 입력한 시각을 지키지 않았습니다: %', v_row.starts_at;
    end if;

    -- ③ 요일 없이 매주 반복은 22023
    begin
      perform public.admin_create_event(v_t_admin, '요일 없음', v_kst, '', '모임', '', null, true, '{}'::smallint[]);
      raise exception '요일 없는 매주 반복이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ④ 0~6 밖의 요일은 22023
    begin
      perform public.admin_create_event(v_t_admin, '요일 이상', v_kst, '', '모임', '', null, true, array[7]::smallint[]);
      raise exception '요일 7 이 통과되었습니다.';
    exception when sqlstate '22023' then null;
    end;

    -- ⑤ 매주 → 한 번만 전환: 요일이 지워집니다
    perform public.admin_update_event(v_t_admin, v_id, '한 번만으로', v_kst + interval '2 days',
                                      '연못 입구', '모임', '', null, false, '{}'::smallint[]);
    select * into v_row from public.events where id = v_id;
    if v_row.repeat_weekly or cardinality(v_row.repeat_weekdays) <> 0 then
      raise exception '한 번만으로 바꾼 뒤에도 반복이 남았습니다: %', row_to_json(v_row);
    end if;

    -- ⑥ 한 번만 → 매주 전환: 요일이 붙고 시작일이 그 요일로 맞춰집니다
    perform public.admin_update_event(v_t_admin, v_id, '다시 매주', v_kst + interval '2 days',
                                      '연못 입구', '모임', '', null, true, array[6, 0]::smallint[]);
    select * into v_row from public.events where id = v_id;
    if v_row.repeat_weekly = false or v_row.repeat_weekdays <> array[0, 6]::smallint[] then
      raise exception '매주로 바꾼 결과가 다릅니다(요일은 0,6 순서로 정리): %', row_to_json(v_row);
    end if;
    if not (extract(dow from (v_row.starts_at at time zone 'Asia/Seoul'))::smallint = any(v_row.repeat_weekdays)) then
      raise exception '매주로 바꾼 시작일이 고른 요일이 아닙니다: %', v_row.starts_at;
    end if;

    -- ⑦ 문파원은 만들 수 없습니다 (42501)
    begin
      perform public.admin_create_event(v_t_mem, '몰래', v_kst, '', '모임', '', null, true, v_days);
      raise exception '문파원이 문파컨텐츠를 만들었습니다.';
    exception when sqlstate '42501' then null;
    end;

    -- ⑧ 로그인 없이 부르면 28000
    begin
      perform public.admin_update_event('clanverifybadtokenclanverifybad', v_id, '몰래', v_kst,
                                        null, null, null, null, true, v_days);
      raise exception '없는 토큰이 통과되었습니다.';
    exception when sqlstate '28000' then null;
    end;

    raise exception 'rollback-check';   -- 확인용 행·세션·임시 문파원을 모두 되돌립니다
  exception
    when others then
      if sqlerrm <> 'rollback-check' then raise; end if;
  end;

  raise notice '문파컨텐츠 확인 — 한 번 · 매주 만들기, 요일 검증, 한 번↔매주 전환, 권한 거절이 모두 정상입니다. 확인용 행은 저장되지 않았습니다.';
  raise notice '연못 마이그레이션 완료 — 일정이 문파컨텐츠가 되고 매주 반복을 담을 수 있습니다.';
end $$;
