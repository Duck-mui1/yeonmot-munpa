/* 연못 — 🍡 경단만들기 (도깨비의 세계)
 *
 *  · 수박게임 방식의 Canvas 2D 원형 물리 드롭 & 머지 게임입니다.
 *  · 외부 라이브러리 없이 직접 만든 물리: 중력 · 서브스텝 충돌(위치 보정 + 반발) ·
 *    벽/바닥 바운스 · 굴러떨어짐 · 위쪽 데드라인 2초 유예.
 *  · 경단 11단계(박쥐단 … 백운단)의 그림은 모두 이 파일의 Canvas 코드로 새로 그립니다(오리지널).
 *  · 도구 3종(절구공이 · 교환부 · 승급붓)은 한 판에 각 2회.
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

  var W = 360;              // 놀이판 너비(논리 좌표)
  var H = 560;              // 놀이판 높이(논리 좌표)
  var DROP_Y = 62;          // 경단을 떨어뜨리는 높이
  var DEAD_Y = 106;         // 데드라인 — 이 위로 2초 넘게 머물면 게임 오버
  var DEAD_GRACE = 2.0;     // 유예 시간(초)
  var GRAVITY = 1750;
  var STEP = 1 / 120;       // 물리 고정 스텝
  var SAVE_KEY = 'ym.gyeongdan.save.v1';
  var BEST_KEY = 'ym.gyeongdan.best';

  /* 11단계 — 반지름은 한눈에 단계가 보이도록 14 → 82 로 커집니다.
     색은 「경단 도감」의 영수 색감을 따릅니다. */
  var TIERS = [
    null,
    { no: 1,  name: '박쥐단',      r: 14, color: '#b08d76', dark: '#8e6b56', light: '#d6bda8', kind: 'bat' },
    { no: 2,  name: '사마귀단',    r: 18, color: '#5f8fc9', dark: '#416fa3', light: '#a8c8ee', kind: 'mantis' },
    { no: 3,  name: '쥐단',        r: 22, color: '#a6bf4e', dark: '#7d9438', light: '#d9e9a0', kind: 'mouse' },
    { no: 4,  name: '뱀단',        r: 27, color: '#b39e8f', dark: '#8c7768', light: '#e6d8c9', kind: 'snake' },
    { no: 5,  name: '호랑이단',    r: 32, color: '#e8952f', dark: '#c2731c', light: '#ffd08a', kind: 'tiger' },
    { no: 6,  name: '돼지단',      r: 38, color: '#b08a9a', dark: '#8a6a7a', light: '#dcbccb', kind: 'pig' },
    { no: 7,  name: '곰단',        r: 45, color: '#a9714a', dark: '#83503a', light: '#d9ab84', kind: 'bear' },
    { no: 8,  name: '자서귀단',    r: 52, color: '#fbfbf7', dark: '#dfe3e8', light: '#ffffff', kind: 'dokkaebi' },
    { no: 9,  name: '황요호단',    r: 60, color: '#e8862f', dark: '#b96318', light: '#ffcf94', kind: 'fox' },
    { no: 10, name: '산군대호단',  r: 70, color: '#cf8a5f', dark: '#a35f3c', light: '#f0c69c', kind: 'tigerking' },
    { no: 11, name: '백운단',      r: 82, color: '#fdfcf7', dark: '#e2e6ec', light: '#ffffff', kind: 'cloud' }
  ];

  /* 위에서 떨어지는 경단은 1~5단계뿐입니다(작은 것일수록 자주). */
  var SPAWN_POOL = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5];
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
        return { t: b.tier, x: r2(b.x), y: r2(b.y), vx: r2(b.vx), vy: r2(b.vy),
          a: r2(b.angle), av: r2(b.av) };
      }),
      at: now
    });
  }

  function clearSave() { storeDrop(SAVE_KEY); }

  function r2(n) { return Math.round(n * 100) / 100; }

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
    return SPAWN_POOL[Math.floor(Math.random() * SPAWN_POOL.length)];
  }

  function makeBody(tier, x, y, vx, vy) {
    uid += 1;
    return {
      id: uid,
      tier: tier,
      r: TIERS[tier].r,
      x: x, y: y,
      vx: vx || 0, vy: vy || 0,
      age: 0,
      over: 0,
      wobble: 1,
      angle: 0,
      av: 0
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
      var x = Number(raw.x), y = Number(raw.y);
      if (!isFinite(x) || !isFinite(y)) { return; }
      var body = makeBody(tier, clamp(x, TIERS[tier].r, W - TIERS[tier].r), clamp(y, 0, H - TIERS[tier].r));
      body.vx = isFinite(Number(raw.vx)) ? Number(raw.vx) : 0;
      body.vy = isFinite(Number(raw.vy)) ? Number(raw.vy) : 0;
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

  function integrate(dt) {
    var bodies = S.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.held) { continue; }   // 테스트용 고정(화면에는 나오지 않습니다)
      b.vy += GRAVITY * dt;
      b.vx *= 0.997;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.av * dt;
      b.av *= 0.988;
      if (b.age < 60) { b.age += dt; }

      if (b.x - b.r < 0) { b.x = b.r; if (b.vx < 0) { b.vx = -b.vx * 0.34; } }
      if (b.x + b.r > W) { b.x = W - b.r; if (b.vx > 0) { b.vx = -b.vx * 0.34; } }
      if (b.y + b.r > H) {
        b.y = H - b.r;
        /* 떡처럼 묵직하게 — 바닥 반발은 낮추고 마찰은 세게 */
        if (b.vy > 0) { b.vy = b.vy > 260 ? -b.vy * 0.13 : 0; }
        b.vx *= 0.94;
        if (Math.abs(b.vx) < 9) { b.vx *= 0.7; }
        /* 바닥에서 굴러가는 각속도 — 미끄러지지 않고 구르는 느낌 */
        b.av = b.av * 0.5 + (b.vx / b.r) * 0.5;
      }
      if (b.y - b.r < -40) { b.y = b.r - 40; if (b.vy < 0) { b.vy = 0; } }
    }
  }

  /** 같은 단계끼리 닿으면 합칩니다 — 한 스텝에 여러 쌍이 동시에 합쳐질 수 있습니다. */
  function mergePass() {
    var bodies = S.bodies;
    var taken = {};
    var pairs = [];
    for (var i = 0; i < bodies.length; i++) {
      if (taken[i]) { continue; }
      for (var j = i + 1; j < bodies.length; j++) {
        if (taken[j]) { continue; }
        var a = bodies[i], b = bodies[j];
        if (a.held || b.held) { continue; }
        if (a.tier !== b.tier) { continue; }
        var dx = b.x - a.x, dy = b.y - a.y;
        var reach = a.r + b.r + 0.8;
        if (dx * dx + dy * dy <= reach * reach) {
          taken[i] = true; taken[j] = true;
          pairs.push([a, b]);
          break;
        }
      }
    }
    if (!pairs.length) { return; }

    pairs.forEach(function (pair) { mergeBody(pair[0], pair[1]); });
    S.bodies = S.bodies.filter(function (b) { return !b.dead; });
    S.dirty = true;
  }

  function mergeBody(a, b) {
    var tier = a.tier;
    var cx = (a.x + b.x) / 2;
    var cy = (a.y + b.y) / 2;
    var vx = (a.vx + b.vx) / 2;
    var vy = (a.vy + b.vy) / 2;
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
      return;
    }

    var next = tier + 1;
    var body = makeBody(next, cx, cy, vx * 0.6, vy * 0.6 - 40);
    body.age = 0;
    S.bodies.push(body);
    var gain = scoreForTier(next);
    S.score += gain;
    if (next > S.maxTier) { S.maxTier = next; }
    addPop(cx, cy, '+' + fmtNum(gain), TIERS[next].light);
    burst(cx, cy, next > 8 ? 20 : 12, [TIERS[next].color, TIERS[next].light, '#ffffff'], 90 + next * 18);
    S.shake = Math.min(1, S.shake + (next > 7 ? 0.32 : 0.12));
    S.lastMerge = Date.now();
    bumpBest();
  }

  function resolvePair(a, b) {
    if (a.held || b.held) { return; }
    var dx = b.x - a.x, dy = b.y - a.y;
    var rr = a.r + b.r;
    var d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr || d2 < 0.0001) { return; }

    var d = Math.sqrt(d2);
    var nx = dx / d, ny = dy / d;
    var overlap = rr - d;
    var ma = a.r * a.r, mb = b.r * b.r, mt = ma + mb;

    a.x -= nx * overlap * (mb / mt);
    a.y -= ny * overlap * (mb / mt);
    b.x += nx * overlap * (ma / mt);
    b.y += ny * overlap * (ma / mt);

    var rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    var vn = rvx * nx + rvy * ny;
    if (vn > 0) { return; }
    /* 반발 계수 — 통통 튀지 않게 낮게 */
    var e = 0.14;
    var j = -(1 + e) * vn / (1 / ma + 1 / mb);
    a.vx -= j * nx / ma; a.vy -= j * ny / ma;
    b.vx += j * nx / mb; b.vy += j * ny / mb;

    /* 접선 마찰 — 경단끼리 물처럼 흘러내리지 않고 버티게 (쿨롱 마찰 한계) */
    var MU = 0.52;
    var tx = -ny, ty = nx;
    var vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    var jt = -vt / (1 / ma + 1 / mb);
    var limit = MU * j;
    if (jt > limit) { jt = limit; }
    if (jt < -limit) { jt = -limit; }
    a.vx -= jt * tx / ma; a.vy -= jt * ty / ma;
    b.vx += jt * tx / mb; b.vy += jt * ty / mb;

    /* 아주 느린 접선 속도는 정지 마찰로 붙잡기 */
    var vt2 = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    if (Math.abs(vt2) < 14) {
      a.vx += vt2 * tx * 0.5; a.vy += vt2 * ty * 0.5;
      b.vx -= vt2 * tx * 0.5; b.vy -= vt2 * ty * 0.5;
    }

    /* 굴러가는 회전 — 접선 속도를 각속도로 나눠 줍니다 */
    a.av = a.av * 0.6 + (a.vx / a.r) * 0.4 - vt2 / (a.r * 6);
    b.av = b.av * 0.6 + (b.vx / b.r) * 0.4 - vt2 / (b.r * 6);
    if (Math.abs(a.av) > 9) { a.av = a.av > 0 ? 9 : -9; }
    if (Math.abs(b.av) > 9) { b.av = b.av > 0 ? 9 : -9; }
  }

  function resolveAll() {
    var bodies = S.bodies;
    for (var i = 0; i < bodies.length; i++) {
      var a = bodies[i];
      for (var j = i + 1; j < bodies.length; j++) {
        resolvePair(a, bodies[j]);
      }
    }
  }

  function checkDeadline(dt) {
    if (S.over) { return; }
    var warn = 0;
    for (var i = 0; i < S.bodies.length; i++) {
      var b = S.bodies[i];
      if (b.y - b.r < DEAD_Y && b.age > 0.8) {
        b.over = (b.over || 0) + dt;
        if (b.over > warn) { warn = b.over; }
      } else {
        b.over = 0;
      }
    }
    S.warn = warn;
    if (warn > DEAD_GRACE) { gameOver('데드라인 위로 2초 넘게 머물렀어요'); }
  }

  function step(dt) {
    integrate(dt);
    mergePass();
    for (var it = 0; it < 4; it++) { resolveAll(); }
    /* 해소 뒤에도 벽·바닥을 벗어나지 않게 한 번 더 */
    for (var i = 0; i < S.bodies.length; i++) {
      var b = S.bodies[i];
      if (b.x - b.r < -0.5) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.2; }
      if (b.x + b.r > W + 0.5) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * 0.2; }
      if (b.y + b.r > H + 0.5) { b.y = H - b.r; if (b.vy > 0) { b.vy *= -0.1; } }
      /* 아주 느린 속도는 깔끔하게 멈춰 미세한 떨림을 없앱니다 (떡의 무게감) */
      if (Math.abs(b.vx) < 2.5) { b.vx = 0; }
      if (Math.abs(b.vy) < 2.5) { b.vy = 0; }
      /* 거의 멈췄을 때는 제자리로 살짝 돌아와 얼굴이 바로 서게 */
      if (Math.abs(b.vx) < 12 && Math.abs(b.av) < 0.8) {
        var upright = Math.round(b.angle / (Math.PI * 2)) * Math.PI * 2;
        b.angle += (upright - b.angle) * 0.06;
        b.av *= 0.9;
        if (Math.abs(upright - b.angle) < 0.01) { b.angle = upright; }
      }
    }
    stepParticles(dt);
    if (S.dropCool > 0) { S.dropCool = Math.max(0, S.dropCool - dt); }
    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt * 2.2); }
    checkDeadline(dt);
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
      p.vy += GRAVITY * 0.45 * dt;
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
     7. 경단 그림 — 2D 카툰 · 한지 수묵풍 (경단 도감 색감)
        · 굵은 진갈색 먹 외곽선 + 매트한 아래쪽 셀 그림자 + 영수 얼굴
        · 선 두께를 반지름에 비례시켜 진화표(32px) · HUD(52px)에서도 또렷합니다.
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
    var rect = el.stage.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    view.w = w; view.h = h; view.dpr = dpr;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    el.canvas.style.width = w + 'px';
    el.canvas.style.height = h + 'px';
    var scale = Math.min(w / W, h / H);
    view.scale = scale;
    view.ox = (w - W * scale) / 2;
    view.oy = (h - H * scale) / 2;
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

    /* 금빛 그릇 테두리 — 위는 사다리꼴 입구 */
    var inset = W * 0.2, rimY = 8, topY = 34;
    var x0 = 2, x1 = W - 2, yb = H - 2, rad = 26;

    function bowlStroke() {
      ctx.beginPath();
      ctx.moveTo(inset, rimY);
      ctx.lineTo(x0 + 2, topY);
      ctx.quadraticCurveTo(x0, topY + 2, x0, topY + 6);
      ctx.lineTo(x0, yb - rad);
      ctx.quadraticCurveTo(x0, yb, x0 + rad, yb);
      ctx.lineTo(x1 - rad, yb);
      ctx.quadraticCurveTo(x1, yb, x1, yb - rad);
      ctx.lineTo(x1, topY + 6);
      ctx.quadraticCurveTo(x1, topY + 2, x1 - 2, topY);
      ctx.lineTo(W - inset, rimY);
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    /* 바깥 번짐 */
    ctx.strokeStyle = 'rgba(255, 220, 150, .16)';
    ctx.lineWidth = 8;
    bowlStroke();
    ctx.stroke();
    /* 금선 */
    ctx.strokeStyle = 'rgba(242, 216, 164, .85)';
    ctx.lineWidth = 2.2;
    bowlStroke();
    ctx.stroke();
    /* 입구 윗변 */
    ctx.beginPath();
    ctx.moveTo(inset, rimY);
    ctx.lineTo(W - inset, rimY);
    ctx.strokeStyle = 'rgba(242, 216, 164, .8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    /* 안쪽 얇은 금선 */
    ctx.strokeStyle = 'rgba(242, 216, 164, .24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 7, topY + 8);
    ctx.lineTo(x0 + 7, yb - rad + 2);
    ctx.quadraticCurveTo(x0 + 7, yb - 7, x0 + rad - 2, yb - 7);
    ctx.lineTo(x1 - rad + 2, yb - 7);
    ctx.quadraticCurveTo(x1 - 7, yb - 7, x1 - 7, yb - rad + 2);
    ctx.lineTo(x1 - 7, topY + 8);
    ctx.stroke();
    ctx.restore();

    /* 데드라인 — 가는 점선 */
    var over = S ? S.warn : 0;
    var hot = over > 0;
    ctx.save();
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hot ? 'rgba(255, 138, 118, .95)' : 'rgba(248, 231, 194, .5)';
    ctx.beginPath();
    ctx.moveTo(x0 + 10, DEAD_Y);
    ctx.lineTo(x1 - 10, DEAD_Y);
    ctx.stroke();
    ctx.restore();

    if (hot) {
      var left = Math.max(0, DEAD_GRACE - over);
      ctx.save();
      ctx.fillStyle = 'rgba(255, 150, 128, .98)';
      ctx.font = '600 12px "Pretendard", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(58, 37, 24, .65)';
      ctx.strokeText('데드라인 초과 · ' + left.toFixed(1) + '초', W / 2, DEAD_Y - 8);
      ctx.fillText('데드라인 초과 · ' + left.toFixed(1) + '초', W / 2, DEAD_Y - 8);
      ctx.restore();
    }

    /* 떨어질 자리 안내선 */
    if (S && !S.over && !S.tool) {
      ctx.save();
      ctx.setLineDash([3, 8]);
      ctx.strokeStyle = 'rgba(248, 226, 178, .22)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(clamp(S.aimX, 4, W - 4), DROP_Y + 10);
      ctx.lineTo(clamp(S.aimX, 4, W - 4), H - 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAim() {
    var tier = S.nextTier;
    var r = TIERS[tier].r;
    var x = clamp(S.aimX, r + 1, W - r - 1);
    if (S.dropCool > 0) { return; }
    ctx.save();
    drawGyeongdan(ctx, tier, x, DROP_Y, r, S.aiming ? 0.96 : 0.82);
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
    var r = TIERS[tier].r;
    var bx = clamp(x, r + 1, W - r - 1);
    var body = makeBody(tier, bx, DROP_Y, 0, 260);
    S.bodies.push(body);
    S.score += 0;
    S.nextTier = pickSpawn();
    S.dropCool = 0.32;
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
        var body = makeBody(t, clamp(x || W / 2, TIERS[t].r, W - TIERS[t].r),
          clamp(y === undefined ? H - TIERS[t].r - 4 : y, TIERS[t].r, H - TIERS[t].r),
          Number(vx) || 0, 0);
        body.age = 1;
        S.bodies.push(body);
        if (t > S.maxTier) { S.maxTier = t; }
        return body.id;
      },
      setNext: function (tier) { if (S) { S.nextTier = clampInt(tier, 1, LAST_TIER, 1); } },
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
          if (S.bodies[i].id === id) { S.bodies[i].held = true; S.bodies[i].age = 2; }
        }
        return id;
      },
      world: function () { return { W: W, H: H, scale: view.scale, ox: view.ox, oy: view.oy }; }
    }
  };
})();
