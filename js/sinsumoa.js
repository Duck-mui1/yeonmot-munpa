/* 연못 — 🫧 신수모아 (도깨비의 세계)
 *
 *  · 7×7 판 · 60초 타임어택. 이웃한 두 신수를 맞바꾸는 조작은 신수팡과 같습니다.
 *  · 다른 점 — 직선 3매치가 아니라 **상하좌우로 이어진 같은 신수가 4개 이상**일 때만 터집니다.
 *      2×2 네모 · ㄱ자 · ㄴ자 · T자 · 일직선 네 개 모두 한 덩어리로 봅니다.
 *      같은 신수가 3개 이하로 이어져 있으면 아무 일도 일어나지 않습니다.
 *  · 특수 경단 — 덩어리 크기가 5개면 특수 경단(일직선이면 줄 폭탄, 그 밖의 모양이면 3×3 대폭발),
 *    6개 이상이면 무지개 경단이 그 자리에 생깁니다. 4개는 그냥 터지기만 합니다.
 *      줄 폭탄 · 대폭발 · 무지개 경단 모두 같은 신수 4개 이상 덩어리에 함께 들어 터질 때만 발동합니다.
 *      무지개 경단도 자기 신수 색을 그대로 가지고 있어서, 매치 없이 옮기면 다른 특수 경단처럼 제자리로 돌아옵니다.
 *      무지개 경단이 터지면 판 전체에서 그 경단과 같은 신수를 모두 지웁니다.
 *  · 병렬 입력 — 신수팡은 한 번 터지면 판 전체가 낙하를 기다려야 하지만, 신수모아는
 *    **터지거나 떨어지고 있는 칸만** 잠기고 나머지 멈춰 있는 칸은 그동안에도 바로 누르고 바꿀 수 있습니다.
 *    (칸마다 popping / falling 상태를 따로 두고, 열마다 따로 중력을 적용합니다.)
 *  · 점수 — 덩어리 하나 200점 + (칸수-4)×80, 특수 경단으로 함께 터진 칸 +40,
 *    연쇄(콤보) 배율 1 + 0.5×(연쇄-1) (최대 ×4). 연쇄 2부터 1초, 한 번에 8칸 이상 터지면 1초가 더 붙습니다(최대 60초).
 *  · 화면 코드는 YM_SINSUMOA.open({ ... }) 만 부르고, 점수 저장 · 랭킹 조회는
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
  var POP_MS = 210;              // 터지는 연출 길이 (신수팡과 같은 결)
  var BEST_KEY = 'ym.sinsumoa.best';

  /* 신수 다섯 — 신수팡의 경단 여섯 중 색이 겹치던 곰단(7)을 빼고 다섯만 씁니다.
     (7×7 에서 '상하좌우 4개 연결'은 6종이면 판이 자주 막혀 5종으로 정했습니다 — docs/sinsumoa-minigame.md) */
  var TYPES = [
    { tier: 11, name: '백운단',   color: '#dfe9ff', glow: 'rgba(206,224,255,.55)' },
    { tier: 9,  name: '황요호단', color: '#ff9a3c', glow: 'rgba(255,170,90,.55)' },
    { tier: 6,  name: '돼지단',   color: '#f08aae', glow: 'rgba(246,152,188,.55)' },
    { tier: 3,  name: '쥐단',     color: '#9ccf4a', glow: 'rgba(186,226,116,.55)' },
    { tier: 2,  name: '사마귀단', color: '#5aa8e6', glow: 'rgba(126,190,244,.55)' }
  ];
  var TYPE_COUNT = TYPES.length;

  var SPRITE_PATH = 'assets/gyeongdan/tier-';
  var CREDIT = '경단 이미지의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제될 수 있습니다.';
  var ROLE_LABEL = { admin: '문주', officer: '운영진', member: '문파원' };
  var SPECIAL_LABEL = { row: '가로 줄', col: '세로 줄', bomb: '대폭발', rainbow: '무지개' };

  var sprites = {};
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
  var el = {};
  var ctx = null;

  function grabDom() {
    el.root = $('#sinsumoa');
    el.panel = $('.sinsumoa__panel', el.root);
    el.stage = $('#sinsumoa-stage');
    el.canvas = $('#sinsumoa-canvas');
    el.score = $('#sm-score');
    el.combo = $('#sm-combo');
    el.best = $('#sm-best');
    el.timerFill = $('#sm-timer-fill');
    el.timerText = $('#sm-timer-text');
    el.timerWrap = $('#sm-timer-wrap');
    el.hint = $('#sm-hint');
    el.over = $('#sinsumoa-over');
    el.sheet = $('#sm-sheet');
    el.close = $('#sinsumoa-close');
    el.rankBtn = $('#sm-rank-btn');
    el.restartBtn = $('#sm-restart-btn');
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
  var opts = {};           // { live, nickname, best, submitScore, listRanking, onToast, avatarHtml, guestMode, submitGuestScore, listGuestRanking }

  /* 🔗 체험 링크(?guest=TOKEN)로 연 판 — 문파 랭킹 대신 '체험 랭킹'(게스트 전용)을 씁니다. */
  function guestRank() { return !!opts.guestMode && typeof opts.submitGuestScore === 'function'; }
  function rankWord() { return guestRank() ? '체험 랭킹' : '문파 랭킹'; }
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
    return { t: t, sp: sp || '', x: 0, y: 0, sc: 1, pop: 0, fresh: false };
  }

  /** 이 칸이 지금 움직이거나 터지는 중인가 — 그런 칸만 입력에서 잠깁니다 */
  function busy(cl) {
    return !cl || cl.pop > 0 || Math.abs(cl.x) > 0.5 || Math.abs(cl.y) > 0.5;
  }

  function newState() {
    return {
      board: null,
      score: 0,
      best: Math.max(localBest(), opts.best || 0),
      chain: 0,
      lastPopAt: -99999,
      maxCombo: 0,
      clock: 0,
      timeLeft: ROUND_MS,
      timeBonus: 0,
      lastCount: 99,
      over: false,
      selected: null,
      drag: null,
      fx: [],
      made: [],
      swapKeys: null,
      hintPair: null,
      hintUntil: 0,
      lastInput: 0,
      lastMoveCheck: 0,
      paused: false,
      metrics: { cell: 40, x0: 0, y0: 0, size: 300 },
      dpr: 1,
      w: 300,
      h: 300,
      submitState: { pending: false, result: null, failed: '' }
    };
  }

  /* ===================================================================
     5. 판 만들기 — 처음부터 4개 이상 이어진 덩어리가 없고, 둘 수 있는 수가 하나 이상
     =================================================================== */

  function typeGrid() {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      g.push([]);
      for (var c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        g[r].push(cl ? cl.t : -1);
      }
    }
    return g;
  }

  /** 숫자 판에서 (r,c) 가 속한 같은 숫자 덩어리의 크기 */
  function compSizeAt(r, c, g) {
    var t = g[r][c];
    if (t === undefined || t === null || t < 0) { return 0; }
    var seen = {};
    var stack = [[r, c]];
    var n = 0;
    seen[key(r, c)] = true;
    while (stack.length) {
      var p = stack.pop();
      n += 1;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < dirs.length; i++) {
        var rr = p[0] + dirs[i][0];
        var cc = p[1] + dirs[i][1];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { continue; }
        if (seen[key(rr, cc)]) { continue; }
        if (g[rr][cc] !== t) { continue; }
        seen[key(rr, cc)] = true;
        stack.push([rr, cc]);
      }
    }
    return n;
  }

  function shuffleArray(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function buildGrid() {
    var g = [];
    for (var r = 0; r < ROWS; r++) {
      g.push([]);
      for (var c = 0; c < COLS; c++) { g[r].push(-1); }
    }
    for (r = 0; r < ROWS; r++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        var order = [];
        for (var t = 0; t < TYPE_COUNT; t++) { order.push(t); }
        shuffleArray(order);
        var picked = -1;
        for (var i = 0; i < order.length; i++) {
          g[r][c2] = order[i];
          if (compSizeAt(r, c2, g) < 4) { picked = order[i]; break; }
        }
        g[r][c2] = picked < 0 ? order[0] : picked;
      }
    }
    return g;
  }

  function swapIsMoveGrid(g, r1, c1, r2, c2) {
    var a = g[r1][c1];
    var d = g[r2][c2];
    if (a < 0 || d < 0) { return false; }
    if (a === d) { return false; }
    g[r1][c1] = d; g[r2][c2] = a;
    var ok = compSizeAt(r1, c1, g) >= 4 || compSizeAt(r2, c2, g) >= 4;
    g[r1][c1] = a; g[r2][c2] = d;
    return ok;
  }

  function findMoveGrid(g) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (c + 1 < COLS && swapIsMoveGrid(g, r, c, r, c + 1)) { return [r, c, r, c + 1]; }
        if (r + 1 < ROWS && swapIsMoveGrid(g, r, c, r + 1, c)) { return [r, c, r + 1, c]; }
      }
    }
    return null;
  }

  function buildBoard() {
    var g = null;
    for (var attempt = 0; attempt < 60; attempt++) {
      g = buildGrid();
      if (findMoveGrid(g)) { break; }
    }
    var b = [];
    for (var r = 0; r < ROWS; r++) {
      b.push([]);
      for (var c = 0; c < COLS; c++) { b[r].push(makeCell(g[r][c])); }
    }
    return b;
  }

  /** 판을 새로 섞습니다 — 특수 경단은 그 자리에 두고, 보통 경단의 종류만 다시 돌립니다 */
  function shuffleBoard() {
    if (!S) { return false; }
    var cells = [];
    var vals = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        if (!cl) { continue; }
        if (cl.sp) { continue; }
        if (busy(cl)) { continue; }
        cells.push([r, c]);
        vals.push(cl.t);
      }
    }
    for (var attempt = 0; attempt < 80; attempt++) {
      shuffleArray(vals);
      for (var i = 0; i < cells.length; i++) {
        S.board[cells[i][0]][cells[i][1]].t = vals[i];
      }
      if (!findSettledGroups().length && findMove()) {
        for (i = 0; i < cells.length; i++) {
          S.board[cells[i][0]][cells[i][1]].sc = 0.82;
        }
        S.selected = null;
        S.hintPair = null;
        S.lastInput = S.clock;
        return true;
      }
    }
    /* 섞어도 안 되면 판을 새로 깝니다 */
    var fresh = buildBoard();
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) { S.board[r][c] = fresh[r][c]; }
    }
    S.selected = null;
    S.hintPair = null;
    S.lastInput = S.clock;
    return true;
  }

  /* ===================================================================
     6. 덩어리 찾기 · 특수 경단
     =================================================================== */

  /**
   * 지금 멈춰 있는(터지는 중도, 떨어지는 중도 아닌) 칸들만으로 덩어리를 찾습니다.
   * 움직이는 칸은 덩어리에 끼지 않으므로, 그 칸이 자리를 잡으면 그때 다시 셉니다.
   * → 한쪽에서 터지고 떨어지는 동안 다른 쪽 덩어리는 곧바로 터질 수 있습니다.
   */
  function findSettledGroups() {
    var seen = {};
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var start = S.board[r][c];
        if (!start || busy(start) || seen[key(r, c)]) { continue; }
        var t = start.t;
        var stack = [[r, c]];
        var cells = [];
        seen[key(r, c)] = true;
        while (stack.length) {
          var p = stack.pop();
          cells.push(key(p[0], p[1]));
          for (var i = 0; i < 4; i++) {
            var rr = p[0] + (i === 0 ? 1 : i === 1 ? -1 : 0);
            var cc = p[1] + (i === 2 ? 1 : i === 3 ? -1 : 0);
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { continue; }
            if (seen[key(rr, cc)]) { continue; }
            var nb = S.board[rr][cc];
            if (!nb || busy(nb) || nb.t !== t) { continue; }
            seen[key(rr, cc)] = true;
            stack.push([rr, cc]);
          }
        }
        if (cells.length >= 4) { out.push({ t: t, cells: cells }); }
      }
    }
    return out;
  }

  /** 덩어리 모양으로 특수 경단을 정합니다 — 4개는 없음 · 5개는 줄/대폭발 · 6개 이상은 무지개 */
  function specialForGroup(group) {
    var n = group.cells.length;
    var rows = {}, cols = {};
    group.cells.forEach(function (k) {
      var p = parseKey(k);
      rows[p.r] = true;
      cols[p.c] = true;
    });
    var straight = Object.keys(rows).length === 1 || Object.keys(cols).length === 1;
    if (n >= 6) { return 'rainbow'; }
    if (n === 5) {
      if (straight) { return Object.keys(rows).length === 1 ? 'row' : 'col'; }
      return 'bomb';
    }
    return '';
  }

  /** 특수 경단을 놓을 자리 — 방금 옮긴 칸이 덩어리에 있으면 그 칸, 없으면 가장 안쪽 칸 */
  function pickSpawnKey(group) {
    if (S.swapKeys) {
      for (var i = 0; i < S.swapKeys.length; i++) {
        if (group.cells.indexOf(S.swapKeys[i]) !== -1) { return S.swapKeys[i]; }
      }
    }
    var best = null, bestSame = -1, bestDist = 1e9;
    group.cells.forEach(function (k) {
      var p = parseKey(k);
      var same = 0;
      for (var d = 0; d < 4; d++) {
        var rr = p.r + (d === 0 ? 1 : d === 1 ? -1 : 0);
        var cc = p.c + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { continue; }
        if (group.cells.indexOf(key(rr, cc)) !== -1) { same += 1; }
      }
      var dist = Math.abs(p.r - (ROWS - 1) / 2) + Math.abs(p.c - (COLS - 1) / 2);
      if (same > bestSame || (same === bestSame && dist < bestDist)) {
        bestSame = same; bestDist = dist; best = k;
      }
    });
    return best || group.cells[0];
  }

  /* 특수 경단이 터진 자리 — expandClears 가 기록해 두면 부르는 쪽이 눈에 보이는 효과로 바꿉니다 */
  var pendingSpecialFx = [];

  /**
   * 터뜨릴 칸을 모읍니다. 안에 특수 경단이 있으면 그 효과까지 이어서 펼칩니다.
   * 무지개 경단은 자기 신수 색(cl.t)을 그대로 가지므로 그 색을 판 전체에서 지웁니다.
   */
  function expandClears(initial) {
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
        var t = cl.t;
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

  function flushSpecialFx() {
    if (!pendingSpecialFx.length) { return false; }
    pendingSpecialFx.forEach(function (f) {
      f.age = 0;
      f.max = f.kind === 'beam' ? 430 : 460;
      S.fx.push(f);
    });
    pendingSpecialFx.length = 0;
    if (S.fx.length > 90) { S.fx.splice(0, S.fx.length - 90); }
    return true;
  }

  /* ===================================================================
     7. 점수 · 콤보
     =================================================================== */

  function comboMultiplier(chain) {
    return Math.min(4, 1 + 0.5 * Math.max(0, chain - 1));
  }

  /* 콤보로 시간이 늘어납니다 — 2연쇄부터 1초씩, 최대 60초 */
  function addTime(ms) {
    if (!S || S.over || !(ms > 0)) { return 0; }
    var before = S.timeLeft;
    S.timeLeft = Math.min(ROUND_MS, S.timeLeft + ms);
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

  function pushFx(fx) {
    if (!S) { return; }
    S.fx.push(fx);
    if (S.fx.length > 90) { S.fx.shift(); }
  }

  function burst(r, c, t, cl) {
    var m = S.metrics;
    var cx = m.x0 + c * m.cell + m.cell / 2 + (cl ? (cl.x || 0) : 0);
    var cy = m.y0 + r * m.cell + m.cell / 2 + (cl ? (cl.y || 0) : 0);
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

  function renderScore() {
    if (el.score) { el.score.textContent = fmtNum(S.score); }
    if (el.combo) { el.combo.textContent = S.maxCombo > 0 ? (S.maxCombo + 'x') : '0'; }
    if (el.best) { el.best.textContent = fmtNum(S.best); }
  }

  /* ===================================================================
     8. 터뜨리기 · 떨어지기 · 채우기 (열마다 따로)
     =================================================================== */

  function beginChain() {
    var now = S.clock;
    S.chain = (now - S.lastPopAt <= 1600) ? (S.chain + 1) : 1;
    S.lastPopAt = now;
    if (S.chain > S.maxCombo) { S.maxCombo = S.chain; }
    return comboMultiplier(S.chain);
  }

  /** 터질 칸을 표시하고 파편·점수 글씨를 뿌립니다 (spawnKeys 는 살아남는 자리) */
  function markClear(clear, spawnKeys) {
    var sumX = 0, sumY = 0, cnt = 0;
    Object.keys(clear).forEach(function (k) {
      if (spawnKeys && spawnKeys[k]) { return; }
      var p = parseKey(k);
      var cl = S.board[p.r] && S.board[p.r][p.c];
      if (!cl || cl.pop > 0) { return; }
      burst(p.r, p.c, cl.t, cl);
      cl.pop = 1;
      var m = S.metrics;
      sumX += m.x0 + p.c * m.cell + m.cell / 2 + (cl.x || 0);
      sumY += m.y0 + p.r * m.cell + m.cell / 2 + (cl.y || 0);
      cnt += 1;
    });
    return cnt ? { x: sumX / cnt, y: sumY / cnt, n: cnt } : null;
  }

  /**
   * 한 번에 찾은 덩어리들을 함께 터뜨립니다.
   * 터지는 칸은 pop 표시만 하고, 실제 제거·낙하는 그 열에서 연출이 끝나는 대로 따로 진행합니다.
   */
  function popGroups(groups) {
    if (!S || S.over) { return; }
    var mult = beginChain();

    pendingSpecialFx.length = 0;
    var clear = {};
    var groupCells = {};
    var spawns = [];
    var spawnKeys = {};
    var base = 0;
    var groupTotal = 0;

    groups.forEach(function (g) {
      var n = g.cells.length;
      groupTotal += n;
      base += 200 + 80 * (n - 4);
      var sp = specialForGroup(g);
      var spawnKey = sp ? pickSpawnKey(g) : null;
      if (spawnKey) { spawnKeys[spawnKey] = true; }
      g.cells.forEach(function (k) { groupCells[k] = true; });
      var set = expandClears(g.cells);
      Object.keys(set).forEach(function (k) {
        if (k !== spawnKey) { clear[k] = true; }
      });
      if (sp && spawnKey) { spawns.push({ key: spawnKey, sp: sp, t: g.t }); }
    });

    var total = Object.keys(clear).length;
    var extra = Math.max(0, total - Object.keys(groupCells).length);
    var points = Math.round((base + extra * 40) * mult);

    var center = markClear(clear, spawnKeys);
    S.score += points;
    renderScore();
    if (center) {
      pushFx({ kind: 'gain', text: '+' + fmtNum(points), x: center.x, y: center.y, age: 0, max: 720 });
    }

    /* 특수 경단이 살아남는 자리 — 터지는 칸으로 표시됐어도 되살립니다 */
    spawns.forEach(function (s) {
      var p = parseKey(s.key);
      var cl = S.board[p.r] && S.board[p.r][p.c];
      if (!cl) { return; }
      cl.sp = s.sp;
      cl.t = s.t;
      cl.pop = 0;
      cl.sc = 0.45;
      pushFx({ kind: 'make', r: p.r, c: p.c, text: SPECIAL_LABEL[s.sp], age: 0, max: 780 });
      if (S.made.length < 80) { S.made.push({ sp: s.sp, r: p.r, c: p.c }); }
    });

    if (S.chain >= 2) {
      pushFx({ kind: 'combo', text: S.chain + ' COMBO!', age: 0, max: 900 });
      addTime(1000);
    }
    if (groupTotal >= 8) { addTime(1000); }

    flushSpecialFx();
    /* 특수 경단 자리를 고를 때 쓰는 "방금 옮긴 칸"은 이번 터짐까지만 */
    S.swapKeys = null;
  }

  /** 한 열을 아래로 내리고 위쪽을 새 경단으로 채웁니다. 칸의 지금 위치는 그대로 이어집니다. */
  function compactColumn(c) {
    var m = S.metrics;
    var write = ROWS - 1;
    for (var r = ROWS - 1; r >= 0; r--) {
      var cl = S.board[r][c];
      if (!cl) { continue; }
      if (write !== r) {
        S.board[write][c] = cl;
        S.board[r][c] = null;
        cl.y -= (write - r) * m.cell;   /* 지금 보이는 자리에서 이어서 아래로 */
      }
      write -= 1;
    }
    if (write < 0) { return false; }
    for (var w = write; w >= 0; w--) {
      var fresh = makeCell(randType());
      fresh.y = -(write - w + 1) * m.cell;   /* 판 위에서 줄을 서서 내려옵니다 */
      fresh.fresh = true;
      S.board[w][c] = fresh;
    }
    return true;
  }

  /** 터지는 연출이 끝난 칸을 지우고, 그 열에 남은 터짐이 없으면 그 열만 내립니다 */
  function updatePops(dt) {
    var touched = {};
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        if (!cl || !(cl.pop > 0)) { continue; }
        cl.pop += dt;
        if (cl.pop >= POP_MS) {
          S.board[r][c] = null;
          touched[c] = true;
        }
      }
    }
    Object.keys(touched).forEach(function (c) {
      var cc = Number(c);
      for (var rr = 0; rr < ROWS; rr++) {
        var cell = S.board[rr][cc];
        if (cell && cell.pop > 0) { return; }
      }
      compactColumn(cc);
    });
  }

  function boardBusy() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (busy(S.board[r][c])) { return true; }
      }
    }
    return false;
  }

  /* ===================================================================
     9. 둘 수 있는 수 · 힌트
     =================================================================== */

  function swapIsMove(b, r1, c1, r2, c2) {
    var a = b[r1] && b[r1][c1];
    var d = b[r2] && b[r2][c2];
    if (!a || !d) { return false; }
    if (a.t === d.t) { return false; }
    var g = typeGrid();
    var tmp = g[r1][c1]; g[r1][c1] = g[r2][c2]; g[r2][c2] = tmp;
    return compSizeAt(r1, c1, g) >= 4 || compSizeAt(r2, c2, g) >= 4;
  }

  function findMove() {
    var b = S && S.board;
    if (!b) { return null; }
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (c + 1 < COLS && swapIsMove(b, r, c, r, c + 1)) { return [r, c, r, c + 1]; }
        if (r + 1 < ROWS && swapIsMove(b, r, c, r + 1, c)) { return [r, c, r + 1, c]; }
      }
    }
    return null;
  }

  /* 힌트는 「네 개가 이어진다」는 자리만 골라 주므로 문구도 하나입니다 */
  function hintTextFor() {
    return '빛나는 두 신수를 바꾸면 네 개가 이어져요';
  }

  /* ===================================================================
     10. 입력 — 스와이프 · 두 번 탭 (멈춰 있는 칸은 연출 중에도 바로)
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
    var p = pointOf(ev);
    var cell = cellFromPoint(p.x, p.y);
    if (!cell) { return; }
    var cl = S.board[cell.r][cell.c];
    /* 터지거나 떨어지고 있는 칸만 잠깁니다 — 다른 칸은 그대로 누를 수 있어요 */
    if (busy(cl)) { return; }
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
    if (Math.abs(dx) > Math.abs(dy)) { c2 += dx > 0 ? 1 : -1; }
    else { r2 += dy > 0 ? 1 : -1; }
    var from = S.drag;
    trySwap(from.r, from.c, r2, c2);
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

  function swapCells(r1, c1, r2, c2) {
    var a = S.board[r1][c1];
    S.board[r1][c1] = S.board[r2][c2];
    S.board[r2][c2] = a;
  }

  function trySwap(r1, c1, r2, c2) {
    if (!S || S.over) { return false; }
    if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) { return false; }
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) { return false; }
    var a = S.board[r1][c1];
    var b = S.board[r2][c2];
    if (busy(a) || busy(b)) { return false; }

    var m = S.metrics;
    S.selected = null;
    S.hintPair = null;
    S.hintUntil = 0;
    S.lastInput = S.clock;
    S.swapKeys = [key(r1, c1), key(r2, c2)];

    swapCells(r1, c1, r2, c2);
    S.board[r2][c2].x = (c1 - c2) * m.cell;
    S.board[r2][c2].y = (r1 - r2) * m.cell;
    S.board[r1][c1].x = (c2 - c1) * m.cell;
    S.board[r1][c1].y = (r2 - r1) * m.cell;

    /* 무지개 경단도 자기 신수 색을 가지므로, 네 개 이상 덩어리가 생길 때만 유효한 수입니다 */
    var g = typeGrid();
    var ok = compSizeAt(r1, c1, g) >= 4 || compSizeAt(r2, c2, g) >= 4;

    if (!ok) {
      swapCells(r1, c1, r2, c2);
      S.board[r1][c1].x = (c2 - c1) * m.cell;
      S.board[r1][c1].y = (r2 - r1) * m.cell;
      S.board[r2][c2].x = (c1 - c2) * m.cell;
      S.board[r2][c2].y = (r1 - r2) * m.cell;
      S.swapKeys = null;
      setHint('그 자리로는 네 개가 이어지지 않아요 · 다른 자리를 골라 주세요');
      return false;
    }
    return true;
  }

  /* ===================================================================
     11. 매 프레임 — 멈춘 칸의 덩어리 찾기 · 판 막힘
     =================================================================== */

  function resolveTick() {
    if (!S || S.over) { return; }

    var groups = findSettledGroups();
    if (groups.length) {
      popGroups(groups);
      return;
    }
    if (boardBusy()) { return; }

    if (S.chain && S.clock - S.lastPopAt > 1800) { S.chain = 0; }
    if (S.clock - S.lastMoveCheck < 400) { return; }
    S.lastMoveCheck = S.clock;
    if (!findMove()) {
      shuffleBoard();
      setHint('둘 수 있는 수가 없어 신수들을 새로 섞었어요');
    }
  }

  /* ===================================================================
     12. 그리기
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

  function drawSpecialMark(cl, cx, cy, size) {
    var half = size * 0.44;
    var w = Math.max(2.6, size * 0.085);
    ctx.save();
    ctx.lineCap = 'round';

    function strokeDark(path) {
      ctx.save();
      ctx.strokeStyle = 'rgba(10, 22, 20, .78)';
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

  /* ---- 특수 경단 발동 연출 ---- */

  function fxBeam(f, k, m) {
    var cx = m.x0 + f.c * m.cell + m.cell / 2;
    var cy = m.y0 + f.r * m.cell + m.cell / 2;
    var grow = Math.min(1, k / 0.16);
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
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = '#fffdf4';
    if (f.dir === 'row') {
      roundRect(ctx, l, cy - thick * 0.09, Math.max(1, r - l), Math.max(1.5, thick * 0.18), thick * 0.09);
    } else {
      roundRect(ctx, cx - thick * 0.09, t, Math.max(1.5, thick * 0.18), Math.max(1, b - t), thick * 0.09);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
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

  function fxBlast(f, k, m) {
    var cx = m.x0 + f.c * m.cell + m.cell / 2;
    var cy = m.y0 + f.r * m.cell + m.cell / 2;
    var a = Math.max(0, 1 - k);
    ctx.save();
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, m.cell * 1.75);
    glow.addColorStop(0, 'rgba(255,255,232,' + Math.min(1, a * 1.5).toFixed(3) + ')');
    glow.addColorStop(0.32, 'rgba(255,196,86,' + (a * 0.62).toFixed(3) + ')');
    glow.addColorStop(0.72, 'rgba(255,132,40,' + (a * 0.26).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(255,110,30,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, m.cell * 1.75, 0, Math.PI * 2); ctx.fill();
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
      var fl = Math.max(0, 1 - Math.abs(k - 0.3) / 0.55);
      if (fl > 0) {
        var g2 = ctx.createRadialGradient(tx, ty, 0, tx, ty, m.cell * 0.95);
        g2.addColorStop(0, 'rgba(255,255,244,' + Math.min(1, fl * 1.05).toFixed(3) + ')');
        g2.addColorStop(0.45, 'hsla(' + hue + ',100%,80%,' + (fl * 0.72).toFixed(3) + ')');
        g2.addColorStop(1, 'rgba(255,220,140,0)');
        ctx.fillStyle = g2;
        ctx.beginPath(); ctx.arc(tx, ty, m.cell * 0.95, 0, Math.PI * 2); ctx.fill();
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

    /* 판 바탕 — 밤 연못 · 물빛 */
    var bg = ctx.createRadialGradient(w * 0.5, h * 0.1, 8, w * 0.5, h * 0.62, Math.max(w, h) * 1.05);
    bg.addColorStop(0, '#16324a');
    bg.addColorStop(0.52, '#16232e');
    bg.addColorStop(1, '#1b2b24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    /* 칸 자리 */
    var pad = Math.max(2, m.cell * 0.06);
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var x = m.x0 + c * m.cell;
        var y = m.y0 + r * m.cell;
        roundRect(ctx, x + pad, y + pad, m.cell - pad * 2, m.cell - pad * 2, m.cell * 0.2);
        ctx.fillStyle = 'rgba(206,246,240,.045)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,236,228,.07)';
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
        var shrink = 1;
        var alpha = 1;
        if (cl.pop > 0) {
          var kp = clamp(cl.pop / POP_MS, 0, 1);
          shrink = Math.max(0.05, 1 + 0.16 * Math.sin(Math.min(1, kp * 2.2) * Math.PI) - kp * kp);
          alpha = Math.max(0, 1 - kp * kp);
        }
        var size = m.cell * 1.08 * (cl.sc || 1) * shrink;
        var glow = ctx.createRadialGradient(p.x, p.y + size * 0.1, size * 0.1, p.x, p.y, size * 0.55);
        glow.addColorStop(0, TYPES[cl.t].glow);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.34 * alpha;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        drawSprite(cl.t, p.x, p.y, size, alpha);
        if (cl.sp && alpha > 0.35) { drawSpecialMark(cl, p.x, p.y, size); }
      }
    }

    /* 고른 칸 */
    if (S.selected) {
      var sel = S.selected;
      var sx = m.x0 + sel.c * m.cell;
      var sy = m.y0 + sel.r * m.cell;
      var pulse = 0.6 + 0.4 * Math.abs(Math.sin(S.clock / 180));
      roundRect(ctx, sx + 1.5, sy + 1.5, m.cell - 3, m.cell - 3, m.cell * 0.22);
      ctx.strokeStyle = 'rgba(198,248,240,' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 2.6;
      ctx.shadowColor = 'rgba(140,240,230,.85)';
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    /* 힌트 */
    if (S.hintPair && S.clock < S.hintUntil) {
      var pair = S.hintPair;
      var k1 = 0.35 + 0.55 * Math.abs(Math.sin(S.clock / 220));
      [[pair[0], pair[1]], [pair[2], pair[3]]].forEach(function (pos) {
        var hx = m.x0 + pos[1] * m.cell;
        var hy = m.y0 + pos[0] * m.cell;
        roundRect(ctx, hx + 2, hy + 2, m.cell - 4, m.cell - 4, m.cell * 0.24);
        ctx.strokeStyle = 'rgba(255,255,255,' + k1.toFixed(2) + ')';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      });
    }

    /* 효과 */
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
        ctx.fillStyle = '#e4fff6';
        ctx.font = '800 ' + Math.round(m.cell * 0.36) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,.6)';
        ctx.shadowBlur = 6;
        ctx.fillText(f.text, f.x, f.y - 26 * k);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      } else if (f.kind === 'make') {
        var mk = Math.max(0, 1 - Math.max(0, k - 0.5) / 0.5);
        var mx = m.x0 + f.c * m.cell + m.cell / 2;
        var my = m.y0 + f.r * m.cell + m.cell / 2 - 16 * k;
        ctx.globalAlpha = mk;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 ' + Math.round(m.cell * 0.3) + 'px sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(8,30,30,.85)';
        ctx.strokeText(f.text, mx, my);
        ctx.fillStyle = '#b8f6e6';
        ctx.fillText(f.text, mx, my);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'combo') {
        var pop = k < 0.18 ? (0.6 + k * 2.4) : 1;
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, k - 0.55) / 0.45);
        ctx.save();
        ctx.translate(w / 2, h * 0.4);
        ctx.scale(pop, pop);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '900 ' + Math.round(m.cell * 0.6) + 'px sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(8,34,34,.9)';
        ctx.strokeText(f.text, 0, 0);
        var gold = ctx.createLinearGradient(0, -m.cell * 0.4, 0, m.cell * 0.4);
        gold.addColorStop(0, '#f4fffa');
        gold.addColorStop(0.5, '#a8f0dd');
        gold.addColorStop(1, '#5cc9c9');
        ctx.fillStyle = gold;
        ctx.fillText(f.text, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'time') {
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

    /* 마지막 10초 — 판 가장자리가 붉게 */
    if (!S.over && S.timeLeft <= 10000) {
      var red = 0.1 + 0.24 * Math.abs(Math.sin(S.clock / 180));
      ctx.strokeStyle = 'rgba(255,86,86,' + red.toFixed(2) + ')';
      ctx.lineWidth = 5;
      ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    }
  }

  /* ===================================================================
     13. 크기 · 반복
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
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (S.board && S.board[r][c]) { S.board[r][c].x = 0; S.board[r][c].y = 0; }
      }
    }
  }

  function update(dt) {
    if (!S) { return; }
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var cl = S.board[r][c];
        if (!cl) { continue; }
        if (cl.x !== 0) {
          cl.x += -cl.x * Math.min(1, dt / 55);
          if (Math.abs(cl.x) < 0.5) { cl.x = 0; }
        }
        if (cl.y !== 0) {
          cl.y += -cl.y * Math.min(1, dt / 62);
          if (Math.abs(cl.y) < 0.5) { cl.y = 0; }
        }
        if (cl.sc !== 1) {
          cl.sc += (1 - cl.sc) * Math.min(1, dt / 120);
          if (Math.abs(cl.sc - 1) < 0.02) { cl.sc = 1; }
        }
      }
    }

    updatePops(dt);

    for (var i = S.fx.length - 1; i >= 0; i--) {
      S.fx[i].age += dt;
      if (S.fx[i].age >= S.fx[i].max) { S.fx.splice(i, 1); }
    }

    /* 고른 칸이 움직이기 시작하면 선택을 풉니다 */
    if (S.selected) {
      var sel = S.board[S.selected.r] && S.board[S.selected.r][S.selected.c];
      if (busy(sel)) { S.selected = null; }
    }

    /* 3초 넘게 가만히 있으면 힌트 */
    if (!S.over && S.clock - S.lastInput > 3000) {
      if (!S.hintPair || S.clock > S.hintUntil) {
        S.hintPair = findMove();
        S.hintUntil = S.clock + 2600;
        if (S.hintPair) { setHint(hintTextFor(S.hintPair)); }
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
    if (el.timerWrap) { el.timerWrap.classList.toggle('is-urgent', S.timeLeft <= 10000); }
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
      if (!S.paused && !S.over) { resolveTick(); }
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
     14. 안내 문구
     =================================================================== */

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
     15. 판 시작 · 끝
     =================================================================== */

  function startGame(first) {
    S = newState();
    S.board = buildBoard();
    S.running = true;
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
    setHint(first
      ? '이어진 같은 신수를 가로세로로 4개 이상 모아 터뜨려 보세요 · 60초!'
      : '새 판이에요 · 터지는 동안에도 다른 칸은 바로 누를 수 있어요');
    startLoop();
  }

  function endGame() {
    if (!S || S.over) { return; }
    S.over = true;
    S.selected = null;
    S.drag = null;
    S.hintPair = null;
    closeSheet();
    if (S.score > S.best) { S.best = S.score; }
    setLocalBest(S.score);
    renderScore();
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
    submit(S.score, S.maxCombo).then(function (res) {
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
    if (!opts.live && !guestRank()) {
      return '체험 모드예요 · 이 기기의 최고 기록 <b>' + fmtNum(S.best) + '점</b>으로 남아요';
    }
    if (S.submitState.failed === 'pending') {
      return '서버에 신수모아 랭킹이 아직 준비되지 않았어요 · 이 기기 최고 <b>' +
        fmtNum(S.best) + '점</b>으로 즐겨 주세요';
    }
    if (S.submitState.failed) {
      return '랭킹에 올리지 못했어요 · 이 기기 최고 <b>' + fmtNum(S.best) + '점</b>';
    }
    var res = S.submitState.result;
    if (res && res.rank) {
      return (res.is_new_best ? '🎉 <b>새 최고 기록</b> · ' : '') +
        rankWord() + ' <b>' + res.rank + '위</b> · 최고 ' + fmtNum(res.best_score) + '점';
    }
    if (S.submitState.pending) { return rankWord() + '에 올리는 중이에요…'; }
    return '';
  }

  function renderOverResult() {
    var box = $('#sm-over-result');
    if (box) { box.innerHTML = currentResultHtml(); }
  }

  function showOver() {
    if (!el.over) { return; }
    el.over.innerHTML =
      '<div class="gd-over__card">' +
        '<p class="gd-over__kicker">60초 종료</p>' +
        '<h3 class="gd-over__title">신수모아 한 판 끝!</h3>' +
        '<p class="gd-over__score"><strong>' + fmtNum(S.score) + '</strong><span>점</span></p>' +
        '<p class="gd-over__meta">최고 <b>' + fmtNum(S.best) + '</b>점 · 최대 <b>' +
          (S.maxCombo || 0) + ' 연쇄</b></p>' +
        '<p class="gd-over__result" id="sm-over-result">' + currentResultHtml() + '</p>' +
        '<div class="gd-over__row">' +
          '<button type="button" class="btn btn--ghost btn--small" id="sm-over-rank">🏆 ' + rankWord() + '</button>' +
          '<button type="button" class="btn btn--primary btn--small" id="sm-over-restart">다시하기</button>' +
        '</div>' +
      '</div>';
    el.over.hidden = false;
    var rank = $('#sm-over-rank', el.over);
    var again = $('#sm-over-restart', el.over);
    if (rank) { rank.addEventListener('click', function () { openSheet('rank'); }); }
    if (again) { again.addEventListener('click', function () { startGame(false); }); }
  }

  function hideOver() {
    if (!el.over) { return; }
    el.over.hidden = true;
    el.over.innerHTML = '';
  }

  /* ===================================================================
     16. 문파 랭킹
     =================================================================== */

  function rankingMarkup() {
    var html = '<div class="gd-sheet__head"><h3>🏆 ' + (guestRank() ? '신수모아 체험 랭킹' : '신수모아 문파 랭킹') + '</h3>' +
      '<button type="button" class="gd-sheet__close" data-sheet-close="1" aria-label="닫기">×</button></div>';

    if (guestRank()) { return html + guestRankingBody(); }

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
      html += '<div class="gd-rank__empty">서버에 신수모아 랭킹이 아직 준비되지 않았어요.<br>' +
        '운영진이 <b>supabase/migration-sinsumoa.sql</b> 을 실행하면 문파원 모두의 기록이 모여요.<br>' +
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
          (combo > 0 ? ' · 최대 ' + combo + ' 연쇄' : '') + '</span></span>' +
        '<span class="gd-rank__score">' + fmtNum(row.best_score) + '</span>' +
        '</li>';
    });
    html += '</ol>';
    if (opts.nickname && !ranking.rows.some(function (r) { return r.nickname === opts.nickname; })) {
      html += '<p class="gd-sheet__note">내 기록이 아직 없어요 · 한 판 마치면 랭킹에 올라요</p>';
    }
    return html;
  }

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
      var combo = Number((row.meta || {}).combo) || 0;
      html += '<li class="gd-rank__row' + (mine ? ' is-mine' : '') + '">' +
        '<span class="gd-rank__no">' + (row.rank || '-') + '</span>' +
        '<span class="gd-rank__avatar gd-rank__avatar--initial">' + escapeHtml(String(row.nickname || '?').slice(0, 1)) + '</span>' +
        '<span class="gd-rank__who"><b>' + escapeHtml(row.nickname || '') + '</b>' +
        '<span class="gd-rank__role">체험' + (combo > 0 ? ' · 최대 ' + combo + ' 연쇄' : '') + '</span></span>' +
        '<span class="gd-rank__score">' + fmtNum(row.score) + '</span>' +
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
        if (opts.nickname && String(r.nickname).toLowerCase() === String(opts.nickname).toLowerCase()) { mine = r; }
      });
      var mineScore = mine ? Number(mine.best_score || mine.score || 0) : 0;
      if (mine && mineScore > (S ? S.best : 0)) {
        if (S) { S.best = mineScore; renderScore(); }
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
     17. 열기 · 닫기 · 다시하기
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
      opts.onToast('🫧 신수모아 ' + fmtNum(S.score) + '점 · 최고 ' + fmtNum(S.best) + '점');
    }
  }

  window.YM_SINSUMOA = {
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
          timeLeft: S.timeLeft, over: S.over, busy: boardBusy(),
          selected: S.selected ? { r: S.selected.r, c: S.selected.c } : null,
          hint: S.hintPair ? S.hintPair.slice() : null,
          count: S.board ? S.board.reduce(function (n, row) { return n + row.filter(Boolean).length; }, 0) : 0
        } : null;
      },
      fx: function () {
        return S ? S.fx.map(function (f) { return { kind: f.kind, text: f.text, age: f.age, max: f.max }; }) : [];
      },
      freeze: function (on) { frozen = !!on; },
      advanceFx: function (ms) {
        if (!S) { return; }
        S.fx.forEach(function (f) { f.age = Math.min(f.max - 1, (f.age || 0) + (Number(ms) || 0)); });
        draw();
      },
      comboMultiplier: comboMultiplier,
      board: function () {
        if (!S) { return null; }
        return typeGrid();
      },
      cells: function () {
        if (!S) { return null; }
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var cl = S.board[r][c];
            out.push({ r: r, c: c, t: cl ? cl.t : -1, sp: cl ? cl.sp : '',
                       pop: cl ? cl.pop : 0, x: cl ? cl.x : 0, y: cl ? cl.y : 0 });
          }
        }
        return out;
      },
      /* 지금 터지거나 떨어지는 중인 칸 */
      moving: function () {
        if (!S) { return []; }
        var out = [];
        for (var r = 0; r < ROWS; r++) {
          for (var c = 0; c < COLS; c++) {
            var cl = S.board[r][c];
            if (!cl) { continue; }
            if (cl.pop > 0) { out.push({ r: r, c: c, why: 'pop' }); }
            else if (Math.abs(cl.x) > 0.5 || Math.abs(cl.y) > 0.5) { out.push({ r: r, c: c, why: 'fall' }); }
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
        S.hintPair = null;
        S.swapKeys = null;
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
      groups: function () { return findSettledGroups(); },
      swap: function (r1, c1, r2, c2) { return trySwap(r1, c1, r2, c2); },
      tap: function (r, c) {
        if (!S || S.over) { return false; }
        if (busy(S.board[r] && S.board[r][c])) { return false; }
        if (S.selected && S.selected.r === r && S.selected.c === c) { S.selected = null; return true; }
        if (S.selected && (Math.abs(S.selected.r - r) + Math.abs(S.selected.c - c) === 1)) {
          var from = S.selected;
          S.selected = null;
          return trySwap(from.r, from.c, r, c);
        }
        S.selected = { r: r, c: c };
        return true;
      },
      /* 테스트용 — 판이 완전히 멈출 때까지 기다리지 않고 한 번 정리합니다 */
      settle: function () {
        if (!S) { return false; }
        var guard = 0;
        while (boardBusy() && guard < 400) {
          update(16);
          guard += 1;
        }
        draw();
        return !boardBusy();
      },
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
      metrics: function () {
        return S ? { cell: S.metrics.cell, x0: S.metrics.x0, y0: S.metrics.y0, w: S.w, h: S.h, dpr: S.dpr } : null;
      },
      types: function () { return TYPES.map(function (t) { return { tier: t.tier, name: t.name }; }); },
      specialForGroup: specialForGroup
    }
  };
})();
