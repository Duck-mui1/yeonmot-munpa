# 🔗 기간제한 외부 체험 링크 · 게스트 전용 랭킹 (v47)

문파원이 아닌 사람에게 **미니게임 4종만** 열어 주는 기간제한 링크(`?guest=토큰`)와,
그 사람들만의 **체험 랭킹**입니다. 문파 자료·문파 랭킹과는 완전히 따로 둡니다.

## 한눈에

| 무엇 | 어디 | 비고 |
| --- | --- | --- |
| 링크 만들기 | 내정보 → **🔗 외부 체험 링크** | 문주·운영진만 (체험 모드에서는 이 기기에서만 연습) |
| 게임 고르기 | `전체 4종` · `연못 생존기` · `신수모아` · `신수팡` · `경단만들기` | 링크 하나가 한 게임만 열 수도 있음 |
| 기간 | `10분`(기본) · `30분` · `1시간` · `24시간` | 화면 선택지. 서버는 1~10080분(7일)까지 허용 |
| 게스트 화면 | `?guest=토큰` | `#guest-view` — 문파 화면(`#auth-view`·`#main-view`)은 그리지 않음 |
| 게스트 랭킹 | 게임 안 `🏆 체험 랭킹` | `private.guest_game_scores` — 문파 랭킹과 별개 |

## 보안 경계 (가장 중요)

- 게스트로 열면 `boot()` 이 `resume()` 전에 갈라져 **세션 복구·문파 자료 로드를 하지 않습니다.**
  서버로 나가는 요청은 `verify_guest_game_link` 한 번뿐입니다(공지·채팅·문파원·랭킹 조회 없음).
- 링크 확인 응답에는 `valid · game · expires_at · remaining_seconds` 만 담깁니다.
  (문파 이름·문파원·랭킹·초대 코드·링크 id·발급자 없음)
- `private.guest_game_links` · `private.guest_game_scores` 는 **RLS 켜고 정책 없음 + anon/authenticated 권한 회수**.
  공개 키로 표를 직접 읽거나 쓸 수 없고, SECURITY DEFINER RPC 로만 동작합니다.
- 게스트 랭킹 표에는 **문파원과 이어지는 칸이 없습니다**(`member_id`·아바타·직위 없음). 닉네임 글자만 남습니다.
- 토큰: `gen_random_uuid()`(122비트)에서 하이픈을 뺀 **32자**. 추측 불가.

## 만료 규칙 (준형 님 요청)

- **새 접속·새로고침**은 `expires_at` 그대로 막습니다 → 만료 안내 화면.
- **이미 들어와 놀던 사람**은 강제로 쫓아내지 않습니다. 타이머 글자만
  `체험 시간이 끝났어요 · 하던 놀이는 이어서 할 수 있어요` 로 바뀝니다.
- 한 판을 마칠 수 있도록 **점수·랭킹 제출만 만료 뒤 10분 여유**를 둡니다
  (`private.guest_link_for_score`). `만료시키기`(revoked)한 링크는 여유 없이 즉시 막힙니다.

## DB

`supabase/migration-guest-links.sql` (이미 쓰는 DB) — `schema.sql` 에도 같은 내용이 들어 있습니다.

```
private.guest_game_links  (id, token, game, expires_at, revoked, created_by, created_at)
private.guest_game_scores (id, game, nickname, score, meta, created_at)   ← (game, lower(nickname)) 한 줄
```

| 함수 | 권한 | 하는 일 |
| --- | --- | --- |
| `verify_guest_game_link(p_token)` | anon | 유효하면 `{valid:true, game, expires_at, remaining_seconds}`, 아니면 `{valid:false, reason}` |
| `create_guest_game_link(p_session, p_game, p_minutes)` | 문주·운영진 | 발급 · 1~10080분 |
| `list_guest_game_links(p_session, p_limit=20)` | 문주·운영진 | 최근 발급 목록(새것부터, active·remaining_seconds) |
| `revoke_guest_game_link(p_session, p_id)` | 문주·운영진 | 즉시 만료(멱등 · `already`) |
| `submit_guest_game_score(p_token, p_game, p_nickname, p_score, p_meta)` | 링크 토큰 | 닉네임별 최고 점수 한 줄 · `{ok, best_score, is_new_best, rank}` |
| `list_guest_game_ranking(p_token, p_game, p_limit=20)` | 링크 토큰 | 그 게임의 게스트 기록만(점수 높은 순) |

- 게스트 판이 끝없이 불어나지 않도록 점수를 올릴 때 **한 게임 300줄까지만** 남깁니다(낮은 점수부터 정리).
- `p_meta` 는 경단만들기 `{tier}`, 신수팡·신수모아 `{combo}`, 연못 생존기는 쓰지 않습니다 — 2KB 제한.
- 연못 생존기(v47)는 `supabase/migration-survival.sql` 이 `survival` 을 게임 목록에 더합니다 —
  실행 전에는 `survival` 링크를 만들 수 없고, 게임 자체는 문파 랭킹 없이도 그대로 돕니다.

## 화면 코드

| 파일 | 무엇 |
| --- | --- |
| `index.html` | `#guest-view`(게스트 전용 화면 자리) — 문파 화면과 형제 |
| `js/app.js` | `startGuest` · `renderGuestHome` · `renderGuestClosed` · `guestSubmitScore` · `guestRanking` · 발급 카드(`guestLinksCardHtml`·`bindGuestLinksCard`) |
| `js/db.js` | `DB.guest.{verify,create,list,revoke,submitScore,ranking}` |
| `js/gyeongdan.js` · `js/sinsupang.js` · `js/sinsumoa.js` · `js/survival.js` | `opts.guestMode` 분기 — 랭킹 버튼 이름(`체험 랭킹`), 점수 제출 경로, `guestRankingBody()` |
| `css/style.css` | `.guest*` · `.guest-links*` · `.gl-item` |

- 게스트 이름은 `localStorage['ym.guestNick']`(1~12자)에 남고, 비어 있으면 **처음 점수를 올릴 때** 창으로 묻습니다.
  (`.modal` z-index 를 90 으로 올려 게임 화면 위에서도 보이게 했습니다)
- 체험 모드에서 만든 연습 링크는 `localStorage['ym.guestLinks']` 에만 있고, 같은 기기에서 열어 볼 수 있습니다.

## 테스트

| 무엇 | 어떻게 |
| --- | --- |
| DB | `yeonmot-tests/db_gl_run/run_tests.sh` (+ `db_test_guest_links.sql` 18묶음) · `db_sv_run/run_tests.sh` 의 `db_test_survival.sql` 12묶음이 `survival` 링크까지 확인 |
| 화면 | `LD_LIBRARY_PATH=… python3 yeonmot-tests/test_guest_link.py` (91개 확인) |
| 스크린샷 | `python3 yeonmot-tests/shot_v46_guest.py` → `downloads/v46_*.png` |
