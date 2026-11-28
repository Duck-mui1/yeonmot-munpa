-- ===========================================================================
-- 마이홈 업데이트 5: 세트 구매 RPC (01~04 이후에 실행)
--   · shop_set_items 테이블과 category 'set' 허용은 01 파일에 있음
--   · 규칙: 세트 가격은 세트 자체 가격 / 구성품 중 보유분은 건너뛰되 가격 그대로
--           구성품 전부 보유 시 구매 불가 / 세트도 user_items 1개로 남겨 중복 구매 방지
--   · ※ 구성품 시드(맨 아래)는 뮤즈 확정 구성 전까지 주석 유지
-- ===========================================================================

create or replace function public.myhome_purchase_set(p_token text, p_set text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor private.session_actor; it public.shop_items;
  v_price int; v_added int := 0; v_skipped int := 0; r record;
begin
  v_actor := private.current_member(p_token);
  select * into it from public.shop_items s
   where s.id = p_set and s.category = 'set' and s.active
     and (not s.is_limited or current_date between s.sale_start and s.sale_end);
  if it.id is null then raise exception '지금은 판매하지 않는 세트예요.' using errcode = 'P0001'; end if;
  if exists (select 1 from private.user_items u
             where u.member_id = v_actor.member_id and u.item_id = p_set) then
    raise exception '이미 가지고 있는 세트예요.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.shop_set_items si where si.set_id = p_set) then
    raise exception '구성 정보가 없는 세트예요.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.shop_set_items si
                 where si.set_id = p_set
                   and not exists (select 1 from private.user_items u
                                   where u.member_id = v_actor.member_id and u.item_id = si.item_id)) then
    raise exception '세트 구성품을 이미 모두 가지고 있어요.' using errcode = 'P0001';
  end if;
  v_price := public.myhome_effective_price(p_set);
  update private.members set point_balance = point_balance - v_price
   where id = v_actor.member_id and point_balance >= v_price;
  if not found then raise exception '포인트가 부족해요.' using errcode = 'P0001'; end if;
  insert into private.point_ledger(member_id, delta, reason, ref)
  values (v_actor.member_id, -v_price, 'purchase_set', p_set);
  insert into private.user_items(member_id, item_id) values (v_actor.member_id, p_set);   -- 세트 자체(중복 구매 방지)
  for r in select item_id from public.shop_set_items where set_id = p_set loop
    insert into private.user_items(member_id, item_id)
    values (v_actor.member_id, r.item_id)
    on conflict (member_id, item_id) do nothing;
    if found then v_added := v_added + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'price', v_price, 'added', v_added, 'skipped', v_skipped);
end $$;

revoke all on function public.myhome_purchase_set(text, text) from public;
grant execute on function public.myhome_purchase_set(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 세트 구성 시드 (※ 뮤즈 확정 구성 전까지 주석 유지)
-- 예시: 크리스마스 홈 세트 = 빈 방 + 가구 + 트리 (정확한 구성 ID 확인 필요)
-- ---------------------------------------------------------------------------
-- insert into public.shop_set_items (set_id, item_id) values
--   ('set_xmas_2026', 'bg_xmas_2026'),
--   ('set_xmas_2026', '<가구 id>'),
--   ('set_xmas_2026', '<트리 id>')
-- on conflict do nothing;
