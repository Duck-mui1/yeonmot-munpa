-- ===========================================================================
-- 마이홈 업데이트 3/3: 주간 복권 RPC
--   · 01·02 이후에 실행
--   · 1장 1,000P / 주 100장 선착순 / 1인 주 5장 / 토요일(KST) 추첨 기준 주차 키
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
      end if;
    elsif pr.kind = 'points' then
      v_pts := pr.points;
      update private.members set point_balance = point_balance + v_pts where id = v_actor.member_id;
      insert into private.point_ledger(member_id, delta, reason, ref)
      values (v_actor.member_id, v_pts, 'lottery_prize', v_week || ':' || v_tier);
    end if;
  end if;

  insert into private.lottery_draws(member_id, week_key, tier, item_id, points, refunded)
  values (v_actor.member_id, v_week, v_tier, v_item, v_pts, v_refund);

  return jsonb_build_object('tier', v_tier, 'item_id', v_item, 'points', v_pts, 'refunded', v_refund,
    'remaining', (select max_total - sold from private.lottery_weekly_pool where week_key = v_week));
end $$;

revoke all on function public.myhome_lottery_buy(text) from public;
grant execute on function public.myhome_lottery_buy(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 당첨표 시드 (확인 필요: 1~3등 item_id는 확정된 상점 ID로, 합계 55% + 꽝 45%는
-- 보드 확정치 해석이라 혜민 님 확인 후 주석 해제)
-- ---------------------------------------------------------------------------
-- insert into private.lottery_prizes(tier, weight_permille, kind, item_id, points) values
--   (1,   5, 'item',   '<크리스마스 홈 세트 id>',   0),
--   (2,  15, 'item',   '<크리스마스 배경 id>',      0),
--   (3,  30, 'item',   '<크리스마스 코스튬 id>',    0),
--   (4, 200, 'points', null,                        500),
--   (5, 300, 'points', null,                        100)
-- on conflict (tier) do nothing;
