-- ===========================================================================
-- 마이홈 업데이트 2/3: 가격 함수 + 마이홈 RPC
--   · 01(migration-myhome-01-tables.sql) 이후에 실행
--   · p_token → private.current_member(session_actor), 실패 시 28000 예외
--   · search_path = '' + 전체 이름 명시, 에러는 한국어 + errcode
--   · 멱등: create or replace
-- ===========================================================================

-- 가격: 상시 상품만 12/1~12/31(KST) 20% 할인(내림), 시즌 한정은 정가.
create or replace function public.myhome_effective_price(p_item text)
returns int language sql stable security definer set search_path = '' as $$
  select case when s.is_limited then s.price
              when (now() at time zone 'Asia/Seoul')::date between date '2026-12-01' and date '2026-12-31'
                   then floor(s.price * 0.8)::int
              else s.price end
  from public.shop_items s where s.id = p_item;
$$;

-- 방 구경: is_public 방은 비로그인도 가능, 만료 토큰은 비로그인 취급. 내 방은 없으면 기본 행 생성.
create or replace function public.myhome_view_room(p_owner uuid, p_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_viewer uuid;
begin
  if p_token is not null then
    begin v_viewer := (private.current_member(p_token)).member_id;
    exception when sqlstate '28000' then v_viewer := null; end;
  end if;
  if v_viewer is not null and v_viewer = p_owner then
    insert into private.myhome_rooms(member_id) values (p_owner) on conflict do nothing;
  end if;
  if not exists (select 1 from private.myhome_rooms r
                 where r.member_id = p_owner and (r.is_public or r.member_id = v_viewer)) then
    return null;
  end if;
  return jsonb_build_object(
    'room', (select to_jsonb(r) from private.myhome_rooms r where r.member_id = p_owner),
    'items', (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
              from private.user_items i where i.member_id = p_owner and i.placed));
end $$;

-- 구매: 1아이템 1개 소장(unique), 잔액 가드는 UPDATE where 절로 원자 처리, 원장 동시 기록.
create or replace function public.myhome_purchase(p_token text, p_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor; it public.shop_items; v_price int;
begin
  v_actor := private.current_member(p_token);
  select * into it from public.shop_items s
   where s.id = p_item and s.active
     and (not s.is_limited or current_date between s.sale_start and s.sale_end);
  if it.id is null then raise exception '지금은 판매하지 않는 상품이에요.' using errcode = 'P0001'; end if;
  if exists (select 1 from private.user_items u
             where u.member_id = v_actor.member_id and u.item_id = p_item) then
    raise exception '이미 가지고 있는 아이템이에요.' using errcode = 'P0001';
  end if;
  v_price := public.myhome_effective_price(p_item);
  update private.members set point_balance = point_balance - v_price
   where id = v_actor.member_id and point_balance >= v_price;
  if not found then raise exception '포인트가 부족해요.' using errcode = 'P0001'; end if;
  insert into private.point_ledger(member_id, delta, reason, ref)
  values (v_actor.member_id, -v_price, 'purchase', p_item);
  insert into private.user_items(member_id, item_id) values (v_actor.member_id, p_item);
  return jsonb_build_object('ok', true, 'price', v_price);
end $$;

-- 장착: 슬롯당 1개(기존 슬롯 아이템은 자동 해제)
create or replace function public.myhome_equip(p_token text, p_item text, p_slot text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor;
begin
  v_actor := private.current_member(p_token);
  if p_slot not in ('avatar','costume','acc_head','acc_hand') then
    raise exception '잘못된 슬롯이에요.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.user_items u
                 where u.member_id = v_actor.member_id and u.item_id = p_item) then
    raise exception '가지고 있지 않은 아이템이에요.' using errcode = 'P0001';
  end if;
  update private.user_items set equipped_slot = null
   where member_id = v_actor.member_id and equipped_slot = p_slot;
  update private.user_items set equipped_slot = p_slot
   where member_id = v_actor.member_id and item_id = p_item;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.myhome_unequip(p_token text, p_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor;
begin
  v_actor := private.current_member(p_token);
  update private.user_items set equipped_slot = null
   where member_id = v_actor.member_id and item_id = p_item;
  return jsonb_build_object('ok', true);
end $$;

-- 일촌평 조회: 공개 방만(비로그인 OK), 작성자 닉네임 포함
create or replace function public.myhome_list_comments(p_owner uuid, p_limit int default 50)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
  from (select cm.id, cm.author_id, pm.nickname as author_nickname, cm.body, cm.created_at
        from private.myhome_comments cm
        left join public.public_members pm on pm.id = cm.author_id
        where cm.room_user_id = p_owner
          and exists (select 1 from private.myhome_rooms r
                      where r.member_id = p_owner and r.is_public)
        order by cm.created_at desc limit least(p_limit, 100)) c;
$$;

-- 일촌평 작성: 문파원만, 1~200자
create or replace function public.myhome_add_comment(p_token text, p_owner uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor;
begin
  v_actor := private.current_member(p_token);
  if char_length(trim(p_body)) not between 1 and 200 then
    raise exception '일촌평은 1~200자로 써 주세요.' using errcode = 'P0001';
  end if;
  insert into private.myhome_comments(room_user_id, author_id, body)
  values (p_owner, v_actor.member_id, trim(p_body));
  return jsonb_build_object('ok', true);
end $$;

-- 좋아요 토글
create or replace function public.myhome_toggle_like(p_token text, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor; v_on boolean;
begin
  v_actor := private.current_member(p_token);
  delete from private.likes where room_user_id = p_owner and user_id = v_actor.member_id;
  if found then v_on := false;
  else insert into private.likes values (p_owner, v_actor.member_id); v_on := true; end if;
  return jsonb_build_object('liked', v_on);
end $$;

-- 방문 기록(남의 방만)
create or replace function public.myhome_log_visit(p_token text, p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor private.session_actor;
begin
  v_actor := private.current_member(p_token);
  if v_actor.member_id <> p_owner then
    insert into private.visit_logs(room_user_id, visitor_id) values (p_owner, v_actor.member_id);
  end if;
end $$;

-- 권한 (migration-dosul.sql 패턴: 함수마다 전체 서명으로 revoke/grant)
revoke all on function public.myhome_effective_price(text) from public;
grant execute on function public.myhome_effective_price(text) to anon, authenticated;
revoke all on function public.myhome_view_room(uuid, text) from public;
grant execute on function public.myhome_view_room(uuid, text) to anon, authenticated;
revoke all on function public.myhome_purchase(text, text) from public;
grant execute on function public.myhome_purchase(text, text) to anon, authenticated;
revoke all on function public.myhome_equip(text, text, text) from public;
grant execute on function public.myhome_equip(text, text, text) to anon, authenticated;
revoke all on function public.myhome_unequip(text, text) from public;
grant execute on function public.myhome_unequip(text, text) to anon, authenticated;
revoke all on function public.myhome_list_comments(uuid, integer) from public;
grant execute on function public.myhome_list_comments(uuid, integer) to anon, authenticated;
revoke all on function public.myhome_add_comment(text, uuid, text) from public;
grant execute on function public.myhome_add_comment(text, uuid, text) to anon, authenticated;
revoke all on function public.myhome_toggle_like(text, uuid) from public;
grant execute on function public.myhome_toggle_like(text, uuid) to anon, authenticated;
revoke all on function public.myhome_log_visit(text, uuid) from public;
grant execute on function public.myhome_log_visit(text, uuid) to anon, authenticated;
