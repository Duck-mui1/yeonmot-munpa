/* 연못 — 🦆 연못 생존기 (도깨비의 세계) · v47
 *
 *  · 잔잔한 연못 위의 오리를 끌어 움직여, 사방(위·아래·왼쪽·오른쪽)에서 날아오는
 *    도깨비불과 탄막을 피하는 고전 닷지(총알 피하기) 게임입니다.
 *  · 아이템은 없습니다 — 한 번 맞으면 그 자리에서 끝. 실력만으로 겨룹니다.
 *    다만 억울하지 않도록 피격 판정은 오리 그림보다 작은 '코어' 반지름(그림의 0.62)으로 봅니다.
 *  · 생존 시간은 0.01초(센티초) 단위로 셉니다. 화면에는 42.85초처럼 보여 주고,
 *    랭킹 점수는 센티초 정수(4285 = 42.85초)로 저장합니다.
 *  · 처음 1.8초는 도깨비불이 나오지 않아 몸을 풀 수 있고, 시간이 갈수록 탄이 잦고 빨라집니다.
 *  · 조작 —
 *      모바일: 화면 아무 곳이나 눌러 끈 만큼(상대 드래그) 오리가 따라 움직입니다.
 *              손가락이 오리를 가리지 않습니다.
 *      PC: 방향키 ↑↓←→ · WASD · 마우스 드래그.
 *  · 화면 코드는 YM_SURVIVAL.open({ ... }) 만 부르고, 점수 저장·랭킹 조회는
 *    넘겨받은 함수(opts.submitScore / opts.listRanking)로 합니다.
 */
