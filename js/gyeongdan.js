/* 연못 — 🍡 경단만들기 (도깨비의 세계)
 *
 *  · 수박게임 방식의 Canvas 2D 원형 물리 드롭 & 머지 게임입니다.
 *  · 물리는 「루팡문파」 경단만들기와 같은 방식·같은 값으로 다시 썼습니다.
 *    - 판은 화면을 꽉 채우고(비율 444:480), 경단 반지름은 판 너비 360 기준 비율.
 *    - 중력 15 × 판높이(px/s²) · 접촉 중에는 3.5 × 판높이 — 묵직하게 떨어지고 툭 앉습니다.
 *    - 반발은 거의 없습니다(경단끼리 0.04 · 벽 0.25 · 바닥 0.17).
 *    - 경단은 24방향으로 살짝 울퉁불퉁한 도형(반지름 0.72~1.01배)이라 서로 파고들어 앉고
 *      굴러가다 자리를 잡습니다. 120Hz 고정 스텝 · 겹침 보정 8회 · 0.24초 잠들기.
 *    - 데드라인은 판 높이 8.5% — 쉬고 있는 경단이 넘으면 그 자리에서 끝.
 *  · 경단 11단계(박쥐단 … 백운단)의 그림은 「도깨비의 세계」 인게임 화면에서 오려낸
 *    assets/gyeongdan/tier-1~11.png 를 기준 지름(2r)에 맞춰 그립니다(1~9단계는 고화질 화면에서 새로 뽑음).
 *    그림을 못 받으면 아래 Canvas 코드의 벡터 그림이 대신 나옵니다.
 *    (경단 이미지의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제됩니다.)
 *  · 도구는 절구공이 하나 — 백운단만 지울 수 있고 무제한입니다.
 *  · 진행 중인 판은 localStorage 에 남겨 두어 창을 닫아도 이어서 할 수 있습니다.
 *
 *  화면 코드는 YM_GYEONGDAN.open({ ... }) 만 부르고, 점수 저장 · 랭킹 조회는
 *  넘겨받은 함수(opts.submitScore / opts.listRanking)로 합니다.
 */
