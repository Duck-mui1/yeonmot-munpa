/* =========================================================
   ⚔️ 도술 계산기 — 화면 (슬롯 · 신식 · 스펙 조정 · 결과 · 타임라인)
   엔진은 js/dosul-calc.js (YM_DOSUL) 가 계산합니다.
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.YM_DOSUL;
  if (!C) { return; }

  var SAVE_KEY = 'ym.dosul.v1';
  var SHARE_KEY = 'ym.dosul.shared.v1';
  var el = {};
  var S = null;
  var API = { live: false, nickname: '', api: null };
  var SH = { status: 'idle', items: [], message: '', armed: '', expanded: false };
  var opened = false;
  var bound = false;
  var timer = null;

  var SLOT_NAMES = ['1번', '2번', '3번', '4번', '5번', '6번', '7번', '8번'];
  var DURATIONS = [30, 60, 120];

  /* 도술 아이콘 — js/dosul-icons.js 가 없으면 빈 문자열(아이콘 없이 동작) */
  var ICONS = global.YM_DOSUL_ICONS || null;
  function ico(id, cls, size, lazy) {
    if (!ICONS || id == null) { return ''; }
    return ICONS.html(id, { cls: cls || '', size: size || 40, lazy: !!lazy });
  }

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n, d) {
    if (n == null || isNaN(n)) { return '–'; }
    var v = Number(n);
    var fixed = v.toFixed(d == null ? 1 : d);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1');
  }

  function defaults() {
    return {
      slots: [null, null, null, null, null, null, null, null],
      duration: 60,
      cdReducePct: 0,
      castMode: 'delay',
      chargeFull: true,
      ultFirst: true,
      autoInterval: 1,
      autoCoeff: 100,
      gap: 0,
      toggles: {},
      override: {},
      enhance: {},
      trans: {},
      picker: { slot: -1, style: '', q: '' }
    };
  }

  function load() {
    var base = defaults();
    var raw = null;
    try { raw = global.localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) {
      /* 처음 열면 1번 프리셋을 채워 둡니다 — 바로 결과가 보이도록 */
      var p = C.presets()[0];
      if (p) { base.slots = p.slots.slice(0, 8); }
      return base;
    }
    try {
      var s = JSON.parse(raw);
      for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(s, k) && s[k] != null) { base[k] = s[k]; }
      }
      if (!Array.isArray(base.slots) || base.slots.length !== 8) {
        base.slots = defaults().slots;
      }
      base.slots = base.slots.map(function (v) { return v && C.skillById(v) ? v : null; });
      base.enhance = (base.enhance && typeof base.enhance === 'object') ? base.enhance : {};
      base.trans = (base.trans && typeof base.trans === 'object') ? base.trans : {};
      base.picker = { slot: -1, style: '', q: '' };
    } catch (e) { /* 깨진 저장값은 기본값으로 */ }
    /* 저장된 신식 토글 중 지금 활성 계열이 아닌 것은 그대로 두되 화면에는 활성만 보입니다 */
    return base;
  }

  function save() {
    try {
      var out = {
        slots: S.slots, duration: S.duration, cdReducePct: S.cdReducePct,
        castMode: S.castMode, chargeFull: S.chargeFull, ultFirst: S.ultFirst,
        autoInterval: S.autoInterval, autoCoeff: S.autoCoeff, gap: S.gap,
        toggles: S.toggles, override: S.override,
        enhance: S.enhance, trans: S.trans
      };
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(out));
    } catch (e) { /* 저장은 선택 */ }
  }

  /* 기본값: 신식이 활성되면 그 계열 신식 효과 토글을 자동으로 켭니다
     (게임에서 3개를 넣으면 신식이 열리는 것과 같게) */
  function syncToggles() {
    var sin = C.sinStyles(S.slots);
    var active = {};
    sin.forEach(function (s) { active[s.key] = true; });
    C.styles().forEach(function (st) {
      if (!active[st.key]) { return; }
      if (!S.toggles[st.key]) {
        S.toggles[st.key] = st.toggles.map(function (t) { return t.id; });
      }
    });
  }

  function config() {
    return {
      slots: S.slots,
      duration: S.duration,
      cdReducePct: S.cdReducePct,
      castMode: S.castMode,
      chargeFull: S.chargeFull,
      ultFirst: S.ultFirst,
      autoInterval: S.autoInterval,
      autoCoeff: S.autoCoeff,
      gap: S.gap,
      toggles: S.toggles,
      override: S.override,
      enhance: S.enhance,
      trans: S.trans
    };
  }

  /* ---------------------------------------------------------
     뼈대
     --------------------------------------------------------- */
  function buildShell() {
    var body = el.body;
    if (!body) { return; }
    body.innerHTML = [
      '<div class="ds-head">',
      '  <p class="ds-head__kicker">도깨비의 세계</p>',
      '  <h2 class="ds-head__title"><svg class="ds-head__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M20 4v5.1L11.3 17.8H6.9v-4.4L15.6 4.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M4.3 19.7 8 16M3.5 15.3l5.2 5.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '도술 계산기</h2>',
      '  <p class="ds-head__sub">쿨타임과 시전시간으로 <b>평타 치는 빈 시간</b>을 계산합니다</p>',
      '</div>',

      '<div class="ds-lead">',
      '  <p>도술마다 <b>쿨타임</b>과 <b>시전시간</b>이 달라서, 쿨이 비면 <b>평타</b>를 칩니다.',
      '  아래 8칸을 채우면 <b>평타 치는 빈 시간</b>과 <b>초당 피해</b>를 바로 계산합니다.</p>',
      '</div>',

      '<section class="ds-sec ds-sec--gold">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">1</span><h3>인기 프리셋</h3><button type="button" class="ds-link" data-act="clear">전부 비우기</button></div>',
      '  <p class="ds-sec__sub">실제 공략에서 쓰는 조합 — 누르면 8칸이 한 번에 채워집니다.</p>',
      '  <div class="ds-presets" id="ds-presets"></div>',
      '</section>',

      '<section class="ds-sec ds-sec--rose ds-shared" id="ds-shared">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">2</span><h3>문파 공유 조합</h3><span class="ds-hint" id="ds-shared-hint">눌러서 불러오기</span></div>',
      '  <p class="ds-sec__sub">문파원이 올린 조합을 눌러 그대로 불러옵니다. 강화·돌파 설정까지 함께 저장됩니다.</p>',
      '  <div class="ds-shared__list" id="ds-shared-list"></div>',
      '</section>',

      '<section class="ds-sec" id="ds-slots-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">3</span><h3>도술 8칸</h3><span class="ds-hint">칸을 누르면 도술을 고릅니다</span></div>',
      '  <div class="ds-slots" id="ds-slots"></div>',
      '  <div class="ds-subhead"><b>신식 · 궁극기</b><span>같은 계열 3개면 자동으로 열립니다</span></div>',
      '  <div class="ds-sin" id="ds-sin"></div>',
      '</section>',

      '<section class="ds-sec ds-sec--gold" id="ds-enhance-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">4</span><h3>강화 · 돌파</h3><span class="ds-hint" id="ds-enh-sum"></span></div>',
      '  <p class="ds-sec__sub">강화는 <b>계열 단위</b>(Lv50 · 피해 +75%), 돌파는 <b>도술 하나씩</b>(10단계 · 단계마다 피해 +3% · 쿨 -1.5%). 6돌파에서는 <b>[돌파 효과]</b>가 열립니다.</p>',
      '  <div class="ds-enh-wrap" id="ds-enhance"></div>',
      '</section>',

      '<details class="ds-sec ds-tune" id="ds-tune">',
      '  <summary><span class="ds-sec__num">5</span><span class="ds-tune__title">내 스펙 조정</span><em id="ds-tune-sum">쿨감 0% · 60초</em></summary>',
      '  <div class="ds-tune__body" id="ds-tune-body"></div>',
      '</details>',

      '<section class="ds-sec ds-sec--result" id="ds-result-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">6</span><h3>계산 결과</h3><span class="ds-hint">8칸 · 강화 · 돌파가 바로 반영</span></div>',
      '  <div class="ds-result" id="ds-result"></div>',
      '</section>',

      '<p class="ds-credit">' + esc((global.YM_DOSUL_ICONS && global.YM_DOSUL_ICONS.credit) ||
        '도술 아이콘의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제될 수 있습니다.') + '</p>',

      '<div class="ds-share" id="ds-share" hidden>',
      '  <div class="ds-share__panel" role="dialog" aria-modal="true" aria-labelledby="ds-share-title">',
      '    <p class="ds-share__head" id="ds-share-title">💾 이 조합 문파에 공유하기</p>',
      '    <label class="ds-share__field"><span>조합 이름</span>',
      '      <input type="text" id="ds-share-name" maxlength="40" placeholder="예: 사냥용 파멸3 주술3"></label>',
      '    <label class="ds-share__field"><span>메모 (선택)</span>',
      '      <input type="text" id="ds-share-memo" maxlength="200" placeholder="예: 무과금 · 쿨감 10%"></label>',
      '    <p class="ds-share__sum" id="ds-share-sum"></p>',
      '    <p class="ds-share__note" id="ds-share-note"></p>',
      '    <div class="ds-share__acts">',
      '      <button type="button" class="ds-btn" data-act="share-cancel">취소</button>',
      '      <button type="button" class="ds-btn ds-btn--accent" data-act="share-save">저장</button>',
      '    </div>',
      '  </div>',
      '</div>',

      '<section class="ds-picker" id="ds-picker" hidden>',
      '  <div class="ds-picker__head">',
      '    <strong id="ds-picker-title">1번 칸에 넣을 도술</strong>',
      '    <button type="button" class="ds-picker__close" data-act="picker-close">닫기</button>',
      '  </div>',
      '  <div class="ds-picker__filters" id="ds-picker-filters"></div>',
      '  <label class="ds-picker__search"><input type="search" id="ds-picker-q" placeholder="도술 이름 검색" autocomplete="off"></label>',
      '  <div class="ds-picker__list" id="ds-picker-list"></div>',
      '</section>'
    ].join('\n');

    el.presets = $('#ds-presets');
    el.slots = $('#ds-slots');
    el.sin = $('#ds-sin');
    el.enhance = $('#ds-enhance');
    el.enhSum = $('#ds-enh-sum');
    el.tuneSum = $('#ds-tune-sum');
    el.tuneBody = $('#ds-tune-body');
    el.result = $('#ds-result');
    el.shared = $('#ds-shared-list');
    el.sharedHint = $('#ds-shared-hint');
    el.shareBox = $('#ds-share');
    el.shareName = $('#ds-share-name');
    el.shareMemo = $('#ds-share-memo');
    el.shareSum = $('#ds-share-sum');
    el.shareNote = $('#ds-share-note');
    el.picker = $('#ds-picker');
    el.pickerTitle = $('#ds-picker-title');
    el.pickerFilters = $('#ds-picker-filters');
    el.pickerQ = $('#ds-picker-q');
    el.pickerList = $('#ds-picker-list');
  }

  /* ---------------------------------------------------------
     프리셋
     --------------------------------------------------------- */
  function renderPresets() {
    var html = C.presets().map(function (p) {
      var names = p.slots.map(function (id) {
        var sk = C.skillById(id);
        return sk ? sk.n : '';
      }).filter(Boolean);
      var same = p.slots.join(',') === S.slots.join(',');
      return '<button type="button" class="ds-preset' + (same ? ' is-on' : '') + '" data-preset="' + esc(p.id) + '">' +
        '<strong>' + esc(p.name) + '</strong>' +
        '<span>' + esc(names.slice(0, 4).join(' · ')) + (names.length > 4 ? ' 외 ' + (names.length - 4) + '개' : '') + '</span>' +
        '<em>' + esc(p.note) + '</em>' +
        '</button>';
    }).join('');
    el.presets.innerHTML = html;
  }

  /* ---------------------------------------------------------
     슬롯
     --------------------------------------------------------- */
  function renderSlots() {
    var html = S.slots.map(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      var basic = i < 5;
      var cls = 'ds-slot' + (sk ? ' is-filled' : ' is-empty') + (basic ? '' : ' is-extra');
      if (!sk) {
        return '<button type="button" class="' + cls + '" data-slot="' + i + '">' +
          '<span class="ds-slot__no">' + (i + 1) + '</span>' +
          '<span class="ds-slot__name">+ 도술 넣기</span>' +
          '<span class="ds-slot__meta">' + (basic ? '기본 칸' : '추가 칸') + '</span>' +
          '</button>';
      }
      return '<div class="' + cls + '" data-slot="' + i + '" style="--ds-style:' + C.styleColor(sk.st) + '">' +
        '<button type="button" class="ds-slot__hit" data-slot="' + i + '">' +
        '<span class="ds-slot__iconwrap">' +
        ico(sk.id, 'ds-ico--slot', 38) +
        '<span class="ds-slot__no">' + (i + 1) + '</span>' +
        '</span>' +
        '<span class="ds-slot__body">' +
        '<span class="ds-slot__name">' + esc(sk.n) + '</span>' +
        '<span class="ds-slot__meta">' + esc(C.styleName(sk.st)) + ' · ' + num(sk.cd) + '초 · ' + num(sk.ct, 2) + '초</span>' +
        '</span>' +
        '</button>' +
        '<span class="ds-slot__move">' +
        '<button type="button" data-mv="up" data-slot="' + i + '" aria-label="' + (i + 1) + '번 칸 앞으로">▲</button>' +
        '<button type="button" data-mv="down" data-slot="' + i + '" aria-label="' + (i + 1) + '번 칸 뒤로">▼</button>' +
        '</span>' +
        '</div>';
    }).join('');
    el.slots.innerHTML = html;
  }

  /* ---------------------------------------------------------
     신식 · 궁극기
     --------------------------------------------------------- */
  function renderSin() {
    syncToggles();
    var sin = C.sinStyles(S.slots);
    var counts = C.styleCounts(S.slots);
    var chips = C.styles().map(function (st) {
      var c = counts[st.key] || 0;
      if (!c) { return ''; }
      var on = c >= 3;
      return '<span class="ds-sinchip' + (on ? ' is-on' : '') + '" style="--ds-style:' + st.color + '">' +
        esc(st.name) + ' ' + c + '개' + (on ? ' · 신식' : ' <em>/3</em>') + '</span>';
    }).join('');

    var active = sin.map(function (s) {
      var st = s.style;
      var ult = C.skillById(st.ult);
      var toggles = st.toggles.map(function (t) {
        var on = (S.toggles[st.key] || []).indexOf(t.id) >= 0;
        var has = Object.keys(t.fx || {}).length > 0;
        return '<label class="ds-tgl' + (has ? '' : ' is-info') + '">' +
          '<input type="checkbox" data-toggle="' + esc(st.key) + ':' + esc(t.id) + '"' + (on ? ' checked' : '') + '>' +
          '<span>' + esc(t.label) + '</span></label>';
      }).join('');
      return '<div class="ds-sinon" style="--ds-style:' + st.color + '">' +
        '<p class="ds-sinon__head"><span class="ds-sinon__name">' +
        ico(ult ? ult.id : st.ult, 'ds-ico--ult', 28) +
        '<b class="ds-sinon__title">' + esc(st.name) + ' 신식</b></span>' +
        '<span>궁극기 <b class="ds-sinon__ult">' + esc(ult ? ult.n : '') + '</b> 자동 장착 · ' + num(ult ? ult.cd : 0) + '초</span></p>' +
        '<p class="ds-sinon__mech">' + esc(st.mech.join(' ')) + '</p>' +
        '<div class="ds-tgls">' + toggles + '</div>' +
        '</div>';
    }).join('');

    el.sin.innerHTML = '<div class="ds-sinchips">' + chips + '</div>' +
      (active || '<p class="ds-sin__empty">기본 1~5번 칸에 <b>같은 계열 3개</b>를 넣으면 그 계열 <b>신식</b>과 <b>궁극기(R)</b>가 자동으로 켜집니다.</p>');
  }

  /* ---------------------------------------------------------
     강화 · 돌파
     · 강화(계열 강화)는 계열(스타일) 하나에 Lv1~50 — 그 계열 도술 모두에 붙습니다.
     · 돌파는 도술 하나씩 0~10단계 — 그 도술에만 붙습니다.
     수치는 도깨비지지(kkaebi.gg) 도술 상세 확인값이고, 공개값이 없는
     도술(궁극기 등)은 슬라이더 대신 안내를 보여 주고 직접 수정으로 넘깁니다.
     --------------------------------------------------------- */
  function equippedStyles() {
    var out = [];
    var seen = {};
    S.slots.forEach(function (id) {
      var sk = id ? C.skillById(id) : null;
      if (!sk || seen[sk.st]) { return; }
      seen[sk.st] = true;
      out.push(sk.st);
    });
    var sin = C.sinStyles(S.slots);
    if (sin.length) {
      var key = sin[0].style.key;
      if (!seen[key]) { seen[key] = true; out.push(key); }
    }
    return out;
  }

  function enhLevelOf(key) {
    return Math.max(0, Math.round(Number(S.enhance[key]) || 0));
  }

  function enhPctText(key) {
    var pct = C.enhanceBonus(enhLevelOf(key), null);
    return '+' + num(pct, 1) + '%';
  }

  /* "파멸 19강 · 헌신 9강 · 돌파 3개" — 공유 창·요약에 쓰는 한 줄 */
  function enhSummaryText() {
    var parts = [];
    equippedStyles().forEach(function (key) {
      var lv = enhLevelOf(key);
      if (lv > 0) { parts.push(C.styleName(key) + ' ' + lv + '강'); }
    });
    var trOn = transTargets().filter(function (t) {
      return (Number(S.trans[t.sk.id]) || 0) > 0;
    }).length;
    if (trOn) { parts.push('돌파 ' + trOn + '개'); }
    return parts.join(' · ');
  }

  function enhStyleRow(key) {
    var st = C.styleOf(key);
    if (!st) { return ''; }
    var lv = enhLevelOf(key);
    var maxLv = C.enhanceMax();
    var count = S.slots.filter(function (id) {
      var sk = id ? C.skillById(id) : null;
      return sk && sk.st === key;
    }).length;
    var steps = [0, 9, 19, 29];
    if (maxLv >= 50) { steps.push(50); }
    var chips = steps.map(function (n) {
      return '<button type="button" class="ds-enh__chip' + (lv === n ? ' is-on' : '') + '"' +
        ' data-enh-set="' + esc(key) + ':' + n + '">' + (n === 0 ? '0' : n + '강') + '</button>';
    }).join('');
    return '<div class="ds-enh" data-enh-row="' + esc(key) + '" style="--ds-style:' + st.color + '">' +
      '<div class="ds-enh__top">' +
      '<span class="ds-enh__name"><i></i>' + esc(st.name) + '<em>' + count + '개 장착</em></span>' +
      '<span class="ds-enh__val" data-enh-val="' + esc(key) + '">Lv <b>' + lv + '</b> · 피해 <b>' + enhPctText(key) + '</b></span>' +
      '</div>' +
      '<input type="range" min="0" max="' + maxLv + '" step="1" value="' + lv + '"' +
      ' data-enh="' + esc(key) + '" aria-label="' + esc(st.name) + ' 계열 강화 레벨">' +
      '<div class="ds-enh__chips">' + chips + '</div>' +
      '</div>';
  }

  function transTargets() {
    var out = [];
    S.slots.forEach(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      if (sk) { out.push({ sk: sk, label: (i + 1) + '번' }); }
    });
    var sin = C.sinStyles(S.slots);
    if (sin.length) {
      var ult = C.skillById(sin[0].style.ult);
      if (ult) { out.push({ sk: ult, label: 'R' }); }
    }
    return out;
  }

  function transRow(sk, label) {
    var st = C.styleOf(sk.st);
    var step = Math.max(0, Math.round(Number(S.trans[sk.id]) || 0));
    var t = C.transInfo(sk.id, step);
    var enhPct = C.enhanceBonus(enhLevelOf(sk.st), sk.id);
    var meta = [];
    if (enhPct > 0) { meta.push('강화 +' + num(enhPct, 1) + '%'); }
    if (t.has) {
      if (t.step > 0) {
        if (t.dmgPct > 0) { meta.push('피해 +' + num(t.dmgPct, 1) + '%'); }
        if (t.cdSec > 0) { meta.push('쿨 -' + num(t.cdSec, 2) + '초'); }
        if (t.d6) { meta.push('6돌파 피해 +' + num(t.d6, 0) + '%'); }
      } else {
        meta.push('돌파 0단계');
      }
    }
    var control = t.has
      ? '<input type="range" min="0" max="10" step="1" value="' + t.step + '"' +
        ' data-trans="' + sk.id + '" aria-label="' + esc(sk.n) + ' 돌파 단계">'
      : '<p class="ds-trans__none">공개된 돌파 수치가 없습니다 — 「내 스펙 조정」에서 직접 넣어 주세요.</p>';
    var six = (t.has && t.t6)
      ? '<p class="ds-trans__six' + (t.t6on ? ' is-on' : '') + '">⑥ 6돌파 · ' + esc(t.t6) + '</p>'
      : '';
    return '<div class="ds-trans' + (t.has ? '' : ' is-none') + '" data-trans-row="' + sk.id + '" style="--ds-style:' + (st ? st.color : '#7fd1bd') + '">' +
      '<div class="ds-trans__top">' +
      ico(sk.id, 'ds-ico--tune', 18) +
      '<span class="ds-trans__name"><b>' + esc(sk.n) + '</b><em>' + esc(label) + ' · ' + esc(C.styleName(sk.st)) + '</em></span>' +
      '<span class="ds-trans__step" data-trans-val="' + sk.id + '">' + (t.has ? t.step + '돌파' : '–') + '</span>' +
      '</div>' +
      control +
      (meta.length ? '<p class="ds-trans__meta">' + meta.join(' · ') + '</p>' : '') +
      six +
      '</div>';
  }

  function renderEnhance() {
    if (!el.enhance) { return; }
    var styles = equippedStyles();
    var targets = transTargets();
    var enhOn = styles.filter(function (k) { return enhLevelOf(k) > 0; }).length;
    var trOn = targets.filter(function (t) {
      var info = C.transInfo(t.sk.id, S.trans[t.sk.id]);
      return info.step > 0;
    }).length;
    if (el.enhSum) {
      el.enhSum.textContent = targets.length
        ? ('강화 ' + enhOn + '계열 · 돌파 ' + trOn + '개')
        : '8칸을 먼저 채워 주세요';
    }
    if (!targets.length) {
      el.enhance.innerHTML = '<p class="ds-enh__empty">8칸에 도술을 넣으면 계열 강화와 도술별 돌파를 여기서 맞출 수 있습니다.</p>';
      return;
    }
    var styleHtml = styles.map(enhStyleRow).join('');
    var transHtml = targets.map(function (t) { return transRow(t.sk, t.label); }).join('');
    el.enhance.innerHTML =
      '<p class="ds-enh__label">계열 강화 <em>계열 하나를 올리면 그 계열 도술이 모두 함께 오릅니다</em></p>' +
      '<div class="ds-enh__styles">' + styleHtml + '</div>' +
      '<p class="ds-enh__label">도술 돌파 <em>도술 하나씩 · 6돌파에 [돌파 효과]</em></p>' +
      '<div class="ds-trans__list">' + transHtml + '</div>' +
      '<div class="ds-enh__foot">' +
      '<span>깨비지지 확인값 (2026-11-24)</span>' +
      '<button type="button" class="ds-link" data-act="trans-reset">돌파 모두 0으로</button>' +
      '</div>';
  }

  /* 슬라이더를 끌 때 — 다시 그리지 않고 숫자만 바꿔 즉시 반영 */
  function updateEnhReadout() {
    if (!el.enhance) { return; }
    var vals = el.enhance.querySelectorAll('[data-enh-val]');
    for (var i = 0; i < vals.length; i++) {
      var key = vals[i].getAttribute('data-enh-val');
      vals[i].innerHTML = 'Lv <b>' + enhLevelOf(key) + '</b> · 피해 <b>' + enhPctText(key) + '</b>';
    }
    var steps = el.enhance.querySelectorAll('[data-trans-val]');
    for (var j = 0; j < steps.length; j++) {
      var id = Number(steps[j].getAttribute('data-trans-val'));
      var info = C.transInfo(id, S.trans[id]);
      steps[j].textContent = info.has ? info.step + '돌파' : '–';
      var row = steps[j].closest ? steps[j].closest('.ds-trans') : null;
      var meta = row ? row.querySelector('.ds-trans__meta') : null;
      if (meta && info.has) {
        var enhPct = C.enhanceBonus(enhLevelOf((C.skillById(id) || {}).st), id);
        var parts = [];
        if (enhPct > 0) { parts.push('강화 +' + num(enhPct, 1) + '%'); }
        if (info.step > 0) {
          if (info.dmgPct > 0) { parts.push('피해 +' + num(info.dmgPct, 1) + '%'); }
          if (info.cdSec > 0) { parts.push('쿨 -' + num(info.cdSec, 2) + '초'); }
          if (info.d6) { parts.push('6돌파 피해 +' + num(info.d6, 0) + '%'); }
        } else {
          parts.push('돌파 0단계');
        }
        meta.textContent = parts.join(' · ');
        var six = row ? row.querySelector('.ds-trans__six') : null;
        if (six) { six.classList.toggle('is-on', !!info.t6on); }
      }
    }
    var targets = transTargets();
    var enhOn = equippedStyles().filter(function (k) { return enhLevelOf(k) > 0; }).length;
    var trOn = targets.filter(function (t) { return (Number(S.trans[t.sk.id]) || 0) > 0; }).length;
    if (el.enhSum) { el.enhSum.textContent = '강화 ' + enhOn + '계열 · 돌파 ' + trOn + '개'; }
  }

  /* ---------------------------------------------------------
     📌 문파 공유 조합 — 저장 · 목록 · 불러오기 · 삭제
     · 로그인(실제 모드)이면 문파 서버(Supabase)에 저장합니다.
     · 마이그레이션 전(PGRST202)이거나 체험 모드면 이 기기에만 저장합니다.
     --------------------------------------------------------- */
  function localList() {
    try {
      var raw = global.localStorage.getItem(SHARE_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function localWrite(arr) {
    try { global.localStorage.setItem(SHARE_KEY, JSON.stringify(arr.slice(0, 30))); } catch (e) { /* 저장 못 해도 계산은 계속 */ }
  }

  function sharedConfig() {
    return {
      duration: S.duration,
      cdReducePct: S.cdReducePct,
      castMode: S.castMode,
      chargeFull: S.chargeFull,
      ultFirst: S.ultFirst,
      autoInterval: S.autoInterval,
      autoCoeff: S.autoCoeff,
      gap: S.gap,
      toggles: S.toggles,
      override: S.override,
      enhance: S.enhance,
      trans: S.trans
    };
  }

  function buildTitle() {
    var counts = C.styleCounts(S.slots);
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var filled = S.slots.filter(Boolean).length;
    if (!keys.length) { return ''; }
    var parts = keys.slice(0, 3).map(function (k) { return C.styleName(k) + counts[k]; });
    return (parts.join(' ') + ' · ' + filled + '칸').slice(0, 40);
  }

  function renderShared() {
    if (!el.shared) { return; }
    var items = SH.items;
    if (SH.status === 'loading') {
      el.shared.innerHTML = '<p class="ds-shared__empty">문파 공유 조합을 불러오는 중…</p>';
      if (el.sharedHint) { el.sharedHint.textContent = '불러오는 중'; }
      return;
    }
    if (el.sharedHint) {
      el.sharedHint.textContent = API.live ? '눌러서 불러오기' : '이 기기에만 저장';
    }
    var head = '';
    if (SH.message) {
      head = '<p class="ds-shared__msg">' + esc(SH.message) + '</p>';
    }
    if (!items.length) {
      el.shared.innerHTML = head + '<p class="ds-shared__empty">아직 공유된 조합이 없어요. ' +
        '아래에서 조합을 만든 뒤 <b>💾 이 조합 문파에 공유하기</b>를 눌러 보세요.</p>';
      return;
    }
    var shown = SH.expanded ? items : items.slice(0, 5);
    var rows = shown.map(function (it) {
      var armed = SH.armed === String(it.id);
      var who = it.mine ? '내가 올림' : (it.nickname || '문파원');
      var right = [
        '평타 ' + num(it.idle_pct, 1) + '%',
        'DPS ' + num(it.dps, 1) + '%'
      ].join(' · ');
      return '<div class="ds-share-item' + (armed ? ' is-armed' : '') + '">' +
        '<button type="button" class="ds-share-item__hit" data-load="' + esc(it.id) + '">' +
        '<strong>' + esc(it.title) + '</strong>' +
        '<span>' + esc(who) + ' · ' + right + '</span>' +
        (it.memo ? '<em>' + esc(it.memo) + '</em>' : '') +
        '</button>' +
        (it.can_delete ? '<button type="button" class="ds-share-item__del" data-del="' + esc(it.id) + '">' +
          (armed ? '지울까요?' : '✕') + '</button>' : '') +
        '</div>';
    }).join('');
    var more = '';
    if (items.length > 5) {
      more = '<button type="button" class="ds-link ds-shared__more" data-act="shared-more">' +
        (SH.expanded ? '접기' : '공유 조합 ' + items.length + '개 모두 보기') + '</button>';
    }
    el.shared.innerHTML = head + '<div class="ds-share-list">' + rows + '</div>' + more;
  }

  function loadShared() {
    SH.status = 'loading';
    SH.message = '';
    renderShared();
    if (API.live && API.api) {
      API.api.list().then(function (rows) {
        var arr = Array.isArray(rows) ? rows : [];
        SH.items = arr.map(function (r) {
          return {
            id: r.id, title: r.title, memo: r.memo || '',
            slots: r.slots, config: r.config,
            idle_pct: r.idle_pct, dps: r.dps,
            nickname: r.nickname, mine: !!r.mine, can_delete: !!r.can_delete,
            created_at: r.created_at
          };
        });
        SH.status = 'ready';
        renderShared();
      }, function (err) {
        var code = err && err.code;
        if (code === 'PGRST202' || code === '404') {
          SH.items = localList();
          SH.status = 'ready';
          SH.message = '문파 서버에 아직 공유 기능이 준비되지 않았어요 (migration-dosul.sql). ' +
            '지금은 이 기기에만 저장됩니다.';
        } else {
          SH.items = localList();
          SH.status = 'ready';
          SH.message = (err && err.message) || '공유 조합을 불러오지 못했어요.';
        }
        renderShared();
      });
      return;
    }
    SH.items = localList();
    SH.status = 'ready';
    renderShared();
  }

  function openShare() {
    var r = C.simulate(config());
    if (!r.ok) { return; }
    if (el.shareName) { el.shareName.value = buildTitle(); }
    if (el.shareMemo) { el.shareMemo.value = ''; }
    if (el.shareSum) {
      el.shareSum.textContent = '8칸 · 평타 빈 시간 ' + num(r.idlePct, 1) + '% (' + num(r.idle, 1) + '초) · DPS ' + num(r.dps, 1) + '%/초' +
        (enhSummaryText() ? ' · ' + enhSummaryText() : '');
    }
    if (el.shareNote) {
      el.shareNote.textContent = API.live
        ? '문파원 누구나 보고 한 번에 불러올 수 있어요. 지우기는 올린 사람과 운영진만.'
        : '체험 모드라 이 기기에만 저장됩니다. 가입하면 문파원과 함께 볼 수 있어요.';
    }
    el.shareBox.hidden = false;
    if (el.shareName) { global.setTimeout(function () { el.shareName.focus(); el.shareName.select(); }, 60); }
  }

  function closeShare() {
    if (el.shareBox) { el.shareBox.hidden = true; }
  }

  function saveShare() {
    var name = (el.shareName && el.shareName.value || '').trim();
    var memo = (el.shareMemo && el.shareMemo.value || '').trim();
    if (!name) {
      if (el.shareNote) { el.shareNote.textContent = '조합 이름을 적어 주세요.'; }
      if (el.shareName) { el.shareName.focus(); }
      return;
    }
    var r = C.simulate(config());
    if (!r.ok) { return; }
    var payload = {
      title: name.slice(0, 40),
      memo: memo.slice(0, 200),
      slots: S.slots.slice(0, 8),
      config: sharedConfig(),
      idlePct: r.idlePct,
      dps: r.dps
    };
    var saveBtn = el.shareBox.querySelector('[data-act="share-save"]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중…'; }

    function done(msg, local) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
      closeShare();
      if (el.onToast) { el.onToast(msg); }
      if (local) {
        SH.items = localList();
        SH.status = 'ready';
        renderShared();
      } else {
        loadShared();
      }
    }

    function saveLocal(note) {
      var arr = localList();
      arr.unshift({
        id: 'local-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: payload.title, memo: payload.memo, slots: payload.slots, config: payload.config,
        idle_pct: payload.idlePct, dps: payload.dps,
        nickname: API.nickname || '나', created_at: new Date().toISOString(),
        mine: true, can_delete: true, local: true
      });
      localWrite(arr);
      SH.message = note || '';
      done('💾 조합을 이 기기에 저장했어요', true);
    }

    if (API.live && API.api) {
      API.api.save(payload).then(function () {
        SH.message = '';
        done('💾 조합을 문파에 공유했어요', false);
      }, function (err) {
        if (err && (err.code === 'PGRST202' || err.code === '404')) {
          saveLocal('문파 서버에 아직 공유 기능이 준비되지 않았어요 (migration-dosul.sql). 이 기기에만 저장했습니다.');
        } else {
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '저장'; }
          if (el.shareNote) { el.shareNote.textContent = (err && err.message) || '저장하지 못했어요.'; }
        }
      });
    } else {
      saveLocal('');
    }
  }

  function findShared(id) {
    for (var i = 0; i < SH.items.length; i++) {
      if (String(SH.items[i].id) === String(id)) { return SH.items[i]; }
    }
    return null;
  }

  function loadBuild(it) {
    if (!it) { return; }
    var cfg = it.config || {};
    var slots = Array.isArray(it.slots) ? it.slots.slice(0, 8) : [];
    while (slots.length < 8) { slots.push(null); }
    slots = slots.map(function (v) { return v && C.skillById(Number(v)) ? Number(v) : null; });
    S.slots = slots;
    if (cfg.duration) { S.duration = Number(cfg.duration) || 60; }
    S.cdReducePct = Number(cfg.cdReducePct) || 0;
    S.castMode = cfg.castMode === 'motion' ? 'motion' : 'delay';
    S.chargeFull = cfg.chargeFull !== false;
    S.ultFirst = cfg.ultFirst !== false;
    S.autoInterval = Number(cfg.autoInterval) || 1;
    S.autoCoeff = Number(cfg.autoCoeff) >= 0 ? Number(cfg.autoCoeff) : 100;
    S.gap = Number(cfg.gap) || 0;
    S.toggles = cfg.toggles && typeof cfg.toggles === 'object' ? cfg.toggles : {};
    S.override = cfg.override && typeof cfg.override === 'object' ? cfg.override : {};
    S.enhance = cfg.enhance && typeof cfg.enhance === 'object' ? cfg.enhance : {};
    S.trans = cfg.trans && typeof cfg.trans === 'object' ? cfg.trans : {};
    S.opt = null;
    renderSlots();
    renderSin();
    renderEnhance();
    renderTune();
    recompute();
    if (el.root && el.root.scrollIntoView) { el.root.scrollTop = 0; }
    if (el.onToast) { el.onToast('📌 "' + (it.title || '조합') + '"을(를) 불러왔어요'); }
  }

  function deleteShared(id) {
    var it = findShared(id);
    if (!it) { return; }
    if (SH.armed !== String(id)) {
      SH.armed = String(id);
      renderShared();
      global.setTimeout(function () {
        if (SH.armed === String(id)) { SH.armed = ''; renderShared(); }
      }, 4000);
      return;
    }
    SH.armed = '';
    if (it.local || !API.live || !API.api) {
      localWrite(localList().filter(function (x) { return String(x.id) !== String(id); }));
      SH.items = localList();
      SH.status = 'ready';
      renderShared();
      if (el.onToast) { el.onToast('조합을 지웠어요'); }
      return;
    }
    API.api.remove(id).then(function () {
      if (el.onToast) { el.onToast('조합을 지웠어요'); }
      loadShared();
    }, function (err) {
      SH.message = (err && err.message) || '지우지 못했어요.';
      renderShared();
    });
  }

  /* ---------------------------------------------------------
     내 스펙 조정
     --------------------------------------------------------- */
  function renderTune() {
    el.tuneSum.textContent = '쿨감 ' + num(S.cdReducePct, 0) + '% · ' + S.duration + '초';

    var durBtns = DURATIONS.map(function (d) {
      return '<button type="button" class="ds-seg' + (S.duration === d ? ' is-on' : '') + '" data-duration="' + d + '">' + d + '초</button>';
    }).join('');

    var rows = S.slots.map(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      if (!sk) { return ''; }
      var o = S.override[id] || {};
      var cdv = o.cd > 0 ? o.cd : sk.cd;
      var ctv = o.ct > 0 ? o.ct : sk.ct;
      var cv = o.c > 0 ? o.c : sk.c;
      return '<div class="ds-tune__row" data-tune-row="' + id + '">' +
        '<span class="ds-tune__name">' + ico(sk.id, 'ds-ico--tune', 16) + (i + 1) + '. ' + esc(sk.n) + '</span>' +
        '<label>쿨<input type="number" min="0.5" max="180" step="0.5" data-ov="cd" data-id="' + id + '" value="' + num(cdv, 1) + '"></label>' +
        '<label>시전<input type="number" min="0" max="8" step="0.01" data-ov="ct" data-id="' + id + '" value="' + num(ctv, 2) + '"></label>' +
        '<label>계수<input type="number" min="0" max="4000" step="1" data-ov="c" data-id="' + id + '" value="' + num(cv, 0) + '"></label>' +
        '</div>';
    }).join('');

    el.tuneBody.innerHTML = [
      '<div class="ds-tune__grid">',
      '  <div class="ds-field">',
      '    <span class="ds-field__label">전투 시간</span>',
      '    <div class="ds-segs">' + durBtns + '</div>',
      '  </div>',
      '  <label class="ds-field">',
      '    <span class="ds-field__label">전체 재사용 대기시간 감소 <b id="ds-cd-pct">' + num(S.cdReducePct, 0) + '%</b></span>',
      '    <input type="range" min="0" max="50" step="1" value="' + S.cdReducePct + '" id="ds-cd-range">',
      '  </label>',
      '  <div class="ds-field ds-field--row">',
      '    <label>평타 1회 시간<input type="number" min="0.3" max="3" step="0.05" value="' + num(S.autoInterval, 2) + '" data-auto="interval"></label>',
      '    <label>평타 1회 계수(%)<input type="number" min="0" max="800" step="5" value="' + num(S.autoCoeff, 0) + '" data-auto="coeff"></label>',
      '    <label>도술 사이 간격(초)<input type="number" min="0" max="2" step="0.05" value="' + num(S.gap, 2) + '" data-auto="gap"></label>',
      '  </div>',
      '  <div class="ds-field ds-field--row">',
      '    <label class="ds-check"><input type="checkbox" data-opt="chargeFull"' + (S.chargeFull ? ' checked' : '') + '><span>차지 도술은 최대 차지로</span></label>',
      '    <label class="ds-check"><input type="checkbox" data-opt="ultFirst"' + (S.ultFirst ? ' checked' : '') + '><span>궁극기는 쿨마다 먼저</span></label>',
      '  </div>',
      '  <div class="ds-field">',
      '    <span class="ds-field__label">시전시간 기준 <em>시전시간은 실제 게임 값(도깨비지지)입니다</em></span>',
      '    <div class="ds-segs">',
      '      <button type="button" class="ds-seg' + (S.castMode === 'delay' ? ' is-on' : '') + '" data-castmode="delay">동작 시간</button>',
      '      <button type="button" class="ds-seg' + (S.castMode === 'motion' ? ' is-on' : '') + '" data-castmode="motion">전체 애니메이션</button>',
      '    </div>',
      '  </div>',
      '</div>',
      rows ? '<div class="ds-tune__rows"><p class="ds-tune__caption">도술별 값 직접 바꾸기 — 각성·장비 보정처럼 강화·돌파로 설명되지 않는 값만</p>' + rows +
        '<button type="button" class="ds-link" data-act="reset-ov">값 되돌리기</button></div>' : ''
    ].join('\n');
  }

  /* ---------------------------------------------------------
     결과
     --------------------------------------------------------- */
  function heroHtml(r) {
    var idleW = Math.max(0, Math.min(100, r.idlePct));
    return '<div class="ds-hero">' +
      '<p class="ds-hero__label">평타 치는 빈 시간</p>' +
      '<p class="ds-hero__value">' + num(r.idle, 1) + '<small>초</small> <em>' + num(r.idlePct, 1) + '%</em></p>' +
      '<div class="ds-hero__bar"><span style="width:' + idleW.toFixed(1) + '%"></span></div>' +
      '<div class="ds-hero__foot">' +
      '<span>도술 가동률 <b>' + num(r.uptime, 1) + '%</b></span>' +
      '<span>평타 <b>' + num(r.autoCount, 1) + '회</b> <i>(' + num(r.autoInterval, 2) + '초/회)</i></span>' +
      '</div>' +
      '</div>';
  }

  function footHtml(r) {
    var tip = '';
    if (r.idlePct >= 40) {
      tip = '<p class="ds-tip">평타가 <b>' + num(r.idlePct, 1) + '%</b>입니다 — 8칸의 쿨타임 총량이 커서 빈 시간이 많습니다. ' +
        '쿨이 짧은 도술(찌르기 8초 · 이중 사격 5.5초 · 낙뢰 8초 같은)을 섞으면 빈 시간이 줄어듭니다.</p>';
    }
    return tip + '<p class="ds-foot">계산 기준 — 쿨타임은 <b>시전을 시작한 순간</b>부터 흐르고, 시전 중에는 다른 도술을 쓸 수 없습니다. ' +
      '시전시간은 도깨비지지 공개값(선행 시전 + 동작 시간)이고, 차지 도술은 최대 차지로 계산합니다. ' +
      '<b>계열 강화</b>는 그 계열 도술 계수에, <b>도술 돌파</b>는 그 도술의 계수·쿨타임에만 붙습니다. ' +
      '평타 1회 시간·계수는 내 스펙 조정에서 바꿀 수 있습니다.</p>';
  }

  function statsHtml(r) {
    return '<div class="ds-cards">' +
      '<div class="ds-card"><span>초당 피해 (DPS)</span><strong>' + num(r.dps, 1) + '<small>%/초</small></strong></div>' +
      '<div class="ds-card"><span>총 피해 계수</span><strong>' + num(r.totalCoeff, 0) + '<small>%</small></strong></div>' +
      '<div class="ds-card"><span>도술 발동</span><strong>' + r.totalCasts + '<small>회</small></strong></div>' +
      '<div class="ds-card"><span>평타 비중</span><strong>' + num(r.autoShare, 1) + '<small>%</small></strong></div>' +
      '</div>';
  }

  function tableHtml(r) {
    var maxShare = 1;
    r.rows.forEach(function (x) { if (x.share > maxShare) { maxShare = x.share; } });
    var head = '<div class="ds-tbl__row ds-tbl__row--head">' +
      '<span class="c-name">도술</span><span class="c-num">발동</span><span class="c-pct">비중</span></div>';
    var rows = r.rows.map(function (x) {
      var isUlt = x.kind === 'ult';
      return '<div class="ds-tbl__row' + (isUlt ? ' is-ult' : '') + '">' +
        '<span class="c-name">' + ico(x.id, 'ds-ico--row', 20) +
        '<b>' + esc(x.name) + '</b>' +
        '<small>' + (isUlt ? 'R' : x.slot + '번') + ' · ' + esc(x.styleName) + ' ' + num(x.cd) + '초 · ' +
        '시전 ' + num(x.occupied, 1) + '초' + (x.est ? ' · 추정' : '') +
        (x.enh ? ' · Lv' + x.enh : '') + (x.trans ? ' · ' + x.trans + '돌파' : '') + '</small></span>' +
        '<span class="c-num">' + x.casts + '회</span>' +
        '<span class="c-pct">' + (x.deals ? num(x.share, 1) + '%' : '–') + '</span>' +
        '<span class="c-bar"><i style="width:' + Math.max(2, (x.share / maxShare) * 100).toFixed(1) + '%;background:' + x.color + '"></i></span>' +
        '</div>';
    }).join('');
    return '<div class="ds-tbl">' + head + rows + '</div>';
  }

  function timelineHtml(r) {
    var span = Math.min(30, r.duration);
    var segs = [];
    var marks = [];
    r.segments.forEach(function (s) {
      if (s.t1 > span) {
        if (s.t0 >= span) { return; }
      }
      if (s.kind === 'mark') {
        if (s.t0 <= span) { marks.push(s.t0); }
        return;
      }
      var t0 = Math.min(s.t0, span);
      var t1 = Math.min(s.t1, span);
      if (t1 - t0 <= 0.0001) { return; }
      segs.push({ t0: t0, t1: t1, kind: s.kind, name: s.name, id: s.id, color: s.color, isUlt: s.isUlt });
    });
    var legend = [];
    var seen = {};
    segs.forEach(function (s) {
      if (s.kind !== 'cast') { return; }
      var key = s.name;
      if (seen[key]) { return; }
      seen[key] = true;
      legend.push({ id: s.id, name: s.name, color: s.color });
    });
    legend = legend.slice(0, 6);

    var bars = segs.map(function (s) {
      var w = s.t1 - s.t0;
      var cls = s.kind === 'auto' ? 'ds-tl__seg is-auto' : 'ds-tl__seg';
      var bg = s.kind === 'auto' ? '' : 'background:' + s.color + ';';
      if (s.isUlt) { cls += ' is-ult'; }
      return '<i class="' + cls + '" style="flex:' + w.toFixed(3) + ' 0 0;' + bg + '" title="' +
        num(s.t0, 2) + '~' + num(s.t1, 2) + '초 · ' + esc(s.name) + '"></i>';
    }).join('');

    var markHtml = marks.map(function (t0) {
      var left = (t0 / span) * 100;
      return '<i class="ds-tl__mark" style="left:' + left.toFixed(2) + '%" title="쿨 초기화"></i>';
    }).join('');

    var ticks = '';
    for (var t = 0; t <= span; t += 5) {
      ticks += '<span style="left:' + ((t / span) * 100).toFixed(2) + '%">' + t + '</span>';
    }

    var legendHtml = legend.map(function (l) {
      return '<span class="ds-tl__key">' + ico(l.id, 'ds-ico--tl', 14) + esc(l.name) + '</span>';
    }).join('') + '<span class="ds-tl__key"><i class="is-auto"></i>평타</span>';

    return '<div class="ds-tl">' +
      '<p class="ds-tl__caption">초반 ' + span + '초 시전 타임라인 <em>회색 = 쿨이 비어 평타를 치는 구간</em></p>' +
      '<div class="ds-tl__bar">' + bars + markHtml + '</div>' +
      '<div class="ds-tl__axis">' + ticks + '</div>' +
      '<div class="ds-tl__legend">' + legendHtml + '</div>' +
      '</div>';
  }

  function optHtml(r) {
    var o = S.opt;
    if (!o || !o.ok) {
      return '<div class="ds-opt">' +
        '<button type="button" class="ds-btn ds-btn--accent" data-act="optimize">평타 빈 시간 줄이는 순서 추천</button>' +
        '<p class="ds-opt__note">8칸의 두 칸 맞바꾸기·한 칸 옮기기를 <b>모두 계산</b>해 초당 피해가 가장 높은 순서를 찾습니다. ' +
        '평타 빈 시간은 8칸의 <b>쿨타임 총량</b>이 크게 정하고, 순서는 그 시간에 <b>더 센 도술을 먼저</b> 넣는 쪽으로 맞춥니다.</p>' +
        '</div>';
    }
    var names = o.slots.map(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      return sk ? (i + 1) + '.' + sk.n : '';
    }).filter(Boolean).join(' › ');
    var sameKey = o.after.totalCoeff + '|' + o.after.idle;
    return '<div class="ds-opt ds-opt--done">' +
      '<p class="ds-opt__head">추천 순서 <em>' + (o.changed ? '바꾸면 더 셉니다' : '지금 순서가 이미 좋습니다') + '</em></p>' +
      '<p class="ds-opt__order">' + esc(names) + '</p>' +
      '<div class="ds-opt__diff">' +
      '<span>평타 빈 시간 ' + num(o.before.idle, 1) + '초 → <b>' + num(o.after.idle, 1) + '초</b></span>' +
      '<span>DPS ' + num(o.before.dps, 1) + ' → <b>' + num(o.after.dps, 1) + '</b></span>' +
      '</div>' +
      '<div class="ds-opt__acts">' +
      (o.changed ? '<button type="button" class="ds-btn ds-btn--accent" data-act="apply-opt" data-key="' + esc(sameKey) + '">이 순서로 바꾸기</button>' : '') +
      '<button type="button" class="ds-btn" data-act="optimize">다시 계산</button>' +
      '</div>' +
      '</div>';
  }

  function renderResult() {
    if (!el.result) { return; }
    var r = C.simulate(config());
    if (!r.ok) {
      el.result.innerHTML = '<p class="ds-empty">' + esc(r.message || '도술을 넣어 주세요.') + '</p>';
      return;
    }
    el.result.innerHTML = [
      heroHtml(r),
      statsHtml(r),
      footHtml(r),
      '<div class="ds-block"><p class="ds-block__title">도술별 발동 · 기여 피해</p>' + tableHtml(r) + '</div>',
      '<div class="ds-block">' + timelineHtml(r) + '</div>',
      optHtml(r),
      '<div class="ds-sharebar">' +
      '<button type="button" class="ds-btn ds-btn--share" data-act="share-open">💾 이 조합 문파에 공유하기</button>' +
      '<p class="ds-sharebar__note">장착 8칸 · 시전 순서 · 스펙 설정과 함께 <b>평타 빈 시간 · DPS</b>가 저장됩니다.</p>' +
      '</div>'
    ].join('\n');
  }

  function recompute() {
    syncToggles();
    save();
    renderResult();
  }

  function recomputeSoon() {
    if (timer) { global.clearTimeout(timer); }
    timer = global.setTimeout(function () { timer = null; recompute(); }, 220);
  }

  /* ---------------------------------------------------------
     도술 고르기
     --------------------------------------------------------- */
  function openPicker(slot) {
    S.picker.slot = slot;
    S.picker.q = '';
    el.pickerTitle.textContent = (slot + 1) + '번 칸에 넣을 도술' + (slot < 5 ? ' (기본 칸)' : ' (추가 칸)');
    if (el.pickerQ) { el.pickerQ.value = ''; }
    renderPickerFilters();
    renderPickerList();
    el.picker.hidden = false;
    if (el.pickerQ) { global.setTimeout(function () { el.pickerQ.focus(); }, 60); }
  }

  function closePicker() {
    S.picker.slot = -1;
    el.picker.hidden = true;
  }

  function renderPickerFilters() {
    var chips = [{ key: '', name: '전체' }].concat(C.styles().map(function (s) {
      return { key: s.key, name: s.name };
    }));
    el.pickerFilters.innerHTML = chips.map(function (c) {
      var on = S.picker.style === c.key;
      var col = c.key ? C.styleColor(c.key) : '#7fd1bd';
      return '<button type="button" class="ds-fchip' + (on ? ' is-on' : '') + '" data-pstyle="' + esc(c.key) + '" style="--ds-style:' + col + '">' + esc(c.name) + '</button>';
    }).join('');
  }

  function renderPickerList() {
    var q = (S.picker.q || '').replace(/\s+/g, '');
    var used = {};
    S.slots.forEach(function (id) { if (id) { used[id] = true; } });
    var list = C.allSkills().filter(function (sk) {
      if (S.picker.style && sk.st !== S.picker.style) { return false; }
      if (q && sk.n.replace(/\s+/g, '').indexOf(q) < 0) { return false; }
      return true;
    });
    list.sort(function (a, b) {
      if (a.st !== b.st) { return 0; }
      if ((a.k === 'ult') !== (b.k === 'ult')) { return a.k === 'ult' ? -1 : 1; }
      return a.cd - b.cd;
    });
    var html = '<button type="button" class="ds-pk ds-pk--clear" data-pick="">' +
      '<span class="ds-pk__name">비우기</span><span class="ds-pk__meta">이 칸을 비웁니다</span></button>';
    html += list.map(function (sk) {
      var on = used[sk.id];
      return '<button type="button" class="ds-pk' + (on ? ' is-used' : '') + (sk.k === 'ult' ? ' is-ult' : '') + '" data-pick="' + sk.id + '" style="--ds-style:' + C.styleColor(sk.st) + '">' +
        ico(sk.id, 'ds-ico--pk', 36, true) +
        '<span class="ds-pk__body">' +
        '<span class="ds-pk__name">' + esc(sk.n) + '<em>' + esc(C.kindLabel(sk.k)) + '</em></span>' +
        '<span class="ds-pk__meta">' + esc(C.styleName(sk.st)) + ' · ' + num(sk.cd) + '초 · 시전 ' + num(sk.ct, 2) + '초 · ' + num(sk.c, 0) + '%</span>' +
        '</span>' +
        '</button>';
    }).join('');
    el.pickerList.innerHTML = html;
  }

  function pick(id) {
    var slot = S.picker.slot;
    if (slot < 0) { return; }
    if (!id) {
      S.slots[slot] = null;
    } else {
      /* 같은 도술이 다른 칸에 있으면 그 칸을 비웁니다 */
      S.slots = S.slots.map(function (v, i) { return i !== slot && v === id ? null : v; });
      S.slots[slot] = id;
    }
    S.opt = null;
    closePicker();
    renderSlots();
    renderSin();
    renderEnhance();
    renderTune();
    recompute();
  }

  function moveSlot(i, dir) {
    var j = i + dir;
    if (j < 0 || j > 7) { return; }
    var tmp = S.slots[i];
    S.slots[i] = S.slots[j];
    S.slots[j] = tmp;
    /* 빈 칸이 앞으로 오면 채워진 칸이 밀리지 않도록 그대로 둡니다 */
    S.opt = null;
    renderSlots();
    renderSin();
    renderEnhance();
    renderTune();
    recompute();
  }

  /* ---------------------------------------------------------
     이벤트
     --------------------------------------------------------- */
  function bind() {
    if (bound) { return; }
    bound = true;

    el.root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      var preset = t.closest('[data-preset]');
      if (preset) {
        var p = C.presets().filter(function (x) { return x.id === preset.getAttribute('data-preset'); })[0];
        if (p) {
          S.slots = p.slots.slice(0, 8);
          S.opt = null;
          renderPresets(); renderSlots(); renderSin(); renderEnhance(); renderTune(); recompute();
        }
        return;
      }
      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'clear') {
          S.slots = [null, null, null, null, null, null, null, null];
          S.opt = null;
          renderPresets(); renderSlots(); renderSin(); renderEnhance(); renderTune(); recompute();
        } else if (a === 'picker-close') {
          closePicker();
        } else if (a === 'reset-ov') {
          S.override = {};
          renderTune(); recompute();
        } else if (a === 'trans-reset') {
          S.trans = {};
          S.opt = null;
          renderEnhance(); recompute();
        } else if (a === 'optimize') {
          S.opt = C.optimize(config());
          renderResult();
        } else if (a === 'shared-more') {
          SH.expanded = !SH.expanded;
          renderShared();
        } else if (a === 'share-open') {
          openShare();
        } else if (a === 'share-cancel') {
          closeShare();
        } else if (a === 'share-save') {
          saveShare();
        } else if (a === 'apply-opt') {
          if (S.opt && S.opt.ok) {
            S.slots = S.opt.slots.slice(0, 8);
            S.opt = null;
            renderSlots(); renderSin(); renderEnhance(); renderTune(); recompute();
          }
        }
        return;
      }
      var mv = t.closest('[data-mv]');
      if (mv) {
        moveSlot(Number(mv.getAttribute('data-slot')), mv.getAttribute('data-mv') === 'up' ? -1 : 1);
        return;
      }
      var enhSet = t.closest('[data-enh-set]');
      if (enhSet) {
        var parts2 = enhSet.getAttribute('data-enh-set').split(':');
        S.enhance[parts2[0]] = Number(parts2[1]) || 0;
        S.opt = null;
        renderEnhance(); recompute();
        return;
      }
      var slot = t.closest('[data-slot]');
      if (slot && !t.closest('.ds-slot__move')) {
        openPicker(Number(slot.getAttribute('data-slot')));
        return;
      }
      var pickBtn = t.closest('[data-pick]');
      if (pickBtn) {
        var val = pickBtn.getAttribute('data-pick');
        pick(val ? Number(val) : null);
        return;
      }
      var loadBtn = t.closest('[data-load]');
      if (loadBtn) {
        loadBuild(findShared(loadBtn.getAttribute('data-load')));
        return;
      }
      var delBtn = t.closest('[data-del]');
      if (delBtn) {
        deleteShared(delBtn.getAttribute('data-del'));
        return;
      }
      var pst = t.closest('[data-pstyle]');
      if (pst) {
        S.picker.style = pst.getAttribute('data-pstyle');
        renderPickerFilters(); renderPickerList();
        return;
      }
      var seg = t.closest('[data-duration]');
      if (seg) {
        S.duration = Number(seg.getAttribute('data-duration'));
        S.opt = null;
        renderTune(); recompute();
        return;
      }
      var cm = t.closest('[data-castmode]');
      if (cm) {
        S.castMode = cm.getAttribute('data-castmode');
        S.opt = null;
        renderTune(); recompute();
        return;
      }
    });

    el.root.addEventListener('input', function (e) {
      var t = e.target;
      if (!t) { return; }
      if (t.id === 'ds-picker-q') {
        S.picker.q = t.value;
        renderPickerList();
        return;
      }
      if (t.id === 'ds-cd-range') {
        S.cdReducePct = Number(t.value);
        var lab = document.getElementById('ds-cd-pct');
        if (lab) { lab.textContent = num(S.cdReducePct, 0) + '%'; }
        el.tuneSum.textContent = '쿨감 ' + num(S.cdReducePct, 0) + '% · ' + S.duration + '초';
        S.opt = null;
        recomputeSoon();
        return;
      }
      var ov = t.getAttribute && t.getAttribute('data-ov');
      if (ov) {
        var id = Number(t.getAttribute('data-id'));
        var v = Number(t.value);
        if (!S.override[id]) { S.override[id] = {}; }
        if (isFinite(v) && v > 0) { S.override[id][ov] = v; } else { delete S.override[id][ov]; }
        if (!Object.keys(S.override[id]).length) { delete S.override[id]; }
        S.opt = null;
        recomputeSoon();
        return;
      }
      var enhKey = t.getAttribute && t.getAttribute('data-enh');
      if (enhKey) {
        S.enhance[enhKey] = Math.max(0, Math.round(Number(t.value) || 0));
        S.opt = null;
        updateEnhReadout();
        recomputeSoon();
        return;
      }
      var trKey = t.getAttribute && t.getAttribute('data-trans');
      if (trKey) {
        S.trans[Number(trKey)] = Math.max(0, Math.min(10, Math.round(Number(t.value) || 0)));
        S.opt = null;
        updateEnhReadout();
        recomputeSoon();
        return;
      }
      var auto = t.getAttribute && t.getAttribute('data-auto');
      if (auto) {
        var av = Number(t.value);
        if (!isFinite(av)) { return; }
        if (auto === 'interval' && av >= 0.3) { S.autoInterval = av; }
        if (auto === 'coeff' && av >= 0) { S.autoCoeff = av; }
        if (auto === 'gap' && av >= 0) { S.gap = av; }
        S.opt = null;
        recomputeSoon();
      }
    });

    el.root.addEventListener('change', function (e) {
      var t = e.target;
      if (!t) { return; }
      var tg = t.getAttribute && t.getAttribute('data-toggle');
      if (tg) {
        var parts = tg.split(':');
        var key = parts[0];
        var id = parts[1];
        var arr = S.toggles[key] || [];
        if (t.checked) {
          if (arr.indexOf(id) < 0) { arr.push(id); }
        } else {
          arr = arr.filter(function (x) { return x !== id; });
        }
        S.toggles[key] = arr;
        S.opt = null;
        recompute();
        return;
      }
      var opt = t.getAttribute && t.getAttribute('data-opt');
      if (opt) {
        if (opt === 'chargeFull') { S.chargeFull = t.checked; }
        if (opt === 'ultFirst') { S.ultFirst = t.checked; }
        S.opt = null;
        recompute();
        return;
      }
      if (t.getAttribute && (t.getAttribute('data-enh') || t.getAttribute('data-trans'))) {
        renderEnhance();
        recompute();
      }
    });

    global.addEventListener('keydown', function (e) {
      if (!opened || e.key !== 'Escape') { return; }
      if (el.shareBox && !el.shareBox.hidden) { closeShare(); return; }
      if (el.picker && !el.picker.hidden) { closePicker(); }
    });
  }

  /* ---------------------------------------------------------
     열기 · 닫기
     --------------------------------------------------------- */
  function grabDom() {
    el.root = document.getElementById('screen-dosul');
    el.body = document.getElementById('dosul-body');
    el.close = null;
  }

  function renderAll() {
    renderPresets();
    renderSlots();
    renderSin();
    renderEnhance();
    renderTune();
    renderResult();
  }

  function open(options) {
    grabDom();
    if (!el.root || !el.body) { return; }
    if (!S) { S = load(); }
    if (!el.body.dataset.built) {
      buildShell();
      el.body.dataset.built = '1';
    }
    bind();
    var opts = options || {};
    API.live = !!opts.live;
    API.api = opts.api || null;
    API.nickname = opts.nickname || '';
    if (opts.toast) { el.onToast = opts.toast; }
    opened = true;
    renderAll();
    /* 탭을 열 때마다 공유 목록을 새로 읽습니다 (문파원이 방금 올린 조합도 바로 보이도록) */
    loadShared();
  }

  /* 화면(탭)이라 닫기는 없습니다 — 다른 탭으로 옮기면 그대로 두고 값만 저장합니다 */
  function close() {
    if (!S) { return; }
    closePicker();
    opened = false;
    save();
  }

  global.YM_DOSUL_UI = {
    open: open,
    mount: open,
    close: close,
    isOpen: function () { return !!opened; },
    state: function () { return S; },
    shared: function () { return { status: SH.status, items: SH.items, message: SH.message }; },
    refreshShared: loadShared,
    saveBuild: function () { openShare(); },
    simulate: function () { return C.simulate(config()); },
    reset: function () {
      S = defaults();
      renderAll();
      save();
    }
  };
})(window);
