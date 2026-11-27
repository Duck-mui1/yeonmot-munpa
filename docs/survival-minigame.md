# 🦆 연못 생존기 — 닷지 미니게임 (v47)

잔잔한 연못 위의 **오리**를 끌어 움직여, 사방(위·아래·왼쪽·오른쪽)에서 날아오는
**도깨비불 · 탄막 · 파편**을 피하는 고전 **닷지(총알 피하기)** 미니게임입니다.
상단 `🎮 미니게임 → 🦆 연못 생존기` 로 열고, 외부 체험 링크(`?guest=토큰`)로도 네 번째 게임으로 열립니다.

## 한눈에

| 무엇 | 값 |
| --- | --- |
| 판 | 정사각 캔버스(`fitStage()` — 화면이 낮아도 정사각 유지) |
| 목숨 | **한 번** — 맞으면 그 자리에서 끝(아이템 없음) |
| 기록 | 생존 시간 **0.01초 단위** — 화면 `42.85초`, 저장은 센티초 정수 `4285` |
| 몸 풀기 | 시작 뒤 **1.8초**는 탄이 나오지 않음 |
| 시작 난이도 | 탄 간격 780ms · 속도 = 판 크기의 0.42배/초 |
| 75초 뒤 | 탄 간격 200ms · 속도 = 판 크기의 1.10배/초 |
| 피격 판정 | 오리 그림 반지름의 **0.62배**(코어) + 탄 반지름의 0.82배 |
| 랭킹 | `private.survival_scores` · `submit_survival_score` · `list_survival_ranking` |
| 체험 링크 | `game = 'survival'` (또는 `all` = 네 게임) |

## 조작

- **모바일 — 상대 드래그**: 화면 아무 곳이나 눌러 **끈 만큼만** 오리가 따라옵니다.
  손가락 밑으로 오리가 순간이동하지 않아 손가락에 가리지 않습니다.
- **PC — 방향키 `↑↓←→` · `WASD`**: 누르고 있는 동안 판 크기의 1.02배/초로 움직입니다.
- **PC — 마우스 드래그**: 왼쪽 버튼을 누른 채 끌면 모바일과 같습니다.
- 오리는 판 밖으로 나가지 않습니다(그림 반지름만큼 안쪽에서 멈춤).

## 탄

| 종류 | 생김새 | 특징 |
| --- | --- | --- |
| `wisp` 도깨비불 | 푸른 불꽃 + 꼬리 | 기본. 오리를 향해 날아옵니다(조준 흔들림 ±판 크기 5%) |
| `orb` 탄막 | 보랏빛 구슬 | 부채(세 갈래)로 퍼질 때 씁니다 |
| `spark` 파편 | 금빛 불티 | 20초 뒤부터, 1.5배 빠르고 작습니다 |

- **시간에 따라 열리는 패턴** — 8초 뒤 세 갈래 부채, 14초 뒤 한 번에 두 발,
  20초 뒤 빠른 파편, 30초 뒤 마주 보는 두 가장자리에서 동시에.
- 탄이 나오는 가장자리가 잠깐 밝아져 어디서 오는지 알 수 있습니다.
- 화면에는 최대 240발까지만 둡니다(넘치지 않게).

## 점수와 기록

- 화면 HUD 왼쪽은 **생존 시간**(`42.85초`), 오른쪽은 **이 기기 최고**입니다.
- 한 판이 끝나면 `score = floor(경과 ms / 10)` (센티초) 로 저장합니다 — 4285 = 42.85초.
- 서버(`submit_survival_score`)는 **더 높은 기록일 때만** 갱신하고 `{ ok, best_score, is_new_best, rank }` 를 돌려줍니다.
- 랭킹판·결과 창은 항상 **초 표기**(`42.85초`)로 보여 줍니다.
- 마이그레이션 전(PGRST202)에는 게임·이 기기 최고 기록이 그대로 돌고, 랭킹 창에만
  `supabase/migration-survival.sql` 안내가 나옵니다.

