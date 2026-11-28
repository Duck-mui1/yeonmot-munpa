-- ===========================================================================
-- 마이홈 업데이트 3/3: 주간 복권 RPC
--   · 01·02 이후에 실행
--   · 1장 1,000P / 주 100장 선착순 / 1인 주 5장 / 토요일(KST) 추첨 기준 주차 키
--   · kind='choice'(3등 남/여 코스튬)는 당첨 시 보류(pending) → myhome_lottery_claim 으로 수령
--   · 당첨표 시드는 확정 전까지 주석 유지 (확률·아이템 ID 확정 후 주석 해제)
-- ===========================================================================

-- 주차 키: 해당 주 토요일(KST) 날짜
create or replace function private.lottery_week_key()
returns text language sql stable set search_path = '' as $$
  select to_char(d + ((6 - extract(dow from d)::int + 7) % 7), 'YYYY-MM-DD')
  from (select (now() at time zone 'Asia/Seoul')::date as d) x;
$$;

-- 구매 1회 = 1장. 당첨표는 private.lottery_prizes (weight_permille 합계 <= 1000, 나머지는 꽝)
create or replace function public.myhome_lottery_buy(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor private.session_actor;
  v_week text := private.lottery_week_key();
  v_roll int; v_acc int := 0;
  pr private.lottery_prizes;
  v_tier int; v_item text; v_pts int := 0; v_refund int := 0; v_price int;
  v_draw_id bigint;
begin
  v_actor := private.current_member(p_token);
  insert into private.lottery_weekly_pool(week_key) values (v_week) on conflict do nothing;
  perform 1 from private.lottery_weekly_pool where week_key = v_week for update;   -- 선착순 직렬화
  if (select sold from private.lottery_weekly_pool where week_key = v_week)
       >= (select max_total from private.lottery_weekly_pool where week_key = v_week) then
    raise exception '이번 주 복권은 모두 팔렸어요.' using errcode = 'P0001';
  end if;
  insert into private.user_lottery_weekly(user_id, week_key, cnt)
  values (v_actor.member_id, v_week, 0) on conflict do nothing;
  if (select cnt from private.user_lottery_weekly
      where user_id = v_actor.member_id and week_key = v_week) >= 5 then
    raise exception '이번 주에는 최대 5장까지 살 수 있어요.' using errcode = 'P0001';
  end if;
  update private.members set point_balance = point_balance - 1000
   where id = v_actor.member_id and point_balance >= 1000;
  if not found then raise exception '포인트가 부족해요.' using errcode = 'P0001'; end if;
  insert into private.point_ledger(member_id, delta, reason, ref)
  values (v_actor.member_id, -1000, 'lottery_buy', v_week);
  update private.lottery_weekly_pool set sold = sold + 1 where week_key = v_week;
  update private.user_lottery_weekly set cnt = cnt + 1
   where user_id = v_actor.member_id and week_key = v_week;

  v_roll := floor(random() * 1000)::int;   -- 0..999 (permille)
  for pr in select * from private.lottery_prizes order by tier loop
    v_acc := v_acc + pr.weight_permille;
    if v_roll < v_acc then v_tier := pr.tier; exit; end if;
  end loop;

  if v_tier is not null then
    select * into pr from private.lottery_prizes where tier = v_tier;
    if pr.kind = 'item' then
      v_item := pr.item_id;
      if exists (select 1 from private.user_items u
                 where u.member_id = v_actor.member_id and u.item_id = v_item) then
        -- 중복 당첨: 상점가 30% 환급
        v_price := (select price from public.shop_items where id = v_item);
        v_refund := floor(v_price * 0.3)::int;
        update private.members set point_balance = point_balance + v_refund where id = v_actor.member_id;
        insert into private.point_ledger(member_id, delta, reason, ref)
        values (v_actor.member_id, v_refund, 'lottery_dup_refund', v_item);
      else
        insert into private.user_items(member_id, item_id) values (v_actor.member_id, v_item);
        -- 세트 경품이면 구성품도 함께 지급(보유분은 건너뜀). shop_set_items는 05 파일에서 생성
        insert into private.user_items(member_id, item_id)
        select v_actor.member_id, si.item_id from public.shop_set_items si
        where si.set_id = v_item
        on conflict (member_id, item_id) do nothing;
      end if;
      insert into private.lottery_draws(member_id, week_key, tier, item_id, points, refunded)
      values (v_actor.member_id, v_week, v_tier, v_item, 0, v_refund)
      returning id into v_draw_id;
    elsif pr.kind = 'points' then
      v_pts := pr.points;
      update private.members set point_balance = point_balance + v_pts where id = v_actor.member_id;
      insert into private.point_ledger(member_id, delta, reason, ref)
      values (v_actor.member_id, v_pts, 'lottery_prize', v_week || ':' || v_tier);
      insert into private.lottery_draws(member_id, week_key, tier, points)
      values (v_actor.member_id, v_week, v_tier, v_pts)
      returning id into v_draw_id;
    elsif pr.kind = 'choice' then
      -- 선택 수령 대기: 아이템은 넣지 않고 pending으로 기록, claim RPC로 수령
      insert into private.lottery_draws(member_id, week_key, tier, claimed, pending_choices)
      values (v_actor.member_id, v_week, v_tier, false, pr.choice_items)
      returning id into v_draw_id;
      return jsonb_build_object('tier', v_tier, 'pending', true, 'draw_id', v_draw_id,
        'choices', to_jsonb(pr.choice_items),
        'remaining', (select max_total - sold from private.lottery_weekly_pool where week_key = v_week));
    else  -- 'none'
      insert into private.lottery_draws(member_id, week_key, tier)
      values (v_actor.member_id, v_week, v_tier)
      returning id into v_draw_id;
    end if;
  else
    insert into private.lottery_draws(member_id, week_key, tier)   -- 꽝
    values (v_actor.member_id, v_week, null)
    returning id into v_draw_id;
  end if;

  return jsonb_build_object('tier', v_tier, 'item_id', v_item, 'points', v_pts, 'refunded', v_refund,
    'remaining', (select max_total - sold from private.lottery_weekly_pool where week_key = v_week));
end $$;

-- pending 경품 수령: 본인·미수령·선택지 안 아이템인지 한 방 UPDATE로 원자 검증.
-- 이미 보유한 쪽을 골라도 상점가 30% 환급으로 처리. 미수령 draw는 만료 없이 유지.
create or replace function public.myhome_lottery_claim(p_token text, p_draw_id bigint, p_item text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor private.session_actor;
  d private.lottery_draws;
  v_price int; v_refund int := 0;
begin
  v_actor := private.current_member(p_token);
  update private.lottery_draws
     set claimed = true, item_id = p_item
   where id = p_draw_id
     and member_id = v_actor.member_id
     and claimed = false
     and p_item = any(pending_choices)
  returning * into d;
  if not found then
    raise exception '이미 받았거나 받을 수 없는 경품이에요.' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.user_items u
             where u.member_id = v_actor.member_id and u.item_id = p_item) then
    -- 이미 보유한 쪽 선택: 상점가 30% 환급
    v_price := (select price from public.shop_items where id = p_item);
    v_refund := floor(v_price * 0.3)::int;
    update private.members set point_balance = point_balance + v_refund where id = v_actor.member_id;
    insert into private.point_ledger(member_id, delta, reason, ref)
    values (v_actor.member_id, v_refund, 'lottery_dup_refund', p_item);
    update private.lottery_draws set refunded = v_refund where id = d.id;
  else
    insert into private.user_items(member_id, item_id) values (v_actor.member_id, p_item);
  end if;
  return jsonb_build_object('ok', true, 'item_id', p_item, 'refunded', v_refund);
end $$;

revoke all on function public.myhome_lottery_buy(text) from public;
grant execute on function public.myhome_lottery_buy(text) to anon, authenticated;
revoke all on function public.myhome_lottery_claim(text, bigint, text) from public;
grant execute on function public.myhome_lottery_claim(text, bigint, text) to anon, authenticated;

-- 당첨표 시드는 migration-myhome-04-seeds.sql 로 분리됨 (준형 님 11/28 승인 값 반영)
