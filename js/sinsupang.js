/* 연못 — 🐾 신수팡 (도깨비의 세계)
 *
 *  · 애니팡 방식의 3매치 퍼즐입니다. 7×7 판 · 60초 타임어택.
 *  · 판의 신수는 경단 그림(assets/gyeongdan/tier-*.png) 6종입니다.
 *      백운단(11) · 황요호단(9) · 곰단(7) · 돼지단(6) · 쥐단(3) · 사마귀단(2)
 *    — 백운단부터 거꾸로 내려오며, 색이 겹치는 산군대호단(10)·자서귀단(8)·호랑이단(5)·곰단과 겹치는
 *      뱀단(4)은 뺐습니다. 한눈에 색으로 구분되는 여섯만 씁니다.
 *    (경단 이미지의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제됩니다.)
 *  · 조작은 스와이프(끌기)와 두 번 탭 모두 됩니다. 3매치가 안 되는 이동은 부드럽게 되돌아옵니다.
 *  · 점수 — 3개 100점 · 4개 133점 · 5개 167점에, 연쇄(콤보)마다 배율(1 + 0.5×(콤보-1), 최대 ×4)과
 *    피버(×2)가 곱해집니다. 특수 블록이 함께 터지면 터진 칸마다 30점이 더 붙습니다.
 *  · 특수 블록 — 4개 일렬은 줄 폭탄(가로/세로 한 줄), 5개 일렬은 무지개 경단(같은 신수 전부),
 *    T·L자(가로·세로가 함께 걸친 자리)는 대폭발(주변 3×3).
 *  · 줄 폭탄·대폭발은 같은 신수 세 개가 맞춰져 터질 때(또는 다른 특수 블록의 폭발에 휘말릴 때)만
 *    발동하고, 매치 없이 옆 칸과 자리만 바꾸면 일반 스와이프처럼 제자리로 돌아옵니다.
 *    무지개 경단만 예외로, 이웃한 아무 경단과 바꾸면 바로 터져 그 종류를 판 전체에서 지웁니다.
 *  · 화면 코드는 YM_SINSUPANG.open({ ... }) 만 부르고, 점수 저장 · 랭킹 조회는
 *    넘겨받은 함수(opts.submitScore / opts.listRanking)로 합니다.
 */
