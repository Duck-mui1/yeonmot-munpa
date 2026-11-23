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
  var TOOL_FREE = 2;        // 도구 한 판 무료 횟수
  var SAVE_KEY = 'ym.gyeongdan.save.v1';
  var BEST_KEY = 'ym.gyeongdan.best';

  /* 11단계 — 반지름은 한눈에 단계가 보이도록 14 → 82 로 커집니다. */
  var TIERS = [
    null,
    { no: 1,  name: '박쥐단',      r: 14, color: '#7b4bd4', dark: '#3f1f7a', light: '#c1a2fb', kind: 'bat' },
    { no: 2,  name: '사마귀단',    r: 18, color: '#8fd06a', dark: '#41761f', light: '#d3f5ae', kind: 'mantis' },
    { no: 3,  name: '쥐단',        r: 22, color: '#ded8e6', dark: '#8e83a1', light: '#ffffff', kind: 'mouse' },
    { no: 4,  name: '뱀단',        r: 27, color: '#2fa08f', dark: '#12574f', light: '#8ce6d5', kind: 'snake' },
    { no: 5,  name: '호랑이단',    r: 32, color: '#f0872c', dark: '#94470a', light: '#ffc987', kind: 'tiger' },
    { no: 6,  name: '돼지단',      r: 38, color: '#f4a3bf', dark: '#a85274', light: '#ffd9e5', kind: 'pig' },
    { no: 7,  name: '곰단',        r: 45, color: '#a9743f', dark: '#5d3612', light: '#dfb083', kind: 'bear' },
    { no: 8,  name: '자서귀단',    r: 52, color: '#8a52d8', dark: '#43207e', light: '#cfa9ff', kind: 'dokkaebi' },
    { no: 9,  name: '황요호단',    r: 60, color: '#efbe4e', dark: '#9a6d0c', light: '#ffeeb0', kind: 'fox' },
    { no: 10, name: '산군대호단',  r: 70, color: '#e9eef6', dark: '#8e9db4', light: '#ffffff', kind: 'tigerking' },
    { no: 11, name: '백운단',      r: 82, color: '#f7fcff', dark: '#a9c4dd', light: '#ffffff', kind: 'cloud' }
  ];

  /* 위에서 떨어지는 경단은 1~5단계뿐입니다(작은 것일수록 자주). */
  var SPAWN_POOL = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5];
  var LAST_TIER = 11;

  /* 합쳐서 만들어낸 단계의 점수 — 10 · 20 · 40 · 80 … 5,120 */
  function scoreForTier(tier) {
    if (tier < 2) { return 0; }
    return 10 * Math.pow(2, tier - 2);
  }
  var CLOUD_BONUS = 10240;   // 백운단 둘이 만나면 둘 다 사라지며 보너스
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
    el.next = $('#gd-next');
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
      tools: { mallet: S.tools.mallet, swap: S.tools.swap, brush: S.tools.brush },
      bodies: S.bodies.map(function (b) {
        return { t: b.tier, x: r2(b.x), y: r2(b.y), vx: r2(b.vx), vy: r2(b.vy) };
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
      wobble: 1
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
      tools: { mallet: TOOL_FREE, swap: TOOL_FREE, brush: TOOL_FREE },
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
    var t = saved.tools || {};
    st.tools = {
      mallet: clampInt(t.mallet, 0, TOOL_FREE, TOOL_FREE),
      swap: clampInt(t.swap, 0, TOOL_FREE, TOOL_FREE),
      brush: clampInt(t.brush, 0, TOOL_FREE, TOOL_FREE)
    };
    var bodies = [];
    saved.bodies.forEach(function (raw) {
      var tier = clampInt(raw.t, 1, LAST_TIER, 0);
      if (!tier) { return; }
      var x = Number(raw.x), y = Number(raw.y);
      if (!isFinite(x) || !isFinite(y)) { return; }
      var body = makeBody(tier, clamp(x, TIERS[tier].r, W - TIERS[tier].r), clamp(y, 0, H - TIERS[tier].r));
      body.vx = isFinite(Number(raw.vx)) ? Number(raw.vx) : 0;
      body.vy = isFinite(Number(raw.vy)) ? Number(raw.vy) : 0;
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
      b.vx *= 0.9985;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.age < 60) { b.age += dt; }

      if (b.x - b.r < 0) { b.x = b.r; if (b.vx < 0) { b.vx = -b.vx * 0.34; } }
      if (b.x + b.r > W) { b.x = W - b.r; if (b.vx > 0) { b.vx = -b.vx * 0.34; } }
      if (b.y + b.r > H) {
        b.y = H - b.r;
        if (b.vy > 0) { b.vy = b.vy > 220 ? -b.vy * 0.16 : 0; }
        b.vx *= 0.9;
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
    var e = 0.1;
    var j = -(1 + e) * vn / (1 / ma + 1 / mb);
    a.vx -= j * nx / ma; a.vy -= j * ny / ma;
    b.vx += j * nx / mb; b.vy += j * ny / mb;

    /* 접선 마찰 — 굴러떨어지는 느낌 */
    var tx = -ny, ty = nx;
    var vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
    var jt = -vt / (1 / ma + 1 / mb) * 0.06;
    a.vx -= jt * tx / ma; a.vy -= jt * ty / ma;
    b.vx += jt * tx / mb; b.vy += jt * ty / mb;
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

  function drawGyeongdan(g, tier, cx, cy, r, alpha) {
    var T = TIERS[tier];
    if (!T) { return; }
    g.save();
    if (alpha !== undefined && alpha !== 1) { g.globalAlpha = alpha; }
    g.translate(cx, cy);

    drawBehind(g, T, r);
    drawBall(g, T, r);
    drawTexture(g, T, r);
    drawGloss(g, r);
    drawFace(g, T, r);
    drawFront(g, T, r);

    g.restore();
  }

  function ballPath(g, r) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    return g;
  }

  function drawBall(g, T, r) {
    var gr = g.createRadialGradient(-r * 0.34, -r * 0.38, r * 0.08, 0, 0, r * 1.04);
    gr.addColorStop(0, T.light);
    gr.addColorStop(0.52, T.color);
    gr.addColorStop(1, T.dark);
    ballPath(g, r);
    g.fillStyle = gr;
    g.fill();

    g.lineWidth = Math.max(1, r * 0.05);
    g.strokeStyle = 'rgba(3, 16, 18, .3)';
    g.beginPath();
    g.arc(0, 0, r - g.lineWidth / 2, 0, Math.PI * 2);
    g.stroke();
  }

  function drawGloss(g, r) {
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(-r * 0.35, -r * 0.44, r * 0.3, r * 0.17, -0.5, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.7;
    g.beginPath();
    g.arc(-r * 0.16, -r * 0.6, Math.max(0.9, r * 0.06), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /* --- 경단 뒤에 두는 것들: 귀 · 뿔 · 날개 · 후광 --- */
  function drawBehind(g, T, r) {
    var k = T.kind;
    if (k === 'bat') {
      g.fillStyle = 'rgba(63, 31, 122, .95)';
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.22, -r * 0.92);
        g.lineTo(s * r * 0.62, -r * 1.46);
        g.lineTo(s * r * 0.78, -r * 0.82);
        g.closePath();
        g.fill();
      });
      g.fillStyle = 'rgba(63, 31, 122, .9)';
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.92, -r * 0.1);
        g.quadraticCurveTo(s * r * 1.5, -r * 0.5, s * r * 1.42, r * 0.2);
        g.quadraticCurveTo(s * r * 1.24, r * 0.02, s * r * 1.14, r * 0.4);
        g.quadraticCurveTo(s * r * 1.0, r * 0.12, s * r * 0.9, r * 0.2);
        g.closePath();
        g.fill();
      });
    } else if (k === 'mantis') {
      g.strokeStyle = '#4d8a24';
      g.lineWidth = Math.max(1, r * 0.09);
      g.lineCap = 'round';
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.2, -r * 0.94);
        g.quadraticCurveTo(s * r * 0.5, -r * 1.4, s * r * 0.86, -r * 1.5);
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.9, -r * 1.54, Math.max(1, r * 0.1), 0, Math.PI * 2);
        g.fillStyle = '#4d8a24';
        g.fill();
      });
    } else if (k === 'mouse') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.66, -r * 0.76, r * 0.36, 0, Math.PI * 2);
        g.fillStyle = '#b3aabd';
        g.fill();
        g.beginPath();
        g.arc(s * r * 0.66, -r * 0.76, r * 0.22, 0, Math.PI * 2);
        g.fillStyle = '#f0c3d2';
        g.fill();
      });
    } else if (k === 'tiger') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.62, -r * 0.8, r * 0.24, 0, Math.PI * 2);
        g.fillStyle = '#c26312';
        g.fill();
      });
    } else if (k === 'pig') {
      g.fillStyle = '#d9789a';
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.42, -r * 0.86);
        g.lineTo(s * r * 0.86, -r * 1.24);
        g.lineTo(s * r * 0.84, -r * 0.66);
        g.closePath();
        g.fill();
      });
    } else if (k === 'bear') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.6, -r * 0.82, r * 0.3, 0, Math.PI * 2);
        g.fillStyle = '#8a5a2d';
        g.fill();
        g.beginPath();
        g.arc(s * r * 0.6, -r * 0.82, r * 0.16, 0, Math.PI * 2);
        g.fillStyle = '#c79a6c';
        g.fill();
      });
    } else if (k === 'dokkaebi') {
      /* 금빛 뿔 두 개 */
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.28, -r * 0.92);
        g.quadraticCurveTo(s * r * 0.5, -r * 1.38, s * r * 0.66, -r * 1.5);
        g.quadraticCurveTo(s * r * 0.62, -r * 1.2, s * r * 0.62, -r * 0.82);
        g.closePath();
        g.fillStyle = '#f2cf7a';
        g.fill();
      });
      g.strokeStyle = 'rgba(255, 236, 170, .55)';
      g.lineWidth = Math.max(1, r * 0.05);
      g.beginPath();
      g.arc(0, 0, r * 0.72, Math.PI * 1.1, Math.PI * 1.55);
      g.stroke();
    } else if (k === 'fox') {
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.24, -r * 0.9);
        g.lineTo(s * r * 0.82, -r * 1.66);
        g.lineTo(s * r * 0.92, -r * 0.62);
        g.closePath();
        g.fillStyle = '#e2a92f';
        g.fill();
        g.beginPath();
        g.moveTo(s * r * 0.52, -r * 1.06);
        g.lineTo(s * r * 0.84, -r * 1.6);
        g.lineTo(s * r * 0.86, -r * 0.9);
        g.closePath();
        g.fillStyle = '#8c5a06';
        g.fill();
      });
    } else if (k === 'tigerking') {
      /* 산군의 갈기 — 어두운 청회색 가시 */
      g.fillStyle = 'rgba(74, 98, 128, .55)';
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2;
        var r0 = r * 0.98, r1 = r * 1.22;
        g.beginPath();
        g.moveTo(Math.cos(a - 0.11) * r0, Math.sin(a - 0.11) * r0);
        g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        g.lineTo(Math.cos(a + 0.11) * r0, Math.sin(a + 0.11) * r0);
        g.closePath();
        g.fill();
      }
      [1, -1].forEach(function (s) {
        g.beginPath();
        g.arc(s * r * 0.58, -r * 0.78, r * 0.26, 0, Math.PI * 2);
        g.fillStyle = '#cfd9e6';
        g.fill();
      });
    } else if (k === 'cloud') {
      /* 황금 후광 */
      g.save();
      g.globalAlpha = 0.85;
      g.strokeStyle = '#f0d391';
      g.lineWidth = Math.max(1.4, r * 0.07);
      g.beginPath();
      g.arc(0, 0, r * 1.16, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 0.4;
      g.beginPath();
      g.arc(0, 0, r * 1.28, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      /* 구름 솜 — 바깥으로 부푼 덩어리 */
      g.fillStyle = '#f2f9ff';
      for (var j = 0; j < 7; j++) {
        var ang = (j / 7) * Math.PI * 2 + 0.3;
        g.beginPath();
        g.arc(Math.cos(ang) * r * 0.86, Math.sin(ang) * r * 0.86, r * 0.3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /* --- 표면 무늬: 원 안에만 그립니다 --- */
  function drawTexture(g, T, r) {
    var k = T.kind;
    if (k === 'tiger' || k === 'tigerking') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.strokeStyle = k === 'tiger' ? 'rgba(94, 43, 4, .72)' : 'rgba(56, 72, 96, .62)';
      g.lineWidth = Math.max(1.2, r * 0.075);
      g.lineCap = 'round';
      for (var i = -2; i <= 2; i++) {
        var y = i * r * 0.34 - r * 0.1;
        g.beginPath();
        g.moveTo(-r * 0.98, y - r * 0.1);
        g.quadraticCurveTo(-r * 0.4, y + r * 0.14, -r * 0.14, y - r * 0.04);
        g.moveTo(r * 0.98, y - r * 0.1);
        g.quadraticCurveTo(r * 0.4, y + r * 0.14, r * 0.14, y - r * 0.04);
        g.stroke();
      }
      g.restore();
    } else if (k === 'snake') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.strokeStyle = 'rgba(140, 230, 213, .3)';
      g.lineWidth = Math.max(0.8, r * 0.03);
      for (var row = 0; row < 4; row++) {
        for (var col = -2; col <= 2; col++) {
          var sx = col * r * 0.4 + (row % 2 ? r * 0.2 : 0);
          var sy = row * r * 0.34 - r * 0.5;
          g.beginPath();
          g.arc(sx, sy, r * 0.16, Math.PI * 0.15, Math.PI * 0.85);
          g.stroke();
        }
      }
      g.restore();
    } else if (k === 'mantis') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.strokeStyle = 'rgba(65, 118, 31, .3)';
      g.lineWidth = Math.max(0.8, r * 0.04);
      g.beginPath();
      g.moveTo(-r * 0.9, -r * 0.2);
      g.quadraticCurveTo(0, r * 0.5, r * 0.9, -r * 0.2);
      g.stroke();
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.6);
      g.quadraticCurveTo(0, r * 0.1, r * 0.6, -r * 0.6);
      g.stroke();
      g.restore();
    } else if (k === 'dokkaebi') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.fillStyle = 'rgba(255, 244, 200, .35)';
      [[-0.42, -0.5], [0.52, -0.24], [-0.1, 0.62]].forEach(function (p) {
        var px = p[0] * r, py = p[1] * r, sz = r * 0.1;
        g.beginPath();
        g.moveTo(px, py - sz * 2);
        g.lineTo(px + sz * 0.6, py);
        g.lineTo(px, py + sz * 2);
        g.lineTo(px - sz * 0.6, py);
        g.closePath();
        g.fill();
      });
      g.restore();
    } else if (k === 'fox') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.fillStyle = 'rgba(255, 255, 255, .26)';
      g.beginPath();
      g.ellipse(0, r * 0.62, r * 0.66, r * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    } else if (k === 'cloud') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.fillStyle = 'rgba(168, 200, 226, .22)';
      g.beginPath();
      g.ellipse(0, r * 0.5, r * 0.8, r * 0.42, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    } else if (k === 'bat') {
      g.save();
      ballPath(g, r * 0.99);
      g.clip();
      g.fillStyle = 'rgba(255, 255, 255, .12)';
      g.beginPath();
      g.arc(0, r * 0.42, r * 0.62, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  /* --- 얼굴 --- */
  function drawFace(g, T, r) {
    var k = T.kind;
    var ex = r * 0.32;
    var ey = -r * 0.02;
    var er = Math.max(1.3, r * 0.1);
    var ink = k === 'cloud' ? '#5d7b96' : '#241a16';

    g.save();
    g.fillStyle = ink;
    g.strokeStyle = ink;
    g.lineCap = 'round';

    if (k === 'cloud') {
      /* 지그시 감은 눈 */
      g.lineWidth = Math.max(1, r * 0.05);
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.arc(s * ex, ey + r * 0.03, r * 0.11, Math.PI * 0.15, Math.PI * 0.85);
        g.stroke();
      });
    } else if (k === 'fox' || k === 'dokkaebi') {
      /* 째는 눈매 */
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * (ex - r * 0.13), ey - r * 0.06);
        g.quadraticCurveTo(s * ex, ey + r * 0.06, s * (ex + r * 0.13), ey - r * 0.08);
        g.lineWidth = Math.max(1.2, r * 0.075);
        g.stroke();
      });
    } else {
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * ex, ey, er, er * 1.15, 0, 0, Math.PI * 2);
        g.fill();
        g.save();
        g.fillStyle = 'rgba(255,255,255,.92)';
        g.beginPath();
        g.arc(s * ex + er * 0.32, ey - er * 0.38, Math.max(0.6, er * 0.36), 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = ink;
      });
    }

    /* 입 — 대부분 작게 웃습니다 */
    if (k === 'snake') {
      /* 뱀 혀 */
      g.strokeStyle = '#e4547a';
      g.lineWidth = Math.max(1, r * 0.05);
      g.beginPath();
      g.moveTo(0, r * 0.3);
      g.lineTo(0, r * 0.56);
      g.moveTo(0, r * 0.46);
      g.lineTo(-r * 0.1, r * 0.56);
      g.moveTo(0, r * 0.46);
      g.lineTo(r * 0.1, r * 0.56);
      g.stroke();
    } else if (k === 'cloud') {
      g.lineWidth = Math.max(1, r * 0.045);
      g.beginPath();
      g.arc(0, r * 0.22, r * 0.1, Math.PI * 0.1, Math.PI * 0.9);
      g.stroke();
    } else {
      g.lineWidth = Math.max(1, r * 0.045);
      g.beginPath();
      g.arc(0, r * 0.14, r * 0.13, Math.PI * 0.18, Math.PI * 0.82);
      g.stroke();
    }
    g.restore();
  }

  /* --- 얼굴 앞쪽: 코 · 수염 · 송곳니 · 왕자 --- */
  function drawFront(g, T, r) {
    var k = T.kind;
    g.save();
    g.lineCap = 'round';

    if (k === 'bat') {
      g.fillStyle = '#ffffff';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.moveTo(s * r * 0.12, r * 0.28);
        g.lineTo(s * r * 0.03, r * 0.46);
        g.lineTo(s * r * 0.2, r * 0.46);
        g.closePath();
        g.fill();
      });
    } else if (k === 'mouse') {
      g.fillStyle = '#e08aa4';
      g.beginPath();
      g.moveTo(0, r * 0.22);
      g.lineTo(-r * 0.07, r * 0.32);
      g.lineTo(r * 0.07, r * 0.32);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(60, 50, 70, .55)';
      g.lineWidth = Math.max(0.7, r * 0.028);
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(s * r * 0.28, r * 0.22 + i * r * 0.06);
          g.lineTo(s * r * 0.82, r * 0.14 + i * r * 0.16);
          g.stroke();
        }
      });
    } else if (k === 'pig') {
      /* 돼지코 */
      g.fillStyle = '#f8c3d4';
      g.beginPath();
      g.ellipse(0, r * 0.3, r * 0.3, r * 0.22, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#b4617f';
      [-1, 1].forEach(function (s) {
        g.beginPath();
        g.ellipse(s * r * 0.11, r * 0.32, r * 0.045, r * 0.062, 0, 0, Math.PI * 2);
        g.fill();
      });
    } else if (k === 'bear' || k === 'tiger') {
      g.fillStyle = k === 'bear' ? '#e6c49c' : '#ffe0b8';
      g.beginPath();
      g.ellipse(0, r * 0.34, r * 0.28, r * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#3a2418';
      g.beginPath();
      g.ellipse(0, r * 0.26, r * 0.09, r * 0.07, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(60, 36, 24, .5)';
      g.lineWidth = Math.max(0.7, r * 0.026);
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(s * r * 0.22, r * 0.3 + i * r * 0.05);
          g.lineTo(s * r * 0.78, r * 0.24 + i * r * 0.14);
          g.stroke();
        }
      });
    } else if (k === 'tigerking') {
      /* 王 자 — 이마 위 */
      g.strokeStyle = 'rgba(40, 52, 74, .85)';
      g.lineWidth = Math.max(1, r * 0.05);
      var ty = -r * 0.46, tw = r * 0.2;
      g.beginPath();
      g.moveTo(-tw, ty - r * 0.08); g.lineTo(tw, ty - r * 0.08);
      g.moveTo(-tw * 0.8, ty); g.lineTo(tw * 0.8, ty);
      g.moveTo(-tw, ty + r * 0.08); g.lineTo(tw, ty + r * 0.08);
      g.stroke();
      /* 위엄 있는 수염 */
      g.strokeStyle = 'rgba(48, 60, 84, .6)';
      g.lineWidth = Math.max(0.9, r * 0.03);
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(s * r * 0.2, r * 0.3 + i * r * 0.05);
          g.quadraticCurveTo(s * r * 0.6, r * 0.24 + i * r * 0.14, s * r * 0.96, r * 0.16 + i * r * 0.22);
          g.stroke();
        }
      });
      g.fillStyle = '#3c4a60';
      g.beginPath();
      g.ellipse(0, r * 0.24, r * 0.075, r * 0.055, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'fox') {
      g.strokeStyle = 'rgba(120, 78, 8, .5)';
      g.lineWidth = Math.max(0.7, r * 0.026);
      [-1, 1].forEach(function (s) {
        for (var i = -1; i <= 1; i++) {
          g.beginPath();
          g.moveTo(s * r * 0.22, r * 0.3 + i * r * 0.05);
          g.lineTo(s * r * 0.8, r * 0.22 + i * r * 0.16);
          g.stroke();
        }
      });
      g.fillStyle = '#8c5a06';
      g.beginPath();
      g.ellipse(0, r * 0.22, r * 0.07, r * 0.05, 0, 0, Math.PI * 2);
      g.fill();
    } else if (k === 'dokkaebi') {
      /* 도깨비 송곳니 하나 */
      g.fillStyle = '#fff7e2';
      g.beginPath();
      g.moveTo(r * 0.06, r * 0.26);
      g.lineTo(r * 0.17, r * 0.26);
      g.lineTo(r * 0.115, r * 0.44);
      g.closePath();
      g.fill();
    } else if (k === 'mantis') {
      g.strokeStyle = 'rgba(65, 118, 31, .55)';
      g.lineWidth = Math.max(0.8, r * 0.035);
      g.beginPath();
      g.moveTo(-r * 0.1, r * 0.26);
      g.lineTo(-r * 0.02, r * 0.4);
      g.moveTo(r * 0.1, r * 0.26);
      g.lineTo(r * 0.02, r * 0.4);
      g.stroke();
    } else if (k === 'cloud') {
      g.fillStyle = 'rgba(255, 246, 214, .9)';
      [[-0.55, -0.42], [0.62, 0.1]].forEach(function (p) {
        g.save();
        g.translate(p[0] * r, p[1] * r);
        drawSpark(g, r * 0.12);
        g.restore();
      });
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
  }

  function worldTransform() {
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale,
      view.dpr * view.ox, view.dpr * view.oy);
  }

  function draw() {
    if (!ctx) { return; }
    var dpr = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

    /* 바깥 배경 — 연못 물빛 */
    var bg = ctx.createRadialGradient(el.canvas.width * 0.5, el.canvas.height * 0.18, 8,
      el.canvas.width * 0.5, el.canvas.height * 0.6, el.canvas.height * 0.9);
    bg.addColorStop(0, 'rgba(14, 62, 62, .55)');
    bg.addColorStop(0.6, 'rgba(6, 32, 36, .62)');
    bg.addColorStop(1, 'rgba(2, 16, 18, .85)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);

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
        drawGyeongdan(ctx, b.tier, b.x, b.y, b.r, 1);
      });
      drawParticles();
      drawPops();
      if (!S.over) { drawAim(); }
    }
    ctx.restore();
  }

  function drawBoard() {
    /* 그릇 바닥 */
    var floor = ctx.createLinearGradient(0, H - 90, 0, H);
    floor.addColorStop(0, 'rgba(46, 139, 122, 0)');
    floor.addColorStop(1, 'rgba(46, 139, 122, .22)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, H - 90, W, 90);

    /* 좌우 벽 · 바닥 */
    ctx.strokeStyle = 'rgba(127, 209, 189, .28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(1, 0);
    ctx.lineTo(1, H - 8);
    ctx.quadraticCurveTo(1, H, 12, H);
    ctx.lineTo(W - 12, H);
    ctx.quadraticCurveTo(W - 1, H, W - 1, H - 8);
    ctx.lineTo(W - 1, 0);
    ctx.stroke();

    /* 데드라인 */
    var over = S ? S.warn : 0;
    var hot = over > 0;
    ctx.save();
    ctx.setLineDash([9, 7]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hot ? 'rgba(255, 118, 118, .9)' : 'rgba(242, 162, 185, .3)';
    ctx.beginPath();
    ctx.moveTo(6, DEAD_Y);
    ctx.lineTo(W - 6, DEAD_Y);
    ctx.stroke();
    ctx.restore();

    if (hot) {
      var left = Math.max(0, DEAD_GRACE - over);
      ctx.save();
      ctx.fillStyle = 'rgba(255, 132, 132, .95)';
      ctx.font = '600 12px "Pretendard", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('데드라인 초과 · ' + left.toFixed(1) + '초', W / 2, DEAD_Y - 8);
      ctx.restore();
    }

    /* 떨어질 자리 안내선 */
    if (S && !S.over && !S.tool) {
      ctx.save();
      ctx.setLineDash([3, 8]);
      ctx.strokeStyle = 'rgba(240, 217, 165, .2)';
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
    renderNext();
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
    renderNext();
  }

  function renderNext() {
    var c = el.next;
    if (!c) { return; }
    var dpr = Math.min(2.5, window.devicePixelRatio || 1);
    var size = 52;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    if (!S) { return; }
    var tier = S.nextTier;
    var r = Math.min(size * 0.36, TIERS[tier].r);
    drawGyeongdan(g, tier, size / 2, size / 2 + 1, r, 1);
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
    renderNext();
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
     10. 도구 3종
     =================================================================== */

  var TOOL_INFO = {
    mallet: {
      name: '절구공이',
      /* 백운단(11단계)만 지울 수 있습니다 — 판이 막혔을 때 쓰는 마지막 수 */
      hint: '백운단만 지울 수 있어요 · 백운단을 눌러 주세요',
      icon: '<path d="M9.2 3.4h5.6l.9 6.1H8.3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M12 9.6V19" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M9.4 19h5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
    },
    swap: {
      name: '교환부',
      hint: '바꿀 경단 두 개를 차례로 눌러 주세요',
      icon: '<path d="M4.6 8.4h11.2l-2.6-2.6M19.4 15.6H8.2l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
    },
    brush: {
      name: '승급붓',
      hint: '한 단계 올릴 경단을 눌러 주세요',
      icon: '<path d="M15.8 4.6l3.6 3.6-8.4 8.4-4.8 1.2 1.2-4.8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.4 7l3.6 3.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5.6 19.4h12.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity=".6"/>'
    }
  };

  function toolMarkup() {
    return Object.keys(TOOL_INFO).map(function (key) {
      var t = TOOL_INFO[key];
      return '<button type="button" class="gd-tool" data-tool="' + key + '" aria-pressed="false">' +
        '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">' + t.icon + '</svg>' +
        '<span class="gd-tool__name">' + t.name + '</span>' +
        '<span class="gd-tool__left" data-left="' + key + '">' + TOOL_FREE + '</span>' +
        '</button>';
    }).join('') +
      '<button type="button" class="gd-tool gd-tool--cancel" id="gd-tool-cancel" hidden>취소</button>';
  }

  function buildTools() {
    if (!el.tools || el.tools.getAttribute('data-built') === '1') { return; }
    el.tools.innerHTML = '<span class="gd-tools__label">도구 <em>한 판에 각 ' + TOOL_FREE + '회</em></span>' +
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
      var left = S ? S.tools[key] : TOOL_FREE;
      var active = S && S.tool === key;
      btn.classList.toggle('is-active', !!active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.disabled = left <= 0 || !S || S.over;
      var badge = $('[data-left="' + key + '"]', btn);
      if (badge) { badge.textContent = left > 0 ? left : '0'; }
      btn.classList.toggle('is-empty', left <= 0);
    });
    var cancel = $('#gd-tool-cancel', el.tools);
    if (cancel) { cancel.hidden = !S || !S.tool; }
  }

  function toggleTool(key) {
    if (!S || S.over) { return; }
    if (S.tools[key] <= 0) {
      setHint(TOOL_INFO[key].name + '는 이번 판에 다 썼어요 · 다음 판에서 다시 2회씩 쓸 수 있어요');
      return;
    }
    selectTool(S.tool === key ? null : key);
  }

  function selectTool(key) {
    if (!S) { return; }
    S.tool = key;
    S.picks = [];
    syncToolButtons();
    if (key) {
      setHint(TOOL_INFO[key].name + ' — ' + TOOL_INFO[key].hint + ' (' + S.tools[key] + '회 남음)');
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
    if (!key || S.tools[key] <= 0) { return false; }
    var body = bodyAt(wx, wy);

    /* 절구공이 — 오직 백운단(11단계)만 지웁니다. 다른 경단이면 횟수를 쓰지 않습니다. */
    if (key === 'mallet') {
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
      S.tools.mallet -= 1;
      S.shake = Math.min(1, S.shake + 0.4);
      bumpBest();
      afterTool('백운단을 깔끔하게 걷어냈어요 · +' + fmtNum(MALLET_BONUS) + '점');
      return true;
    }

    if (!body) { setHint(TOOL_INFO[key].name + ' — 경단을 정확히 눌러 주세요'); return true; }

    if (key === 'brush') {
      if (body.tier >= LAST_TIER) {
        setHint('백운단은 더 올릴 수 없어요 · 다른 경단을 골라 주세요');
        return true;
      }
      var nextTier = body.tier + 1;
      S.bodies = S.bodies.filter(function (b) { return b !== body; });
      var grown = makeBody(nextTier, clamp(body.x, TIERS[nextTier].r, W - TIERS[nextTier].r),
        clamp(body.y, TIERS[nextTier].r, H - TIERS[nextTier].r), 0, -30);
      grown.age = 1;
      S.bodies.push(grown);
      S.tools.brush -= 1;
      if (nextTier > S.maxTier) { S.maxTier = nextTier; }
      burst(grown.x, grown.y, 14, [TIERS[nextTier].color, TIERS[nextTier].light, '#ffffff'], 150);
      addPop(grown.x, grown.y, '승급!', '#e8ffd8');
      afterTool();
      return true;
    }

    /* 교환부 — 두 개를 차례로 */
    var idx = S.picks.indexOf(body);
    if (idx !== -1) {
      S.picks.splice(idx, 1);
      setHint(TOOL_INFO.swap.hint + ' (' + (2 - S.picks.length) + '번째)');
      return true;
    }
    S.picks.push(body);
    if (S.picks.length < 2) {
      setHint('교환부 — 하나 더 눌러 주세요 (' + S.tools.swap + '회 남음)');
      return true;
    }
    var a = S.picks[0], b = S.picks[1];
    var ax = a.x, ay = a.y, avx = a.vx, avy = a.vy;
    a.x = clamp(b.x, a.r, W - a.r); a.y = clamp(b.y, a.r, H - a.r);
    b.x = clamp(ax, b.r, W - b.r); b.y = clamp(ay, b.r, H - b.r);
    a.vx = 0; a.vy = 0; b.vx = 0; b.vy = 0;
    S.tools.swap -= 1;
    S.picks = [];
    burst(a.x, a.y, 8, ['#c9f5e6', '#ffffff'], 110);
    burst(b.x, b.y, 8, ['#c9f5e6', '#ffffff'], 110);
    afterTool();
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
    /* 횟수를 다 쓴 도구는 자동으로 풀립니다 */
    if (S.tool && S.tools[S.tool] <= 0) { S.tool = null; }
    syncToolButtons();
    if (message) {
      setHint(message);
    } else if (S.tool) {
      setHint(TOOL_INFO[S.tool].name + ' — ' + TOOL_INFO[S.tool].hint + ' (' + S.tools[S.tool] + '회 남음)');
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
    var html = '<div class="gd-sheet__head"><h3>🍡 진화표</h3>' +
      '<button type="button" class="gd-sheet__close" data-sheet-close="1" aria-label="닫기">×</button></div>' +
      '<p class="gd-sheet__note">같은 경단 두 개가 닿으면 다음 단계로 합쳐져요 · 위에서 떨어지는 건 1~5단계<br>' +
      '백운단 두 개가 합쳐지면 둘 다 사라지며 <b>+' + fmtNum(CLOUD_BONUS) + '점</b>!</p>' +
      '<ol class="gd-chart">';
    for (var t = 1; t <= LAST_TIER; t++) {
      var T = TIERS[t];
      html += '<li class="gd-chart__row">' +
        '<span class="gd-chart__no">' + t + '</span>' +
        '<canvas class="gd-chart__icon" data-tier="' + t + '" width="40" height="40" aria-hidden="true"></canvas>' +
        '<span class="gd-chart__name">' + T.name + '</span>' +
        '<span class="gd-chart__score">' + (t === 1 ? '기본' : '+' + fmtNum(scoreForTier(t)) + '점') + '</span>' +
        '</li>';
    }
    html += '</ol>';
    return html;
  }

  /* 진화표 아이콘 — 귀·뿔·후광까지 40px 안에 들어오도록 단계별 반지름을 정합니다 */
  var ICON_R = { 1: 11.5, 2: 11.5, 3: 14.5, 4: 15, 5: 15, 6: 15, 7: 14.5, 8: 12, 9: 10.5, 10: 13, 11: 14 };

  function paintChartIcons() {
    $$('canvas[data-tier]', el.sheet).forEach(function (c) {
      var tier = Number(c.getAttribute('data-tier'));
      var dpr = Math.min(2.5, window.devicePixelRatio || 1);
      c.width = Math.round(40 * dpr);
      c.height = Math.round(40 * dpr);
      var g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, 40, 40);
      drawGyeongdan(g, tier, 20, 20, ICON_R[tier] || 14, 1);
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
      add: function (tier, x, y) {
        if (!S) { return null; }
        var t = clampInt(tier, 1, LAST_TIER, 1);
        var body = makeBody(t, clamp(x || W / 2, TIERS[t].r, W - TIERS[t].r),
          clamp(y === undefined ? H - TIERS[t].r - 4 : y, TIERS[t].r, H - TIERS[t].r));
        body.age = 1;
        S.bodies.push(body);
        if (t > S.maxTier) { S.maxTier = t; }
        return body.id;
      },
      setNext: function (tier) { if (S) { S.nextTier = clampInt(tier, 1, LAST_TIER, 1); renderNext(); } },
      bodies: function () { return S ? S.bodies.map(function (b) { return { id: b.id, tier: b.tier, x: r2(b.x), y: r2(b.y), r: b.r }; }) : []; },
      state: function () {
        return S ? {
          score: S.score, best: S.best, maxTier: S.maxTier, over: S.over,
          tools: { mallet: S.tools.mallet, swap: S.tools.swap, brush: S.tools.brush },
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