## 화면 코드

| 파일 | 무엇 |
| --- | --- |
| `index.html` | `#survival` 판(제목 · HUD · 캔버스 · 결과 · 랭킹 시트) · `#mg-survival` 메뉴 항목 |
| `js/survival.js` | 게임 전체 — `window.YM_SURVIVAL.open({ ... })` · 판 크기(`fitStage`) · 조작 · 탄 · 그리기 · 랭킹 |
| `js/app.js` | `openSurvival()` · 미니게임 메뉴 · 게스트(`GUEST_GAMES` · `openGuestGame` · 발급 카드) · `DB.submitSurvivalScore` 연결 |
| `js/db.js` | `submitSurvivalScore(score)` · `listSurvivalRanking(limit)` |
| `css/style.css` | `.survival*` (낮은 창 미디어 쿼리 포함) |
| `sw.js` | `js/survival.js` 를 오프라인 캐시에 추가, `CACHE_NAME` v47 |

- 그리는 것은 모두 캔버스 — 오리·연못·연잎·도깨비불을 코드로 그립니다(게임 이미지 파일 없음).
- `window.YM_SURVIVAL._debug` 는 **테스트 전용**입니다(화면에는 나오지 않습니다):
  `state()` · `bullets()` · `metrics()` · `difficulty()` · `freeze(on)` · `step(ms)` ·
  `duck(x, y)` · `spawn(x, y, vx, vy, r, kind)` · `spawnRain(n)` · `setTime(sec)` · `end()` ·
  `setBest(cs)` · `rankDemo(rows)`.

## DB

`supabase/migration-survival.sql` (이미 쓰는 DB — `schema.sql` 에도 같은 내용이 들어 있습니다)

```
private.survival_scores (member_id uuid PK, best_score int 0~100000000, updated_at)
```

| 함수 | 권한 | 하는 일 |
| --- | --- | --- |
| `submit_survival_score(p_token, p_score)` | 로그인 문파원 | 최고 기록일 때만 갱신 · `{ ok, best_score, is_new_best, rank }` |
| `list_survival_ranking(p_token, p_limit=20)` | 로그인 문파원 | 오래 버틴 순 · `{ rank, member_id, nickname, role, avatar, best_score, updated_at }` |

- 같은 파일이 **외부 체험 링크의 게임 목록에 `survival` 을 더합니다**
  (`private.guest_game_links` · `private.guest_game_scores` 의 check 제약을 새 목록으로 다시 걸고,
  `create_guest_game_link` · `submit_guest_game_score` · `list_guest_game_ranking` 을 다시 만듭니다).
  이미 만든 링크·게스트 기록은 그대로입니다.

## 테스트

| 무엇 | 어떻게 |
| --- | --- |
| DB | `yeonmot-tests/db_sv_run/run_tests.sh` — 옛 DB + 마이그레이션 / 새 설치본 / 멱등 / 회귀 10종 (`fail=0`) |
| DB 단위 | `yeonmot-tests/db_test_survival.sql` — 12묶음(첫 기록 · 최고만 갱신 · 순위 · limit · 22023 · 28000 · 강퇴 · anon · 체험 링크) |
| 화면 | `LD_LIBRARY_PATH=… python3 yeonmot-tests/test_survival.py` (95개 확인) |
| 스크린샷 | `python3 yeonmot-tests/shot_v47_survival.py` → `downloads/v47_*.png` |

## 난이도 메모

- 같은 조건에서 **가만히 있는 오리는 3초 남짓**, 탄을 보고 비켜서는 플레이는 **10~20초**,
  익숙해지면 40초를 넘깁니다(테스트용 봇으로 측정). 조준 흔들림이 오리 폭보다 커서
  가만히 있으면 반드시 맞고, 날아오는 방향의 **수직**으로 움직여야 피할 수 있습니다.
- 처음 1.8초 + 첫 탄 간격 780ms 로 시작해, 10초 동안은 한두 발씩만 나옵니다.