(function () {
  'use strict';

  /* ===================================================================
     1. 판 · 경단 · 점수
     =================================================================== */

  /* 놀이판은 화면(캔버스) 크기를 그대로 씁니다 — 남는 여백 없이 꽉 찹니다.
     경단 반지름은 너비 360 기준 비율을 따르므로 폰이 크든 작든 같은 손맛이 납니다. */
  var BASE_W = 360;         // 반지름 기준 너비
  var W = 360;              // resize()에서 실제 캔버스 너비로 바뀝니다
  var H = 390;              // resize()에서 실제 캔버스 높이로 바뀝니다
  var STEP = 1 / 120;       // 물리 고정 스텝 — 「루팡문파」와 같은 120Hz
  var SAVE_KEY = 'ym.gyeongdan.save.v1';
  var BEST_KEY = 'ym.gyeongdan.best';

  /* 11단계 — 반지름은 「루팡문파」 경단만들기와 같은 비율(너비 360 기준)입니다.
     색은 「경단 도감」의 영수 색감을 따릅니다. */
  var R_BASE = [19.2, 23.6, 25.9, 31, 38.3, 46.4, 49.2, 60.9, 66.1, 77.6, 74.2];
  var TIERS = [
    null,
    { no: 1,  name: '박쥐단',      r: R_BASE[0],  color: '#b08d76', dark: '#8e6b56', light: '#d6bda8', kind: 'bat' },
    { no: 2,  name: '사마귀단',    r: R_BASE[1],  color: '#5f8fc9', dark: '#416fa3', light: '#a8c8ee', kind: 'mantis' },
    { no: 3,  name: '쥐단',        r: R_BASE[2],  color: '#a6bf4e', dark: '#7d9438', light: '#d9e9a0', kind: 'mouse' },
    { no: 4,  name: '뱀단',        r: R_BASE[3],  color: '#b39e8f', dark: '#8c7768', light: '#e6d8c9', kind: 'snake' },
    { no: 5,  name: '호랑이단',    r: R_BASE[4],  color: '#e8952f', dark: '#c2731c', light: '#ffd08a', kind: 'tiger' },
    { no: 6,  name: '돼지단',      r: R_BASE[5],  color: '#b08a9a', dark: '#8a6a7a', light: '#dcbccb', kind: 'pig' },
    { no: 7,  name: '곰단',        r: R_BASE[6],  color: '#a9714a', dark: '#83503a', light: '#d9ab84', kind: 'bear' },
    { no: 8,  name: '자서귀단',    r: R_BASE[7],  color: '#fbfbf7', dark: '#dfe3e8', light: '#ffffff', kind: 'dokkaebi' },
    { no: 9,  name: '황요호단',    r: R_BASE[8],  color: '#e8862f', dark: '#b96318', light: '#ffcf94', kind: 'fox' },
    { no: 10, name: '산군대호단',  r: R_BASE[9],  color: '#cf8a5f', dark: '#a35f3c', light: '#f0c69c', kind: 'tigerking' },
    { no: 11, name: '백운단',      r: R_BASE[10], color: '#fdfcf7', dark: '#e2e6ec', light: '#ffffff', kind: 'cloud' }
  ];

  /* 경단의 진짜 모양 — 24방향 반지름 비율(1 = 기준 반지름). 완전한 원이 아니라
     0.72~1.01 사이로 살짝 울퉁불퉁해서, 경단끼리 파고들어 앉고 굴러가다 자리를 잡습니다.
     「루팡문파」 경단만들기가 쓰는 값 그대로입니다. */
  var SHAPE = [
    /*  1단계 */ [0.874, 0.8994, 0.8977, 0.8811, 0.8746, 0.86, 0.836, 0.8566, 0.8713, 0.8803, 0.9003, 0.9025, 0.887, 0.899, 0.9653, 0.9878, 0.9522, 0.8654, 0.862, 0.8627, 0.9522, 0.9878, 0.9718, 0.9008],
    /*  2단계 */ [0.766, 0.7458, 0.7305, 0.7531, 0.7805, 0.7909, 0.801, 0.8217, 0.8425, 0.8464, 0.8495, 0.8814, 0.897, 0.9228, 0.919, 0.9221, 0.9386, 0.9017, 0.806, 0.8647, 0.8725, 0.8224, 0.8065, 0.7945],
    /*  3단계 */ [0.872, 0.8916, 0.893, 0.8867, 0.8805, 0.8655, 0.859, 0.8703, 0.8834, 0.891, 0.8954, 0.8912, 0.878, 0.9412, 0.9943, 1.0076, 0.9785, 0.9077, 0.841, 0.9084, 0.9733, 0.9949, 0.9808, 0.9209],
    /*  4단계 */ [0.847, 0.8686, 0.887, 0.8867, 0.887, 0.8801, 0.884, 0.8912, 0.9102, 0.9171, 0.9259, 0.9124, 0.878, 0.8705, 0.8581, 0.8521, 0.8396, 0.8758, 0.89, 0.8646, 0.8202, 0.8217, 0.8219, 0.829],
    /*  5단계 */ [0.809, 0.8188, 0.8227, 0.816, 0.8015, 0.7847, 0.774, 0.7865, 0.8045, 0.8202, 0.8407, 0.8455, 0.838, 0.8699, 0.9318, 0.9468, 0.9139, 0.8367, 0.826, 0.8346, 0.9021, 0.9263, 0.9087, 0.8419],
    /*  6단계 */ [0.7187, 0.7404, 0.7483, 0.7445, 0.7366, 0.7374, 0.7521, 0.7832, 0.823, 0.8627, 0.8931, 0.8994, 0.8858, 0.8878, 0.9249, 0.91, 0.9107, 0.8952, 0.8969, 0.8534, 0.8264, 0.7957, 0.7834, 0.7288],
    /*  7단계 */ [0.869, 0.8915, 0.8971, 0.886, 0.8754, 0.8643, 0.857, 0.8693, 0.8837, 0.8987, 0.907, 0.9008, 0.888, 0.8961, 0.9588, 1.009, 1.0158, 0.9717, 0.875, 0.9702, 1.0107, 1.0041, 0.9471, 0.8805],
    /*  8단계 */ [0.874, 0.8809, 0.8867, 0.8881, 0.8735, 0.8555, 0.85, 0.8477, 0.8569, 0.8669, 0.8623, 0.852, 0.856, 0.8618, 0.9234, 0.9645, 0.9586, 0.9012, 0.88, 0.905, 0.9632, 0.9687, 0.9346, 0.88],
    /*  9단계 */ [0.825, 0.8927, 0.9223, 0.9016, 0.8851, 0.8528, 0.86, 0.865, 0.9086, 0.9348, 0.963, 0.9327, 0.871, 0.8473, 0.8316, 0.8514, 0.8409, 0.795, 0.789, 0.7828, 0.8253, 0.8266, 0.8013, 0.8081],
    /* 10단계 */ [0.727, 0.7431, 0.7417, 0.7418, 0.7199, 0.7083, 0.727, 0.7503, 0.7964, 0.8499, 0.8711, 0.8888, 0.88, 0.8619, 0.8796, 0.8811, 0.8661, 0.8374, 0.825, 0.7978, 0.7882, 0.7729, 0.7526, 0.7198],
    /* 11단계 */ [0.856, 0.8563, 0.8631, 0.8641, 0.85, 0.8317, 0.832, 0.8433, 0.874, 0.898, 0.9046, 0.9027, 0.904, 0.9106, 0.9247, 0.915, 0.896, 0.8462, 0.868, 0.8462, 0.884, 0.8895, 0.89, 0.8642]
  ];
  var SHAPE_MAX = SHAPE.map(function (row) { return Math.max.apply(null, row); });
  var DIRS = (function () {
    var list = [];
    for (var i = 0; i < 24; i++) { list.push([Math.cos(i * Math.PI / 12), Math.sin(i * Math.PI / 12)]); }
    return list;
  }());

  /** 단계의 기준 반지름 — 판 너비에 맞춰 늘어납니다 */
  function rad(tier) { return TIERS[tier].r * (W / BASE_W); }

  /* 경단 그림 — 도감 원본 그림에서 오려낸 투명 PNG.
     그림 한 장이 기준 지름(2r)을 그대로 채우고, 몸통은 그 안에 조금 작게 들어 있습니다. */
  var SPRITE_PATH = 'assets/gyeongdan/tier-';
  var SPRITE_CREDIT = '경단 이미지의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제될 수 있습니다.';
  /* 그림 속 몸통 중심이 그림 가운데에서 얼마나 벗어났는지 — 회전축을 몸통 가운데로
     (1~9단계는 인게임 화면에서 몸통을 캔버스 한가운데에 맞춰 잘랐습니다) */
  var SPRITE_OFF = {
    1: [0, 0], 2: [0, 0], 3: [0, 0], 4: [0, 0], 5: [0, 0], 6: [0, 0],
    7: [0, 0], 8: [0, 0], 9: [0, 0], 10: [0.004, -0.008], 11: [-0.013, 0.020]
  };
  var sprites = [];          // sprites[tier] = Image
  var spriteReady = {};      // 로드가 끝난 단계
  var spritesAsked = false;

  /** 1~11단계 PNG를 미리 받아 둡니다. 다 받으면 지금 그려진 판·도감을 다시 그립니다. */
  function loadSprites() {
    if (spritesAsked) { return; }
    spritesAsked = true;
    for (var t = 1; t <= LAST_TIER; t++) {
      (function (tier) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
          spriteReady[tier] = (img.naturalWidth > 0);
          if (S && S.running) { draw(); }
          if (el.sheet && el.sheet.getAttribute('data-kind') === 'chart' && !el.sheet.hidden) {
            paintChartIcons();
          }
        };
        img.onerror = function () { spriteReady[tier] = false; };
        img.src = SPRITE_PATH + tier + '.png';
        sprites[tier] = img;
      }(t));
    }
  }

  function spriteOf(tier) {
    return spriteReady[tier] ? sprites[tier] : null;
  }

  /* 위에서 떨어지는 경단은 1~5단계뿐입니다.
     나오는 비율도 「루팡문파」와 같게 — 1단계 45% · 2단계 28% · 3단계 16% · 4단계 8% · 5단계 3% */
  var SPAWN_CUT = [0.45, 0.73, 0.89, 0.97];   // 이 값을 넘으면 한 단계 위
  var LAST_TIER = 11;

  /* 합쳐서 만들어낸 단계의 점수 — 「경단 도감」 그대로
     10 · 21 · 45 · 120 · 360 · 1,120 · 3,580 · 11,800 · 40,100 · 140,000 */
  var MERGE_SCORE = [0, 0, 10, 21, 45, 120, 360, 1120, 3580, 11800, 40100, 140000];
  function scoreForTier(tier) {
    return MERGE_SCORE[tier] || 0;
  }
  var CLOUD_BONUS = 280000;  // 백운단 둘이 만나면 둘 다 사라지며 보너스
  var MALLET_BONUS = 1000;   // 절구공이로 백운단을 걷어낼 때

  var ROLE_LABEL = { admin: '문주', officer: '운영진', member: '문파원' };

  /* ===================================================================
     2. DOM
     =================================================================== */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var el = {};
  var ctx = null;

  function grabDom() {
    el.root = $('#gyeongdan');
    el.canvas = $('#gyeongdan-canvas');
    el.stage = $('#gyeongdan-stage');
    el.score = $('#gd-score');
    el.best = $('#gd-best');
    el.hint = $('#gd-hint');
    el.over = $('#gyeongdan-over');
    el.tools = $('#gyeongdan-tools');
    el.sheet = $('#gd-sheet');
    el.close = $('#gyeongdan-close');
    el.chartBtn = $('#gd-chart-btn');
    el.rankBtn = $('#gd-rank-btn');
    el.restartBtn = $('#gd-restart-btn');
    if (el.canvas) { ctx = el.canvas.getContext('2d'); }
  }

  /* ===================================================================
     3. 진행 저장(localStorage)
     =================================================================== */

  function storeGet(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 사생활 보호 모드 */ }
  }
  function storeDrop(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  function localBest() {
    var v = Number(storeGet(BEST_KEY, 0));
    return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  function setLocalBest(value) {
    if (value > localBest()) { storeSet(BEST_KEY, Math.floor(value)); }
  }

  /** 저장해 둔 판 — 이어서 할 수 있으면 그대로, 아니면 null */
  function readSave() {
    var raw = storeGet(SAVE_KEY, null);
    if (!raw || raw.v !== 1 || !Array.isArray(raw.bodies)) { return null; }
    return raw;
  }
  function saveGame(force) {
    if (!S) { return; }
    if (S.over || !S.bodies.length) { storeDrop(SAVE_KEY); return; }
    var now = Date.now();
    if (!force && now - (S.savedAt || 0) < 400) { S.dirty = true; return; }
    S.savedAt = now;
    S.dirty = false;
    storeSet(SAVE_KEY, {
      v: 1,
      score: Math.floor(S.score),
      maxTier: S.maxTier,
      nextTier: S.nextTier,
      bodies: S.bodies.map(function (b) {
        return { t: b.tier, x: r4(b.x / W), y: r4(b.y / H),
          vx: r2(b.vx * 360 / W), vy: r2(b.vy * 390 / H),
          a: r4(b.angle), av: r2(b.av) };
      }),
      at: now
    });
  }

  function clearSave() { storeDrop(SAVE_KEY); }

  function r2(n) { return Math.round(n * 100) / 100; }
  function r4(n) { return Math.round(n * 10000) / 10000; }

  /* ===================================================================
     4. 판 상태
     =================================================================== */

  var S = null;          // 현재 판
  var opts = {};         // { live, nickname, best, submitScore, listRanking, onToast }
  var raf = 0;
  var lastT = 0;
  var acc = 0;
  var uid = 0;
  var opened = false;
  var ranking = { status: 'idle', rows: [], message: '' };

  function pickSpawn() {
    var roll = Math.random();
    for (var i = 0; i < SPAWN_CUT.length; i++) {
      if (roll < SPAWN_CUT[i]) { return i + 1; }
    }
    return SPAWN_CUT.length + 1;
  }

  function makeBody(tier, x, y, vx, vy) {
    uid += 1;
    return {
      id: uid,
      tier: tier,
      r: rad(tier),
      x: x, y: y,
      vx: vx || 0, vy: vy || 0,
      age: 0,
      angle: 0,
      av: 0,
      supported: false,
      sleeping: false,
      quiet: 0,
      glow: 0
    };
  }

  function newState() {
    var b = localBest();
    return {
      bodies: [],
      particles: [],
      pops: [],
      score: 0,
      best: Math.max(b, opts.best || 0),
      nextTier: pickSpawn(),
      tool: null,
      picks: [],
      over: false,
      overReason: '',
      running: false,
      startedAt: Date.now(),
      savedAt: 0,
      dirty: false,
      aimX: W / 2,
      aiming: false,
      dropCool: 0,
      maxTier: 1,
      warn: 0,
      shake: 0,
      lastMerge: 0
    };
  }

  /** 저장된 판을 되살립니다 — 없으면 새 판 */
  function resumeState() {
    var saved = readSave();
    if (!saved) { return null; }
    var st = newState();
    st.score = Math.max(0, Number(saved.score) || 0);
    st.maxTier = Math.min(LAST_TIER, Math.max(1, Number(saved.maxTier) || 1));
    st.nextTier = Math.min(5, Math.max(1, Number(saved.nextTier) || pickSpawn()));
    var bodies = [];
    saved.bodies.forEach(function (raw) {
      var tier = clampInt(raw.t, 1, LAST_TIER, 0);
      if (!tier) { return; }
      var rr = rad(tier);
      var x = Number(raw.x), y = Number(raw.y);
      if (!isFinite(x) || !isFinite(y)) { return; }
      /* 저장은 판 크기 대비 비율(0~1)로 — 폰이 바뀌어도 같은 자리 */
      if (x > 1.5 || y > 1.5) { x = x / 360; y = y / 560; }
      var body = makeBody(tier, clamp(x * W, rr, W - rr), clamp(y * H, 0, H - rr));
      body.vx = isFinite(Number(raw.vx)) ? Number(raw.vx) * (W / 360) : 0;
      body.vy = isFinite(Number(raw.vy)) ? Number(raw.vy) * (H / 390) : 0;
      body.angle = isFinite(Number(raw.a)) ? Number(raw.a) : 0;
      body.av = isFinite(Number(raw.av)) ? Number(raw.av) : 0;
      body.age = 1;
      bodies.push(body);
    });
    if (!bodies.length) { return null; }
    st.bodies = bodies;
    return st;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clampInt(v, lo, hi, fallback) {
    var n = Math.floor(Number(v));
    if (!isFinite(n)) { return fallback; }
    return clamp(n, lo, hi);
  }

  /* ===================================================================
     5. 물리
     =================================================================== */

  /* --- 경단의 손맛을 정하는 값들 ---------------------------------------
     「루팡문파」 경단만들기가 실제로 쓰는 값 그대로입니다.
     · GRAV · GRAV_REST : 중력 = 15 × 판높이(px/s²). 무언가에 닿아 있는 동안에는
                           3.5 × 판높이로 약해져 겹친 경단이 서로를 밀어내지 않습니다.
     · VY_CAP           : 떨어지는 속도 상한 5.4 × 판높이.
     · AIR_X · AIR_Y    : 공기저항 — 1/60초마다 0.985(가로) · 0.998(세로).
     · WALL_E · FLOOR_E : 벽 0.25 · 바닥 0.17 — 튕기지 않고 툭.
     · PAIR_E           : 경단끼리 법선 속도를 1.04배로 되돌립니다(반발 0.04).
     · FRIC_V · FRIC_H  : 경단끼리 마찰 0.19(수직 접촉) · 0.43(비스듬한 접촉).
     · SLEEP_*          : 0.24초 잠잠하면 잠들어 연산을 쉬고, 부딪히면 깨어납니다. */
  var GRAV = 15;
  var GRAV_REST = 3.5;
  var VY_CAP = 5.4;
  var AIR_X = 0.985;
  var AIR_Y = 0.998;
  var WALL_E = 0.25;
  var FLOOR_E = 0.17;
  var PAIR_E = 1.04;
  var FRIC_V = 0.19;
  var FRIC_H = 0.43;
  var SLEEP_TIME = 0.24;
  var BAND = 0.085;         // 데드라인 — 판 높이의 8.5% 위
  var DROP_COOL = 0.31;     // 경단 사이 쿨타임(초)
  var SEP_ITER = 8;         // 겹침 보정 · 충격 반복 횟수

  /** 경단의 24방향 반지름 — 각도(굴러간 만큼)에 맞춰 돌려 씁니다 */
  function shapeOf(b) {
    var base = SHAPE[b.tier - 1];
    var ang = b.angle || 0;
    if (!ang) { return base; }
    var cache = b._shape;
    if (cache && cache.angle === ang) { return cache.dist; }
    var turn = ((-ang * 12 / Math.PI) % 24 + 24) % 24;
    var i0 = Math.floor(turn), frac = turn - i0;
    var dist = new Array(24);
    for (var i = 0; i < 24; i++) {
      dist[i] = base[(i + i0) % 24] * (1 - frac) + base[(i + i0 + 1) % 24] * frac;
    }
    b._shape = { angle: ang, dist: dist };
    return dist;
  }

  /** 두 경단이 닿았는지 — 24방향으로 재어 가장 얕게 파고든 방향을 돌려줍니다 */
  function contact(a, b, gap) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var reach = a.r * SHAPE_MAX[a.tier - 1] + b.r * SHAPE_MAX[b.tier - 1] + (gap || 0);
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) { return null; }
    var sa = shapeOf(a), sb = shapeOf(b);
    var best = Infinity, sx = 0, sy = 0;
    var eps = (a.r + b.r) * 1e-8;
    for (var i = 0; i < 24; i++) {
      var p = a.r * sa[i] + b.r * sb[(i + 12) % 24] - dx * DIRS[i][0] - dy * DIRS[i][1] + (gap || 0);
      if (p <= 0) { return null; }
      if (p < best - eps) {
        best = p; sx = DIRS[i][0]; sy = DIRS[i][1];
      } else if (p <= best + eps) {
        sx += DIRS[i][0]; sy += DIRS[i][1];
        if (p < best) { best = p; }
      }
    }
    var len = Math.sqrt(sx * sx + sy * sy);
    if (len < 1e-8) { return { overlap: best, nx: 0, ny: dy < 0 ? -1 : 1 }; }
    return { overlap: best, nx: Math.abs(sx) < 1e-12 ? 0 : sx / len, ny: sy / len };
  }

  /** 속도 · 자리 · 구르기 — 닿아 있으면 중력이 약해지고, 굴러간 만큼 얼굴이 돕니다 */
  function integrate(dt) {
    var bodies = S.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.held || b.sleeping) { continue; }
      var stand = !!b.supported;
      b.supported = false;
      b.vy = Math.min(H * VY_CAP, b.vy + H * (stand ? GRAV_REST : GRAV) * dt);
      if (stand && b.vx) {
        b.angle = (b.angle + b.vx * dt / (b.r * shapeOf(b)[6])) % (Math.PI * 2);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx *= Math.pow(AIR_X, dt * 60);
      b.vy *= Math.pow(AIR_Y, dt * 60);

      var sh = shapeOf(b);
      if (b.x < b.r * sh[12]) { b.x = b.r * sh[12]; b.vx = Math.abs(b.vx) * WALL_E; }
      if (b.x > W - b.r * sh[0]) { b.x = W - b.r * sh[0]; b.vx = -Math.abs(b.vx) * WALL_E; }
      if (b.y > H - b.r * sh[6]) {
        b.supported = true;
        b.y = H - b.r * sh[6];
        b.vy = -Math.abs(b.vy) * FLOOR_E;
        if (Math.abs(b.vx) < 4) { b.vx = 0; }
        if (Math.abs(b.vy) < 28) { b.vy = 0; }
      }
      b.age += dt;
    }
  }

  /** 같은 단계끼리 닿으면 한 단계 위로 — 새 경단은 두 경단의 한가운데서 태어납니다 */
  function mergeInto(a, b) {
    var tier = a.tier;
    var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    a.dead = true;
    b.dead = true;

    /* 백운단 두 개 — 둘 다 사라지고 큰 보너스 */
    if (tier >= LAST_TIER) {
      S.score += CLOUD_BONUS;
      addPop(cx, cy, '+' + fmtNum(CLOUD_BONUS), '#ffe9a8');
      burst(cx, cy, 34, ['#fff7d6', '#ffe28a', '#cfeaff', '#ffffff'], 320);
      S.shake = Math.min(1, S.shake + 0.55);
      S.maxTier = LAST_TIER;
      bumpBest();
      return null;
    }

    var body = makeBody(tier + 1, cx, cy, (a.vx + b.vx) / 2, (a.vy + b.vy) * 0.2);
    body.glow = 0.22;
    var gain = scoreForTier(tier + 1);
    S.score += gain;
    if (tier + 1 > S.maxTier) { S.maxTier = tier + 1; }
    addPop(cx, cy, '+' + fmtNum(gain), TIERS[tier + 1].light);
    burst(cx, cy, tier > 8 ? 20 : 12, [TIERS[tier + 1].color, TIERS[tier + 1].light, '#ffffff'], 90 + tier * 18);
    S.shake = Math.min(1, S.shake + (tier > 6 ? 0.32 : 0.12));
    S.lastMerge = Date.now();
    bumpBest();
    return body;
  }

  /** 접촉 한 번 — 자리를 살짝 밀어내고, 다가오는 속도를 반발 0.04로 되돌리고, 비비며 마찰합니다 */
  function contactPass() {
    var bodies = S.bodies;
    var born = [];
    var i, j;
    var wake = Math.max(32, W * 0.1);
    for (i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      if (a.dead) { continue; }
      for (j = i + 1; j < bodies.length; j++) {
        var b = bodies[j];
        if (b.dead) { continue; }
        if (a.sleeping && b.sleeping && (a.tier !== b.tier || a.tier >= LAST_TIER)) { continue; }
        var hit = contact(a, b, 0);
        if (!hit) { continue; }

        /* 같은 단계 → 한 단계 위로 합칩니다 */
        if (a.tier === b.tier && a.tier < LAST_TIER) {
          var made = mergeInto(a, b);
          if (made) { born.push(made); }
          break;
        }

        if (hit.ny > 0.25) { a.supported = true; }
        if (hit.ny < -0.25) { b.supported = true; }

        var ma = a.r * a.r, mb = b.r * b.r;
        var vrel = (a.vx - b.vx) * hit.nx + (a.vy - b.vy) * hit.ny;
        if (a.sleeping && vrel * mb / (ma + mb) > wake) { a.sleeping = false; a.quiet = 0; }
        if (b.sleeping && vrel * ma / (ma + mb) > wake) { b.sleeping = false; b.quiet = 0; }

        var sa = a.sleeping ? 0 : (b.sleeping ? 1 : mb / (ma + mb));
        var sb = 1 - sa;
        a.x -= hit.nx * hit.overlap * sa;
        a.y -= hit.ny * hit.overlap * sa;
        b.x += hit.nx * hit.overlap * sb;
        b.y += hit.ny * hit.overlap * sb;

        var vn = (b.vx - a.vx) * hit.nx + (b.vy - a.vy) * hit.ny;
        if (vn >= 0) { continue; }

        var jn = -PAIR_E * vn;
        a.vx -= jn * hit.nx * sa; a.vy -= jn * hit.ny * sa;
        b.vx += jn * hit.nx * sb; b.vy += jn * hit.ny * sb;

        /* 접선 마찰 — 미끄러지는 대신 서로 붙잡아 줍니다 */
        var vt = -(b.vx - a.vx) * hit.ny + (b.vy - a.vy) * hit.nx;
        var lim = (Math.abs(hit.ny) > 0.5 ? FRIC_V : FRIC_H) * jn;
        var jt = Math.max(-lim, Math.min(lim, vt));
        a.vx -= jt * hit.ny * sa; a.vy += jt * hit.nx * sa;
        b.vx -= jt * hit.ny * sb; b.vy += jt * hit.nx * sb;
      }
    }
    if (born.length || S.bodies.some(function (x) { return x.dead; })) {
      S.bodies = bodies.filter(function (x) { return !x.dead; }).concat(born);
      S.picks = (S.picks || []).filter(function (x) { return !x.dead; });
      S.dirty = true;
    }
  }

  /** 겹친 경단을 무게 비율대로 떼어 놓습니다 — 바닥을 뚫지 않게 위로 밀어 올리며 */
  function separate() {
    var bodies = S.bodies;
    for (var it = 0; it < SEP_ITER; it++) {
      var worst = 0;
      for (var i = 0; i < bodies.length; i++) {
        var a = bodies[i];
        for (var j = i + 1; j < bodies.length; j++) {
          var b = bodies[j];
          if (a.sleeping && b.sleeping) { continue; }
          var hit = contact(a, b, 0);
          if (!hit || hit.overlap < 0.05) { continue; }
          var ma = a.r * a.r, mb = b.r * b.r;
          var share = a.sleeping ? 0 : (b.sleeping ? 1 : mb / (ma + mb));
          var px = hit.nx * hit.overlap, py = hit.ny * hit.overlap;
          a.x -= px * share;
          b.x += px * (1 - share);
          var floorA = H - a.r * shapeOf(a)[6];
          var floorB = H - b.r * shapeOf(b)[6];
          var liftA = Math.min(-py * share, Math.max(0, floorA - a.y));
          var liftB = Math.min(py + liftA, Math.max(0, floorB - b.y));
          if (!a.sleeping) { a.y += liftB - py; }
          if (!b.sleeping) { b.y += liftB; }
          worst = Math.max(worst, hit.overlap);
        }
      }
      for (var k = 0; k < bodies.length; k++) {
        var body = bodies[k], sh = shapeOf(body);
        var nx2 = Math.max(body.r * sh[12], Math.min(W - body.r * sh[0], body.x));
        var ny2 = Math.min(H - body.r * sh[6], body.y);
        worst = Math.max(worst, Math.abs(nx2 - body.x), body.y - ny2);
        body.x = nx2;
        body.y = ny2;
      }
      if (worst < 0.05) { break; }
    }
  }

  /** 바닥·벽·경단에 닿은 곳 — 다가오는 속도를 지우고, 마찰로 서서히 멈추고, 잠들게 합니다 */
  function markEdge(st, nx, ny) {
    if (ny > 0.2) {
      st.below = true;
      if (Math.abs(nx) < 0.16) { st.flat = true; }
    }
    if (nx < -0.01) { st.left = Math.max(st.left, ny / -nx); }
    if (nx > 0.01) { st.right = Math.max(st.right, ny / nx); }
  }

  function bounce(dt) {
    var bodies = S.bodies;
    var gap = W / 2400;
    var touch = W * 0.12;
    var list = [];
    var states = [];
    var i, j;

    for (i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var sh = shapeOf(b);
      var onFloor = H - b.y - b.r * sh[6] <= gap;
      var st = { below: onFloor, flat: onFloor, left: -Infinity, right: -Infinity };
      if (onFloor && !b.sleeping && b.vy < touch) {
        list.push({ a: b, b: null, nx: 0, ny: 1, sa: 1, sb: 0 });
      }
      if (b.x - b.r * sh[12] <= gap) {
        markEdge(st, -1, 0);
        if (!b.sleeping && -b.vx < touch) { list.push({ a: b, b: null, nx: -1, ny: 0, sa: 1, sb: 0 }); }
      }
      if (W - b.x - b.r * sh[0] <= gap) {
        markEdge(st, 1, 0);
        if (!b.sleeping && b.vx < touch) { list.push({ a: b, b: null, nx: 1, ny: 0, sa: 1, sb: 0 }); }
      }
      states.push(st);
    }

    for (i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      for (j = i + 1; j < bodies.length; j++) {
        var c = bodies[j];
        var hit = contact(a, c, gap);
        if (!hit) { continue; }
        var ma = a.r * a.r, mb = c.r * c.r;
        var share = a.sleeping ? 0 : (c.sleeping ? 1 : mb / (ma + mb));
        markEdge(states[i], hit.nx, hit.ny);
        markEdge(states[j], -hit.nx, -hit.ny);
        if (a.sleeping && c.sleeping) { continue; }
        if ((a.vx - c.vx) * hit.nx + (a.vy - c.vy) * hit.ny <= touch) {
          list.push({ a: a, b: c, nx: hit.nx, ny: hit.ny, sa: share, sb: 1 - share });
        }
      }
    }

    for (var it = 0; it < SEP_ITER; it++) {
      var most = 0;
      for (var k = 0; k < list.length; k++) {
        var im = list[k];
        var vn = (im.a.vx - (im.b ? im.b.vx : 0)) * im.nx + (im.a.vy - (im.b ? im.b.vy : 0)) * im.ny;
        if (vn <= 0) { continue; }
        im.a.vx -= im.nx * vn * im.sa;
        im.a.vy -= im.ny * vn * im.sa;
        if (im.b) {
          im.b.vx += im.nx * vn * im.sb;
          im.b.vy += im.ny * vn * im.sb;
        }
        most = Math.max(most, vn);
      }
      if (most < W * 0.00015) { break; }
    }

    for (i = 0; i < bodies.length; i++) {
      var body = bodies[i], s = states[i];
      if (body.held) { body.supported = true; continue; }   // 테스트용 고정 — 늘 버티는 것으로 봅니다
      var stand = s.below && (s.flat || s.left + s.right > 0.04);
      body.supported = s.below;
      if (body.sleeping && stand) { continue; }
      body.sleeping = false;
      if (s.below) {
        var slide = Math.min(1, Math.abs(body.vx) / (W * 0.18));
        var coef = s.flat ? 16 - 11 * slide : (stand ? 16 : 3);
        body.vx *= Math.exp(-coef * dt);
        if (stand) { body.vy *= Math.exp(-16 * dt); }
      }
      var quiet = Math.abs(body.vx) < W * 0.018 && Math.abs(body.vy) < W * 0.09;
      body.quiet = stand && quiet ? (body.quiet || 0) + dt : 0;
      if (body.quiet >= SLEEP_TIME) {
        body.sleeping = true;
        body.vx = 0;
        body.vy = 0;
      }
    }
  }

  /** 데드라인 — 쉬고 있는 경단이 판 위 8.5% 선을 넘으면 그 자리에서 끝 */
  function checkDeadline() {
    if (S.over) { return; }
    var band = H * BAND;
    var hot = 0;
    for (var i = 0; i < S.bodies.length; i++) {
      var b = S.bodies[i];
      if (!b.supported) { continue; }
      if (b.y - b.r * shapeOf(b)[18] <= band) { hot += 1; }
    }
    S.warn = hot;
    if (hot > 0) { gameOver('경단이 데드라인에 닿았어요'); }
  }

  function step(dt) {
    integrate(dt);
    contactPass();
    separate();
    bounce(dt);
    for (var i = 0; i < S.bodies.length; i++) {
      var b = S.bodies[i];
      /* 각속도(테스트 · 저장용) — 구르는 속도에서 뽑습니다 */
      b.av = b.supported ? b.vx / b.r : 0;
      if (b.glow > 0) { b.glow = Math.max(0, b.glow - dt); }
    }
    stepParticles(dt);
    if (S.dropCool > 0) { S.dropCool = Math.max(0, S.dropCool - dt); }
    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 2.2); }
    checkDeadline();
  }

  /* ===================================================================
     6. 이펙트
     =================================================================== */

  function burst(x, y, count, colors, speed) {
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var sp = speed * (0.35 + Math.random() * 0.8);
      S.particles.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - speed * 0.22,
        life: 0.55 + Math.random() * 0.5,
        max: 1.05,
        size: 1.6 + Math.random() * 2.6,
        color: colors[Math.floor(Math.random() * colors.length)]
      });
    }
    if (S.particles.length > 260) { S.particles = S.particles.slice(-260); }
  }

  function addPop(x, y, text, color) {
    S.pops.push({ x: x, y: y, text: text, color: color || '#ffffff', life: 1.1, max: 1.1 });
    if (S.pops.length > 12) { S.pops.shift(); }
  }

  function stepParticles(dt) {
    var list = S.particles;
    for (var i = list.length - 1; i >= 0; i--) {
      var p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy += H * GRAV * 0.45 * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (var k = S.pops.length - 1; k >= 0; k--) {
      var q = S.pops[k];
      q.life -= dt;
      q.y -= 34 * dt;
      if (q.life <= 0) { S.pops.splice(k, 1); }
    }
  }

  /* ===================================================================
     7. 그리기 — 경단 한 알(오리지널 아트)
     =================================================================== */

  function fmtNum(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* ===================================================================
     7. 경단 그림 — 도감 원본 PNG(assets/gyeongdan) · 없으면 Canvas 벡터 그림
     =================================================================== */

  var INK = '#3a2518';       // 진갈색 먹 외곽선
  var BLUSH = 'rgba(236, 138, 148, .4)';

  function lineW(g, r, k) {
    g.lineWidth = Math.max(1.2, r * (k || 0.085));
    g.lineJoin = 'round';
    g.lineCap = 'round';
  }

  function ballPath(g, r) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    return g;
  }

  function blush(g, x, y, rad, color) {
    g.fillStyle = color || BLUSH;
    g.beginPath();
    g.ellipse(x, y, rad, rad * 0.72, 0, 0, Math.PI * 2);
    g.fill();
  }

  function eyeSpark(g, x, y, rad) {
    g.fillStyle = 'rgba(255, 255, 255, .92)';
    g.beginPath();
    g.arc(x, y, Math.max(0.5, rad), 0, Math.PI * 2);
    g.fill();
  }

  /* 솜털 테두리 — 흰 털 · 갈기. 테두리를 먼저 긋고 안쪽을 채워 실루엣만 남깁니다. */
  function fluff(g, r, count, color, dist, rad, from, to) {
    var a0 = from === undefined ? -Math.PI / 2 : from;
    var a1 = to === undefined ? a0 + Math.PI * 2 : to;
    var step = (a1 - a0) / count;
    var i, a;
    lineW(g, r, 0.05);
    g.strokeStyle = INK;
    for (i = 0; i < count; i++) {
      a = a0 + step * (i + 0.5);
      g.beginPath();
      g.arc(Math.cos(a) * r * dist, Math.sin(a) * r * dist, r * rad, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = color;
    for (i = 0; i < count; i++) {
      a = a0 + step * (i + 0.5);
      g.beginPath();
      g.arc(Math.cos(a) * r * dist, Math.sin(a) * r * dist, r * rad, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawGyeongdan(g, tier, cx, cy, r, alpha) {
    var T = TIERS[tier];
    if (!T) { return; }

    /* 도감 원본 그림(PNG)이 있으면 그것을 그립니다. 없으면 아래 벡터 그림이 그대로 나옵니다. */
    var img = spriteOf(tier);
    if (img) {
      /* 그림 한 장이 기준 지름(2r)을 그대로 채웁니다 — 몸통은 그 안에서 살짝 작게.
         「루팡문파」와 같은 방식이라 충돌 반지름과 그림이 자연스럽게 겹칩니다. */
      var size = r * 2;
      var off = SPRITE_OFF[tier] || [0, 0];
      g.save();
      if (alpha !== undefined && alpha !== 1) { g.globalAlpha = alpha; }
      g.translate(cx, cy);
      g.drawImage(img, -size / 2 - off[0] * size, -size / 2 - off[1] * size, size, size);
      g.restore();
      return;
    }

    g.save();
    if (alpha !== undefined && alpha !== 1) { g.globalAlpha = alpha; }
    g.translate(cx, cy);

    drawBehind(g, T, r);
    drawBody(g, T, r);
    drawTexture(g, T, r);
    drawFace(g, T, r);
    drawFront(g, T, r);

    g.restore();
  }

  /* --- 몸통: 매트한 2D 셀 채색 + 굵은 외곽선 --- */
  function drawBody(g, T, r) {
    ballPath(g, r);
    g.fillStyle = T.color;
    g.fill();

    g.save();
    ballPath(g, r);
    g.clip();
    g.globalAlpha = (T.kind === 'cloud' || T.kind === 'dokkaebi') ? 0.2 : 0.38;
    g.fillStyle = T.dark;
    g.beginPath();
    g.ellipse(0, r * 1.5, r * 1.26, r * 0.94, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    /* 솜털 몸(자서귀단 · 백운단)은 테두리가 곧 실루엣입니다 */
    if (T.kind !== 'cloud' && T.kind !== 'dokkaebi') {
      lineW(g, r);
      g.strokeStyle = INK;
      ballPath(g, Math.max(0.5, r - g.lineWidth * 0.5));
      g.stroke();
    }
  }

  /* --- 경단 뒤에 두는 것들: 귀 · 뿔 · 갈기 · 더듬이 --- */
  function drawBehind(g, T, r) {
    var k = T.kind;
    g.save();
    lineW(g, r, 0.07);
    g.strokeStyle = INK;

    if (k === 'bat') {
      /* 둥근 양쪽 귀 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.56, -r * 0.66, r * 0.3, 0, Math.PI * 2);
        g.fillStyle = '#8f6c54';
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.56, -r * 0.66, r * 0.16, 0, Math.PI * 2);
        g.fillStyle = '#d3a0a6';
        g.fill();
      });
    } else if (k === 'mantis') {
      /* 더듬이 두 개 */
      [1, -1].forEach(function (s) {
        g.strokeStyle = INK;
        lineW(g, r, 0.075);
        g.beginPath();
        g.moveTo(s * r * 0.16, -r * 0.9);
        g.quadraticCurveTo(s * r * 0.46, -r * 1.42, s * r * 0.4, -r * 1.56);
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.4, -r * 1.58, r * 0.12, 0, Math.PI * 2);
        g.fillStyle = T.color;
        g.fill();
        g.stroke();
      });
      /* 양옆 하늘색 앞발 */
      [1, -1].forEach(function (s) {
        g.save();
        g.translate(s * r * 0.84, r * 0.5);
        g.rotate(s * 0.34);
        g.beginPath();
        g.ellipse(0, 0, r * 0.24, r * 0.32, 0, 0, Math.PI * 2);
        g.fillStyle = '#8ed8cd';
        g.fill();
        lineW(g, r, 0.06);
        g.strokeStyle = INK;
        g.stroke();
        g.restore();
      });
    } else if (k === 'mouse') {
      /* 붉은 둥근 귀 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.62, -r * 0.6, r * 0.36, 0, Math.PI * 2);
        g.fillStyle = '#c9463f';
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.62, -r * 0.6, r * 0.2, 0, Math.PI * 2);
        g.fillStyle = '#8e2f2c';
        g.fill();
      });
    } else if (k === 'tiger') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.64, -r * 0.72, r * 0.25, 0, Math.PI * 2);
        g.fillStyle = T.color;
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.64, -r * 0.72, r * 0.13, 0, Math.PI * 2);
        g.fillStyle = '#f6c877';
        g.fill();
      });
    } else if (k === 'pig') {
      /* 머리 위 진분홍 갈기 세 갈래 */
      g.fillStyle = '#c8425f';
      [-0.24, 0, 0.24].forEach(function (mx, i) {
        var x = mx * r;
        var tip = -(1.4 + (i === 1 ? 0.16 : 0.02)) * r;
        g.beginPath();
        g.moveTo(x - r * 0.2, -r * 0.84);
        g.quadraticCurveTo(x - r * 0.06, tip - r * 0.06, x + r * 0.03, tip);
        g.quadraticCurveTo(x + r * 0.05, tip + r * 0.26, x + r * 0.2, -r * 0.82);
        g.closePath();
        g.fill();
        g.stroke();
      });
      /* 늘어진 귀 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.44, -r * 0.76);
        g.quadraticCurveTo(s * r * 0.92, -r * 0.96, s * r * 0.9, -r * 0.46);
        g.quadraticCurveTo(s * r * 0.84, -r * 0.26, s * r * 0.6, -r * 0.4);
        g.closePath();
        g.fillStyle = '#96788c';
        g.fill();
        g.stroke();
      });
    } else if (k === 'bear') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.6, -r * 0.72, r * 0.3, 0, Math.PI * 2);
        g.fillStyle = '#8a5636';
        g.fill();
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.6, -r * 0.72, r * 0.16, 0, Math.PI * 2);
        g.fillStyle = '#d7b07c';
        g.fill();
      });
    } else if (k === 'dokkaebi') {
      /* 하늘/청록 곱슬 갈기 */
      g.save();
      var curls = [[-0.46, -0.78, 0.24], [-0.18, -0.92, 0.26], [0.14, -0.94, 0.25],
        [0.44, -0.8, 0.22], [0.0, -1.14, 0.2], [-0.5, -1.02, 0.16], [0.5, -1.02, 0.16]];
      curls.forEach(function (c) {
        g.beginPath();
        g.arc(c[0] * r, c[1] * r, c[2] * r, 0, Math.PI * 2);
        g.fillStyle = '#6fc7d6';
        g.fill();
        lineW(g, r, 0.05);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.arc(c[0] * r - c[2] * r * 0.2, c[1] * r - c[2] * r * 0.25, c[2] * r * 0.5, 0, Math.PI * 2);
        g.fillStyle = '#bfeef3';
        g.fill();
      });
      g.restore();
      /* 흰 솜털 */
      fluff(g, r, 14, '#fbfbf7', 0.94, 0.22);
    } else if (k === 'fox') {
      /* 뾰족 귀 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.2, -r * 0.8);
        g.quadraticCurveTo(s * r * 0.6, -r * 1.4, s * r * 0.72, -r * 1.54);
        g.quadraticCurveTo(s * r * 0.84, -r * 1.0, s * r * 0.88, -r * 0.5);
        g.closePath();
        g.fillStyle = T.color;
        g.fill();
        g.stroke();
        g.beginPath();
        g.moveTo(s * r * 0.42, -r * 0.92);
        g.quadraticCurveTo(s * r * 0.6, -r * 1.24, s * r * 0.66, -r * 1.38);
        g.quadraticCurveTo(s * r * 0.74, -r * 0.98, s * r * 0.74, -r * 0.72);
        g.closePath();
        g.fillStyle = '#ffe9c8';
        g.fill();
      });
      /* 흰 볼 털 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.9, r * 0.16, r * 0.28, 0, Math.PI * 2);
        g.fillStyle = '#fdf3e2';
        g.fill();
        g.stroke();
      });
    } else if (k === 'tigerking') {
      /* 진한 붉은 갈기 */
      var n = 14;
      for (var i = 0; i < n; i++) {
        var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        var a0 = a - 0.18, a1 = a + 0.18;
        g.beginPath();
        g.moveTo(Math.cos(a0) * r * 0.94, Math.sin(a0) * r * 0.94);
        g.quadraticCurveTo(Math.cos(a - 0.05) * r * 1.28, Math.sin(a - 0.05) * r * 1.28,
          Math.cos(a) * r * 1.32, Math.sin(a) * r * 1.32);
        g.quadraticCurveTo(Math.cos(a + 0.05) * r * 1.28, Math.sin(a + 0.05) * r * 1.28,
          Math.cos(a1) * r * 0.94, Math.sin(a1) * r * 0.94);
        g.closePath();
        g.fillStyle = '#a8332f';
        g.fill();
        lineW(g, r, 0.05);
        g.stroke();
      }
    } else if (k === 'cloud') {
      /* 은은한 금빛 후광 */
      g.save();
      g.globalAlpha = 0.45;
      g.strokeStyle = '#eccf8f';
      g.lineWidth = Math.max(1.2, r * 0.03);
      g.beginPath();
      g.arc(0, 0, r * 1.28, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      /* 하얀 깃털 솜 */
      fluff(g, r, 15, '#fdfcf7', 0.92, 0.26);
    }
    g.restore();
  }

  /* --- 표면 무늬: 원 안에만 그립니다 --- */
  function drawTexture(g, T, r) {
    var k = T.kind;
    g.save();
    ballPath(g, r * 0.995);
    g.clip();

    if (k === 'tiger') {
      /* 하얀 볼 · 입 주변 */
      g.fillStyle = '#fdf6ea';
      g.beginPath();
      g.ellipse(0, r * 0.6, r * 1.0, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
      /* 옆 줄무늬 */
      g.strokeStyle = 'rgba(92, 52, 16, .8)';
      lineW(g, r, 0.07);
      [-1, 1].forEach(function (s) {
        for (var i = 0; i < 2; i++) {
          var y = -r * 0.3 + i * r * 0.26;
          g.beginPath();
          g.moveTo(s * r, y - r * 0.07);
          g.quadraticCurveTo(s * r * 0.64, y + r * 0.05, s * r * 0.44, y - r * 0.03);
          g.stroke();
        }
      });
    } else if (k === 'tigerking') {
      g.fillStyle = '#fbf5ea';
      g.beginPath();
      g.ellipse(0, r * 0.66, r * 0.92, r * 0.48, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(168, 51, 47, .45)';
      lineW(g, r, 0.05);
      [-1, 1].forEach(function (s) {
        for (var i = 0; i < 2; i++) {
          var y = -r * 0.24 + i * r * 0.22;
          g.beginPath();
          g.moveTo(s * r, y - r * 0.06);
          g.quadraticCurveTo(s * r * 0.66, y + r * 0.04, s * r * 0.5, y - r * 0.02);
          g.stroke();
        }
      });
    } else if (k === 'snake') {
      /* 하얀 턱 */
      g.fillStyle = '#f7efe4';
      g.beginPath();
      g.ellipse(0, r * 0.72, r * 0.92, r * 0.44, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(0, r * 0.3, r * 0.46, r * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      /* 은은한 비늘 */
      g.strokeStyle = 'rgba(120, 96, 78, .22)';
      lineW(g, r, 0.026);
      for (var row = 0; row < 3; row++) {
        for (var col = -2; col <= 2; col++) {
          var sx = col * r * 0.34 + (row % 2 ? r * 0.17 : 0);
          var sy = row * r * 0.26 - r * 0.5;
          g.beginPath();
          g.arc(sx, sy, r * 0.15, Math.PI * 0.15, Math.PI * 0.85);
          g.stroke();
        }
      }
    } else if (k === 'mouse') {
      /* 하얀 주둥이 */
      g.fillStyle = '#f1e8c6';
      g.beginPath();
      g.ellipse(0, r * 0.34, r * 0.48, r * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'mantis') {
      g.fillStyle = 'rgba(200, 226, 250, .5)';
      [[-0.42, 0.1], [0.46, 0.06], [0.0, -0.52]].forEach(function (p) {
        g.beginPath();
        g.arc(p[0] * r, p[1] * r, r * 0.09, 0, Math.PI * 2);
        g.fill();
      });
    } else if (k === 'bear') {
      g.fillStyle = '#e2c58f';
      g.beginPath();
      g.ellipse(0, r * 0.42, r * 0.44, r * 0.4, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'pig') {
      g.fillStyle = 'rgba(255, 255, 255, .1)';
      g.beginPath();
      g.ellipse(0, -r * 0.4, r * 0.7, r * 0.28, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'dokkaebi') {
      /* 연두 볼 */
      g.fillStyle = '#a8c86a';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * r * 0.56, r * 0.22, r * 0.17, r * 0.13, 0, 0, Math.PI * 2);
        g.fill();
      });
    } else if (k === 'fox') {
      /* 흰 눈썹 위쪽 털 */
      g.fillStyle = '#fdf3e2';
      g.beginPath();
      g.ellipse(0, r * 0.62, r * 0.8, r * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'cloud') {
      g.strokeStyle = 'rgba(214, 172, 104, .3)';
      lineW(g, r, 0.022);
      g.beginPath();
      g.arc(0, 0, r * 0.86, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  /* --- 얼굴 --- */
  function drawFace(g, T, r) {
    var k = T.kind;
    var ex = r * 0.31;
    var ey = -r * 0.06;
    g.save();
    g.strokeStyle = INK;
    g.fillStyle = INK;
    g.lineCap = 'round';
    g.lineJoin = 'round';

    if (k === 'bat') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey - r * 0.04, r * 0.085, r * 0.105, 0, 0, Math.PI * 2);
        g.fillStyle = '#2a1b12';
        g.fill();
        eyeSpark(g, s * ex + r * 0.03, ey - r * 0.12, r * 0.03);
      });
      /* 커다란 분홍 코 */
      g.beginPath();
      g.ellipse(0, r * 0.2, r * 0.3, r * 0.23, 0, 0, Math.PI * 2);
      g.fillStyle = '#d99ba3';
      g.fill();
      lineW(g, r, 0.04);
      g.stroke();
      g.fillStyle = 'rgba(122, 66, 72, .65)';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * r * 0.09, r * 0.2, r * 0.032, r * 0.045, 0, 0, Math.PI * 2);
        g.fill();
      });
      g.strokeStyle = INK;
      lineW(g, r, 0.042);
      g.beginPath();
      g.arc(0, r * 0.46, r * 0.1, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else if (k === 'mantis') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.075, r * 0.1, 0, 0, Math.PI * 2);
        g.fillStyle = '#20304d';
        g.fill();
        eyeSpark(g, s * ex + r * 0.026, ey - r * 0.04, r * 0.028);
      });
      g.strokeStyle = '#2c4a2a';
      lineW(g, r, 0.045);
      g.beginPath();
      g.arc(0, r * 0.24, r * 0.1, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
    } else if (k === 'mouse') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.075, r * 0.095, 0, 0, Math.PI * 2);
        g.fillStyle = '#2a2016';
        g.fill();
        eyeSpark(g, s * ex + r * 0.026, ey - r * 0.04, r * 0.028);
      });
      /* 노란 코 */
      g.beginPath();
      g.ellipse(0, r * 0.24, r * 0.075, r * 0.06, 0, 0, Math.PI * 2);
      g.fillStyle = '#e2c25a';
      g.fill();
      g.strokeStyle = INK;
      lineW(g, r, 0.03);
      g.stroke();
      g.strokeStyle = '#5b4a22';
      lineW(g, r, 0.04);
      g.beginPath();
      g.arc(0, r * 0.42, r * 0.12, Math.PI * 0.18, Math.PI * 0.82);
      g.stroke();
    } else if (k === 'snake') {
      /* 웃느라 접힌 눈 */
      [-1, 1].forEach(function (s) {
        g.strokeStyle = '#3a2a20';
        lineW(g, r, 0.075);
        g.beginPath();
        g.arc(s * ex, ey + r * 0.06, r * 0.12, Math.PI * 1.12, Math.PI * 1.88);
        g.stroke();
      });
      /* 활짝 웃는 붉은 입 */
      g.beginPath();
      g.ellipse(0, r * 0.42, r * 0.3, r * 0.24, 0, 0, Math.PI * 2);
      g.fillStyle = '#c0392b';
      g.fill();
      lineW(g, r, 0.045);
      g.strokeStyle = INK;
      g.stroke();
      g.beginPath();
      g.ellipse(0, r * 0.5, r * 0.16, r * 0.11, 0, 0, Math.PI * 2);
      g.fillStyle = '#e2547a';
      g.fill();
      /* 작은 이빨 두 개 */
      g.fillStyle = '#fffdf6';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.14, r * 0.22);
        g.lineTo(s * r * 0.07, r * 0.3);
        g.lineTo(s * r * 0.19, r * 0.3);
        g.closePath();
        g.fill();
      });
    } else if (k === 'tiger') {
      /* 이마 王자 */
      g.strokeStyle = 'rgba(84, 48, 14, .85)';
      lineW(g, r, 0.05);
      var ty = -r * 0.56, tw = r * 0.15;
      g.beginPath();
      g.moveTo(-tw, ty - r * 0.055); g.lineTo(tw, ty - r * 0.055);
      g.moveTo(-tw * 0.8, ty); g.lineTo(tw * 0.8, ty);
      g.moveTo(-tw, ty + r * 0.055); g.lineTo(tw, ty + r * 0.055);
      g.stroke();
      /* 붉은 눈 */
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.12, r * 0.125, 0, 0, Math.PI * 2);
        g.fillStyle = '#d63b3b';
        g.fill();
        lineW(g, r, 0.045);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey + r * 0.01, r * 0.045, r * 0.06, 0, 0, Math.PI * 2);
        g.fillStyle = '#40100f';
        g.fill();
        eyeSpark(g, s * ex + r * 0.035, ey - r * 0.05, r * 0.033);
        /* 치켜올린 눈썹 */
        g.beginPath();
        g.moveTo(s * (ex - r * 0.14), ey - r * 0.23);
        g.quadraticCurveTo(s * ex, ey - r * 0.32, s * (ex + r * 0.13), ey - r * 0.18);
        lineW(g, r, 0.045);
        g.strokeStyle = INK;
        g.stroke();
      });
    } else if (k === 'pig') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.07, r * 0.09, 0, 0, Math.PI * 2);
        g.fillStyle = '#3b2233';
        g.fill();
        eyeSpark(g, s * ex + r * 0.024, ey - r * 0.04, r * 0.026);
      });
      g.strokeStyle = INK;
      lineW(g, r, 0.042);
      g.beginPath();
      g.arc(0, r * 0.16, r * 0.11, Math.PI * 0.2, Math.PI * 0.8);
      g.stroke();
    } else if (k === 'bear') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.095, r * 0.11, 0, 0, Math.PI * 2);
        g.fillStyle = '#d9a733';
        g.fill();
        lineW(g, r, 0.035);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey + r * 0.01, r * 0.04, r * 0.055, 0, 0, Math.PI * 2);
        g.fillStyle = '#33230f';
        g.fill();
        eyeSpark(g, s * ex + r * 0.03, ey - r * 0.045, r * 0.028);
      });
    } else if (k === 'dokkaebi') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.1, r * 0.115, 0, 0, Math.PI * 2);
        g.fillStyle = '#e0b23c';
        g.fill();
        lineW(g, r, 0.04);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey + r * 0.01, r * 0.042, r * 0.06, 0, 0, Math.PI * 2);
        g.fillStyle = '#33240c';
        g.fill();
        eyeSpark(g, s * ex + r * 0.032, ey - r * 0.045, r * 0.028);
      });
      /* 금빛 부리 같은 코 */
      g.beginPath();
      g.moveTo(-r * 0.08, r * 0.16);
      g.lineTo(r * 0.08, r * 0.16);
      g.lineTo(0, r * 0.34);
      g.closePath();
      g.fillStyle = '#e8b53c';
      g.fill();
      lineW(g, r, 0.035);
      g.strokeStyle = INK;
      g.stroke();
    } else if (k === 'fox') {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * (ex - r * 0.14), ey + r * 0.03);
        g.quadraticCurveTo(s * ex, ey - r * 0.13, s * (ex + r * 0.15), ey - r * 0.04);
        g.quadraticCurveTo(s * ex, ey + r * 0.1, s * (ex - r * 0.14), ey + r * 0.03);
        g.closePath();
        g.fillStyle = '#f0b93a';
        g.fill();
        lineW(g, r, 0.04);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.024, r * 0.07, 0, 0, Math.PI * 2);
        g.fillStyle = '#4a2c06';
        g.fill();
        /* 하얀 눈썹 */
        g.strokeStyle = '#fdf3e2';
        lineW(g, r, 0.075);
        g.beginPath();
        g.moveTo(s * (ex - r * 0.15), ey - r * 0.18);
        g.quadraticCurveTo(s * ex, ey - r * 0.3, s * (ex + r * 0.15), ey - r * 0.16);
        g.stroke();
      });
      g.strokeStyle = INK;
      lineW(g, r, 0.042);
      g.beginPath();
      g.arc(0, r * 0.34, r * 0.1, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    } else if (k === 'tigerking') {
      /* 금빛 눈 */
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.11, r * 0.095, 0, 0, Math.PI * 2);
        g.fillStyle = '#f0b93a';
        g.fill();
        lineW(g, r, 0.04);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.024, r * 0.07, 0, 0, Math.PI * 2);
        g.fillStyle = '#3a2408';
        g.fill();
        g.beginPath();
        g.moveTo(s * (ex - r * 0.15), ey - r * 0.19);
        g.quadraticCurveTo(s * ex, ey - r * 0.27, s * (ex + r * 0.13), ey - r * 0.14);
        lineW(g, r, 0.045);
        g.strokeStyle = INK;
        g.stroke();
      });
      g.strokeStyle = INK;
      lineW(g, r, 0.04);
      g.beginPath();
      g.moveTo(-r * 0.12, r * 0.36);
      g.quadraticCurveTo(0, r * 0.44, r * 0.12, r * 0.36);
      g.stroke();
    } else if (k === 'cloud') {
      /* 금빛 눈 */
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, r * 0.09, r * 0.1, 0, 0, Math.PI * 2);
        g.fillStyle = '#e8b53c';
        g.fill();
        lineW(g, r, 0.035);
        g.strokeStyle = INK;
        g.stroke();
        g.beginPath();
        g.ellipse(s * ex, ey + r * 0.01, r * 0.035, r * 0.05, 0, 0, Math.PI * 2);
        g.fillStyle = '#3a2a08';
        g.fill();
      });
    }
    g.restore();
  }

  /* --- 얼굴 앞쪽: 부리 · 수염 · 송곳니 · 관 --- */
  function drawFront(g, T, r) {
    var k = T.kind;
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = INK;

    if (k === 'pig') {
      /* 돼지코 */
      g.fillStyle = '#f2a9b8';
      lineW(g, r, 0.045);
      g.beginPath();
      g.ellipse(0, r * 0.3, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#a85b78';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * r * 0.11, r * 0.3, r * 0.042, r * 0.062, 0, 0, Math.PI * 2);
        g.fill();
      });
      /* 양옆 흰 송곳니 */
      g.fillStyle = '#fffdf4';
      lineW(g, r, 0.032);
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.42, r * 0.44);
        g.quadraticCurveTo(s * r * 0.56, r * 0.36, s * r * 0.52, r * 0.06);
        g.quadraticCurveTo(s * r * 0.42, r * 0.24, s * r * 0.34, r * 0.36);
        g.closePath();
        g.fill();
        g.stroke();
      });
    } else if (k === 'bear') {
      g.fillStyle = '#4a3222';
      lineW(g, r, 0.032);
      g.beginPath();
      g.ellipse(0, r * 0.3, r * 0.13, r * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.strokeStyle = '#5b4130';
      lineW(g, r, 0.038);
      g.beginPath();
      g.moveTo(0, r * 0.4);
      g.lineTo(0, r * 0.5);
      g.moveTo(0, r * 0.5);
      g.quadraticCurveTo(-r * 0.08, r * 0.58, -r * 0.16, r * 0.5);
      g.moveTo(0, r * 0.5);
      g.quadraticCurveTo(r * 0.08, r * 0.58, r * 0.16, r * 0.5);
      g.stroke();
    } else if (k === 'tiger') {
      /* 웃는 입 + 송곳니 */
      g.beginPath();
      g.moveTo(-r * 0.24, r * 0.24);
      g.quadraticCurveTo(0, r * 0.56, r * 0.24, r * 0.24);
      g.quadraticCurveTo(0, r * 0.36, -r * 0.24, r * 0.24);
      g.closePath();
      g.fillStyle = '#6d2a2a';
      g.fill();
      lineW(g, r, 0.04);
      g.stroke();
      g.fillStyle = '#fffdf4';
      lineW(g, r, 0.028);
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.13, r * 0.26);
        g.lineTo(s * r * 0.05, r * 0.42);
        g.lineTo(s * r * 0.19, r * 0.34);
        g.closePath();
        g.fill();
        g.stroke();
      });
      g.fillStyle = '#8a4a16';
      g.beginPath();
      g.ellipse(0, r * 0.16, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'fox') {
      g.fillStyle = '#4a3208';
      g.beginPath();
      g.ellipse(0, r * 0.24, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(60, 42, 16, .5)';
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.arc(s * r * 0.32, r * 0.34 + i * r * 0.07, r * 0.026, 0, Math.PI * 2);
          g.fill();
        }
      });
    } else if (k === 'tigerking') {
      /* 풍성한 하얀 수염 */
      fluff(g, r, 7, '#fbf5ea', 0.74, 0.24, Math.PI * 0.18, Math.PI * 0.82);
      g.strokeStyle = 'rgba(90, 100, 118, .55)';
      lineW(g, r, 0.022);
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(s * r * 0.26, r * 0.42 + i * r * 0.06);
          g.quadraticCurveTo(s * r * 0.66, r * 0.34 + i * r * 0.16,
            s * r * 0.96, r * 0.26 + i * r * 0.24);
          g.stroke();
        }
      });
      g.fillStyle = '#8b6a4e';
      g.beginPath();
      g.ellipse(0, r * 0.3, r * 0.075, r * 0.055, 0, 0, Math.PI * 2);
      g.fill();
      /* 갈기 위 초록 장식 */
      g.beginPath();
      g.arc(0, -r * 1.24, r * 0.1, 0, Math.PI * 2);
      g.fillStyle = '#4d8a5a';
      g.fill();
      lineW(g, r, 0.035);
      g.strokeStyle = '#e8c46a';
      g.stroke();
    } else if (k === 'cloud') {
      /* 붉은 관 */
      g.beginPath();
      g.moveTo(-r * 0.34, -r * 0.86);
      g.quadraticCurveTo(-r * 0.28, -r * 1.22, -r * 0.1, -r * 1.16);
      g.quadraticCurveTo(0, -r * 1.42, r * 0.12, -r * 1.14);
      g.quadraticCurveTo(r * 0.3, -r * 1.2, r * 0.34, -r * 0.82);
      g.closePath();
      g.fillStyle = '#c8383f';
      g.fill();
      lineW(g, r, 0.045);
      g.strokeStyle = INK;
      g.stroke();
      g.fillStyle = '#e8c46a';
      g.beginPath();
      g.ellipse(0, -r * 0.86, r * 0.34, r * 0.08, 0, 0, Math.PI * 2);
      g.fill();
      /* 금빛 부리 */
      g.beginPath();
      g.moveTo(-r * 0.1, r * 0.16);
      g.lineTo(r * 0.1, r * 0.16);
      g.lineTo(0, r * 0.4);
      g.closePath();
      g.fillStyle = '#e8b53c';
      g.fill();
      lineW(g, r, 0.035);
      g.strokeStyle = INK;
      g.stroke();
      /* 푸른 보석 */
      g.beginPath();
      g.arc(0, r * 0.62, r * 0.075, 0, Math.PI * 2);
      g.fillStyle = '#6fa8d8';
      g.fill();
      g.stroke();
    } else if (k === 'dokkaebi') {
      g.fillStyle = '#e8b53c';
      g.beginPath();
      g.ellipse(0, -r * 1.02, r * 0.07, r * 0.07, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  function drawSpark(g, s) {
    g.beginPath();
    g.moveTo(0, -s * 1.4);
    g.quadraticCurveTo(s * 0.2, -s * 0.2, s * 1.4, 0);
    g.quadraticCurveTo(s * 0.2, s * 0.2, 0, s * 1.4);
    g.quadraticCurveTo(-s * 0.2, s * 0.2, -s * 1.4, 0);
    g.quadraticCurveTo(-s * 0.2, -s * 0.2, 0, -s * 1.4);
    g.fill();
  }

  /* ===================================================================
     8. 그리기 — 화면
     =================================================================== */

  var view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1 };

  var backdrop = null;

  function resize() {
    if (!el.canvas || !el.stage) { return; }
    /* 테두리 안쪽(내용 상자)을 그대로 놀이판으로 — 남는 여백도 넘침도 없습니다 */
    var w = Math.round(el.stage.clientWidth);
    var h = Math.round(el.stage.clientHeight);
    if (w < 40 || h < 40) { return; }   // 아직 화면에 올라오기 전
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var oldW = W, oldH = H;
    /* 그림이 테두리에 잘려 보이지 않도록 가장자리에 살짝 여유 */
    var padX = Math.max(2, Math.round(w * 0.006));
    var padB = Math.max(4, Math.round(h * 0.018));
    W = w - padX * 2;
    H = h - padB;
    view.w = w; view.h = h; view.dpr = dpr;
    view.scale = 1; view.ox = padX; view.oy = 0;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    el.canvas.style.width = w + 'px';
    el.canvas.style.height = h + 'px';
    /* 판 크기가 바뀌면 경단도 같이 — 반지름은 너비를 따릅니다 */
    if (S && oldW > 40 && (oldW !== w || oldH !== h)) {
      var sx = w / oldW, sy = h / oldH;
      S.bodies.forEach(function (b) {
        b.x *= sx;
        b.y *= sy;
        b.vx *= sx;
        b.vy *= sy;
        b.r = rad(b.tier);
        b._shape = null;
        b.sleeping = false;
      });
      S.aimX *= sx;
    }
    buildBackdrop();
  }

  /* --- 배경(한지 · 수묵 산수 · 금빛 빛망울)은 크기가 바뀔 때 한 번만 --- */
  function inkRidge(g, w, h, base, amp, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-2, h * (base + amp * 0.4));
    g.quadraticCurveTo(w * 0.14, h * (base - amp), w * 0.3, h * (base - amp * 0.2));
    g.quadraticCurveTo(w * 0.45, h * (base + amp * 0.5), w * 0.58, h * (base - amp * 0.6));
    g.quadraticCurveTo(w * 0.72, h * (base - amp * 1.1), w * 0.86, h * (base + amp * 0.1));
    g.quadraticCurveTo(w * 0.95, h * (base + amp * 0.6), w + 2, h * (base - amp * 0.15));
    g.lineTo(w + 2, h + 2);
    g.lineTo(-2, h + 2);
    g.closePath();
    g.fill();
  }

  function buildBackdrop() {
    if (!el.canvas) { return; }
    var w = el.canvas.width, h = el.canvas.height;
    if (!w || !h) { return; }
    var c = backdrop || document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);

    /* 위는 남청 밤하늘, 아래는 따뜻한 한지빛 */
    var sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#232741');
    sky.addColorStop(0.11, '#2c2b3d');
    sky.addColorStop(0.24, '#5c4231');
    sky.addColorStop(0.46, '#8e5f3a');
    sky.addColorStop(0.72, '#b57e46');
    sky.addColorStop(1, '#d5a56d');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    /* 밤하늘의 작은 별 */
    var stars = [[0.08, 0.030], [0.18, 0.055], [0.31, 0.026], [0.44, 0.050],
      [0.57, 0.020], [0.70, 0.048], [0.82, 0.028], [0.93, 0.062], [0.25, 0.092], [0.66, 0.086]];
    g.fillStyle = '#fff4d6';
    stars.forEach(function (s, i) {
      g.globalAlpha = i % 3 === 0 ? 0.72 : 0.4;
      g.beginPath();
      g.arc(s[0] * w, s[1] * h, Math.max(1, w * 0.0022), 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;

    /* 겹겹 수묵 산수 */
    inkRidge(g, w, h, 0.27, 0.06, 'rgba(64, 66, 100, .36)');
    inkRidge(g, w, h, 0.37, 0.085, 'rgba(96, 72, 74, .33)');
    inkRidge(g, w, h, 0.49, 0.1, 'rgba(126, 82, 50, .36)');

    /* 물안개 */
    var mist = g.createLinearGradient(0, h * 0.54, 0, h * 0.80);
    mist.addColorStop(0, 'rgba(255, 226, 178, 0)');
    mist.addColorStop(0.5, 'rgba(255, 226, 178, .17)');
    mist.addColorStop(1, 'rgba(255, 226, 178, 0)');
    g.fillStyle = mist;
    g.fillRect(0, h * 0.54, w, h * 0.26);

    /* 은은한 금빛 빛망울 */
    var bokeh = [[0.16, 0.14, 0.055], [0.85, 0.22, 0.04], [0.30, 0.46, 0.032],
      [0.74, 0.58, 0.05], [0.12, 0.72, 0.038], [0.55, 0.86, 0.045], [0.90, 0.90, 0.03]];
    bokeh.forEach(function (b) {
      var cx = b[0] * w, cy = b[1] * h, rr = b[2] * w * 1.7;
      var gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      gr.addColorStop(0, 'rgba(255, 214, 140, .48)');
      gr.addColorStop(0.42, 'rgba(255, 196, 116, .16)');
      gr.addColorStop(1, 'rgba(255, 190, 110, 0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255, 238, 190, .6)';
      g.beginPath();
      g.arc(cx, cy, Math.max(1, rr * 0.055), 0, Math.PI * 2);
      g.fill();
    });

    /* 바닥의 한지 그라데이션 */
    var warm = g.createLinearGradient(0, h * 0.68, 0, h);
    warm.addColorStop(0, 'rgba(214, 154, 92, 0)');
    warm.addColorStop(1, 'rgba(232, 182, 118, .45)');
    g.fillStyle = warm;
    g.fillRect(0, h * 0.68, w, h * 0.32);

    backdrop = c;
  }

  function worldTransform() {
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale,
      view.dpr * view.ox, view.dpr * view.oy);
  }

  function draw() {
    if (!ctx) { return; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (backdrop) {
      ctx.drawImage(backdrop, 0, 0);
    } else {
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
    }

    worldTransform();
    var shakeX = 0, shakeY = 0;
    if (S && S.shake > 0.01) {
      shakeX = (Math.random() - 0.5) * S.shake * 5;
      shakeY = (Math.random() - 0.5) * S.shake * 5;
    }
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawBoard();
    if (S) {
      S.bodies.forEach(function (b) {
        var picked = S.picks.indexOf(b) !== -1;
        if (picked) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = '#ffe9a8';
          ballPath(ctx, b.r + 5);
          ctx.fill();
          ctx.restore();
        }
        /* 막 합쳐진 경단은 잠깐 금빛으로 번집니다 */
        if (b.glow > 0) {
          var gl = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * 1.55);
          gl.addColorStop(0, '#fff1b7');
          gl.addColorStop(0.55, '#ffbd68');
          gl.addColorStop(1, 'rgba(255, 176, 76, 0)');
          ctx.save();
          ctx.globalAlpha = Math.min(1, b.glow / 0.22);
          ctx.fillStyle = gl;
          ctx.fillRect(b.x - b.r * 1.55, b.y - b.r * 1.55, b.r * 3.1, b.r * 3.1);
          ctx.restore();
        }
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle || 0);
        drawGyeongdan(ctx, b.tier, 0, 0, b.r, 1);
        ctx.restore();
      });
      drawParticles();
      drawPops();
      if (!S.over) { drawAim(); }
    }
    ctx.restore();
  }

  function drawBoard() {
    /* 그릇 안쪽 — 은은한 황토빛 한지 */
    var inner = ctx.createLinearGradient(0, 0, 0, H);
    inner.addColorStop(0, 'rgba(44, 32, 40, .26)');
    inner.addColorStop(0.42, 'rgba(132, 88, 54, .16)');
    inner.addColorStop(1, 'rgba(232, 178, 112, .26)');
    ctx.fillStyle = inner;
    ctx.fillRect(0, 0, W, H);

    /* 안쪽 금선 — 판 가장자리에 은은하게 */
    var corner = Math.min(16, W * 0.045);
    ctx.save();
    ctx.strokeStyle = 'rgba(242, 216, 164, .18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(6, corner + 6);
    ctx.quadraticCurveTo(6, 6, corner + 6, 6);
    ctx.lineTo(W - corner - 6, 6);
    ctx.quadraticCurveTo(W - 6, 6, W - 6, corner + 6);
    ctx.lineTo(W - 6, H - corner - 6);
    ctx.quadraticCurveTo(W - 6, H - 6, W - corner - 6, H - 6);
    ctx.lineTo(corner + 6, H - 6);
    ctx.quadraticCurveTo(6, H - 6, 6, H - corner - 6);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    /* 데드라인 — 가는 점선 */
    var hot = S && S.warn > 0;
    var bandY = H * BAND;
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = hot ? 'rgba(255, 160, 140, .95)' : 'rgba(255, 217, 143, .85)';
    ctx.beginPath();
    ctx.moveTo(W * 0.08, bandY);
    ctx.lineTo(W * 0.92, bandY);
    ctx.stroke();
    ctx.restore();

    /* 떨어질 자리 안내선 — 다음 경단을 놓을 수 있을 때만 */
    if (S && !S.over && !S.tool && S.dropCool <= 0) {
      var aimR = rad(S.nextTier);
      var ax = clamp(S.aimX, aimR + 5, W - aimR - 5);
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = 'rgba(243, 206, 136, .42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, bandY + 8);
      ctx.lineTo(ax, H - 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAim() {
    var tier = S.nextTier;
    var r = rad(tier);
    var x = clamp(S.aimX, r + 5, W - r - 5);
    if (S.dropCool > 0) { return; }
    ctx.save();
    /* 다음 경단은 ‘아직 떨어지지 않은 그림자’ — 테두리까지 점선으로 둡니다 */
    drawGyeongdan(ctx, tier, x, r, r, S.aiming ? 0.95 : 0.42);
    ctx.setLineDash([3, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = S.aiming ? 'rgba(255, 236, 190, .8)' : 'rgba(248, 226, 178, .38)';
    ctx.beginPath();
    ctx.arc(x, r, r * 0.98, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    var list = S.particles;
    if (!list.length) { return; }
    ctx.save();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPops() {
    var list = S.pops;
    if (!list.length) { return; }
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life / q.max));
      ctx.font = '800 17px "Pretendard", "Apple SD Gothic Neo", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(3, 18, 20, .6)';
      ctx.strokeText(q.text, q.x, q.y);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.restore();
  }

  /* ===================================================================
     9. 게임 흐름
     =================================================================== */

  function startGame(resume) {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    var resumed = resume ? resumeState() : null;
    S = resumed || newState();
    if (!resumed) { clearSave(); }
    S.tool = null;
    S.picks = [];
    S.aiming = false;
    S.over = false;
    S.running = true;
    lastT = 0;
    acc = 0;
    hideOver();
    renderHud();
    setHint(resumed
      ? '이어서 하는 중이에요 · 떨어뜨릴 곳을 눌러 주세요'
      : '떨어뜨릴 곳을 누르거나 좌우로 끌어 놓아 보세요');
    syncToolButtons();
    resize();
    raf = window.requestAnimationFrame(frame);
  }

  function frame(t) {
    if (!S || !S.running) { return; }
    if (!lastT) { lastT = t; }
    var dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.06) { dt = 0.06; }

    acc += dt;
    var guard = 0;
    while (acc >= STEP && guard < 10) {
      step(STEP);
      acc -= STEP;
      guard += 1;
    }
    if (guard >= 10) { acc = 0; }

    if (S.dirty) { saveGame(false); }
    if (!S.over) { renderScore(); }
    draw();
    raf = window.requestAnimationFrame(frame);
  }

  function pause() {
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    lastT = 0;
  }

  function bumpBest() {
    if (S.score > S.best) {
      S.best = S.score;
      renderScore();
    }
  }

  function renderScore() {
    if (el.score) { el.score.textContent = fmtNum(S.score); }
    if (el.best) { el.best.textContent = fmtNum(S.best); }
  }

  function renderHud() {
    renderScore();
  }

  function dropAt(x) {
    if (!S || S.over || !S.running) { return; }
    if (S.tool) { return; }
    if (S.dropCool > 0) { return; }
    var tier = S.nextTier;
    var r = rad(tier);
    var bx = (W - r - 5 < r + 5) ? W / 2 : clamp(x, r + 5, W - r - 5);
    var body = makeBody(tier, bx, r, 0, 0);
    S.bodies.push(body);
    S.nextTier = pickSpawn();
    S.dropCool = DROP_COOL;
    S.dirty = true;
    saveGame(true);
    if (S.nextTier > S.maxTier) { S.maxTier = S.nextTier; }
  }

  function gameOver(reason) {
    if (!S || S.over) { return; }
    S.over = true;
    S.overReason = reason || '경단이 데드라인을 넘었어요';
    S.tool = null;
    S.picks = [];
    clearSave();
    if (S.score > localBest()) { setLocalBest(S.score); }
    if (S.score >= S.best) { S.best = S.score; }
    renderHud();
    syncToolButtons();
    setHint('');
    saveGame(true);
    showOver();
    submitScore();
  }

  /* ---------- 점수 저장(실제 문파) ---------- */

  var submitState = { pending: false, last: null, failed: '' };

  function submitScore() {
    if (!opts.live || typeof opts.submitScore !== 'function') { return; }
    if (!S || S.score <= 0) { return; }
    submitState.pending = true;
    var payload = { score: Math.floor(S.score), tier: S.maxTier };
    opts.submitScore(payload.score, payload.tier).then(function (res) {
      submitState.pending = false;
      submitState.last = res || null;
      submitState.failed = '';
      if (res && Number(res.best_score) > S.best) {
        S.best = Number(res.best_score);
        renderScore();
      }
      if (res && res.rank) {
        setHint(res.is_new_best
          ? '🎉 새 최고 기록! 문파 랭킹 ' + res.rank + '위예요'
          : '문파 최고 기록은 ' + fmtNum(res.best_score) + '점 · 지금 ' + res.rank + '위');
      }
      renderOverResult(res);
    }, function (err) {
      submitState.pending = false;
      var code = String((err && err.code) || '');
      var msg = String((err && err.message) || '');
      if (code === 'PGRST202' || msg.indexOf('Could not find the function') !== -1
          || msg.indexOf('이 기능이 아직') !== -1) {
        submitState.failed = 'pending';
        setHint('서버에 경단 랭킹이 아직 준비되지 않았어요 · 이 기기에 최고 점수를 남겼어요');
      } else {
        submitState.failed = 'error';
        setHint('점수를 문파에 보내지 못했어요 · 이 기기에는 남겼어요');
        if (opts.onToast) { opts.onToast('경단 점수를 서버에 보내지 못했어요 · 기록은 이 기기에 남아 있어요'); }
      }
      renderOverResult(null);
    });
  }

  /* ===================================================================
     10. 도구 — 절구공이 하나 (백운단 전용 · 무제한)
     =================================================================== */

  var TOOL_INFO = {
    mallet: {
      name: '절구공이',
      tag: '백운단만',
      /* 백운단(11단계)만 지울 수 있습니다 — 판이 막혔을 때 쓰는 마지막 수 */
      hint: '백운단만 지울 수 있어요 · 백운단을 눌러 주세요',
      icon: '<path d="M9.2 3.4h5.6l.9 6.1H8.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.6V19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.4 19h5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    }
  };

  function toolMarkup() {
    return Object.keys(TOOL_INFO).map(function (key) {
      var t = TOOL_INFO[key];
      return '<button type="button" class="gd-tool" data-tool="' + key + '" aria-pressed="false">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">' + t.icon + '</svg>' +
        '<span class="gd-tool__name">' + t.name + '</span>' +
        '<span class="gd-tool__tag">' + t.tag + '</span>' +
        '</button>';
    }).join('') +
      '<button type="button" class="gd-tool gd-tool--cancel" id="gd-tool-cancel" hidden>취소</button>';
  }

  function buildTools() {
    if (!el.tools || el.tools.getAttribute('data-built') === '1') { return; }
    el.tools.innerHTML = '<span class="gd-tools__label">도구 <em>절구공이는 무제한</em></span>' +
      '<div class="gd-tools__row">' + toolMarkup() + '</div>';
    el.tools.setAttribute('data-built', '1');
    $$('[data-tool]', el.tools).forEach(function (btn) {
      btn.addEventListener('click', function () { toggleTool(btn.getAttribute('data-tool')); });
    });
    var cancel = $('#gd-tool-cancel', el.tools);
    if (cancel) { cancel.addEventListener('click', function () { selectTool(null); }); }
  }

  function syncToolButtons() {
    if (!el.tools) { return; }
    $$('[data-tool]', el.tools).forEach(function (btn) {
      var key = btn.getAttribute('data-tool');
      var active = S && S.tool === key;
      btn.classList.toggle('is-active', !!active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.disabled = !S || S.over;
    });
    var cancel = $('#gd-tool-cancel', el.tools);
    if (cancel) { cancel.hidden = !S || !S.tool; }
  }

  function toggleTool(key) {
    if (!S || S.over) { return; }
    selectTool(S.tool === key ? null : key);
  }

  function selectTool(key) {
    if (!S) { return; }
    S.tool = key;
    S.picks = [];
    syncToolButtons();
    if (key) {
      setHint(TOOL_INFO[key].name + ' — ' + TOOL_INFO[key].hint);
    } else if (!S.over) {
      setHint('떨어뜨릴 곳을 누르거나 좌우로 끌어 놓아 보세요');
    }
  }

  function bodyAt(wx, wy, skip) {
    for (var i = S.bodies.length - 1; i >= 0; i--) {
      var b = S.bodies[i];
      if (skip && skip.indexOf(b) !== -1) { continue; }
      var dx = wx - b.x, dy = wy - b.y;
      if (dx * dx + dy * dy <= (b.r + 2) * (b.r + 2)) { return b; }
    }
    return null;
  }

  function useToolAt(wx, wy) {
    var key = S.tool;
    if (!key) { return false; }
    var body = bodyAt(wx, wy);

    /* 절구공이 — 오직 백운단(11단계)만 지웁니다. 다른 경단이면 아무것도 지우지 않습니다. */
    if (!hasCloud()) {
      setHint('백운단만 지울 수 있어요! · 판에 백운단이 아직 없어요');
      if (opts.onToast) { opts.onToast('백운단만 지울 수 있어요!'); }
      return true;
    }
    if (!body || body.tier !== LAST_TIER) {
      setHint('백운단만 지울 수 있어요!');
      if (opts.onToast) { opts.onToast('백운단만 지울 수 있어요!'); }
      return true;
    }
    removeBody(body, '#fff3d4');
    burst(body.x, body.y, 30, ['#fff8e0', '#ffe9a8', '#d8ecff'], 300);
    S.score += MALLET_BONUS;
    addPop(body.x, body.y, '+' + fmtNum(MALLET_BONUS), '#ffe9a8');
    S.shake = Math.min(1, S.shake + 0.4);
    bumpBest();
    afterTool('백운단을 깔끔하게 걷어냈어요 · +' + fmtNum(MALLET_BONUS) + '점');
    return true;
  }

  function removeBody(body, color) {
    S.bodies = S.bodies.filter(function (b) { return b !== body; });
    burst(body.x, body.y, 16, [color || '#ffffff', '#ffd7a8'], 160);
    S.dirty = true;
  }

  /** 판 위에 백운단이 있는가 — 절구공이가 쓸 수 있는지 먼저 봅니다 */
  function hasCloud() {
    for (var i = 0; i < S.bodies.length; i++) {
      if (S.bodies[i].tier === LAST_TIER) { return true; }
    }
    return false;
  }

  function afterTool(message) {
    S.picks = [];
    /* 절구공이는 무제한이라 골라 둔 채로 이어서 쓸 수 있습니다 */
    syncToolButtons();
    if (message) {
      setHint(message);
    } else if (S.tool) {
      setHint(TOOL_INFO[S.tool].name + ' — ' + TOOL_INFO[S.tool].hint);
    } else if (!S.over) {
      setHint('떨어뜨릴 곳을 누르거나 좌우로 끌어 놓아 보세요');
    }
    if (S.score > S.best) { S.best = S.score; }
    renderScore();
    saveGame(true);
  }

  /* ===================================================================
     11. 포인터
     =================================================================== */

  var pointer = { down: false, moved: false, startX: 0, startY: 0, id: null };

  function toWorld(clientX, clientY) {
    var rect = el.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.ox) / view.scale,
      y: (clientY - rect.top - view.oy) / view.scale
    };
  }

  function bindPointer() {
    var c = el.canvas;
    if (!c) { return; }

    c.addEventListener('pointerdown', function (e) {
      if (!S || S.over) { return; }
      var p = toWorld(e.clientX, e.clientY);
      pointer.down = true;
      pointer.moved = false;
      pointer.startX = p.x;
      pointer.startY = p.y;
      pointer.id = e.pointerId;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      if (S.tool) { return; }
      S.aiming = true;
      S.aimX = p.x;
    });

    c.addEventListener('pointermove', function (e) {
      if (!S || S.over) { return; }
      var p = toWorld(e.clientX, e.clientY);
      if (pointer.down && Math.abs(p.x - pointer.startX) > 6) { pointer.moved = true; }
      if (S.tool) { return; }
      S.aimX = p.x;
    });

    c.addEventListener('pointerup', function (e) {
      if (!S || S.over) { pointer.down = false; return; }
      var p = toWorld(e.clientX, e.clientY);
      var wasDown = pointer.down;
      pointer.down = false;
      try { c.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      if (S.tool) {
        if (wasDown) { useToolAt(p.x, p.y); }
        return;
      }
      S.aiming = false;
      if (wasDown) { dropAt(p.x); }
    });

    c.addEventListener('pointercancel', function () {
      pointer.down = false;
      if (S) { S.aiming = false; }
    });

    c.addEventListener('pointerleave', function () {
      if (S && !pointer.down) { S.aiming = false; }
    });
  }

  /* ===================================================================
     12. 게임 오버 · 랭킹 · 진화표
     =================================================================== */

  function showOver() {
    if (!el.over) { return; }
    var isBest = S.score > 0 && Math.round(S.score) >= Math.round(S.best);
    el.over.innerHTML =
      '<div class="gd-over__card">' +
      '<p class="gd-over__kicker">경단 그릇이 가득 찼어요</p>' +
      '<h3 class="gd-over__title">' + (isBest ? '새 최고 기록! 🍡' : '한 판 마쳤어요') + '</h3>' +
      '<p class="gd-over__score"><strong>' + fmtNum(S.score) + '</strong><span>점</span></p>' +
      '<p class="gd-over__meta">최고 ' + fmtNum(S.best) + '점 · 가장 높은 경단 <b>' + TIERS[S.maxTier].name + '</b></p>' +
      '<p class="gd-over__result" id="gd-over-result">' + (opts.live ? '문파 랭킹에 기록하는 중…' : '이 기기에 최고 점수를 남겼어요') + '</p>' +
      '<div class="gd-over__row">' +
      '<button type="button" class="btn btn--primary btn--small" id="gd-over-retry">다시하기</button>' +
      '<button type="button" class="btn btn--ghost btn--small" id="gd-over-rank">🏆 문파 랭킹</button>' +
      '<button type="button" class="btn btn--ghost btn--small" id="gd-over-close">닫기</button>' +
      '</div></div>';
    el.over.hidden = false;
    var retry = $('#gd-over-retry', el.over);
    var rank = $('#gd-over-rank', el.over);
    var close = $('#gd-over-close', el.over);
    if (retry) { retry.addEventListener('click', function () { restart(true); }); }
    if (rank) { rank.addEventListener('click', function () { openRanking(); }); }
    if (close) { close.addEventListener('click', function () { closeGame(); }); }
  }

  function hideOver() {
    if (el.over) { el.over.hidden = true; el.over.innerHTML = ''; }
  }

  function renderOverResult(res) {
    var box = $('#gd-over-result');
    if (!box) { return; }
    if (res && res.rank) {
      box.innerHTML = (res.is_new_best ? '🎉 <b>새 최고 기록</b> · ' : '') +
        '문파 랭킹 <b>' + res.rank + '위</b> · 문파 최고 ' + fmtNum(res.best_score) + '점';
    } else if (submitState.failed === 'pending') {
      box.textContent = '서버에 랭킹이 아직 준비되지 않았어요 · 이 기기에 최고 점수를 남겼어요';
    } else if (submitState.failed === 'error') {
      box.textContent = '점수를 문파에 보내지 못했어요 · 이 기기에는 남겼어요';
    } else if (opts.live) {
      box.textContent = '문파 랭킹에 기록했어요';
    }
  }

  function setHint(text) {
    if (el.hint) { el.hint.textContent = text || ''; }
  }

  /* ---------- 진화표 ---------- */

  function chartMarkup() {
    var html = '<div class="gd-sheet__head"><h3>🍡 경단 도감</h3>' +
      '<button type="button" class="gd-sheet__close" data-sheet-close="1" aria-label="닫기">×</button></div>' +
      '<p class="gd-sheet__note">같은 경단 두 개가 닿으면 다음 단계로 합쳐져요 · 위에서 떨어지는 건 1~5단계<br>' +
      '백운단 두 개가 합쳐지면 둘 다 사라지며 <b>+' + fmtNum(CLOUD_BONUS) + '점</b>!</p>' +
      '<ol class="gd-chart">';
    for (var t = 1; t <= LAST_TIER; t++) {
      var T = TIERS[t];
      var next = t + 1;
      html += '<li class="gd-chart__row">' +
        '<span class="gd-chart__name">' + T.name + '</span>' +
        '<span class="gd-chart__combine">' +
        '<canvas class="gd-chart__icon" data-tier="' + t + '" aria-hidden="true"></canvas>' +
        '<span class="gd-chart__op" aria-hidden="true">+</span>' +
        '<canvas class="gd-chart__icon" data-tier="' + t + '" aria-hidden="true"></canvas>' +
        '<span class="gd-chart__arrow" aria-hidden="true"></span>' +
        (next <= LAST_TIER
          ? '<canvas class="gd-chart__icon gd-chart__icon--next" data-tier="' + next + '" aria-hidden="true"></canvas>'
          : '<canvas class="gd-chart__icon gd-chart__icon--next" data-spark="1" aria-hidden="true"></canvas>') +
        '</span>' +
        '<span class="gd-chart__score">+' +
        fmtNum(next <= LAST_TIER ? scoreForTier(next) : CLOUD_BONUS) + '</span>' +
        '</li>';
    }
    html += '</ol>';
    html += '<p class="gd-sheet__credit">' + SPRITE_CREDIT + '</p>';
    return html;
  }

  /* 진화표 아이콘 — 귀·갈기까지 30px 안에 들어오도록 단계별 반지름 비율 */
  var ICON_RATIO = { 1: 0.29, 2: 0.28, 3: 0.33, 4: 0.33, 5: 0.3, 6: 0.3, 7: 0.3, 8: 0.27, 9: 0.25, 10: 0.26, 11: 0.27 };

  function paintChartIcons() {
    $$('canvas[data-tier], canvas[data-spark]', el.sheet).forEach(function (c) {
      var size = 30;
      var dpr = Math.min(2.5, window.devicePixelRatio || 1);
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      if (c.getAttribute('data-spark')) {
        g.save();
        g.translate(size / 2, size / 2);
        g.fillStyle = '#f6dfa4';
        drawSpark(g, size * 0.2);
        g.restore();
        return;
      }
      var tier = Number(c.getAttribute('data-tier'));
      var img = spriteOf(tier);
      if (img) {
        /* 도감 원본 그림 — 줄마다 같은 크기로 놓습니다(원본 도감처럼) */
        g.drawImage(img, 0, 0, size, size);
        return;
      }
      drawGyeongdan(g, tier, size / 2, size / 2, size * (ICON_RATIO[tier] || 0.28), 1);
    });
  }

  /* ---------- 랭킹 ---------- */

  function rankingMarkup() {
    var html = '<div class="gd-sheet__head"><h3>🏆 문파 랭킹</h3>' +
      '<button type="button" class="gd-sheet__close" data-sheet-close="1" aria-label="닫기">×</button></div>';

    if (!opts.live) {
      html += '<div class="gd-rank__empty">체험 모드예요.<br>이 기기의 최고 점수 <b>' + fmtNum(localBest()) +
        '점</b>만 남아요. 실제 문파에 들어가면 문파원 모두의 기록이 이곳에 모여요.</div>';
      return html;
    }

    if (ranking.status === 'loading' || ranking.status === 'idle') {
      html += '<div class="gd-rank__empty">문파 기록을 불러오는 중이에요…</div>';
      return html;
    }

    if (ranking.status === 'pending') {
      html += '<div class="gd-rank__empty">서버에 경단 랭킹이 아직 준비되지 않았어요.<br>' +
        '운영진이 <b>supabase/migration-gyeongdan.sql</b> 을 실행하면 문파원 모두의 기록이 모여요.<br>' +
        '그때까지는 이 기기의 최고 점수 <b>' + fmtNum(localBest()) + '점</b>으로 게임을 즐길 수 있어요.</div>';
      return html;
    }

    if (ranking.status === 'error') {
      html += '<div class="gd-rank__empty">랭킹을 불러오지 못했어요.<br>' + escapeHtml(ranking.message || '') +
        '<br>이 기기의 최고 점수는 <b>' + fmtNum(localBest()) + '점</b>이에요.</div>';
      return html;
    }

    if (!ranking.rows.length) {
      html += '<div class="gd-rank__empty">아직 기록이 없어요 · 첫 기록을 남겨 보세요!</div>';
      return html;
    }

    html += '<ol class="gd-rank">';
    ranking.rows.forEach(function (row) {
      var mine = opts.nickname && row.nickname === opts.nickname;
      var tierName = TIERS[clampInt(row.max_tier, 1, LAST_TIER, 1)].name;
      var initial = String(row.nickname || '?').slice(0, 1);
      html += '<li class="gd-rank__row' + (mine ? ' is-mine' : '') + '">' +
        '<span class="gd-rank__no">' + (row.rank || '-') + '</span>' +
        (row.avatar
          ? '<span class="gd-rank__avatar" style="background-image:url(' + escapeAttr(row.avatar) + ')"></span>'
          : '<span class="gd-rank__avatar gd-rank__avatar--initial">' + escapeHtml(initial) + '</span>') +
        '<span class="gd-rank__who"><b>' + escapeHtml(row.nickname || '') + '</b>' +
        '<span class="gd-rank__role">' + escapeHtml(ROLE_LABEL[row.role] || '문파원') + ' · ' + escapeHtml(tierName) + '</span></span>' +
        '<span class="gd-rank__score">' + fmtNum(row.best_score) + '</span>' +
        '</li>';
    });
    html += '</ol>';
    if (opts.nickname && !ranking.rows.some(function (r) { return r.nickname === opts.nickname; })) {
      html += '<p class="gd-sheet__note">내 기록이 아직 없어요 · 한 판 마치면 랭킹에 올라요</p>';
    }
    return html;
  }

  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/\)/g, '%29').replace(/\(/g, '%28');
  }

  function openSheet(kind) {
    if (!el.sheet) { return; }
    el.sheet.hidden = false;
    el.sheet.setAttribute('data-kind', kind);
    if (kind === 'chart') {
      el.sheet.innerHTML = chartMarkup();
      paintChartIcons();
    } else {
      el.sheet.innerHTML = rankingMarkup();
      loadRanking();
    }
    var close = $('[data-sheet-close]', el.sheet);
    if (close) { close.addEventListener('click', closeSheet); }
    pause();
  }

  function closeSheet() {
    if (!el.sheet) { return; }
    el.sheet.hidden = true;
    el.sheet.innerHTML = '';
    el.sheet.removeAttribute('data-kind');
    if (S && S.running && !S.over) {
      lastT = 0;
      raf = window.requestAnimationFrame(frame);
    }
  }

  function openRanking() {
    openSheet('rank');
  }

  /** 실제 문파 — 랭킹을 불러오고, 내 최고 점수도 함께 맞춥니다. */
  function loadRanking() {
    if (!opts.live || typeof opts.listRanking !== 'function') {
      ranking.status = 'trial';
      return Promise.resolve(null);
    }
    if (ranking.status === 'loading') { return ranking.promise; }
    ranking.status = 'loading';
    if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
      el.sheet.innerHTML = rankingMarkup();
      var close = $('[data-sheet-close]', el.sheet);
      if (close) { close.addEventListener('click', closeSheet); }
    }
    ranking.promise = opts.listRanking().then(function (rows) {
      ranking.status = 'ready';
      ranking.rows = Array.isArray(rows) ? rows : [];
      ranking.message = '';
      var mine = null;
      ranking.rows.forEach(function (r) {
        if (opts.nickname && r.nickname === opts.nickname) { mine = r; }
      });
      if (mine && Number(mine.best_score) > (S ? S.best : 0)) {
        if (S) { S.best = Number(mine.best_score); renderScore(); }
      }
      if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
        el.sheet.innerHTML = rankingMarkup();
        var btn = $('[data-sheet-close]', el.sheet);
        if (btn) { btn.addEventListener('click', closeSheet); }
      }
      return ranking.rows;
    }, function (err) {
      var code = String((err && err.code) || '');
      var msg = String((err && err.message) || '');
      if (code === 'PGRST202' || msg.indexOf('Could not find the function') !== -1
          || msg.indexOf('이 기능이 아직') !== -1) {
        ranking.status = 'pending';
      } else {
        ranking.status = 'error';
        ranking.message = msg || '연결을 확인해 주세요.';
      }
      if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
        el.sheet.innerHTML = rankingMarkup();
        var close = $('[data-sheet-close]', el.sheet);
        if (close) { close.addEventListener('click', closeSheet); }
      }
      return null;
    });
    return ranking.promise;
  }

  /* ===================================================================
     13. 열기 · 닫기 · 다시하기
     =================================================================== */

  function restart(withConfirm) {
    if (!S) { return; }
    if (withConfirm && !S.over && S.score > 0 && el.restartBtn) {
      if (el.restartBtn.getAttribute('data-armed') !== '1') {
        el.restartBtn.setAttribute('data-armed', '1');
        el.restartBtn.classList.add('is-armed');
        el.restartBtn.textContent = '한 번 더 누르면 새 판';
        setHint('진행 중인 판을 버리고 새로 시작해요 · 한 번 더 눌러 주세요');
        window.setTimeout(function () {
          if (el.restartBtn) {
            el.restartBtn.setAttribute('data-armed', '0');
            el.restartBtn.classList.remove('is-armed');
            el.restartBtn.textContent = '다시하기';
          }
        }, 3200);
        return;
      }
      el.restartBtn.setAttribute('data-armed', '0');
      el.restartBtn.classList.remove('is-armed');
      el.restartBtn.textContent = '다시하기';
    }
    startGame(false);
  }

  function openSheetReset() {
    closeSheet();
    hideOver();
  }

  function openGame(options) {
    grabDom();
    if (!el.root || !el.canvas) { return; }
    opts = options || {};
    loadSprites();
    if (!opened) {
      buildTools();
      bindPointer();
      if (el.close) { el.close.addEventListener('click', function () { closeGame(); }); }
      if (el.chartBtn) { el.chartBtn.addEventListener('click', function () { openSheet('chart'); }); }
      if (el.rankBtn) { el.rankBtn.addEventListener('click', function () { openRanking(); }); }
      if (el.restartBtn) { el.restartBtn.addEventListener('click', function () { restart(true); }); }
      el.sheet.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-sheet-close]')) { closeSheet(); }
      });
      window.addEventListener('resize', function () { if (opened) { resize(); } });
      /* 폰을 돌리거나 판이 늦게 자리를 잡아도 바로 따라가도록 */
      if (window.ResizeObserver) {
        var ro = new window.ResizeObserver(function () { if (opened) { resize(); } });
        if (el.stage) { ro.observe(el.stage); }
      }
      window.addEventListener('keydown', function (e) {
        if (!opened) { return; }
        if (e.key === 'Escape') {
          if (el.sheet && !el.sheet.hidden) { closeSheet(); return; }
          if (S && S.tool) { selectTool(null); return; }
          closeGame();
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (!opened) { return; }
        if (document.hidden) { saveGame(true); pause(); }
        else if (S && S.running && !S.over && (el.sheet.hidden)) {
          lastT = 0;
          raf = window.requestAnimationFrame(frame);
        }
      });
      window.addEventListener('pagehide', function () { if (opened) { saveGame(true); } });
      opened = true;
    }
    openSheetReset();
    el.root.hidden = false;
    document.body.classList.add('is-locked');
    ranking = { status: 'idle', rows: [], message: '' };
    startGame(true);
    if (opts.live) { loadRanking(); }
    window.setTimeout(function () { resize(); draw(); }, 30);
  }

  function closeGame() {
    if (!opened) { return; }
    saveGame(true);
    pause();
    if (S) { S.running = false; }
    closeSheet();
    hideOver();
    if (el.root) { el.root.hidden = true; }
    document.body.classList.remove('is-locked');
    var saved = !!readSave();
    if (saved && opts.onToast) { opts.onToast('🍡 경단만들기 진행을 저장했어요 · 다음에 이어서 할 수 있어요'); }
  }

  /* 앱이 내정보 등에서 다시 열 때 쓰는 도우미 */
  window.YM_GYEONGDAN = {
    open: openGame,
    close: closeGame,
    isOpen: function () { return !!opened && el.root && !el.root.hidden; },
    localBest: localBest,
    /* 테스트용 — 화면에는 나오지 않습니다. */
    _debug: {
      /* 시험·스크린샷용 — 한 단계를 큰 캔버스에 그려 data URL 로 돌려줍니다 */
      art: function (tier, size) {
        var s2 = size || 160;
        var c = document.createElement('canvas');
        c.width = s2; c.height = s2;
        var g = c.getContext('2d');
        var t = clampInt(tier, 1, LAST_TIER, 1);
        drawGyeongdan(g, t, s2 / 2, s2 / 2, s2 * 0.3, 1);
        return c.toDataURL('image/png');
      },
      add: function (tier, x, y, vx) {
        if (!S) { return null; }
        var t = clampInt(tier, 1, LAST_TIER, 1);
        var rr = rad(t);
        var body = makeBody(t, clamp(x || W / 2, rr, W - rr),
          clamp(y === undefined ? H - rr - 4 : y, rr, H - rr),
          Number(vx) || 0, 0);
        body.age = 1;
        S.bodies.push(body);
        if (t > S.maxTier) { S.maxTier = t; }
        return body.id;
      },
      setNext: function (tier) { if (S) { S.nextTier = clampInt(tier, 1, LAST_TIER, 1); } },
      clear: function () { if (S) { S.bodies = []; S.picks = []; S.dirty = true; } },
      bodies: function () { return S ? S.bodies.map(function (b) { return { id: b.id, tier: b.tier, x: r2(b.x), y: r2(b.y), r: b.r, angle: b.angle, av: b.av }; }) : []; },
      state: function () {
        return S ? {
          score: S.score, best: S.best, maxTier: S.maxTier, over: S.over,
          tool: S.tool,
          tool: S.tool, count: S.bodies.length, warn: S.warn, nextTier: S.nextTier
        } : null;
      },
      setScore: function (n) { if (S) { S.score = Math.max(0, Math.floor(n)); renderScore(); } },
      drop: dropAt,
      /** 테스트용 — 그 자리에 움직이지 않는 경단을 둡니다(데드라인 규칙 확인). */
      anchor: function (tier, x, y) {
        var id = this.add(tier, x, y);
        for (var i = 0; i < S.bodies.length; i++) {
          if (S.bodies[i].id === id) {
            S.bodies[i].held = true;
            S.bodies[i].supported = true;
            S.bodies[i].age = 2;
          }
        }
        return id;
      },
      world: function () { return { W: W, H: H, scale: view.scale, ox: view.ox, oy: view.oy }; }
    }
  };
})();