(function () {
  'use strict';

  /* ===================================================================
     1. 판 · 신수 · 점수 규칙
     =================================================================== */

  var COLS = 7;
  var ROWS = 7;
  var ROUND_MS = 60000;          // 60초 타임어택
  var FEVER_MS = 8000;           // 피버 지속
  var BEST_KEY = 'ym.sinsupang.best';

  /* 신수 여섯 — 경단 그림의 단계와 이름. color 는 그림 아래 은은한 빛(구분 보조) */
  var TYPES = [
    { tier: 11, name: '백운단',   color: '#dfe9ff', glow: 'rgba(206,224,255,.55)' },
    { tier: 9,  name: '황요호단', color: '#ff9a3c', glow: 'rgba(255,170,90,.55)' },
    { tier: 7,  name: '곰단',     color: '#c98a52', glow: 'rgba(216,158,104,.55)' },
    { tier: 6,  name: '돼지단',   color: '#f08aae', glow: 'rgba(246,152,188,.55)' },
    { tier: 3,  name: '쥐단',     color: '#9ccf4a', glow: 'rgba(186,226,116,.55)' },
    { tier: 2,  name: '사마귀단', color: '#5aa8e6', glow: 'rgba(126,190,244,.55)' }
  ];
  var TYPE_COUNT = TYPES.length;

  var SPRITE_PATH = 'assets/gyeongdan/tier-';
  var CREDIT = '경단 이미지의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제될 수 있습니다.';
  var ROLE_LABEL = { admin: '문주', officer: '운영진', member: '문파원' };
  var SPECIAL_LABEL = { row: '가로 줄', col: '세로 줄', bomb: '대폭발', rainbow: '무지개' };

  var sprites = {};        // sprites[tier] = Image
  var spritesAsked = false;

  function loadSprites() {
    if (spritesAsked) { return; }
    spritesAsked = true;
    TYPES.forEach(function (type) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { if (S && S.running) { draw(); } };
      img.src = SPRITE_PATH + type.tier + '.png';
      sprites[type.tier] = img;
    });
  }

  /* ===================================================================
     2. DOM
     =================================================================== */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var el = {};
  var ctx = null;

  function grabDom() {
    el.root = $('#sinsupang');
    el.panel = $('.sinsupang__panel', el.root);
    el.stage = $('#sinsupang-stage');
    el.canvas = $('#sinsupang-canvas');
    el.score = $('#sp-score');
    el.combo = $('#sp-combo');
    el.best = $('#sp-best');
    el.timerFill = $('#sp-timer-fill');
    el.timerText = $('#sp-timer-text');
    el.timerWrap = $('#sp-timer-wrap');
    el.hint = $('#sp-hint');
    el.over = $('#sinsupang-over');
    el.sheet = $('#sp-sheet');
    el.close = $('#sinsupang-close');
    el.rankBtn = $('#sp-rank-btn');
    el.restartBtn = $('#sp-restart-btn');
    if (el.canvas) { ctx = el.canvas.getContext('2d'); }
  }

  /* ===================================================================
     3. 저장 (이 기기 최고 기록)
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

  var S = null;            // 현재 판
  var opts = {};           // { live, nickname, best, submitScore, listRanking, onToast, avatarHtml }
  var ranking = { status: 'idle', rows: [], message: '' };
  var opened = false;
  var running = false;
  var raf = 0;
  var lastT = 0;
  var frozen = false;      /* 테스트용 — 화면을 한 순간에 멈춰 놓고 찍을 때 */
  var restartArmTimer = 0;

  function nowMs() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }
  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  function fmtNum(n) {
    var v = Math.round(Number(n) || 0);
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function escapeHtml(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function key(r, c) { return r + ',' + c; }
  function parseKey(k) { var p = k.split(','); return { r: Number(p[0]), c: Number(p[1]) }; }
  function randType() { return (Math.random() * TYPE_COUNT) | 0; }

  function makeCell(t, sp) {
    return { t: t, sp: sp || '', x: 0, y: 0, sc: 1, fresh: false };
  }

  function newState() {
    return {
      board: null,
      score: 0,
      best: Math.max(localBest(), opts.best || 0),
      chain: 0,
      maxCombo: 0,
      feverGauge: 0,
      feverUntil: 0,
      clock: 0,
      timeLeft: ROUND_MS,
      timeBonus: 0,          // 콤보로 늘어난 시간(ms) 합 — 화면에는 "+1초"로만 보입니다
      lastCount: 99,
      over: false,
      phase: 'idle',        // idle · swap · fall · over
      selected: null,       // {r,c}
      drag: null,
      queue: [],
      fx: [],
      hold: 0,              // 이 시간이 지난 뒤에야 다음 차례(낙하)로 — 특수 블록 연출을 보여 주려고
      made: [],             // 이번 판에서 만들어 낸 특수 블록 기록(테스트·확인용)
      hintPair: null,
      hintUntil: 0,
      lastInput: 0,
      paused: false,
      metrics: { cell: 40, x0: 0, y0: 0, size: 300 },
      dpr: 1,
      w: 300,
      h: 300,
      submitState: { pending: false, result: null, failed: '' }
    };
  }

  /* ===================================================================
     5. 판 만들기 — 처음부터 3매치가 없고, 항상 둘 수 있는 수가 하나 이상
     =================================================================== */

  function typeGrid(board) {
    return board.map(function (row) {
      return row.map(function (c) { return c ? c.t : -1; });
    });
  }

  function matchAtGrid(g, r, c) {
    var t = g[r][c];
    if (t < 0) { return false; }
    var n = 1, i;
    for (i = c - 1; i >= 0 && g[r][i] === t; i--) { n += 1; }
    for (i = c + 1; i < COLS && g[r][i] === t; i++) { n += 1; }
    if (n >= 3) { return true; }
    n = 1;
    for (i = r - 1; i >= 0 && g[i][c] === t; i--) { n += 1; }
    for (i = r + 1; i < ROWS && g[i][c] === t; i++) { n += 1; }
    return n >= 3;
  }

  /**
   * 그 자리를 바꾸면 둘 수 있는 수가 되는지.
   * 무지개 경단은 이웃한 아무 경단과 바꿔도 발동하므로 그 자체로 유효한 수이고,
   * 줄 폭탄·대폭발은 매치 없이 옮겨도 발동하지 않으므로 3매치가 생겨야만 유효한 수입니다.
   */
  function swapIsMove(b, r1, c1, r2, c2) {
    var a = b[r1] && b[r1][c1];
    var d = b[r2] && b[r2][c2];
    if (!a || !d) { return false; }
    if (a.sp === 'rainbow' || d.sp === 'rainbow') { return true; }
    var g = typeGrid(b);
    var tmp = g[r1][c1]; g[r1][c1] = g[r2][c2]; g[r2][c2] = tmp;
    return matchAtGrid(g, r1, c1) || matchAtGrid(g, r2, c2);
  }

  function findMove(board) {
    var b = board || (S && S.board);
    if (!b) { return null; }
    var r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (c + 1 < COLS && swapIsMove(b, r, c, r, c + 1)) { return [r, c, r, c + 1]; }
        if (r + 1 < ROWS && swapIsMove(b, r, c, r + 1, c)) { return [r, c, r + 1, c]; }
      }
    }
    return null;
  }

  function buildBoard() {
    var b = null;
    for (var attempt = 0; attempt < 60; attempt++) {
      b = [];
      for (var r = 0; r < ROWS; r++) {
        b.push([]);
        for (var c = 0; c < COLS; c++) {
          var banned = {};
          if (c >= 2 && b[r][c - 1] && b[r][c - 2] && b[r][c - 1].t === b[r][c - 2].t) {
            banned[b[r][c - 1].t] = true;
          }
          if (r >= 2 && b[r - 1][c] && b[r - 2][c] && b[r - 1][c].t === b[r - 2][c].t) {
            banned[b[r - 1][c].t] = true;
          }
          var pool = [];
          for (var t = 0; t < TYPE_COUNT; t++) { if (!banned[t]) { pool.push(t); } }
          b[r][c] = makeCell(pool[(Math.random() * pool.length) | 0]);
        }
      }
      if (findMove(b)) { return b; }
    }
    return b;
  }

  /** 판을 새로 섞습니다 — 3매치가 없고 둘 수 있는 수가 생길 때까지 */
  function shuffleBoard() {
    if (!S) { return; }
    var flat = [];
    var r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        if (S.board[r][c]) { flat.push(S.board[r][c].t); }
      }
    }
    for (var attempt = 0; attempt < 80; attempt++) {
      for (var i = flat.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var tmp = flat[i]; flat[i] = flat[j]; flat[j] = tmp;
      }
      var k = 0;
      for (r = 0; r < ROWS; r++) {
        for (c = 0; c < COLS; c++) {
          S.board[r][c] = makeCell(flat[k++], '');
          S.board[r][c].sc = 0.82;
        }
      }
      if (!collectRuns().length && findMove()) { return; }
    }
  }

  /* ===================================================================
     6. 매치 찾기 · 특수 블록
     =================================================================== */

  function collectRuns() {
    var runs = [], r, c;
    for (r = 0; r < ROWS; r++) {
      c = 0;
      while (c < COLS) {
        var t = S.board[r][c] ? S.board[r][c].t : -1;
        if (t < 0) { c += 1; continue; }
        var e = c + 1;
        while (e < COLS && S.board[r][e] && S.board[r][e].t === t) { e += 1; }
        if (e - c >= 3) { runs.push({ dir: 'h', r: r, c: c, len: e - c, t: t }); }
        c = e;
      }
    }
    for (c = 0; c < COLS; c++) {
      r = 0;
      while (r < ROWS) {
        var t2 = S.board[r][c] ? S.board[r][c].t : -1;
        if (t2 < 0) { r += 1; continue; }
        var e2 = r + 1;
        while (e2 < ROWS && S.board[e2][c] && S.board[e2][c].t === t2) { e2 += 1; }
        if (e2 - r >= 3) { runs.push({ dir: 'v', r: r, c: c, len: e2 - r, t: t2 }); }
        r = e2;
      }
    }
    return runs;
  }

  function cellsOfRun(run) {
    var out = [], i;
    if (run.dir === 'h') {
      for (i = 0; i < run.len; i++) { out.push(key(run.r, run.c + i)); }
    } else {
      for (i = 0; i < run.len; i++) { out.push(key(run.r + i, run.c)); }
    }
    return out;
  }

  /** 줄(run)들을 하나의 덩어리(group)로 묶습니다 — T·L자도 한 덩어리 */
  function findGroups() {
    var runs = collectRuns();
    if (!runs.length) { return []; }
    var parent = runs.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) { parent[b] = a; } }

    var owner = {};
    runs.forEach(function (run, i) {
      cellsOfRun(run).forEach(function (k) {
        if (owner[k] !== undefined) { uni(i, owner[k]); } else { owner[k] = i; }
      });
    });

    var byRoot = {};
    runs.forEach(function (run, i) {
      var root = find(i);
      (byRoot[root] = byRoot[root] || []).push(run);
    });

    return Object.keys(byRoot).map(function (root) {
      var group = byRoot[root];
      var cellMap = {};
      group.forEach(function (run) { cellsOfRun(run).forEach(function (k) { cellMap[k] = true; }); });
      return { t: group[0].t, runs: group, cells: Object.keys(cellMap) };
    });
  }

  function specialFor(group) {
    var maxLen = 0;
    var hasH = false, hasV = false, longH = false, longV = false;
    group.runs.forEach(function (run) {
      if (run.len > maxLen) { maxLen = run.len; }
      if (run.dir === 'h') { hasH = true; if (run.len >= 4) { longH = true; } }
      if (run.dir === 'v') { hasV = true; if (run.len >= 4) { longV = true; } }
    });
    if (hasH && hasV) { return 'bomb'; }               // T · L 자
    if (maxLen >= 5) { return 'rainbow'; }             // 다섯 개 일렬
    if (longH) { return 'row'; }                       // 네 개 가로
    if (longV) { return 'col'; }                       // 네 개 세로
    return '';
  }

  /** 특수 블록을 놓을 자리 — 방금 옮긴 칸이 이 덩어리에 있으면 그 칸, 없으면 가장 긴 줄 가운데 */
  function pickSpawnKey(group) {
    if (S.swapKeys) {
      for (var i = 0; i < S.swapKeys.length; i++) {
        if (group.cells.indexOf(S.swapKeys[i]) !== -1) { return S.swapKeys[i]; }
      }
    }
    var best = group.runs[0];
    group.runs.forEach(function (run) { if (run.len > best.len) { best = run; } });
    if (best.dir === 'h') { return key(best.r, best.c + ((best.len - 1) >> 1)); }
    return key(best.r + ((best.len - 1) >> 1), best.c);
  }

  /* 특수 블록이 터진 자리 — expandClears 가 기록해 두면 부르는 쪽이 눈에 보이는 효과로 바꿉니다 */
  var pendingSpecialFx = [];

  /**
   * 터뜨릴 칸을 모읍니다. 안에 특수 블록이 있으면 그 효과까지 이어서 펼칩니다.
   * fallbackType 은 무지개 경단이 지울 신수의 종류입니다(없으면 자기 종류).
   */
  function expandClears(initial, fallbackType) {
    var clear = {};
    var queue = [];
    initial.forEach(function (k) {
      if (!clear[k]) { clear[k] = true; queue.push(k); }
    });
    while (queue.length) {
      var k = queue.shift();
      var p = parseKey(k);
      var cl = S.board[p.r] && S.board[p.r][p.c];
      if (!cl || !cl.sp) { continue; }
      var add = [];
      var i, rr, cc;
      if (cl.sp === 'row') {
        for (i = 0; i < COLS; i++) { add.push([p.r, i]); }
        pendingSpecialFx.push({ kind: 'beam', dir: 'row', r: p.r, c: p.c });
      } else if (cl.sp === 'col') {
        for (i = 0; i < ROWS; i++) { add.push([i, p.c]); }
        pendingSpecialFx.push({ kind: 'beam', dir: 'col', r: p.r, c: p.c });
      } else if (cl.sp === 'bomb') {
        for (var dr = -1; dr <= 1; dr++) {
          for (var dc = -1; dc <= 1; dc++) {
            rr = p.r + dr; cc = p.c + dc;
            if (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) { add.push([rr, cc]); }
          }
        }
        pendingSpecialFx.push({ kind: 'blast', r: p.r, c: p.c });
      } else if (cl.sp === 'rainbow') {
        var t = (fallbackType === null || fallbackType === undefined) ? cl.t : fallbackType;
        var targets = [];
        for (rr = 0; rr < ROWS; rr++) {
          for (cc = 0; cc < COLS; cc++) {
            if (S.board[rr][cc] && S.board[rr][cc].t === t) {
              add.push([rr, cc]);
              targets.push([rr, cc]);
            }
          }
        }
        pendingSpecialFx.push({ kind: 'rainbow', r: p.r, c: p.c, cells: targets, seed: p.r * 31 + p.c * 17 });
      }
      add.forEach(function (pos) {
        var kk = key(pos[0], pos[1]);
        if (!clear[kk] && S.board[pos[0]][pos[1]]) { clear[kk] = true; queue.push(kk); }
      });
    }
    return clear;
  }

  /* 기록해 둔 특수 블록을 화면 효과로 올립니다 — 터졌다는 걸 한눈에 알아보게 */
  function flushSpecialFx() {
    if (!pendingSpecialFx.length) { return false; }
    pendingSpecialFx.forEach(function (f) {
      f.age = 0;
      f.max = f.kind === 'beam' ? 430 : (f.kind === 'blast' ? 460 : 460);
      S.fx.push(f);
    });
    pendingSpecialFx.length = 0;
    if (S.fx.length > 90) { S.fx.splice(0, S.fx.length - 90); }
    return true;
  }

  /* 효과를 보여 주는 동안 낙하를 잠깐 멈춥니다 */
  function holdFor(ms) {
    if (!S) { return; }
    S.hold = Math.max(S.hold || 0, ms);
  }


  /* ===================================================================
     7. 점수 · 콤보 · 피버
     =================================================================== */

  function comboMultiplier(chain) {
    return Math.min(4, 1 + 0.5 * Math.max(0, chain - 1));
  }
  function feverActive() {
    return !!S && S.clock < S.feverUntil;
  }

  /* 콤보로 시간이 늘어납니다 — 2연쇄부터 1초씩, 최대 60초 */
  function addTime(ms) {
    if (!S || S.over || !(ms > 0)) { return 0; }
    var before = S.timeLeft;
    S.timeLeft = Math.min(ROUND_MS, S.timeLeft + ms);   /* 60초를 넘지 않습니다 */
    var gained = Math.round(S.timeLeft - before);
    if (gained > 0) {
      S.timeBonus += gained;
      pushFx({
        kind: 'time', text: '+' + (gained % 1000 === 0 ? (gained / 1000) : (gained / 1000).toFixed(1)) + '초',
        age: 0, max: 820
      });
    }
    return gained;
  }

  function addFever(point) {
    if (!S || feverActive()) { return; }
    S.feverGauge += (point || 1);
    if (S.feverGauge >= 6) {
      S.feverGauge = 0;
      S.feverUntil = S.clock + FEVER_MS;
      pushFx({ kind: 'fever', text: 'FEVER!', age: 0, max: 1400 });
      if (el.hint) { setHint('🔥 피버 타임! 8초 동안 점수가 두 배예요'); }
    }
  }

  function pushFx(fx) {
    if (!S) { return; }
    S.fx.push(fx);
    if (S.fx.length > 90) { S.fx.shift(); }
  }

  function burst(r, c, t) {
    var m = S.metrics;
    var cx = m.x0 + c * m.cell + m.cell / 2;
    var cy = m.y0 + r * m.cell + m.cell / 2;
    var color = TYPES[t] ? TYPES[t].color : '#f0d9a5';
    for (var i = 0; i < 5; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 0.05 + Math.random() * 0.11;
      pushFx({
        kind: 'particle', x: cx, y: cy,
        vx: Math.cos(a) * sp * 1000, vy: Math.sin(a) * sp * 1000 - 90,
        size: 2 + Math.random() * 3.4, color: color,
        age: 0, max: 380 + Math.random() * 260
      });
    }
  }

  /* ===================================================================
     8. 터뜨리기 · 떨어지기 · 채우기
     =================================================================== */

  function renderScore() {
    if (el.score) { el.score.textContent = fmtNum(S.score); }
    if (el.combo) { el.combo.textContent = S.maxCombo > 0 ? (S.maxCombo + 'x') : '0'; }
    if (el.best) { el.best.textContent = fmtNum(S.best); }
  }

  function applyGravity() {
    var m = S.metrics;
    for (var c = 0; c < COLS; c++) {
      var write = ROWS - 1;
      for (var r = ROWS - 1; r >= 0; r--) {
        var cl = S.board[r][c];
        if (!cl) { continue; }
        if (write !== r) {
          S.board[write][c] = cl;
          S.board[r][c] = null;
          /* 목표 칸(write)보다 위쪽에서 출발해 아래로 떨어지도록 — 음수 = 화면 위 */
          cl.y -= (write - r) * m.cell;
        }
        write -= 1;
      }
      for (var w = write; w >= 0; w--) {
        var fresh = makeCell(randType());
        /* 새 경단은 모두 보드 위쪽 바깥에 줄을 서고, 위에서 아래로 떨어져 쌓입니다 */
        fresh.y = -(write + 1) * m.cell;
        fresh.fresh = true;
        S.board[w][c] = fresh;
      }
    }
  }

  /** 매치 한 단계 — 찾고 · 터뜨리고 · 점수를 매기고 · 채웁니다. 연쇄가 끝나면 afterCascade */
  function resolveStep() {
    if (!S || S.over) { return; }
    var groups = findGroups();
    if (!groups.length) { afterCascade(); return; }

    S.chain += 1;
    var base = 0;
    var spawns = [];
    var clear = {};
    var groupCells = {};

    groups.forEach(function (g) {
      base += Math.round(100 * g.cells.length / 3);
      var sp = specialFor(g);
      var spawnKey = sp ? pickSpawnKey(g) : null;
      g.cells.forEach(function (k) { groupCells[k] = true; });
      var set = expandClears(g.cells, g.t);
      Object.keys(set).forEach(function (k) {
        if (k !== spawnKey) { clear[k] = true; }
      });
      if (sp && spawnKey) { spawns.push({ key: spawnKey, sp: sp, t: g.t }); }
    });

    var total = Object.keys(clear).length;
    var extra = Math.max(0, total - Object.keys(groupCells).length);
    var mult = comboMultiplier(S.chain) * (feverActive() ? 2 : 1);
    var points = Math.round((base + extra * 30) * mult);

    S.score += points;
    if (S.chain > S.maxCombo) { S.maxCombo = S.chain; }
    renderScore();

    /* 터지는 자리의 가운데에 점수, 연쇄가 이어지면 콤보 글씨 */
    var sumX = 0, sumY = 0, cnt = 0;
    Object.keys(clear).forEach(function (k) {
      var p = parseKey(k);
      var cl = S.board[p.r][p.c];
      if (cl) { burst(p.r, p.c, cl.t); }
      var m = S.metrics;
      sumX += m.x0 + p.c * m.cell + m.cell / 2;
      sumY += m.y0 + p.r * m.cell + m.cell / 2;
      cnt += 1;
      S.board[p.r][p.c] = null;
    });
    if (cnt) {
      pushFx({
        kind: 'gain', text: '+' + fmtNum(points),
        x: sumX / cnt, y: sumY / cnt,
        age: 0, max: 720
      });
    }
    if (S.chain >= 2) {
      pushFx({ kind: 'combo', text: S.chain + ' COMBO!', age: 0, max: 900 });
      addFever(1);
      /* 연쇄가 이어질 때마다 1초 — 2연쇄 +1초, 3연쇄까지면 누적 +2초 */
      addTime(1000);
    } else if (cnt >= 6) {
      addFever(1);
    }

    spawns.forEach(function (s) {
      var p = parseKey(s.key);
      if (!S.board[p.r]) { return; }
      var cl = S.board[p.r][p.c];
      if (!cl) {
        cl = makeCell(s.t, s.sp);
        S.board[p.r][p.c] = cl;
      } else {
        /* 터지지 않고 남은 칸이면 그 신수가 그대로 특수 블록이 됩니다 */
        cl.sp = s.sp;
        cl.t = s.t;
      }
      cl.sc = 0.4;
      if (S.made.length < 60) { S.made.push({ sp: s.sp, r: p.r, c: p.c }); }
    });

    /* 특수 블록이 터졌다면 빛줄기·폭발 연출을 먼저 보여 주고 낙하는 조금 뒤에 */
    S.phase = 'fall';
    if (flushSpecialFx()) {
      holdFor(220);
      S.queue.push(function () {
        applyGravity();
        S.queue.push(function () { resolveStep(); });
      });
    } else {
      applyGravity();
      S.queue.push(function () { resolveStep(); });
    }
  }

  function afterCascade() {
    S.phase = 'idle';
    S.chain = 0;
    S.swapKeys = null;
    S.lastInput = S.clock;
    if (!findMove()) {
      shuffleBoard();
      setHint('둘 수 있는 수가 없어 신수들을 새로 섞었어요');
    }
    renderScore();
  }

  /* 이동 · 되돌리기 */

  function swapCells(r1, c1, r2, c2) {
    var a = S.board[r1][c1];
    S.board[r1][c1] = S.board[r2][c2];
    S.board[r2][c2] = a;
  }

  function trySwap(r1, c1, r2, c2) {
    if (!S || S.over) { return false; }
    if (S.phase !== 'idle') { return false; }
    if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) { return false; }
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) { return false; }
    var a = S.board[r1][c1];
    var b = S.board[r2][c2];
    if (!a || !b) { return false; }

    var m = S.metrics;
    S.phase = 'swap';
    S.selected = null;
    S.hintPair = null;
    S.hintUntil = 0;
    S.lastInput = S.clock;
    S.swapKeys = [key(r1, c1), key(r2, c2)];

    swapCells(r1, c1, r2, c2);
    /* 새 자리에서 출발하도록 반대쪽에서 미끄러져 들어옵니다 */
    S.board[r2][c2].x = (c1 - c2) * m.cell;
    S.board[r2][c2].y = (r1 - r2) * m.cell;
    S.board[r1][c1].x = (c2 - c1) * m.cell;
    S.board[r1][c1].y = (r2 - r1) * m.cell;

    S.queue.push(function () {
      if (!S || S.over) { return; }
      var groups = findGroups();
      /* 줄 폭탄·대폭발은 매치에 들어가야만 터지고, 무지개 경단만 옮기면 바로 터집니다 */
      var rainbowSwap = (S.board[r1][c1].sp === 'rainbow') || (S.board[r2][c2].sp === 'rainbow');
      if (!groups.length && !rainbowSwap) {
        /* 3매치가 안 되면 부드럽게 제자리로 — 살짝 흔들고 안내 */
        S.phase = 'swap';
        S.board[r1][c1].x = (c2 - c1) * m.cell;
        S.board[r1][c1].y = (r2 - r1) * m.cell;
        S.board[r2][c2].x = (c1 - c2) * m.cell;
        S.board[r2][c2].y = (r1 - r2) * m.cell;
        swapCells(r1, c1, r2, c2);
        setHint('그 자리로는 세 개가 맞지 않아요 · 다른 자리를 골라 주세요');
        S.queue.push(function () {
          S.phase = 'idle';
          S.swapKeys = null;
          S.lastInput = S.clock;
        });
        return;
      }
      S.chain = 0;
      if (groups.length) {
        resolveStep();
      } else {
        activateSpecials([key(r1, c1), key(r2, c2)], r1, c1, r2, c2);
      }
    });
    return true;
  }

  /** 무지개 경단을 매치 없이 옮겼을 때 — 바꾼 상대 경단과 같은 종류를 판 전체에서 터뜨립니다 */
  function activateSpecials(keys, r1, c1, r2, c2) {
    var fallback = null;
    keys.forEach(function (k) {
      var p = parseKey(k);
      var cl = S.board[p.r][p.c];
      if (cl && cl.sp === 'rainbow') {
        var other = (k === keys[0]) ? S.board[r2][c2] : S.board[r1][c1];
        if (other && other.sp !== 'rainbow') { fallback = other.t; }
      }
    });
    var set = expandClears(keys, fallback);
    var total = Object.keys(set).length;
    if (!total) { S.phase = 'idle'; S.swapKeys = null; return; }

    var mult = comboMultiplier(1) * (feverActive() ? 2 : 1);
    var points = Math.round(total * 40 * mult);
    S.score += points;
    renderScore();
    Object.keys(set).forEach(function (k) {
      var p = parseKey(k);
      var cl = S.board[p.r][p.c];
      if (cl) { burst(p.r, p.c, cl.t); }
      S.board[p.r][p.c] = null;
    });
    var m = S.metrics;
    pushFx({
      kind: 'gain', text: '+' + fmtNum(points),
      x: m.x0 + c2 * m.cell + m.cell / 2,
      y: m.y0 + r2 * m.cell + m.cell / 2,
      age: 0, max: 720
    });
    S.chain = 1;
    S.phase = 'fall';
    if (flushSpecialFx()) {
      holdFor(220);
      S.queue.push(function () {
        applyGravity();
        S.queue.push(function () {
          S.chain = 0;
          resolveStep();
        });
      });
    } else {
      applyGravity();
      S.queue.push(function () {
        S.chain = 0;
        resolveStep();
      });
    }
  }

  /* ===================================================================
     9. 입력 — 스와이프 · 두 번 탭
     =================================================================== */

  function cellFromPoint(px, py) {
    var m = S.metrics;
    var c = Math.floor((px - m.x0) / m.cell);
    var r = Math.floor((py - m.y0) / m.cell);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) { return null; }
    return { r: r, c: c };
  }

  function pointOf(ev) {
    var rect = el.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function onPointerDown(ev) {
    if (!S || S.over || S.paused) { return; }
    if (el.sheet && !el.sheet.hidden) { return; }
    if (S.phase !== 'idle') { return; }
    var p = pointOf(ev);
    var cell = cellFromPoint(p.x, p.y);
    if (!cell) { return; }
    ev.preventDefault();
    S.drag = { r: cell.r, c: cell.c, x: p.x, y: p.y, moved: false };
    S.lastInput = S.clock;
    S.hintPair = null;
    S.hintUntil = 0;
    if (S.selected && S.selected.r === cell.r && S.selected.c === cell.c) {
      S.selected = null;
      return;
    }
    if (S.selected && (Math.abs(S.selected.r - cell.r) + Math.abs(S.selected.c - cell.c) === 1)) {
      var from = S.selected;
      S.selected = null;
      trySwap(from.r, from.c, cell.r, cell.c);
      S.drag = null;
      return;
    }
    S.selected = { r: cell.r, c: cell.c };
  }

  function onPointerMove(ev) {
    if (!S || !S.drag || S.over) { return; }
    var p = pointOf(ev);
    var m = S.metrics;
    var dx = p.x - S.drag.x;
    var dy = p.y - S.drag.y;
    var limit = m.cell * 0.34;
    if (Math.abs(dx) < limit && Math.abs(dy) < limit) { return; }
    ev.preventDefault();
    S.drag.moved = true;
    var r2 = S.drag.r;
    var c2 = S.drag.c;
    if (Math.abs(dx) > Math.abs(dy)) {
      c2 += dx > 0 ? 1 : -1;
    } else {
      r2 += dy > 0 ? 1 : -1;
    }
    trySwap(S.drag.r, S.drag.c, r2, c2);
    S.drag = null;
  }

  function onPointerUp() {
    if (!S) { return; }
    S.drag = null;
  }

  function bindPointer() {
    if (!el.canvas) { return; }
    el.canvas.addEventListener('pointerdown', onPointerDown);
    el.canvas.addEventListener('pointermove', onPointerMove);
    el.canvas.addEventListener('pointerup', onPointerUp);
    el.canvas.addEventListener('pointercancel', onPointerUp);
    el.canvas.addEventListener('pointerleave', onPointerUp);
    el.canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ===================================================================
     10. 그리기
     =================================================================== */

  function roundRect(g, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y);
    g.quadraticCurveTo(x + w, y, x + w, y + rr);
    g.lineTo(x + w, y + h - rr);
    g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    g.lineTo(x + rr, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - rr);
    g.lineTo(x, y + rr);
    g.quadraticCurveTo(x, y, x + rr, y);
    g.closePath();
  }

  function tileCenter(r, c) {
    var m = S.metrics;
    var cl = S.board[r][c];
    var ox = cl ? cl.x : 0;
    var oy = cl ? cl.y : 0;
    return {
      x: m.x0 + c * m.cell + m.cell / 2 + ox,
      y: m.y0 + r * m.cell + m.cell / 2 + oy
    };
  }

  function drawSprite(t, cx, cy, size, alpha) {
    var img = sprites[TYPES[t].tier];
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    if (img && img.naturalWidth) {
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    } else {
      /* 그림을 못 받았을 때 — 색 원과 이름 첫 글자 */
      ctx.beginPath();
      ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = TYPES[t].color;
      ctx.fill();
      ctx.fillStyle = '#3a2518';
      ctx.font = '700 ' + Math.round(size * 0.34) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(TYPES[t].name.slice(0, 1), cx, cy + 1);
    }
    ctx.globalAlpha = 1;
  }

  /* 특수 블록 표시 — 어떤 그림 위에서도 보이도록 어두운 테두리를 먼저 깔고 밝은 표시를 얹습니다 */
  function drawSpecialMark(cl, cx, cy, size) {
    var half = size * 0.44;
    var w = Math.max(2.6, size * 0.085);
    ctx.save();
    ctx.lineCap = 'round';

    function strokeDark(path) {
      ctx.save();
      ctx.strokeStyle = 'rgba(24, 12, 6, .78)';
      ctx.lineWidth = w + 3.2;
      path();
      ctx.stroke();
      ctx.restore();
    }
    function strokeBright(color, glow) {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.shadowColor = glow;
      ctx.shadowBlur = Math.round(size * 0.34);
      ctx.stroke();
      ctx.restore();
    }

    if (cl.sp === 'row' || cl.sp === 'col') {
      var horiz = cl.sp === 'row';
      var drawLine = function () {
        ctx.beginPath();
        if (horiz) { ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy); }
        else { ctx.moveTo(cx, cy - half); ctx.lineTo(cx, cy + half); }
      };
      var drawHeads = function () {
        ctx.beginPath();
        var hx = horiz ? half : 0;
        var hy = horiz ? 0 : half;
        var bx = horiz ? -half : 0;
        var by = horiz ? 0 : -half;
        var tip = size * 0.17;
        var back = size * 0.12;
        if (horiz) {
          ctx.moveTo(cx + hx, cy); ctx.lineTo(cx + hx - tip, cy - back);
          ctx.moveTo(cx + hx, cy); ctx.lineTo(cx + hx - tip, cy + back);
          ctx.moveTo(cx + bx, cy); ctx.lineTo(cx + bx + tip, cy - back);
          ctx.moveTo(cx + bx, cy); ctx.lineTo(cx + bx + tip, cy + back);
        } else {
          ctx.moveTo(cx, cy + hy); ctx.lineTo(cx - back, cy + hy - tip);
          ctx.moveTo(cx, cy + hy); ctx.lineTo(cx + back, cy + hy - tip);
          ctx.moveTo(cx, cy + by); ctx.lineTo(cx - back, cy + by + tip);
          ctx.moveTo(cx, cy + by); ctx.lineTo(cx + back, cy + by + tip);
        }
      };
      strokeDark(drawLine);
      strokeBright('rgba(255,246,206,.98)', 'rgba(255,206,110,.95)');
      strokeDark(drawHeads);
      strokeBright('rgba(255,246,206,.98)', 'rgba(255,206,110,.95)');
    } else if (cl.sp === 'bomb') {
      var drawBomb = function () {
        ctx.beginPath();
        ctx.arc(cx, cy, half * 0.9, 0, Math.PI * 2);
        for (var i = 0; i < 8; i++) {
          var a = (Math.PI * 2 / 8) * i;
          ctx.moveTo(cx + Math.cos(a) * half * 0.95, cy + Math.sin(a) * half * 0.95);
          ctx.lineTo(cx + Math.cos(a) * half * 1.16, cy + Math.sin(a) * half * 1.16);
        }
      };
      strokeDark(drawBomb);
      strokeBright('rgba(255,168,110,.98)', 'rgba(255,120,60,.95)');
    } else if (cl.sp === 'rainbow') {
      var drawRing = function () {
        ctx.beginPath();
        ctx.arc(cx, cy, half * 0.94, 0, Math.PI * 2);
      };
      strokeDark(drawRing);
      var grad = ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half);
      grad.addColorStop(0, 'rgba(255,120,150,.98)');
      grad.addColorStop(0.35, 'rgba(255,214,120,.98)');
      grad.addColorStop(0.7, 'rgba(140,235,165,.98)');
      grad.addColorStop(1, 'rgba(130,190,255,.98)');
      strokeBright(grad, 'rgba(255,220,150,.9)');
    }
    ctx.restore();
  }

  /* ---- 특수 블록 발동 연출 — "아이템이 터졌다"를 한눈에 ---- */

  /* 가로/세로 줄 폭탄 : 판을 가로지르는 밝은 빛줄기 + 반짝임 */
  function fxBeam(f, k, m) {
    var cx = m.x0 + f.c * m.cell + m.cell / 2;
    var cy = m.y0 + f.r * m.cell + m.cell / 2;
    var grow = Math.min(1, k / 0.16);                       /* 성는데 빠르게 */
    var fade = k < 0.5 ? 1 : Math.max(0, 1 - (k - 0.5) / 0.5);
    var a = fade * (0.55 + 0.45 * grow);
    var x0 = m.x0, x1 = m.x0 + COLS * m.cell;
    var y0 = m.y0, y1 = m.y0 + ROWS * m.cell;
    var thick = m.cell * (0.5 + 0.24 * Math.sin(Math.min(1, k / 0.45) * Math.PI));
    var l, r, t, b;
    if (f.dir === 'row') {
      l = cx - (cx - x0) * grow; r = cx + (x1 - cx) * grow;
      t = cy - thick / 2; b = cy + thick / 2;
    } else {
      t = cy - (cy - y0) * grow; b = cy + (y1 - cy) * grow;
      l = cx - thick / 2; r = cx + thick / 2;
    }
    var grad = f.dir === 'row'
      ? ctx.createLinearGradient(l, cy, r, cy)
      : ctx.createLinearGradient(cx, t, cx, b);
    grad.addColorStop(0, 'rgba(255,186,86,0)');
    grad.addColorStop(0.16, 'rgba(255,206,110,' + (a * 0.85).toFixed(3) + ')');
    grad.addColorStop(0.5, 'rgba(255,252,236,' + a.toFixed(3) + ')');
    grad.addColorStop(0.84, 'rgba(255,206,110,' + (a * 0.85).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(255,186,86,0)');
    ctx.save();
    ctx.fillStyle = grad;
    ctx.shadowColor = 'rgba(255,196,96,' + (a * 0.85).toFixed(3) + ')';
    ctx.shadowBlur = m.cell * 0.5;
    roundRect(ctx, l, t, Math.max(1, r - l), Math.max(2, b - t), Math.min(r - l, b - t) / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    /* 한가운데 하얀 심지 */
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = '#fffdf4';
    if (f.dir === 'row') {
      roundRect(ctx, l, cy - thick * 0.09, Math.max(1, r - l), Math.max(1.5, thick * 0.18), thick * 0.09);
    } else {
      roundRect(ctx, cx - thick * 0.09, t, Math.max(1.5, thick * 0.18), Math.max(1, b - t), thick * 0.09);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    /* 빛줄기 위 반짝임 */
    var span = f.dir === 'row' ? (x1 - x0) : (y1 - y0);
    for (var i = 0; i < 9; i++) {
      var tw = Math.abs(Math.sin((k * 2.4 + i * 0.6) * Math.PI));
      if (tw < 0.15) { continue; }
      var d = (i + 0.5) / 9;
      var px = f.dir === 'row' ? x0 + span * d : cx;
      var py = f.dir === 'row' ? cy : y0 + span * d;
      var sz = m.cell * (0.09 + 0.09 * tw);
      ctx.globalAlpha = Math.min(1, a * tw * 1.2);
      ctx.fillStyle = '#fff8dc';
      ctx.beginPath();
      ctx.moveTo(px, py - sz * 1.7); ctx.quadraticCurveTo(px + sz * 0.3, py - sz * 0.3, px + sz * 1.7, py);
      ctx.quadraticCurveTo(px + sz * 0.3, py + sz * 0.3, px, py + sz * 1.7);
      ctx.quadraticCurveTo(px - sz * 0.3, py + sz * 0.3, px - sz * 1.7, py);
      ctx.quadraticCurveTo(px - sz * 0.3, py - sz * 0.3, px, py - sz * 1.7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 대폭발 : 3×3 충격파 링 + 황금 섬광 */
  function fxBlast(f, k, m) {
    var cx = m.x0 + f.c * m.cell + m.cell / 2;
    var cy = m.y0 + f.r * m.cell + m.cell / 2;
    var a = Math.max(0, 1 - k);
    ctx.save();
    /* 중심 섬광 */
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, m.cell * 1.75);
    glow.addColorStop(0, 'rgba(255,255,232,' + Math.min(1, a * 1.5).toFixed(3) + ')');
    glow.addColorStop(0.32, 'rgba(255,196,86,' + (a * 0.62).toFixed(3) + ')');
    glow.addColorStop(0.72, 'rgba(255,132,40,' + (a * 0.26).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(255,110,30,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, m.cell * 1.75, 0, Math.PI * 2); ctx.fill();
    /* 충격파 링 두 개 */
    for (var i = 0; i < 2; i++) {
      var kk = Math.min(1, k * 1.6 - i * 0.22);
      if (kk <= 0) { continue; }
      var rr = m.cell * (0.5 + 1.6 * kk);
      var ra = Math.max(0, (1 - kk) * a) * (i === 0 ? 0.95 : 0.55);
      ctx.strokeStyle = i === 0
        ? 'rgba(255,238,190,' + ra.toFixed(3) + ')'
        : 'rgba(255,170,70,' + ra.toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.5, m.cell * 0.16 * (1 - kk * 0.7));
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    }
    /* 터진 3×3 칸을 금빛 테두리로 */
    var bx = m.x0 + Math.max(0, f.c - 1) * m.cell;
    var by = m.y0 + Math.max(0, f.r - 1) * m.cell;
    var bw = m.cell * (Math.min(COLS - 1, f.c + 1) - Math.max(0, f.c - 1) + 1);
    var bh = m.cell * (Math.min(ROWS - 1, f.r + 1) - Math.max(0, f.r - 1) + 1);
    ctx.globalAlpha = a * 0.75;
    ctx.strokeStyle = 'rgba(255,232,170,.95)';
    ctx.lineWidth = Math.max(1.5, m.cell * 0.07);
    roundRect(ctx, bx + 1, by + 1, bw - 2, bh - 2, m.cell * 0.3);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* 무지개 : 지워지는 칸마다 광선이 뻗고 그 칸이 번쩍 */
  function fxRainbow(f, k, m) {
    var cx = m.x0 + f.c * m.cell + m.cell / 2;
    var cy = m.y0 + f.r * m.cell + m.cell / 2;
    var a = Math.max(0, 1 - k);
    var grow = Math.min(1, k / 0.2);
    ctx.save();
    (f.cells || []).forEach(function (pos, i) {
      var tx = m.x0 + pos[1] * m.cell + m.cell / 2;
      var ty = m.y0 + pos[0] * m.cell + m.cell / 2;
      var ex = cx + (tx - cx) * grow;
      var ey = cy + (ty - cy) * grow;
      var hue = (i * 47) % 360;
      ctx.shadowColor = i % 2 ? 'rgba(255,226,150,.95)' : 'hsla(' + hue + ',100%,72%,.95)';
      ctx.shadowBlur = m.cell * 0.4;
      ctx.strokeStyle = i % 2 ? 'rgba(255,236,170,' + (a * 0.92).toFixed(3) + ')' : 'hsla(' + hue + ',96%,74%,' + (a * 0.88).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2.2, m.cell * 0.19);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,248,' + (a * 0.95).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1.2, m.cell * 0.06);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      /* 대상 칸 번짍 — 사라진 자리가 밝게 빛납니다 */
      var fl = Math.max(0, 1 - Math.abs(k - 0.3) / 0.55);
      if (fl > 0) {
        var g2 = ctx.createRadialGradient(tx, ty, 0, tx, ty, m.cell * 0.95);
        g2.addColorStop(0, 'rgba(255,255,244,' + Math.min(1, fl * 1.05).toFixed(3) + ')');
        g2.addColorStop(0.45, 'hsla(' + hue + ',100%,80%,' + (fl * 0.72).toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(tx, ty, m.cell * 0.95, 0, Math.PI * 2); ctx.fill();
        /* 작은 반짝이 */
        var sz = m.cell * 0.16 * fl;
        ctx.fillStyle = 'rgba(255,255,250,' + fl.toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(tx, ty - sz * 1.8); ctx.quadraticCurveTo(tx + sz * 0.3, ty - sz * 0.3, tx + sz * 1.8, ty);
        ctx.quadraticCurveTo(tx + sz * 0.3, ty + sz * 0.3, tx, ty + sz * 1.8);
        ctx.quadraticCurveTo(tx - sz * 0.3, ty + sz * 0.3, tx - sz * 1.8, ty);
        ctx.quadraticCurveTo(tx - sz * 0.3, ty - sz * 0.3, tx, ty - sz * 1.8);
        ctx.fill();
      }
    });
    /* 무지개 경단 자리 — 금빛 고리 */
    var ring = m.cell * (0.5 + 0.9 * Math.min(1, k / 0.45));
    ctx.strokeStyle = 'rgba(255,246,214,' + (a * 0.9).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.6, m.cell * 0.1);
    ctx.beginPath(); ctx.arc(cx, cy, ring, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function draw() {
    if (!ctx || !S || !S.board) { return; }
    var w = S.w, h = S.h, m = S.metrics;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    /* 판 바탕 — 한지 · 어두운 연못 */
    var bg = ctx.createRadialGradient(w * 0.5, h * 0.12, 8, w * 0.5, h * 0.62, Math.max(w, h) * 1.05);
    bg.addColorStop(0, '#1d2946');
    bg.addColorStop(0.52, '#221d2c');
    bg.addColorStop(1, '#2d1d14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* 칸 자리 */
    var pad = Math.max(2, m.cell * 0.06);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = m.x0 + c * m.cell;
        var y = m.y0 + r * m.cell;
        roundRect(ctx, x + pad, y + pad, m.cell - pad * 2, m.cell - pad * 2, m.cell * 0.2);
        ctx.fillStyle = 'rgba(255,236,196,.045)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(240,217,165,.07)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* 신수 — 아래 줄부터(위에서 떨어지는 신수가 뒤로 가도록) */
    for (r = ROWS - 1; r >= 0; r--) {
      for (c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        if (!cl) { continue; }
        var p = tileCenter(r, c);
        var size = m.cell * 1.08 * (cl.sc || 1);
        /* 색 기운 — 같은 색끼리 헷갈리지 않도록 아주 옅게 */
        var glow = ctx.createRadialGradient(p.x, p.y + size * 0.1, size * 0.1, p.x, p.y, size * 0.55);
        glow.addColorStop(0, TYPES[cl.t].glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        drawSprite(cl.t, p.x, p.y, size);
        if (cl.sp) { drawSpecialMark(cl, p.x, p.y, size); }
      }
    }

    /* 고른 칸 */
    if (S.selected && S.phase === 'idle') {
      var sel = S.selected;
      var sx = m.x0 + sel.c * m.cell;
      var sy = m.y0 + sel.r * m.cell;
      var pulse = 0.6 + 0.4 * Math.abs(Math.sin(S.clock / 180));
      roundRect(ctx, sx + 1.5, sy + 1.5, m.cell - 3, m.cell - 3, m.cell * 0.22);
      ctx.strokeStyle = 'rgba(255,226,150,' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 2.6;
      ctx.shadowColor = 'rgba(255,214,120,.85)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* 힌트 — 3초 넘게 가만히 있으면 될 자리 두 칸이 반짝입니다 */
    if (S.hintPair && S.clock < S.hintUntil && S.phase === 'idle') {
      var pair = S.hintPair;
      var k1 = 0.35 + 0.55 * Math.abs(Math.sin(S.clock / 220));
      [ [pair[0], pair[1]], [pair[2], pair[3]] ].forEach(function (pos) {
        var hx = m.x0 + pos[1] * m.cell;
        var hy = m.y0 + pos[0] * m.cell;
        roundRect(ctx, hx + 2, hy + 2, m.cell - 4, m.cell - 4, m.cell * 0.24);
        ctx.strokeStyle = 'rgba(255,255,255,' + k1.toFixed(2) + ')';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      });
    }

    /* 효과 — 파티클 · 점수 · 콤보 */
    S.fx.forEach(function (f) {
      var k = f.age / f.max;
      if (f.kind === 'particle') {
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.fillStyle = f.color;
        ctx.beginPath();
        ctx.arc(f.x + f.vx * k * 0.25, f.y + f.vy * k * 0.25 + 60 * k * k, f.size * (1 - k * 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'beam') {
        fxBeam(f, k, m);
      } else if (f.kind === 'blast') {
        fxBlast(f, k, m);
      } else if (f.kind === 'rainbow') {
        fxRainbow(f, k, m);
      } else if (f.kind === 'gain') {
        ctx.globalAlpha = Math.max(0, 1 - k * k);
        ctx.fillStyle = '#ffe9b4';
        ctx.font = '800 ' + Math.round(m.cell * 0.36) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 6;
        ctx.fillText(f.text, f.x, f.y - 26 * k);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      } else if (f.kind === 'combo') {
        var pop = k < 0.18 ? (0.6 + k * 2.4) : 1;
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.55) / 0.45);
        ctx.save();
        ctx.translate(w / 2, h * 0.42);
        ctx.scale(pop, pop);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(m.cell * 0.62) + 'px sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(60,26,10,.9)';
        ctx.strokeText(f.text, 0, 0);
        var gold = ctx.createLinearGradient(0, -m.cell * 0.4, 0, m.cell * 0.4);
        gold.addColorStop(0, '#fff4d0');
        gold.addColorStop(0.5, '#ffd479');
        gold.addColorStop(1, '#ffab3d');
        ctx.fillStyle = gold;
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'fever') {
        var kk = Math.min(1, k / 0.15);
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.7) / 0.3);
        ctx.save();
        ctx.translate(w / 2, h * 0.5);
        ctx.scale(0.7 + kk * 0.3, 0.7 + kk * 0.3);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(m.cell * 0.7) + 'px sans-serif';
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(80,20,6,.92)';
        ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = '#ffd36e';
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'time') {
        /* 콤보로 늘어난 시간 — 판 위쪽에 짧게 떠오릅니다 */
        var ty = m.y0 + m.cell * 1.05 - 18 * k;
        ctx.globalAlpha = Math.max(0, 1 - k * k * 1.05);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(m.cell * 0.44) + 'px sans-serif';
        ctx.lineWidth = 4.5;
        ctx.strokeStyle = 'rgba(12,44,38,.88)';
        ctx.strokeText(f.text, w / 2, ty);
        ctx.fillStyle = '#c8f7d3';
        ctx.shadowColor = 'rgba(140,255,190,.85)';
        ctx.shadowBlur = 12;
        ctx.fillText(f.text, w / 2, ty);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      } else if (f.kind === 'count') {
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(m.cell * 1.1) + 'px sans-serif';
        ctx.fillStyle = 'rgba(255,96,96,.92)';
        ctx.shadowColor = 'rgba(255,60,60,.8)';
        ctx.shadowBlur = 16;
        ctx.fillText(f.text, w / 2, h * 0.5);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    });

    /* 피버 — 판 테두리가 금빛으로 달아오릅니다 */
    if (feverActive()) {
      var fp = 0.18 + 0.12 * Math.abs(Math.sin(S.clock / 260));
      ctx.strokeStyle = 'rgba(255,206,120,' + fp.toFixed(2) + ')';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
    }

    /* 마지막 10초 — 판 가장자리가 붉게 */
    if (!S.over && S.timeLeft <= 10000) {
      var red = 0.1 + 0.24 * Math.abs(Math.sin(S.clock / 180));
      ctx.strokeStyle = 'rgba(255,86,86,' + red.toFixed(2) + ')';
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    }
  }


  /* ===================================================================
     11. 크기 · 반복
     =================================================================== */

  /* 판은 언제나 정사각 — 낮은 창에서도 가로·세로가 함께 줄어듭니다 */
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
      var room = boxH - padY - otherHeight(panel, stage) - 6;   /* 6 = 판의 위 여백 */
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
    S.w = w; S.h = h; S.dpr = dpr;
    el.canvas.width = Math.round(w * dpr);
    el.canvas.height = Math.round(h * dpr);
    var pad = Math.max(4, Math.min(w, h) * 0.018);
    var cell = (Math.min(w, h) - pad * 2) / COLS;
    S.metrics = {
      cell: cell,
      x0: (w - cell * COLS) / 2,
      y0: (h - cell * ROWS) / 2,
      size: Math.min(w, h)
    };
    /* 크기가 바뀌면 미끄러지던 위치는 접습니다 */
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (S.board && S.board[r][c]) { S.board[r][c].x = 0; S.board[r][c].y = 0; }
      }
    }
  }

  function update(dt) {
    if (!S) { return; }
    var moving = false;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        if (!cl) { continue; }
        if (cl.x !== 0) {
          cl.x += -cl.x * Math.min(1, dt / 55);
          if (Math.abs(cl.x) < 0.5) { cl.x = 0; } else { moving = true; }
        }
        if (cl.y !== 0) {
          cl.y += -cl.y * Math.min(1, dt / 62);
          if (Math.abs(cl.y) < 0.5) { cl.y = 0; } else { moving = true; }
        }
        if (cl.sc !== 1) {
          cl.sc += (1 - cl.sc) * Math.min(1, dt / 120);
          if (Math.abs(cl.sc - 1) < 0.02) { cl.sc = 1; } else { moving = true; }
        }
      }
    }

    for (var i = S.fx.length - 1; i >= 0; i--) {
      S.fx[i].age += dt;
      if (S.fx[i].age >= S.fx[i].max) { S.fx.splice(i, 1); }
    }

    /* 특수 블록 연출이 끝날 때까지는 다음 차례(낙하)를 미룹니다 */
    if (S.hold > 0) {
      S.hold -= dt;
      if (S.hold < 0) { S.hold = 0; }
    }

    if (!moving && S.hold <= 0 && S.queue.length) {
      var fn = S.queue.shift();
      fn();
    }

    /* 3초 넘게 가만히 있으면 힌트 — 지금 둘 수 있는 자리 하나 */
    if (S.phase === 'idle' && !S.over && S.clock - S.lastInput > 3000) {
      if (!S.hintPair || S.clock > S.hintUntil) {
        S.hintPair = findMove();
        S.hintUntil = S.clock + 2600;
        if (S.hintPair) {
          setHint(hintTextFor(S.hintPair));
        }
      }
    }
  }

  function tickTimer() {
    if (!S || S.paused || S.over) { return; }
    var sec = Math.max(0, Math.ceil(S.timeLeft / 1000));
    if (el.timerText) { el.timerText.textContent = sec + '초'; }
    if (el.timerFill) {
      var pct = Math.max(0, Math.min(1, S.timeLeft / ROUND_MS));
      el.timerFill.style.width = (pct * 100).toFixed(2) + '%';
    }
    if (el.timerWrap) {
      el.timerWrap.classList.toggle('is-urgent', S.timeLeft <= 10000);
    }
    if (S.timeLeft <= 10000 && sec !== S.lastCount && sec > 0) {
      S.lastCount = sec;
      pushFx({ kind: 'count', text: String(sec), age: 0, max: 620 });
    }
  }

  function frame(t) {
    if (!running) { return; }
    raf = window.requestAnimationFrame(frame);
    var dt = lastT ? Math.min(64, t - lastT) : 16;
    lastT = t;
    if (S && !frozen) {
      if (!S.paused && !S.over) {
        S.clock += dt;
        S.timeLeft -= dt;
        if (S.timeLeft <= 0) {
          S.timeLeft = 0;
          tickTimer();
          endGame();
        } else {
          tickTimer();
        }
      }
      update(dt);
    }
    if (S) { draw(); }
  }

  function startLoop() {
    if (raf) { window.cancelAnimationFrame(raf); }
    lastT = 0;
    running = true;
    raf = window.requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
  }
  function pause() {
    if (!S) { return; }
    S.paused = true;
  }
  function resume() {
    if (!S) { return; }
    S.paused = false;
    lastT = 0;
  }

  /* ===================================================================
     12. 안내 문구
     =================================================================== */

  /* 힌트 문구 — 무지개 경단이 섞인 자리면 그에 맞게 알려 줍니다 */
  function hintTextFor(pair) {
    var a = S && S.board[pair[0]] ? S.board[pair[0]][pair[1]] : null;
    var b = S && S.board[pair[2]] ? S.board[pair[2]][pair[3]] : null;
    if ((a && a.sp === 'rainbow') || (b && b.sp === 'rainbow')) {
      return '빛나는 무지개 경단과 바꾸면 그 신수가 모두 사라져요';
    }
    return '빛나는 두 신수를 바꾸면 세 개가 맞아요';
  }

  var hintTimer = 0;
  function setHint(text) {
    if (!el.hint) { return; }
    el.hint.textContent = text || '';
    window.clearTimeout(hintTimer);
    if (text) {
      hintTimer = window.setTimeout(function () {
        if (el.hint) { el.hint.textContent = ''; }
      }, 5200);
    }
  }

  /* ===================================================================
     13. 판 시작 · 끝
     =================================================================== */

  function startGame(first) {
    S = newState();
    S.board = buildBoard();
    S.swapKeys = null;
    if (el.score) { el.score.textContent = '0'; }
    if (el.combo) { el.combo.textContent = '0'; }
    if (el.best) { el.best.textContent = fmtNum(S.best); }
    hideOver();
    closeSheet();
    if (el.restartBtn) {
      el.restartBtn.textContent = '다시하기';
      el.restartBtn.classList.remove('is-armed');
      el.restartBtn.removeAttribute('data-armed');
    }
    resize();
    S.lastInput = 0;
    S.paused = false;
    setHint(first ? '신수 둘을 바꿔 세 개를 맞춰 보세요 · 60초!' : '새 판이에요 · 60초 동안 최대한 많이!');
    startLoop();
  }

  function endGame() {
    if (!S || S.over) { return; }
    S.over = true;
    S.phase = 'over';
    S.selected = null;
    S.drag = null;
    S.hintPair = null;
    S.queue.length = 0;
    closeSheet();
    if (S.score > S.best) { S.best = S.score; }
    setLocalBest(S.score);
    renderScore();
    showOver();
    if (opts.live && typeof opts.submitScore === 'function' && S.score > 0) {
      submitScore();
    }
  }

  function submitScore() {
    if (!S || S.submitState.pending) { return; }
    S.submitState.pending = true;
    S.submitState.failed = '';
    opts.submitScore(S.score, S.maxCombo).then(function (res) {
      S.submitState.pending = false;
      S.submitState.result = res || null;
      if (res && Number(res.best_score) > S.best) {
        S.best = Number(res.best_score);
        setLocalBest(S.best);
        renderScore();
      }
      renderOverResult();
      if (ranking.status === 'ready') { loadRanking(); }
      if (el.best) { el.best.textContent = fmtNum(S.best); }
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

  function currentResultHtml() {
    if (!S) { return ''; }
    if (!opts.live) {
      return '체험 모드예요 · 이 기기의 최고 기록 <b>' + fmtNum(S.best) + '점</b>으로 남아요';
    }
    if (S.submitState.failed === 'pending') {
      return '서버에 신수팡 랭킹이 아직 준비되지 않았어요 · 이 기기 최고 <b>' +
        fmtNum(S.best) + '점</b>으로 즐겨 주세요';
    }
    if (S.submitState.failed) {
      return '랭킹에 올리지 못했어요 · 이 기기 최고 <b>' + fmtNum(S.best) + '점</b>';
    }
    var res = S.submitState.result;
    if (res && res.rank) {
      return (res.is_new_best ? '🎉 <b>새 최고 기록</b> · ' : '') +
        '문파 랭킹 <b>' + res.rank + '위</b> · 문파 최고 ' + fmtNum(res.best_score) + '점';
    }
    if (S.submitState.pending) { return '문파 랭킹에 올리는 중이에요…'; }
    return '';
  }

  function renderOverResult() {
    var box = $('#sp-over-result');
    if (box) { box.innerHTML = currentResultHtml(); }
  }

  function showOver() {
    if (!el.over) { return; }
    el.over.innerHTML =
      '<div class="gd-over__card">' +
        '<p class="gd-over__kicker">60초 종료</p>' +
        '<h3 class="gd-over__title">신수팡 한 판 끝!</h3>' +
        '<p class="gd-over__score"><strong>' + fmtNum(S.score) + '</strong><span>점</span></p>' +
        '<p class="gd-over__meta">최고 <b>' + fmtNum(S.best) + '</b>점 · 최대 <b>' +
          (S.maxCombo || 0) + ' COMBO</b></p>' +
        '<p class="gd-over__result" id="sp-over-result">' + currentResultHtml() + '</p>' +
        '<div class="gd-over__row">' +
          '<button type="button" class="btn btn--ghost btn--small" id="sp-over-rank">🏆 문파 랭킹</button>' +
          '<button type="button" class="btn btn--primary btn--small" id="sp-over-restart">다시하기</button>' +
        '</div>' +
      '</div>';
    el.over.hidden = false;
    var rank = $('#sp-over-rank', el.over);
    var again = $('#sp-over-restart', el.over);
    if (rank) { rank.addEventListener('click', function () { openSheet('rank'); }); }
    if (again) { again.addEventListener('click', function () { startGame(false); }); }
  }

  function hideOver() {
    if (!el.over) { return; }
    el.over.hidden = true;
    el.over.innerHTML = '';
  }

  /* ===================================================================
     14. 문파 랭킹
     =================================================================== */

  function rankingMarkup() {
    var html = '<div class="gd-sheet__head"><h3>🏆 신수팡 문파 랭킹</h3>' +
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
      html += '<div class="gd-rank__empty">서버에 신수팡 랭킹이 아직 준비되지 않았어요.<br>' +
        '운영진이 <b>supabase/migration-sinsupang.sql</b> 을 실행하면 문파원 모두의 기록이 모여요.<br>' +
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
      var combo = Number(row.best_combo) || 0;
      html += '<li class="gd-rank__row' + (mine ? ' is-mine' : '') + '">' +
        '<span class="gd-rank__no">' + (row.rank || '-') + '</span>' +
        rankAvatarMarkup(row.nickname, row.avatar) +
        '<span class="gd-rank__who"><b>' + escapeHtml(row.nickname || '') + '</b>' +
        '<span class="gd-rank__role">' + escapeHtml(ROLE_LABEL[row.role] || '문파원') +
          (combo > 0 ? ' · 최대 ' + combo + ' 콤보' : '') + '</span></span>' +
        '<span class="gd-rank__score">' + fmtNum(row.best_score) + '</span>' +
        '</li>';
    });
    html += '</ol>';
    if (opts.nickname && !ranking.rows.some(function (r) { return r.nickname === opts.nickname; })) {
      html += '<p class="gd-sheet__note">내 기록이 아직 없어요 · 한 판 마치면 랭킹에 올라요</p>';
    }
    return html;
  }

  /* 랭킹의 프로필 그림 한 칸 — 경단만들기와 같은 방식.
     DB의 avatar 는 ① 'preset:duck' 같은 일러스트 프리셋 문자열, ② data:image/... 사진, ③ 없음.
     app.js 가 넘겨주는 avatarHtml(일러스트 SVG·사진 <img>)로 그리고, 없으면 첫 글자. */
  var AVATAR_PRESETS = ['lotus', 'koi', 'frog', 'firefly', 'moon', 'leaf', 'turtle', 'lantern', 'duck'];
  function avatarPreset(value) {
    if (typeof value !== 'string' || value.indexOf('preset:') !== 0) { return null; }
    var kind = value.slice(7);
    return AVATAR_PRESETS.indexOf(kind) === -1 ? null : kind;
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

  function openSheet(kind) {
    if (!el.sheet) { return; }
    el.sheet.hidden = false;
    el.sheet.setAttribute('data-kind', kind);
    el.sheet.innerHTML = rankingMarkup();
    bindSheetClose();
    loadRanking();
    pause();
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
  function openRanking() { openSheet('rank'); }

  function loadRanking() {
    if (!opts.live || typeof opts.listRanking !== 'function') {
      ranking.status = 'trial';
      return Promise.resolve(null);
    }
    if (ranking.status === 'loading') { return ranking.promise; }
    ranking.status = 'loading';
    if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank' && !el.sheet.hidden) {
      el.sheet.innerHTML = rankingMarkup();
      bindSheetClose();
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
     15. 열기 · 닫기 · 다시하기
     =================================================================== */

  function restart(withConfirm) {
    if (!S) { return; }
    window.clearTimeout(restartArmTimer);
    if (withConfirm && !S.over && S.score > 0 && el.restartBtn) {
      if (el.restartBtn.getAttribute('data-armed') !== '1') {
        el.restartBtn.setAttribute('data-armed', '1');
        el.restartBtn.classList.add('is-armed');
        el.restartBtn.textContent = '한 번 더 누르면 새 판';
        setHint('진행 중인 판을 버리고 새로 시작해요 · 한 번 더 눌러 주세요');
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
    loadSprites();
    if (!opened) {
      bindPointer();
      if (el.close) { el.close.addEventListener('click', closeGame); }
      if (el.rankBtn) { el.rankBtn.addEventListener('click', openRanking); }
      if (el.restartBtn) { el.restartBtn.addEventListener('click', function () { restart(true); }); }
      el.sheet.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-sheet-close]')) { closeSheet(); }
      });
      window.addEventListener('resize', function () { if (opened) { resize(); } });
      if (window.ResizeObserver) {
        var ro = new window.ResizeObserver(function () { if (opened) { resize(); } });
        if (el.stage) { ro.observe(el.stage); }
      }
      window.addEventListener('keydown', function (e) {
        if (!opened) { return; }
        if (e.key === 'Escape') {
          if (el.sheet && !el.sheet.hidden) { closeSheet(); return; }
          if (S && S.selected) { S.selected = null; return; }
          closeGame();
        }
      });
      /* 다른 앱을 보는 동안에는 시간을 멈추고, 돌아오면 이어서 갑니다 */
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
    if (el.root) { el.root.hidden = false; }
    document.body.classList.add('is-locked');
    startGame(true);
    if (opts.live) { loadRanking(); }
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
      opts.onToast('🐾 신수팡 ' + fmtNum(S.score) + '점 · 최고 ' + fmtNum(S.best) + '점');
    }
  }

  window.YM_SINSUPANG = {
    open: openGame,
    close: closeGame,
    isOpen: function () { return !!opened && el.root && !el.root.hidden; },
    localBest: localBest,
    credit: CREDIT,
    /* 테스트용 — 화면에는 나오지 않습니다. */
    _debug: {
      state: function () {
        return S ? {
          score: S.score, best: S.best, maxCombo: S.maxCombo, chain: S.chain,
          timeLeft: S.timeLeft, over: S.over, phase: S.phase,
          fever: feverActive(), combo: S.maxCombo,
          hint: S.hintPair ? S.hintPair.slice() : null,
          count: S.board ? S.board.reduce(function (n, row) { return n + row.filter(Boolean).length; }, 0) : 0
        } : null;
      },
      fx: function () {
        return S ? S.fx.map(function (f) { return { kind: f.kind, text: f.text, age: f.age, max: f.max }; }) : [];
      },
      /* 테스트용 — 연출을 확인하려고 화면을 한 순간 멈춰 두거나, 효과를 조금 진행시킵니다 */
      freeze: function (on) { frozen = !!on; },
      advanceFx: function (ms) {
        if (!S) { return; }
        S.fx.forEach(function (f) { f.age = Math.min(f.max - 1, (f.age || 0) + (Number(ms) || 0)); });
        draw();
      },
      /* 테스트용 — 지금 판에서 매치를 한 단계 풀어 봅니다(연쇄·콤보 확인) */
      resolve: function () { if (S) { resolveStep(); } },
      setChain: function (n) { if (S) { S.chain = Math.max(0, Number(n) || 0); } },
      /* 테스트용 — 피버 게이지를 채웁니다 */
      fever: function (n) {
        if (!S) { return false; }
        for (var i = 0; i < (n || 6); i++) { addFever(1); }
        return feverActive();
      },
      /* 테스트용 — 피버 상태를 비웁니다 */
      clearFever: function () {
        if (!S) { return; }
        S.feverGauge = 0;
        S.feverUntil = 0;
      },
      comboMultiplier: comboMultiplier,
      board: function () {
        if (!S) { return null; }
        return typeGrid(S.board);
      },
      cells: function () {
        if (!S) { return null; }
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var cl = S.board[r][c];
            out.push({ r: r, c: c, t: cl ? cl.t : -1, sp: cl ? cl.sp : '' });
          }
        }
        return out;
      },
      /* 테스트용 — 칸마다 지금 그려지는 위치 어긋남(x·y)과 새로 채운 칸 여부 */
      offsets: function () {
        if (!S) { return null; }
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var cl = S.board[r][c];
            if (!cl) { continue; }
            out.push({ r: r, c: c, t: cl.t, sp: cl.sp, x: cl.x, y: cl.y, fresh: !!cl.fresh });
          }
        }
        return out;
      },
      made: function () { return S ? S.made.slice() : []; },
      specials: function () {
        if (!S) { return []; }
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            if (S.board[r][c] && S.board[r][c].sp) {
              out.push({ r: r, c: c, sp: S.board[r][c].sp, t: S.board[r][c].t });
            }
          }
        }
        return out;
      },
      setBoard: function (grid) {
        if (!S || !Array.isArray(grid)) { return false; }
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var v = grid[r] && grid[r][c];
            S.board[r][c] = (v === undefined || v === null || v < 0) ? null : makeCell(v);
          }
        }
        S.selected = null;
        S.phase = 'idle';
        S.queue.length = 0;
        S.made = [];
        return true;
      },
      setSpecial: function (r, c, sp, t) {
        if (!S || !S.board[r] || !S.board[r][c]) { return false; }
        S.board[r][c].sp = sp || '';
        if (t !== undefined && t !== null) { S.board[r][c].t = t; }
        return true;
      },
      findMove: function () { return findMove(); },
      groups: function () { return findGroups(); },
      swap: function (r1, c1, r2, c2) { return trySwap(r1, c1, r2, c2); },
      tap: function (r, c) {
        if (!S || S.over || S.phase !== 'idle') { return false; }
        if (S.selected && S.selected.r === r && S.selected.c === c) { S.selected = null; return true; }
        if (S.selected && (Math.abs(S.selected.r - r) + Math.abs(S.selected.c - c) === 1)) {
          var from = S.selected;
          S.selected = null;
          return trySwap(from.r, from.c, r, c);
        }
        S.selected = { r: r, c: c };
        return true;
      },
      /* 테스트용 — 콤보로 늘어난 시간(ms) */
      timeBonus: function () { return S ? S.timeBonus : 0; },
      setTime: function (sec) {
        if (!S) { return; }
        S.timeLeft = Math.max(0, Number(sec) * 1000);
        S.lastCount = 99;
        tickTimer();
      },
      end: function () {
        if (!S) { return; }
        S.timeLeft = 0;
        endGame();
      },
      addScore: function (n) {
        if (!S) { return; }
        S.score = Math.max(0, Math.floor(n));
        renderScore();
      },
      setCombo: function (n) {
        if (!S) { return; }
        S.maxCombo = Math.max(0, Math.floor(Number(n) || 0));
        renderScore();
      },
      /** 테스트용 — 랭킹 시트에 보여 줄 줄을 직접 넣어 아바타 세 가지를 확인합니다 */
      setRanking: function (rows, status) {
        ranking.status = status || 'ready';
        ranking.rows = rows || [];
        ranking.message = '';
        if (el.sheet && el.sheet.getAttribute('data-kind') === 'rank') {
          el.sheet.innerHTML = rankingMarkup();
          bindSheetClose();
        }
      },
      /** 테스트용 — 서버를 부르지 않고 랭킹 시트를 그대로 엽니다 */
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
      metrics: function () {
        return S ? { cell: S.metrics.cell, x0: S.metrics.x0, y0: S.metrics.y0, w: S.w, h: S.h, dpr: S.dpr } : null;
      },
      types: function () { return TYPES.map(function (t) { return { tier: t.tier, name: t.name }; }); }
    }
  };
})();
