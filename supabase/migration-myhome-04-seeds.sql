-- ===========================================================================
-- 마이홈 업데이트 4/4: 시드 데이터 (01~03 실행 후에 실행)
--   · shop_items 크리스마스 한정 카탈로그 (뮤즈 v2 가격표 확정본, 19개 합계 68,500P)
--     - 판매 기간 2026-12-01 ~ 2026-12-25, 재판매 없음, 12월 상시 20% 할인 제외(is_limited)
--     - asset_path 는 토르 명명 규칙(assets/myhome/...) 기준, 에셋 파일은 별도 커밋
--   · lottery_prizes 당첨표 (방 합의 + 준형 님 11/28 승인: 0.5/1.5/3/20/30% + 꽝 45%)
--     - 3등은 kind='choice': 당첨자가 남/여 코스튬 직접 선택(myhome_lottery_claim)
--   · FK 순서: shop_items 먼저, lottery_prizes 나중 (item_id·choice_items 참조)
--   · 멱등: on conflict do nothing
-- ===========================================================================

insert into public.shop_items (id, name, category, price, is_limited, sale_start, sale_end, asset_path) values
  -- 배경 · 홈 세트 (복권 1·2등 겸용)
  ('bg_xmas_2026',      '크리스마스 빈 방',       'room',      6000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/rooms/bg_xmas_2026.png'),
  ('set_xmas_2026',     '크리스마스 홈 세트',     'set',      9500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/rooms/set_xmas_2026.png'),
  -- 가구 6종
  ('furn_xmas_tree',    '크리스마스 트리',        'furniture', 4500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_tree.png'),
  ('furn_xmas_sofa',    '크리스마스 소파',        'furniture', 4000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_sofa.png'),
  ('furn_xmas_teatable','크리스마스 티테이블',    'furniture', 2500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_teatable.png'),
  ('furn_xmas_armchair','체크 안락의자',          'furniture', 3500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_armchair.png'),
  ('furn_xmas_giftbox', '선물상자',               'furniture', 1500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_giftbox.png'),
  ('furn_xmas_firewood','장작바구니',             'furniture', 2000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_xmas_firewood.png'),
  -- 트리 6종
  ('tree_classic',      '클래식 트리',            'tree',      3000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_classic.png'),
  ('tree_snow',         '스노우 트리',            'tree',      3000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_snow.png'),
  ('tree_pastel',       '파스텔 트리',            'tree',      3000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_pastel.png'),
  ('tree_hanok',        '한옥 등불분재 트리',     'tree',      3500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_hanok.png'),
  ('tree_birch',        '북유럽 자작나무 트리',   'tree',      3500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_birch.png'),
  ('tree_mini',         '미니트리',               'tree',      2000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/furniture/furn_tree_mini.png'),
  -- 한복 코스튬 2종 (복권 3등 겸용, 당첨자 선택 수령)
  ('costume_xmas_m',    '딥그린 크리스마스 한복 (남)', 'costume', 5000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/avatars/costume_xmas_m.png'),
  ('costume_xmas_f',    '레드 크리스마스 한복 (여)',   'costume', 5000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/avatars/costume_xmas_f.png'),
  -- 장신구 3종 (acc_head / acc_hand 슬롯 분리, 동시 착용 가능)
  ('acc_head_xmas_bolkki', '순백 퍼 볼끼',        'acc_head',  2000, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/acc/acc_head_xmas_bolkki.png'),
  ('acc_hand_rudolph',  '루돌프 인형',            'acc_hand',  2500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/acc/acc_hand_rudolph.png'),
  ('acc_hand_santa',    '산타 인형',              'acc_hand',  2500, true, date '2026-12-01', date '2026-12-25', 'assets/myhome/acc/acc_hand_santa.png')
on conflict (id) do nothing;

-- 복권 당첨표 (확률 permille: 합계 550 = 55%, 나머지 450 = 꽝 45%)
insert into private.lottery_prizes (tier, weight_permille, kind, item_id, points, choice_items) values
  (1,   5, 'item',   'set_xmas_2026',   0, null),
  (2,  15, 'item',   'bg_xmas_2026',    0, null),
  (3,  30, 'choice', null,              0, array['costume_xmas_m','costume_xmas_f']),
  (4, 200, 'points', null,            500, null),
  (5, 300, 'points', null,            100, null)
on conflict (tier) do nothing;