(function () {
  'use strict';

  /* ===================================================================
     1. 규칙 상수
     =================================================================== */

  var WARMUP_MS = 1800;          // 시작 뒤 이만큼은 탄이 나오지 않습니다(몸 풀기)
  var MAX_BULLETS = 240;         // 화면이 넘치지 않게 두는 상한
  var BEST_KEY = 'ym.survival.best';
  var ROLE_LABEL = { admin: '문주', officer: '운영진', member: '문파원' };
  var KINDS = {
    wisp:  { glow: 'rgba(126, 244, 222, .55)', core: '#eafff8' },
    orb:   { glow: 'rgba(196, 152, 255, .55)', core: '#f4e9ff' },
    spark: { glow: 'rgba(255, 214, 132, .6)',  core: '#fff6dd' }
  };

  /* ===================================================================
     2. DOM
     =================================================================== */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = {};
  var ctx = null;

  function grabDom() {
    el.root = $('#survival');
    el.panel = $('.survival__panel', el.root);
    el.stage = $('#survival-stage');
    el.canvas = $('#survival-canvas');
    el.time = $('#sv-time');
    el.best = $('#sv-best');
    el.hint = $('#sv-hint');
    el.over = $('#sv-over');
    el.sheet = $('#sv-sheet');
    el.close = $('#survival-close');
    el.rankBtn = $('#sv-rank-btn');
    el.restartBtn = $('#sv-restart-btn');
    if (el.canvas) { ctx = el.canvas.getContext('2d'); }
  }

  /* ===================================================================
     3. 저장 (이 기기 최고 기록 · 센티초)
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
  function localBest() {
    var v = Number(storeGet(BEST_KEY, 0));
    return isFinite(v) && v > 0 ? Math.floor(v) : 0;
  }
  function setLocalBest(value) {
    if (value > localBest()) { storeSet(BEST_KEY, Math.floor(value)); }
  }

  /* ===================================================================
     4. 상태 · 유틸
     =================================================================== */

  var S = null;
  var opts = {};
  var ranking = { status: 'idle', rows: [], message: '' };
  var opened = false;
  var raf = 0;
  var lastT = 0;
  var frozen = false;
  var restartArmTimer = 0;
  var hintTimer = 0;

  /* 🔗 체험 링크(?guest=TOKEN)로 연 판 — 문파 랭킹 대신 '체험 랭킹'을 씁니다. */
  function guestRank() { return !!opts.guestMode && typeof opts.submitGuestScore === 'function'; }
  function rankWord() { return guestRank() ? '체험 랭킹' : '문파 랭킹'; }

  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /** 센티초 → '42.85초' (화면·랭킹 공통 표기) */
  function fmtSec(cs) {
    var v = Math.max(0, Math.round(Number(cs) || 0));
    return (v / 100).toFixed(2) + '초';
  }
  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function newState() {
    return {
      w: 0, h: 0, dpr: 1,
      metrics: { size: 300, duckR: 16, coreR: 10 },
      duck: { x: 0, y: 0, r: 16, vx: 0, vy: 0, tilt: 0, hurt: 0 },
      bullets: [],
      marks: [],            // 물결 · 피격 자국 같은 잔잔한 흔적
      elapsed: 0,           // ms
      score: 0,             // 센티초
      best: Math.max(localBest(), opts.best || 0),
      over: false,
      paused: false,
      drag: null,
      keys: {},
      spawnIn: 260,
      edgeFlash: { top: 0, bottom: 0, left: 0, right: 0 },
      tier: 0,              // 난이도 단계(안내 문구용)
      submitState: { pending: false, failed: '', result: null },
      shake: 0,
      startedAt: nowMs()
    };
  }

  /* 난이도 — 따뜻한 몸풀기 뒤부터 서서히 */
  function difficultyAt(ms) {
    var t = Math.max(0, (Number(ms) || 0) - WARMUP_MS) / 1000;   // 몸풀기 뒤 지난 초
    var k = clamp(t / 75, 0, 1);
    return {
      t: t,
      speed: 0.42 + k * 0.68,          // 판 크기 대비 초당 배율(0.42 → 1.10)
      interval: 780 - k * 580,         // 탄 하나 사이 간격(ms) 780 → 200
      spread: t >= 8,                  // 세 갈래 부채
      twin: t >= 14,                   // 한 번에 두 발
      spark: t >= 20,                  // 아주 빠른 파편
      cross: t >= 30                   // 마주 보는 두 가장자리에서 동시에
    };
  }

  /* ===================================================================
     5. 판 크기 — 낮은 PC 창에서도 정사각 비율 유지
     =================================================================== */

  var stageFit = { w: 0, h: 0 };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function fitStage() {
    var stage = el.stage, panel = el.panel, root = el.root;
    if (!stage || !panel || !root || root.hidden) { return; }
    var rootW = root.clientWidth, rootH = root.clientHeight;
    if (rootW < 40 || rootH < 40) { return; }
    var rs = window.getComputedStyle(root);
    var ps = window.getComputedStyle(panel);
    var padY = num(ps.paddingTop) + num(ps.paddingBottom)
      + num(ps.borderTopWidth) + num(ps.borderBottomWidth);
    var padX = num(ps.paddingLeft) + num(ps.paddingRight)
      + num(ps.borderLeftWidth) + num(ps.borderRightWidth);
    var boxW = Math.min(440, Math.round(rootW - num(rs.paddingLeft) - num(rs.paddingRight)));
    var boxH = Math.round(rootH - num(rs.paddingTop) - num(rs.paddingBottom));
    var w = 0;
    for (var pass = 0; pass < 4; pass++) {
      var room = boxH - padY - otherHeight(panel, stage) - 6;
      if (room < 0) { room = 0; }
      var next = Math.max(90, Math.min(boxW - padX, room));
      if (pass > 0 && Math.abs(next - w) < 2) { break; }
      w = next;
      setPanelWidth(w + padX, boxW);
      applyStageSize(w);
    }
    var spill = panel.scrollHeight - panel.clientHeight;
    if (spill > 1) { applyStageSize(Math.max(90, stageFit.w - spill - 1)); }
  }

  function otherHeight(panel, stage) {
    var sum = 0;
    for (var i = 0; i < panel.children.length; i++) {
      var child = panel.children[i];
      if (child === stage) { continue; }
      var cs = window.getComputedStyle(child);
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') { continue; }
      sum += child.getBoundingClientRect().height + num(cs.marginTop) + num(cs.marginBottom);
    }
    return sum;
  }

  function setPanelWidth(width, boxW) {
    var panel = el.panel;
    if (!panel) { return; }
    var target = Math.round(Math.min(boxW, Math.max(340, width)));
    if (target >= boxW) {
      if (panel.style.width) { panel.style.width = ''; }
      return;
    }
    if (panel.style.width !== target + 'px') { panel.style.width = target + 'px'; }
  }

  function applyStageSize(width) {
    var stage = el.stage;
    if (!stage || !(width > 0)) { return; }
    var s = Math.round(width);
    if (Math.abs(s - stageFit.w) < 1 && Math.abs(s - stageFit.h) < 1) { return; }
    stageFit.w = s; stageFit.h = s;
    stage.style.width = s + 'px';
    stage.style.height = s + 'px';
  }

  function resize() {
    if (!el.stage || !el.canvas || !S) { return; }
    fitStage();
    var rect = el.stage.getBoundingClientRect();
    var w = Math.max(90, Math.round(rect.width));
    var h = Math.max(90, Math.round(rect.height));
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var wasW = S.w;
    S.w = w; S.h = h; S.dpr = dpr;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    var size = Math.min(w, h);
    S.metrics = {
      size: size,
      duckR: size * 0.052,
      coreR: size * 0.052 * 0.62
    };
    S.duck.r = S.metrics.duckR;
    if (!wasW) {
      S.duck.x = w / 2;
      S.duck.y = h / 2;
    } else {
      /* 판 크기가 바뀌어도 오리가 판 밖으로 나가지 않게 */
      S.duck.x = clamp(S.duck.x, S.duck.r, w - S.duck.r);
      S.duck.y = clamp(S.duck.y, S.duck.r, h - S.duck.r);
    }
  }

  /* ===================================================================
     6. 조작 — 상대 드래그 · 방향키 · WASD · 마우스 끌기
     =================================================================== */

  function pointerPoint(ev) {
    var rect = el.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev) {
    if (!S || S.over) { return; }
    if (ev.pointerType === 'mouse' && ev.button !== 0) { return; }
    var p = pointerPoint(ev);
    S.drag = { id: ev.pointerId, lastX: p.x, lastY: p.y };
    try { el.canvas.setPointerCapture(ev.pointerId); } catch (e) { /* 오래된 브라우저 */ }
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    if (!S || S.over || !S.drag || S.drag.id !== ev.pointerId) { return; }
    var p = pointerPoint(ev);
    /* 손가락(마우스)이 움직인 만큼만 오리를 옮깁니다 — 손가락이 오리를 가리지 않습니다. */
    moveDuck(p.x - S.drag.lastX, p.y - S.drag.lastY);
    S.drag.lastX = p.x;
    S.drag.lastY = p.y;
    ev.preventDefault();
  }

  function onPointerUp(ev) {
    if (!S || !S.drag) { return; }
    if (S.drag.id !== ev.pointerId) { return; }
    S.drag = null;
  }

  function moveDuck(dx, dy) {
    if (!S) { return; }
    var m = S.duck.r;
    S.duck.x = clamp(S.duck.x + (Number(dx) || 0), m, S.w - m);
    S.duck.y = clamp(S.duck.y + (Number(dy) || 0), m, S.h - m);
    if (Math.abs(dx) > 0.4) { S.duck.tilt = clamp(S.duck.tilt + dx * 0.02, -1, 1); }
    S.duck.vx = (Number(dx) || 0) * 60;
  }

  var KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', a: 'left', s: 'down', d: 'right',
    W: 'up', A: 'left', S: 'down', D: 'right'
  };

  function bindPointer() {
    el.canvas.addEventListener('pointerdown', onPointerDown);
    el.canvas.addEventListener('pointermove', onPointerMove);
    el.canvas.addEventListener('pointerup', onPointerUp);
    el.canvas.addEventListener('pointercancel', onPointerUp);
    el.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ===================================================================
     7. 탄 — 도깨비불 · 탄막 · 파편
     =================================================================== */

  function edgeList() { return ['top', 'right', 'bottom', 'left']; }

  function addBullet(b) {
    if (!S || S.bullets.length >= MAX_BULLETS) { return null; }
    b.age = 0;
    b.kind = b.kind || 'wisp';
    S.bullets.push(b);
    return b;
  }

  /** 가장자리 하나에서 오리를 향해 한 발 (조준 + 약간 흔들림) */
  function spawnFromEdge(edge, spec) {
    if (!S) { return null; }
    spec = spec || {};
    var size = S.metrics.size;
    var speed = size * (spec.speed || difficultyAt(S.elapsed).speed) * rnd(0.92, 1.12);
    var r = size * (spec.r || 0.017) * rnd(0.9, 1.12);
    var x, y, tx, ty;
    if (edge === 'top') { x = rnd(r, S.w - r); y = -r - 2; }
    else if (edge === 'bottom') { x = rnd(r, S.w - r); y = S.h + r + 2; }
    else if (edge === 'left') { x = -r - 2; y = rnd(r, S.h - r); }
    else { x = S.w + r + 2; y = rnd(r, S.h - r); }

    tx = S.duck.x + rnd(-S.metrics.size * 0.05, S.metrics.size * 0.05);
    ty = S.duck.y + rnd(-S.metrics.size * 0.05, S.metrics.size * 0.05);
    var dx = tx - x, dy = ty - y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var kind = spec.kind || 'wisp';
    spawnSideFlash(edge);
    return addBullet({
      x: x, y: y, vx: dx / len * speed, vy: dy / len * speed,
      r: r, kind: kind,
      hitR: r * 0.82,
      life: 0, max: 9000
    });
  }

  /** 부채 — 같은 가장자리에서 세 갈래 */
  function spawnFan(edge) {
    if (!S) { return; }
    var base = spawnFromEdge(edge, { kind: 'orb' });
    if (!base) { return; }
    var spread = 0.34;
    var ang = Math.atan2(base.vy, base.vx);
    var spd = Math.sqrt(base.vx * base.vx + base.vy * base.vy);
    [-spread, spread].forEach(function (d) {
      addBullet({
        x: base.x, y: base.y,
        vx: Math.cos(ang + d) * spd, vy: Math.sin(ang + d) * spd,
        r: base.r * 0.86, kind: 'orb', hitR: base.r * 0.86 * 0.82, life: 0, max: 9000
      });
    });
  }

  function spawnTick(dt) {
    if (!S || S.over) { return; }
    if (S.elapsed < WARMUP_MS) { return; }
    S.spawnIn -= dt;
    if (S.spawnIn > 0) { return; }
    var d = difficultyAt(S.elapsed);
    var edges = edgeList();
    var edge = edges[(Math.random() * 4) | 0];

    /* 오래 살수록 더 자주, 여러 발 */
    S.spawnIn = d.interval * rnd(0.78, 1.24);

    if (d.cross && Math.random() < 0.26) {
      spawnFromEdge(edge, { kind: 'wisp' });
      var opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[edge];
      spawnFromEdge(opposite, { kind: 'wisp' });
      return;
    }
    if (d.spread && Math.random() < 0.24) {
      spawnFan(edge);
      return;
    }
    if (d.spark && Math.random() < 0.3) {
      spawnFromEdge(edge, { kind: 'spark', r: 0.012, speed: d.speed * 1.5 });
      return;
    }
    spawnFromEdge(edge, { kind: 'wisp' });
    if (d.twin && Math.random() < 0.42) {
      var other = edges[(Math.random() * 4) | 0];
      spawnFromEdge(other, { kind: 'wisp' });
    }
  }

  function spawnSideFlash(edge) {
    if (!S || !S.edgeFlash) { return; }
    S.edgeFlash[edge] = 1;
  }

  /* ===================================================================
     8. 한 판 — 시작 · 진행 · 피격
     =================================================================== */

  function startGame(first) {
    S = newState();
    S.running = true;
    if (el.time) { el.time.textContent = fmtSec(0); }
    if (el.best) { el.best.textContent = fmtSec(S.best); }
    hideOver();
    closeSheet();
    if (el.restartBtn) {
      el.restartBtn.textContent = '다시하기';
      el.restartBtn.classList.remove('is-armed');
      el.restartBtn.removeAttribute('data-armed');
    }
    resize();
    setHint(first
      ? '화면을 끈 만큼 오리가 따라와요 · 방향키·WASD 도 돼요'
      : '한 번 맞으면 끝이에요 · 오리를 끌어 피해 보세요');
    startLoop();
  }

  function endGame() {
    if (!S || S.over) { return; }
    S.over = true;
    S.drag = null;
    S.shake = 1;
    S.duck.hurt = 1;
    S.score = Math.max(0, Math.floor(S.elapsed / 10));
    if (S.score > S.best) { S.best = S.score; }
    setLocalBest(S.score);
    renderTime();
    showOver();
    if ((opts.live && typeof opts.submitScore === 'function') || guestRank()) {
      if (S.score > 0) { submitScore(); }
    }
  }

  function submitScore() {
    if (!S || S.submitState.pending) { return; }
    var submit = guestRank() ? opts.submitGuestScore : opts.submitScore;
    if (typeof submit !== 'function') { return; }
    S.submitState.pending = true;
    S.submitState.failed = '';
    submit(S.score).then(function (res) {
      S.submitState.pending = false;
      S.submitState.result = res || null;
      if (res && Number(res.best_score) > S.best) {
        S.best = Number(res.best_score);
        setLocalBest(S.best);
        renderTime();
      }
      renderOverResult();
      if (ranking.status === 'ready') { loadRanking(); }
    }, function (err) {
      S.submitState.pending = false;
      var code = String((err && err.code) || '');
      var msg = String((err && err.message) || '');
      if (code === 'PGRST202' || msg.indexOf('Could not find the function') !== -1) {
        S.submitState.failed = 'pending';
      } else {
        S.submitState.failed = msg || 'error';
      }
      renderOverResult();
    });
  }

  /* ===================================================================
     9. 한 순간의 계산
     =================================================================== */

  function update(dt) {
    if (!S || S.over || S.paused) { return; }
    var sec = dt / 1000;

    S.elapsed += dt;
    var started = S.elapsed >= WARMUP_MS;

    /* 키보드 — 누르고 있는 동안 일정한 속도로 */
    var kx = (S.keys.right ? 1 : 0) - (S.keys.left ? 1 : 0);
    var ky = (S.keys.down ? 1 : 0) - (S.keys.up ? 1 : 0);
    if (kx || ky) {
      var norm = (kx && ky) ? 0.7071 : 1;
      var speed = S.metrics.size * 1.02;
      S.duck.x = clamp(S.duck.x + kx * speed * norm * sec, S.duck.r, S.w - S.duck.r);
      S.duck.y = clamp(S.duck.y + ky * speed * norm * sec, S.duck.r, S.h - S.duck.r);
      S.duck.vx = kx * speed;
    } else {
      S.duck.vx *= 0.86;
    }
    S.duck.tilt *= 0.9;

    if (started) { spawnTick(dt); }

    /* 탄 이동 + 피격 검사 */
    var core = S.metrics.coreR;
    var hit = false;
    var alive = [];
    for (var i = 0; i < S.bullets.length; i++) {
      var b = S.bullets[i];
      b.life += dt;
      b.age += dt;
      b.x += b.vx * sec;
      b.y += b.vy * sec;
      var pad = b.r + 6;
      if (b.x < -pad * 3 || b.x > S.w + pad * 3 || b.y < -pad * 3 || b.y > S.h + pad * 3) { continue; }
      if (b.life > b.max) { continue; }
      if (!hit) {
        var dx = b.x - S.duck.x, dy = (b.y - (S.duck.y - S.duck.r * 0.18));
        if (dx * dx + dy * dy < (core + b.hitR) * (core + b.hitR)) {
          hit = true;
          S.bullets[i].hit = true;
        }
      }
      alive.push(b);
    }
    S.bullets = alive;

    /* 가장자리 안내 불빛 · 잔잔한 흔적 */
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      if (S.edgeFlash[k] > 0) { S.edgeFlash[k] = Math.max(0, S.edgeFlash[k] - dt / 420); }
    });
    if (S.bullets.length && Math.random() < 0.06) {
      var last = S.bullets[S.bullets.length - 1];
      S.marks.push({ x: last.x, y: last.y, r: last.r, age: 0, max: 520 });
    }
    for (var m = S.marks.length - 1; m >= 0; m--) {
      S.marks[m].age += dt;
      if (S.marks[m].age > S.marks[m].max) { S.marks.splice(m, 1); }
    }
    if (S.shake > 0) { S.shake = Math.max(0, S.shake - dt / 420); }

    /* 난이도 안내 — 단계가 바뀔 때 한 줄 */
    var tier = S.elapsed < WARMUP_MS ? 0
      : (S.elapsed < 12000 ? 1 : (S.elapsed < 30000 ? 2 : 3));
    if (tier !== S.tier) {
      S.tier = tier;
      if (tier === 1) { setHint('도깨비불이 몰려와요 · 한 번 맞으면 끝!'); }
      else if (tier === 2) { setHint('점점 빨라져요 · 가장자리를 살펴보세요'); }
      else if (tier === 3) { setHint('탄막이 두꺼워졌어요 · 오래 버텨 보세요'); }
    }

    S.score = Math.max(0, Math.floor(S.elapsed / 10));
    renderTime();

    if (hit) { endGame(); }
  }

  function renderTime() {
    if (!S) { return; }
    if (el.time) {
      var text = fmtSec(S.score);
      if (el.time.textContent !== text) { el.time.textContent = text; }
    }
    if (el.best) {
      var best = fmtSec(S.best);
      if (el.best.textContent !== best) { el.best.textContent = best; }
    }
  }

  function setHint(text) {
    if (!el.hint) { return; }
    el.hint.textContent = text || '';
    window.clearTimeout(hintTimer);
    if (text) {
      hintTimer = window.setTimeout(function () {
        if (el.hint && el.hint.textContent === text) { el.hint.textContent = ''; }
      }, 4200);
    }
  }

  /* ===================================================================
     10. 그리기 — 연못 · 오리 · 탄
     =================================================================== */

  function drawWater(g) {
    var w = S.w, h = S.h;
    var grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#082730');
    grad.addColorStop(0.42, '#0e3c46');
    grad.addColorStop(1, '#15514e');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    /* 잔물결 — 천천히 흐르는 물결 세 줄 */
    var t = S.elapsed / 1000;
    g.save();
    g.strokeStyle = 'rgba(176, 246, 232, .055)';
    g.lineWidth = Math.max(1, S.w * 0.004);
    for (var i = 0; i < 3; i++) {
      g.beginPath();
      for (var x = 0; x <= w; x += 8) {
        var y = h * (0.28 + i * 0.22) + Math.sin((x / w) * 7 + t * (0.6 + i * 0.2) + i) * h * 0.016;
        if (x === 0) { g.moveTo(x, y); } else { g.lineTo(x, y); }
      }
      g.stroke();
    }
    g.restore();

    /* 연잎 몇 장 */
    var pad = S.metrics.size;
    var lotus = [
      { x: 0.16, y: 0.18, r: 0.085, a: 0.5 },
      { x: 0.86, y: 0.13, r: 0.06, a: 0.42 },
      { x: 0.1, y: 0.82, r: 0.07, a: 0.36 },
      { x: 0.9, y: 0.88, r: 0.09, a: 0.44 }
    ];
    lotus.forEach(function (p, idx) {
      var cx = w * p.x + Math.sin(t * 0.5 + idx) * 2;
      var cy = h * p.y + Math.cos(t * 0.42 + idx) * 2;
      var r = pad * p.r;
      g.save();
      g.globalAlpha = p.a;
      g.fillStyle = 'rgba(56, 122, 92, .85)';
      g.beginPath();
      g.ellipse(cx, cy, r * 1.25, r * 0.78, idx * 0.6, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(160, 232, 190, .3)';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
    });

    /* 가장자리 불빛 — 탄이 나오는 쪽이 잠깐 밝아집니다 */
    ['top', 'right', 'bottom', 'left'].forEach(function (k) {
      var v = S.edgeFlash[k];
      if (!(v > 0)) { return; }
      g.save();
      g.globalAlpha = v * 0.42;
      var gx, gy, ww, hh;
      if (k === 'top') { gx = 0; gy = 0; ww = w; hh = h * 0.14; }
      else if (k === 'bottom') { gx = 0; gy = h * 0.86; ww = w; hh = h * 0.14; }
      else if (k === 'left') { gx = 0; gy = 0; ww = w * 0.14; hh = h; }
      else { gx = w * 0.86; gy = 0; ww = w * 0.14; hh = h; }
      var eg = g.createLinearGradient(
        k === 'left' ? gx : (k === 'right' ? w : w / 2),
        k === 'top' ? gy : (k === 'bottom' ? h : h / 2),
        k === 'left' ? gx + ww : (k === 'right' ? w - ww : w / 2),
        k === 'top' ? gy + hh : (k === 'bottom' ? h - hh : h / 2)
      );
      eg.addColorStop(0, 'rgba(150, 255, 226, .8)');
      eg.addColorStop(1, 'rgba(150, 255, 226, 0)');
      g.fillStyle = eg;
      g.fillRect(gx, gy, ww, hh);
      g.restore();
    });
  }

  function drawMarks(g) {
    S.marks.forEach(function (m) {
      var k = 1 - m.age / m.max;
      g.save();
      g.globalAlpha = k * 0.28;
      g.strokeStyle = 'rgba(198, 255, 244, .85)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.arc(m.x, m.y, m.r * (1.6 + (1 - k) * 2.4), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    });
  }

  function drawBullet(g, b) {
    var k = KINDS[b.kind] || KINDS.wisp;
    var r = b.r;
    /* 후광 — 물빛이 밝은 아래쪽에서도 탄이 한눈에 보이게 */
    g.save();
    g.globalAlpha = 0.5;
    var halo = g.createRadialGradient(b.x, b.y, r * 0.3, b.x, b.y, r * 2.6);
    halo.addColorStop(0, k.glow);
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = halo;
    g.beginPath();
    g.arc(b.x, b.y, r * 2.6, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    if (b.kind === 'spark') {
      var ang = Math.atan2(b.vy, b.vx);
      g.translate(b.x, b.y);
      g.rotate(ang);
      g.shadowColor = k.glow;
      g.shadowBlur = r * 2.6;
      /* 꼬리 — 뒤로 갈수록 사라지는 불티 */
      var sg = g.createLinearGradient(-r * 3.4, 0, r * 0.6, 0);
      sg.addColorStop(0, 'rgba(255, 214, 132, 0)');
      sg.addColorStop(0.55, 'rgba(255, 226, 158, .55)');
      sg.addColorStop(1, 'rgba(255, 246, 214, .95)');
      g.fillStyle = sg;
      g.beginPath();
      g.moveTo(-r * 3.4, 0);
      g.lineTo(r * 0.2, -r * 0.62);
      g.lineTo(r * 1.1, 0);
      g.lineTo(r * 0.2, r * 0.62);
      g.closePath();
      g.fill();
      /* 핵 — 아주 밝은 점 */
      g.fillStyle = '#fffdf4';
      g.beginPath();
      g.arc(r * 0.35, 0, r * 0.72, 0, Math.PI * 2);
      g.fill();
      g.restore();
      return;
    }
    if (b.kind === 'orb') {
      var pulse = 1 + Math.sin((b.age / 220)) * 0.06;
      g.shadowColor = k.glow;
      g.shadowBlur = r * 3.4;
      var og = g.createRadialGradient(b.x - r * 0.3, b.y - r * 0.35, r * 0.15, b.x, b.y, r * pulse);
      og.addColorStop(0, '#ffffff');
      og.addColorStop(0.45, '#d9b8ff');
      og.addColorStop(1, 'rgba(120, 78, 200, .95)');
      g.fillStyle = og;
      g.beginPath();
      g.arc(b.x, b.y, r * pulse, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(244, 232, 255, .5)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(b.x, b.y, r * 1.35, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      return;
    }
    /* 도깨비불 — 꼬리를 끄는 푸른 불꽃 */
    var ang2 = Math.atan2(b.vy, b.vx);
    var tail = clamp(1 + b.age / 900, 1, 1.6);
    g.shadowColor = k.glow;
    g.shadowBlur = r * 3.2;
    g.fillStyle = 'rgba(96, 226, 206, .32)';
    g.beginPath();
    g.ellipse(b.x - Math.cos(ang2) * r * 1.5 * tail, b.y - Math.sin(ang2) * r * 1.5 * tail,
              r * 1.9 * tail, r * 0.9, ang2, 0, Math.PI * 2);
    g.fill();
    var fg = g.createRadialGradient(b.x, b.y, r * 0.1, b.x, b.y, r * 1.15);
    fg.addColorStop(0, '#ffffff');
    fg.addColorStop(0.4, '#b8ffe9');
    fg.addColorStop(1, 'rgba(46, 206, 196, .9)');
    g.fillStyle = fg;
    g.beginPath();
    g.arc(b.x, b.y, r * 1.15, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  function drawDuck(g) {
    var d = S.duck, r = S.metrics.duckR;
    var bump = Math.sin(S.elapsed / 220) * r * 0.04;

    /* 물 위 그림자 · 물결 */
    g.save();
    g.globalAlpha = 0.4;
    g.fillStyle = 'rgba(4, 26, 30, .55)';
    g.beginPath();
    g.ellipse(d.x, d.y + r * 0.95, r * 1.15, r * 0.34, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(198, 250, 240, .45)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(d.x, d.y + r * 1.02, r * (1.55 + Math.sin(S.elapsed / 500) * 0.08), r * 0.5, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    g.save();
    g.translate(d.x, d.y + bump);
    g.rotate(d.tilt * 0.16);

    /* 꽁지 */
    g.fillStyle = '#f0c765';
    g.beginPath();
    g.moveTo(-r * 0.95, -r * 0.1);
    g.quadraticCurveTo(-r * 1.5, -r * 0.5, -r * 1.25, r * 0.08);
    g.quadraticCurveTo(-r * 1.4, r * 0.3, -r * 0.95, r * 0.3);
    g.closePath();
    g.fill();

    /* 몸통 · 머리를 한 덩어리로 — 목선이 보이지 않게 먼저 이어 그립니다 */
    var bg = g.createLinearGradient(-r, -r, r, r * 0.8);
    bg.addColorStop(0, '#fffdf2');
    bg.addColorStop(0.55, '#fff3cf');
    bg.addColorStop(1, '#f5d884');
    g.fillStyle = bg;
    g.strokeStyle = 'rgba(190, 138, 46, .5)';
    g.lineWidth = Math.max(1, r * 0.085);
    g.beginPath();
    g.ellipse(0, r * 0.12, r * 1.12, r * 0.82, -0.06, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    /* 목 — 몸과 머리 사이를 메웁니다 */
    g.beginPath();
    g.ellipse(r * 0.46, -r * 0.28, r * 0.42, r * 0.5, -0.5, 0, Math.PI * 2);
    g.fill();

    /* 날개 */
    g.fillStyle = 'rgba(246, 205, 118, .95)';
    g.beginPath();
    g.ellipse(-r * 0.12, r * 0.2, r * 0.62, r * 0.42, -0.2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(196, 146, 52, .4)';
    g.lineWidth = Math.max(0.8, r * 0.06);
    g.stroke();

    /* 발 — 물 위에 살짝 */
    g.fillStyle = '#f08a2c';
    g.globalAlpha = 0.9;
    g.beginPath();
    g.ellipse(-r * 0.28, r * 0.86, r * 0.26, r * 0.12, 0.2, 0, Math.PI * 2);
    g.ellipse(r * 0.34, r * 0.86, r * 0.26, r * 0.12, -0.2, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    /* 머리 */
    g.fillStyle = '#fffdf2';
    g.beginPath();
    g.arc(r * 0.6, -r * 0.56, r * 0.52, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(190, 138, 46, .42)';
    g.lineWidth = Math.max(1, r * 0.075);
    g.stroke();

    /* 부리 */
    g.fillStyle = '#ff9f3d';
    g.strokeStyle = 'rgba(206, 112, 26, .55)';
    g.lineWidth = Math.max(0.8, r * 0.05);
    g.beginPath();
    g.moveTo(r * 1.06, -r * 0.7);
    g.quadraticCurveTo(r * 1.56, -r * 0.58, r * 1.08, -r * 0.36);
    g.quadraticCurveTo(r * 1.04, -r * 0.54, r * 1.06, -r * 0.7);
    g.closePath();
    g.fill();
    g.stroke();

    /* 눈 */
    g.fillStyle = '#2a2015';
    g.beginPath();
    g.arc(r * 0.78, -r * 0.72, Math.max(1.3, r * 0.12), 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, .95)';
    g.beginPath();
    g.arc(r * 0.82, -r * 0.77, Math.max(0.6, r * 0.05), 0, Math.PI * 2);
    g.fill();

    /* 코어(피격 판정) — 아주 옅게만 보이는 점 */
    g.globalAlpha = 0.24;
    g.strokeStyle = 'rgba(255, 255, 255, .8)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(0, -r * 0.18, S.metrics.coreR, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;

    g.restore();

    /* 피격 연출 */
    if (d.hurt > 0) {
      g.save();
      g.globalAlpha = d.hurt * 0.8;
      g.strokeStyle = '#ffe9a8';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(d.x, d.y, r * (1.4 + (1 - d.hurt) * 3), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
  }

  function draw() {
    if (!ctx || !S) { return; }
    var g = ctx;
    g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    g.clearRect(0, 0, S.w, S.h);

    g.save();
    if (S.shake > 0) {
      var s = S.shake * S.w * 0.012;
      g.translate(rnd(-s, s), rnd(-s, s));
    }
    drawWater(g);
    drawMarks(g);
    for (var i = 0; i < S.bullets.length; i++) { drawBullet(g, S.bullets[i]); }
    if (!S.over) { drawDuck(g); }
    g.restore();

    /* 몸풀기 안내 */
    if (S.elapsed < WARMUP_MS && !S.over) {
      g.save();
      g.globalAlpha = 0.9;
      g.fillStyle = 'rgba(232, 255, 250, .82)';
      g.font = '600 ' + Math.round(S.metrics.size * 0.038) + 'px sans-serif';
      g.textAlign = 'center';
      g.fillText('몸 풀기 ' + ((WARMUP_MS - S.elapsed) / 1000).toFixed(1) + '초',
                 S.w / 2, S.h * 0.12);
      g.restore();
    }
  }

  /* ===================================================================
     11. 반복
     =================================================================== */

  function frame(t) {
    if (!opened) { return; }
    raf = window.requestAnimationFrame(frame);
    if (!lastT) { lastT = t; }
    var dt = Math.min(48, Math.max(0, t - lastT));
    lastT = t;
    if (frozen) { return; }
    if (S && !S.over && !S.paused) {
      /* 한 프레임이 크게 밀려도 한 번에 16ms 씩만 — 탄이 순간이동하지 않게 */
      var left = dt;
      while (left > 0) {
        var step = Math.min(16, left);
        update(step);
        left -= step;
        if (S.over) { break; }
      }
    }
    if (S) { S.duck.hurt = Math.max(0, S.duck.hurt - dt / 600); }
    draw();
  }

  function startLoop() {
    stopLoop();
    lastT = 0;
    raf = window.requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (raf) { window.cancelAnimationFrame(raf); }
    raf = 0;
  }
  function pause() { if (S) { S.paused = true; S.drag = null; } }
  function resume() {
    if (!S || S.over) { return; }
    S.paused = false;
    lastT = 0;
    startLoop();
  }

  /* ===================================================================
     12. 결과 · 랭킹
     =================================================================== */

  function currentResultHtml() {
    if (!S) { return ''; }
    if (!opts.live && !guestRank()) {
      return '체험 모드예요 · 이 기기의 최고 기록 <b>' + fmtSec(S.best) + '</b>로 남아요';
    }
    if (S.submitState.failed === 'pending') {
      return '서버에 연못 생존기 랭킹이 아직 준비되지 않았어요 · 이 기기 최고 <b>' +
        fmtSec(S.best) + '</b>로 즐겨 주세요';
    }
    if (S.submitState.failed) {
      return '랭킹에 올리지 못했어요 · 이 기기 최고 <b>' + fmtSec(S.best) + '</b>';
    }
    var res = S.submitState.result;
    if (res && res.rank) {
      return (res.is_new_best ? '🎉 <b>새 최고 기록</b> · ' : '') +
        rankWord() + ' <b>' + res.rank + '위</b> · 최고 ' + fmtSec(res.best_score);
    }
    if (S.submitState.pending) { return rankWord() + '에 올리는 중이에요…'; }
    return '';
  }

  function renderOverResult() {
    var box = $('#sv-over-result');
    if (box) { box.innerHTML = currentResultHtml(); }
  }

  function showOver() {
    if (!el.over) { return; }
    el.over.innerHTML =
      '<div class="gd-over__card">' +
        '<p class="gd-over__kicker">오리가 부딪혔어요</p>' +
        '<h3 class="gd-over__title">연못 생존기 끝!</h3>' +
        '<p class="gd-over__score"><strong>' + (S.score / 100).toFixed(2) + '</strong><span>초</span></p>' +
        '<p class="gd-over__meta">최고 <b>' + fmtSec(S.best) + '</b></p>' +
        '<p class="gd-over__result" id="sv-over-result">' + currentResultHtml() + '</p>' +
        '<div class="gd-over__row">' +
          '<button type="button" class="btn btn--ghost btn--small" id="sv-over-rank">🏆 ' + rankWord() + '</button>' +
          '<button type="button" class="btn btn--primary btn--small" id="sv-over-restart">다시하기</button>' +
        '</div>' +
      '</div>';
    el.over.hidden = false;
    var rank = $('#sv-over-rank', el.over);
    var again = $('#sv-over-restart', el.over);
    if (rank) { rank.addEventListener('click', function () { openSheet('rank'); }); }
    if (again) { again.addEventListener('click', function () { startGame(false); }); }
  }

  function hideOver() {
    if (!el.over) { return; }
    el.over.hidden = true;
    el.over.innerHTML = '';
  }

  function avatarPreset(value) {
    if (typeof value !== 'string' || value.indexOf('preset:') !== 0) { return null; }
    var kind = value.slice(7);
    var allowed = ['lotus', 'koi', 'frog', 'firefly', 'moon', 'leaf', 'turtle', 'lantern', 'duck'];
    return allowed.indexOf(kind) === -1 ? null : kind;
  }
  function avatarImageSrc(value) {
    if (typeof value !== 'string') { return null; }
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) { return value; }
    if (/^https:\/\/[^\s"'<>]+$/.test(value)) { return value; }
    return null;
  }
  function rankAvatarMarkup(name, avatar) {
    if (typeof opts.avatarHtml === 'function') {
      var painted = opts.avatarHtml(String(name || ''), avatar);
      if (painted) { return painted; }
    } else {
      var preset = avatarPreset(avatar);
      var art = window.YM_ART;
      if (preset && art && typeof art.avatar === 'function') {
        return '<span class="gd-rank__avatar avatar--art" aria-hidden="true">' + art.avatar(preset) + '</span>';
      }
      var src = avatarImageSrc(avatar);
      if (src) {
        return '<span class="gd-rank__avatar avatar--art" aria-hidden="true">' +
          '<img class="avatar__img" src="' + escapeHtml(src) + '" alt=""></span>';
      }
    }
    return '<span class="gd-rank__avatar gd-rank__avatar--initial">' +
      escapeHtml(String(name || '?').slice(0, 1)) + '</span>';
  }

  function rankingMarkup() {
    var html = '<div class="gd-sheet__head"><h3>🏆 ' + (guestRank() ? '연못 생존기 체험 랭킹' : '연못 생존기 문파 랭킹') + '</h3>' +
      '<button type="button" class="gd-sheet__close" data-sheet-close="1" aria-label="닫기">×</button></div>';

    if (guestRank()) { return html + guestRankingBody(); }

    if (!opts.live) {
      html += '<div class="gd-rank__empty">체험 모드예요.<br>이 기기의 최고 기록 <b>' + fmtSec(localBest()) +
        '</b>만 남아요. 실제 문파에 들어가면 문파원 모두의 기록이 이곳에 모여요.</div>';
      return html;
    }
    if (ranking.status === 'loading' || ranking.status === 'idle') {
      html += '<div class="gd-rank__empty">문파 기록을 불러오는 중이에요…</div>';
      return html;
    }
    if (ranking.status === 'pending') {
      html += '<div class="gd-rank__empty">서버에 연못 생존기 랭킹이 아직 준비되지 않았어요.<br>' +
        '운영진이 <b>supabase/migration-survival.sql</b> 을 실행하면 문파원 모두의 기록이 모여요.<br>' +
        '그때까지는 이 기기의 최고 기록 <b>' + fmtSec(localBest()) + '</b>으로 게임을 즐길 수 있어요.</div>';
      return html;
    }
    if (ranking.status === 'error') {
      html += '<div class="gd-rank__empty">랭킹을 불러오지 못했어요.<br>' + escapeHtml(ranking.message || '') +
        '<br>이 기기의 최고 기록은 <b>' + fmtSec(localBest()) + '</b>이에요.</div>';
      return html;
    }
    if (!ranking.rows.length) {
      html += '<div class="gd-rank__empty">아직 기록이 없어요 · 첫 기록을 남겨 보세요!</div>';
      return html;
    }

    html += '<ol class="gd-rank">';
    ranking.rows.forEach(function (row) {
      var mine = opts.nickname && row.nickname === opts.nickname;
      html += '<li class="gd-rank__row' + (mine ? ' is-mine' : '') + '">' +
        '<span class="gd-rank__no">' + (row.rank || '-') + '</span>' +
        rankAvatarMarkup(row.nickname, row.avatar) +
        '<span class="gd-rank__who"><b>' + escapeHtml(row.nickname || '') + '</b>' +
        '<span class="gd-rank__role">' + escapeHtml(ROLE_LABEL[row.role] || '문파원') + '</span></span>' +
        '<span class="gd-rank__score">' + fmtSec(row.best_score) + '</span>' +
        '</li>';
    });
    html += '</ol>';
    if (opts.nickname && !ranking.rows.some(function (r) { return r.nickname === opts.nickname; })) {
      html += '<p class="gd-sheet__note">내 기록이 아직 없어요 · 한 판 마치면 랭킹에 올라요</p>';
    }
    return html;
  }

  /* 🔗 게스트 전용 랭킹 — 이 체험 링크로 놀러 온 사람들만. 문파 랭킹과 별개입니다. */
  function guestRankingBody() {
    var html = '<p class="gd-sheet__note gd-sheet__note--guest">체험 링크로 놀러 온 분들만의 랭킹이에요 · <b>연못 문파 랭킹과는 따로</b> 쌓여요</p>';
    if (ranking.status === 'loading' || ranking.status === 'idle') {
      return html + '<div class="gd-rank__empty">체험 랭킹을 불러오는 중이에요…</div>';
    }
    if (ranking.status === 'error') {
      return html + '<div class="gd-rank__empty">체험 랭킹을 불러오지 못했어요.<br>' + escapeHtml(ranking.message || '') + '</div>';
    }
    if (!ranking.rows || !ranking.rows.length) {
      return html + '<div class="gd-rank__empty">아직 올라온 기록이 없어요 · 첫 기록을 남겨 보세요!</div>';
    }
    var me = opts.nickname ? String(opts.nickname).toLowerCase() : '';
    html += '<ol class="gd-rank">';
    ranking.rows.forEach(function (row) {
      var mine = me && String(row.nickname || '').toLowerCase() === me;
      html += '<li class="gd-rank__row' + (mine ? ' is-mine' : '') + '">' +
        '<span class="gd-rank__no">' + (row.rank || '-') + '</span>' +
        '<span class="gd-rank__avatar gd-rank__avatar--initial">' + escapeHtml(String(row.nickname || '?').slice(0, 1)) + '</span>' +
        '<span class="gd-rank__who"><b>' + escapeHtml(row.nickname || '') + '</b>' +
        '<span class="gd-rank__role">체험</span></span>' +
        '<span class="gd-rank__score">' + fmtSec(row.score) + '</span>' +
        '</li>';
    });
    html += '</ol>';
    if (me && !ranking.rows.some(function (r) { return String(r.nickname || '').toLowerCase() === me; })) {
      html += '<p class="gd-sheet__note">내 기록이 아직 없어요 · 한 판 마치면 체험 랭킹에 올라요</p>';
    }
    return html;
  }

  function bindSheetClose() {
    var close = $('[data-sheet-close]', el.sheet);
    if (close) { close.addEventListener('click', closeSheet); }
  }
  function closeSheet() {
    if (!el.sheet) { return; }
    el.sheet.hidden = true;
    el.sheet.innerHTML = '';
    el.sheet.removeAttribute('data-kind');
    if (S && !S.over) { resume(); }
  }
  function openSheet(kind) {
    if (!el.sheet) { return; }
    el.sheet.hidden = false;
    el.sheet.setAttribute('data-kind', kind);
    el.sheet.innerHTML = rankingMarkup();
    bindSheetClose();
    loadRanking();
    pause();
  }
  function openRanking() { openSheet('rank'); }

  function loadRanking() {
    var source = guestRank() ? (typeof opts.listGuestRanking === 'function' ? opts.listGuestRanking : null)
                             : (opts.live && typeof opts.listRanking === 'function' ? opts.listRanking : null);
    if (!source) {
      ranking.status = 'trial';
      return Promise.resolve(null);
    }
    if (ranking.status === 'loading') { return ranking.promise; }
    ranking.status = 'loading';
    if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
      el.sheet.innerHTML = rankingMarkup();
      bindSheetClose();
    }
    ranking.promise = source().then(function (rows) {
      ranking.status = 'ready';
      ranking.rows = Array.isArray(rows) ? rows : [];
      ranking.message = '';
      var mine = null;
      ranking.rows.forEach(function (r) {
        if (opts.nickname && String(r.nickname || '').toLowerCase() === String(opts.nickname).toLowerCase()) { mine = r; }
      });
      var mineScore = mine ? Number(mine.best_score || mine.score || 0) : 0;
      if (mine && mineScore > (S ? S.best : 0)) {
        if (S) { S.best = mineScore; renderTime(); }
      }
      if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
        el.sheet.innerHTML = rankingMarkup();
        bindSheetClose();
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
        bindSheetClose();
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
    window.clearTimeout(restartArmTimer);
    if (withConfirm && !S.over && S.score > 0 && el.restartBtn) {
      if (el.restartBtn.getAttribute('data-armed') !== '1') {
        el.restartBtn.setAttribute('data-armed', '1');
        el.restartBtn.classList.add('is-armed');
        el.restartBtn.textContent = '한 번 더 누르면 새 판';
        setHint('지금까지 ' + fmtSec(S.score) + ' · 버리고 새로 시작하려면 한 번 더 눌러 주세요');
        restartArmTimer = window.setTimeout(function () {
          if (el.restartBtn && el.restartBtn.getAttribute('data-armed') === '1') {
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

  function openGame(options) {
    grabDom();
    if (!el.root || !el.canvas) { return; }
    opts = options || {};
    if (!opened) {
      bindPointer();
      if (el.close) { el.close.addEventListener('click', closeGame); }
      if (el.rankBtn) { el.rankBtn.addEventListener('click', openRanking); }
      if (el.restartBtn) { el.restartBtn.addEventListener('click', function () { restart(true); }); }
      el.sheet.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-sheet-close]')) { closeSheet(); }
      });
      window.addEventListener('resize', function () { if (opened) { resize(); draw(); } });
      if (window.ResizeObserver) {
        var ro = new window.ResizeObserver(function () { if (opened) { resize(); draw(); } });
        if (el.stage) { ro.observe(el.stage); }
      }
      window.addEventListener('keydown', function (e) {
        if (!opened) { return; }
        var key = KEYMAP[e.key];
        if (key) {
          e.preventDefault();
          if (S) { S.keys[key] = true; }
          return;
        }
        if (e.key === 'Escape') {
          if (el.sheet && !el.sheet.hidden) { closeSheet(); return; }
          closeGame();
        }
      });
      window.addEventListener('keyup', function (e) {
        if (!opened) { return; }
        var key = KEYMAP[e.key];
        if (key && S) { S.keys[key] = false; }
      });
      /* 다른 앱을 보는 동안에는 판을 멈추고, 돌아오면 이어서 갑니다 */
      document.addEventListener('visibilitychange', function () {
        if (!opened) { return; }
        if (document.hidden) {
          pause();
        } else if (S && !S.over && (!el.sheet || el.sheet.hidden)) {
          resume();
        }
      });
      opened = true;
    }
    ranking = { status: 'idle', rows: [], message: '' };
    if (el.rankBtn) { el.rankBtn.textContent = '🏆 ' + rankWord(); }
    if (el.root) { el.root.hidden = false; }
    document.body.classList.add('is-locked');
    startGame(true);
    if (opts.live || guestRank()) { loadRanking(); }
    window.setTimeout(function () {
      if (!S) { return; }
      resize();
      draw();
    }, 30);
  }

  function closeGame() {
    if (!opened) { return; }
    window.clearTimeout(restartArmTimer);
    stopLoop();
    closeSheet();
    hideOver();
    if (el.root) { el.root.hidden = true; }
    document.body.classList.remove('is-locked');
    if (S) { S.paused = true; }
    if (opts.onToast && S && S.score > 0) {
      opts.onToast('🦆 연못 생존기 ' + fmtSec(S.score) + ' · 최고 ' + fmtSec(S.best));
    }
  }

  /* ===================================================================
     14. 바깥에 내놓는 것
     =================================================================== */

  window.YM_SURVIVAL = {
    open: openGame,
    close: closeGame,
    isOpen: function () { return !!opened && el.root && !el.root.hidden; },
    localBest: localBest,
    fmtSec: fmtSec,
    /* 테스트용 — 화면에는 나오지 않습니다. */
    _debug: {
      state: function () {
        return S ? {
          time: S.elapsed / 1000, score: S.score, best: S.best, over: S.over,
          paused: S.paused, warmup: S.elapsed < WARMUP_MS,
          bullets: S.bullets.length, tier: S.tier,
          duck: { x: S.duck.x, y: S.duck.y, r: S.duck.r },
          coreR: S.metrics.coreR, size: S.metrics.size
        } : null;
      },
      bullets: function () {
        return S ? S.bullets.map(function (b) {
          return { x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy, kind: b.kind, hitR: b.hitR };
        }) : [];
      },
      metrics: function () {
        return S ? { w: S.w, h: S.h, dpr: S.dpr, duckR: S.metrics.duckR, coreR: S.metrics.coreR } : null;
      },
      difficulty: function () { return difficultyAt(S ? S.elapsed : 0); },
      freeze: function (on) { frozen = !!on; },
      step: function (ms) {
        if (!S) { return; }
        var left = Math.max(0, Number(ms) || 0);
        while (left > 0 && !S.over) {
          var d = Math.min(16, left);
          update(d);
          left -= d;
        }
        draw();
      },
      duck: function (x, y) {
        if (!S) { return false; }
        S.duck.x = clamp(Number(x) || 0, S.duck.r, S.w - S.duck.r);
        S.duck.y = clamp(Number(y) || 0, S.duck.r, S.h - S.duck.r);
        return true;
      },
      spawn: function (x, y, vx, vy, r, kind) {
        if (!S) { return false; }
        addBullet({
          x: Number(x) || 0, y: Number(y) || 0,
          vx: Number(vx) || 0, vy: Number(vy) || 0,
          r: Number(r) || S.metrics.size * 0.017,
          kind: kind || 'wisp',
          hitR: (Number(r) || S.metrics.size * 0.017) * 0.82,
          life: 0, max: 30000
        });
        draw();
        return true;
      },
      spawnRain: function (count) {
        if (!S) { return 0; }
        var n = Math.max(0, Math.min(180, Number(count) || 0));
        for (var i = 0; i < n; i++) {
          var edge = ['top', 'right', 'bottom', 'left'][(Math.random() * 4) | 0];
          spawnFromEdge(edge, { kind: ['wisp', 'orb', 'spark'][(Math.random() * 3) | 0] });
        }
        draw();
        return S.bullets.length;
      },
      setTime: function (sec) {
        if (!S) { return; }
        S.elapsed = Math.max(0, Number(sec) || 0) * 1000;
        S.score = Math.max(0, Math.floor(S.elapsed / 10));
        S.spawnIn = 0;
        renderTime();
        draw();
      },
      end: function () {
        if (!S) { return; }
        S.elapsed = Math.max(S.elapsed, 1);
        endGame();
      },
      setBest: function (cs) {
        if (!S) { return; }
        S.best = Math.max(0, Math.floor(Number(cs) || 0));
        setLocalBest(S.best);
        renderTime();
      },
      setRanking: function (rows, status) {
        ranking.status = status || 'ready';
        ranking.rows = rows || [];
        ranking.message = '';
        if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank') {
          el.sheet.innerHTML = rankingMarkup();
          bindSheetClose();
        }
      },
      rankDemo: function (rows) {
        if (!el.sheet) { return false; }
        ranking.status = 'ready';
        ranking.rows = rows || [];
        ranking.message = '';
        el.sheet.hidden = false;
        el.sheet.setAttribute('data-kind', 'rank');
        el.sheet.innerHTML = rankingMarkup();
        bindSheetClose();
        pause();
        return true;
      },
      submitResult: function () {
        return S ? { pending: S.submitState.pending, failed: S.submitState.failed,
                     result: S.submitState.result } : null;
      }
    }
  };
})();
