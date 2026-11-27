/* =========================================================
   ⚔️ 도술 계산기 — 화면 (슬롯 · 신식 · 스펙 조정 · 결과 · 타임라인)
   엔진은 js/dosul-calc.js (YM_DOSUL) 가 계산합니다.
   ========================================================= */
(function (global) {
  'use strict';

  var C = global.YM_DOSUL;
  if (!C) { return; }

  /* 🏹 평타 1타 계수 — 자사계산기의 고정 기준값입니다(사용자 입력 칸 없음).
     v48·v49 때 285로 저장된 기기의 localStorage 값이 남아 v50 의 95 를 덮어썼습니다.
     v51 부터는 읽어 들일 때도, 계산할 때도 언제나 이 값을 씁니다. */
  var HUNT_AUTO_FIXED = (function () {
    var h = (C.huntData && C.huntData()) || null;
    var v = h ? Number(h.autoCoeff) : NaN;
    return isFinite(v) && v > 0 ? v : 95;
  })();

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
  /* 전투 시간 — 300초(5분)는 기만처럼 편차가 큰 신식을 평균으로 보고
     60초 쿨 궁극기가 여러 번 돌아가는지 확인할 때 씁니다 */
  var DURATIONS = [30, 60, 120, 300];
  var DUR_LABEL = { 30: '30초', 60: '60초', 120: '120초', 300: '300초 (5분)' };
  /* 결과 상단 빠른 전환 — 설정을 열지 않고 1분 · 2분 · 5분 평균을 봅니다 */
  var QUICK_DURATIONS = [60, 120, 300];
  var QUICK_LABEL = { 60: '1분', 120: '2분', 300: '5분' };

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

  /* 세 자리 콤마 — 몹 체력처럼 큰 수를 한눈에 읽도록 (24,750) */
  function group(n) {
    var s = num(n, 0);
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* 무기·장비 도술 피해 — 0~500% 범위로 안전하게 다듬습니다 */
  function clampPct(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 0) { return 0; }
    return Math.min(500, Math.round(n * 10) / 10);
  }

  function cleanStyleDmg(map) {
    var out = {};
    if (!map || typeof map !== 'object') { return out; }
    C.styles().forEach(function (st) {
      var n = clampPct(map[st.key]);
      if (n > 0) { out[st.key] = n; }
    });
    return out;
  }

  /* 지금 ③ 도술 장착 8칸에 들어 있는 계열별 개수 — 계열 % 칸 강조에 썰니다 */
  function slotStyleCounts() {
    var counts = {};
    S.slots.forEach(function (id) {
      var sk = id ? C.skillById(id) : null;
      if (!sk) { return; }
      counts[sk.st] = (counts[sk.st] || 0) + 1;
    });
    return counts;
  }

  /* 「쿨감 0% · 도술 +10% · 파멸 +15% · 60초」 — ⑥ 요약 줄 */
  function styleDmgSummary() {
    var parts = [];
    var allPct = clampPct(S.allDosulDmgPct);
    if (allPct > 0) { parts.push('도술 +' + num(allPct, 1) + '%'); }
    var styles = [];
    C.styles().forEach(function (st) {
      var v = clampPct(S.styleDmgPct && S.styleDmgPct[st.key]);
      if (v > 0) { styles.push(st.name + ' +' + num(v, 1) + '%'); }
    });
    /* 요약 줄은 한 줄이라 계열은 2개까지만 적고 나머지는 「외 N」으로 줄입니다 */
    parts = parts.concat(styles.slice(0, 2));
    if (styles.length > 2) { parts.push('외 ' + (styles.length - 2) + '계열'); }
    return parts.join(' · ');
  }

  function tuneSumText() {
    var extra = styleDmgSummary();
    return '쿨감 ' + num(S.cdReducePct, 0) + '%' + (extra ? ' · ' + extra : '') + ' · ' + S.duration + '초';
  }

  function updateTuneSum() {
    if (el.tuneSum) { el.tuneSum.textContent = tuneSumText(); }
  }

  /* 게임 등급 배지 — 일반(영웅) · 특별(전설) */
  function gradeBadge(id, opts) {
    var o = opts || {};
    var g = C.gradeOf(id);
    if (!g) { return ''; }
    if (o.specialOnly && g !== '특별') { return ''; }
    var sp = g === '특별';
    var cls = 'ds-gr ' + (sp ? 'ds-gr--sp' : 'ds-gr--nm') + (o.cls ? ' ' + o.cls : '');
    return '<em class="' + cls + '">' + esc(g) + '</em>';
  }

  /* 연계 배지 — 한 도술을 두 번(이상) 이어 쓰는 연계기 */
  function chainBadge(id, opts) {
    var ch = C.chainOf(id);
    if (!ch) { return ''; }
    var o = opts || {};
    var title = ch.name + ' · ' + ch.uses + '회 이어 쓰기 · ' + num(ch.window, 1) + '초 안에';
    return '<em class="ds-cb' + (o.cls ? ' ' + o.cls : '') + '" title="' + esc(title) + '">연계</em>';
  }

  function defaults() {
    return {
      slots: [null, null, null, null, null, null, null, null],
      /* 사용 순서 — 장착 8칸과 별개. 실제 전투에서 도술이 나가는 순서(궁극기 포함) */
      castOrder: [],
      duration: 60,
      cdReducePct: 0,
      /* 무기·장비 — 전체 도술 피해 +% · 계열별 도술 피해 +% (계열 key → %) */
      allDosulDmgPct: 0,
      styleDmgPct: {},
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
      tr6: {},
      chain: {},
      /* 🏹 사냥터 분당 처치 — 몹 체력·젠·치명타 기준 (2026-11-27) */
      hunt: {
        killHits: 10, maxMobs: 13, respawnSec: 5,
        autoCoeff: 95, critPct: 50, critDmgPct: 20, duration: 180,
        maxHp: 160000, mobDmg: 0, mobAtkInterval: 2, healAtPct: 70, healPct: 30,
        /* 내 기본 평타 데미지(몹 체력 추정용) · 체력 자연 회복(5초마다) */
        myAutoDmg: 0, hpRegen: 0,
        /* 몹 체력 넣는 방식 — 'hits'(직접 입력 몇 방, 기본) / 'ground'(사냥터 선택) */
        hpMode: 'hits', groundId: ''
      },
      /* 디버프 — 파티가 걸어 주는 것으로 보는 보조 토글 */
      debuffOn: {},
      /* 나중에 더한 기본 ON 신식 토글을 기존 저장분에도 한 번만 켜기 위한 표시 */
      mig: {},
      /* 화면 모드 — 'raid'(단일 보스 DPS) / 'hunt'(자사계산기) */
      mode: 'raid',
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
      base.castOrder = C.syncCastOrder(base.slots, [], { ultFirst: base.ultFirst !== false });
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
      /* 구버전 저장분에는 castOrder가 없습니다 — 그때는 슬롯 순서로 되돌립니다 */
      base.castOrder = Array.isArray(base.castOrder)
        ? base.castOrder.map(function (v) { return Number(v) || null; }).filter(function (v) { return v && C.skillById(v); })
        : [];
      base.enhance = (base.enhance && typeof base.enhance === 'object') ? base.enhance : {};
      base.trans = (base.trans && typeof base.trans === 'object') ? base.trans : {};
      base.tr6 = (base.tr6 && typeof base.tr6 === 'object') ? base.tr6 : {};
      base.chain = (base.chain && typeof base.chain === 'object') ? base.chain : {};
      base.hunt = (base.hunt && typeof base.hunt === 'object') ? base.hunt : {};
      var hd = defaults().hunt;
      /* 글자 칸(방식·사냥터)은 숫자 정리 전에 따로 넣어 둡니다 */
      var rawHpMode = base.hunt.hpMode;
      var rawGroundId = base.hunt.groundId;
      for (var hk in hd) {
        if (Object.prototype.hasOwnProperty.call(hd, hk)) {
          base.hunt[hk] = Number(base.hunt[hk]) >= 0 ? Number(base.hunt[hk]) : hd[hk];
        }
      }
      base.hunt.hpMode = rawHpMode === 'ground' ? 'ground' : 'hits';
      base.hunt.groundId = typeof rawGroundId === 'string' ? rawGroundId : '';
      /* 옛 저장값(285 등)이 남아 있어도 평타 1타 계수는 고정값으로 교정합니다 (v51) */
      base.hunt.autoCoeff = HUNT_AUTO_FIXED;
      base.debuffOn = (base.debuffOn && typeof base.debuffOn === 'object') ? base.debuffOn : {};
      /* 무기·장비 도술 피해 — 예전 저장분에는 없으므로 없으면 0 / {} 로 읽습니다 */
      base.allDosulDmgPct = clampPct(base.allDosulDmgPct);
      base.styleDmgPct = cleanStyleDmg(base.styleDmgPct);
      base.picker = { slot: -1, style: '', q: '' };
      base.mode = base.mode === 'hunt' ? 'hunt' : 'raid';
      base.castOrder = C.syncCastOrder(base.slots, base.castOrder, { ultFirst: base.ultFirst !== false });
    } catch (e) { /* 깨진 저장값은 기본값으로 */ }
    /* 저장된 신식 토글 중 지금 활성 계열이 아닌 것은 그대로 두되 화면에는 활성만 보입니다 */
    return base;
  }

  function save() {
    try {
      /* 평타 1타 계수는 고정값만 저장합니다 — 옛 값이 다시 기록되지 않게 (v51) */
      if (S.hunt) { S.hunt.autoCoeff = HUNT_AUTO_FIXED; }
      var out = {
        slots: S.slots, castOrder: S.castOrder,
        duration: S.duration, cdReducePct: S.cdReducePct,
        castMode: S.castMode, chargeFull: S.chargeFull, ultFirst: S.ultFirst,
        autoInterval: S.autoInterval, autoCoeff: S.autoCoeff, gap: S.gap,
        toggles: S.toggles, override: S.override,
        enhance: S.enhance, trans: S.trans, tr6: S.tr6, chain: S.chain, mig: S.mig,
        debuffOn: S.debuffOn, hunt: S.hunt,
        mode: S.mode,
        allDosulDmgPct: S.allDosulDmgPct, styleDmgPct: S.styleDmgPct
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
    if (!S.mig) { S.mig = {}; }
    C.styles().forEach(function (st) {
      if (!active[st.key]) { return; }
      if (!S.toggles[st.key]) {
        S.toggles[st.key] = st.toggles.filter(function (t) { return !t.defOff; })
          .map(function (t) { return t.id; });
      }
      /* 나중에 더한 「기본 ON」 토글(저격 연속 조준처럼)은 기존 저장분에도
         한 번만 켭니다 — 사용자가 끄면 그 뒤로는 다시 켜지 않습니다. */
      st.toggles.forEach(function (t) {
        if (!t.defOn || S.mig[t.id]) { return; }
        S.mig[t.id] = 1;
        if (S.toggles[st.key].indexOf(t.id) < 0) { S.toggles[st.key].push(t.id); }
      });
    });
  }

  /* 장착 칸(slots)에 맞춰 사용 순서를 정리합니다 — 다른 도술의 순서는 최대한 그대로 둡니다 */
  function syncOrder() {
    S.castOrder = C.syncCastOrder(S.slots, S.castOrder, { ultFirst: S.ultFirst !== false });
  }

  function config() {
    return {
      slots: S.slots,
      castOrder: S.castOrder,
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
      trans: S.trans,
      tr6: S.tr6,
      chain: S.chain,
      allDosulDmgPct: S.allDosulDmgPct,
      styleDmgPct: S.styleDmgPct,
      debuffOn: S.debuffOn
    };
  }

  /* 🏹 사냥터 계산 조건 — 몹 체력·젠·치명타·평타 계수 */
  function huntConfig() {
    var h = S.hunt || defaults().hunt;
    var base = config();
    base.duration = Number(h.duration) || 180;
    /* 몹 체력 넣는 방식 — 「사냥터 선택」이면 실제 몹 체력 ÷ 내 평타로 몇 방인지 만들어 넘깁니다 */
    var gh = (h.hpMode === 'ground') ? huntGroundHits(h) : null;
    base.killHits = gh ? gh.hits : Number(h.killHits);
    base.groundInfo = gh ? {
      id: gh.ground.id, name: gh.ground.name, region: gh.ground.region,
      cp: gh.ground.cp, hp: gh.ground.hp, hpMin: gh.ground.hpMin, hpMax: gh.ground.hpMax,
      auto: gh.auto, hits: Math.round(gh.hits * 100) / 100
    } : null;
    base.maxMobs = Number(h.maxMobs);
    base.respawnSec = Number(h.respawnSec);
    /* 저장값과 상관없이 고정값 — 옛 기기의 285가 새 기본값을 덮어쓰지 않게 (v51) */
    base.huntAutoCoeff = HUNT_AUTO_FIXED;
    base.critPct = Number(h.critPct);
    base.critDmgPct = Number(h.critDmgPct);
    base.maxHp = Number(h.maxHp) || 0;
    base.mobDmg = Number(h.mobDmg) || 0;
    base.mobAtkInterval = Number(h.mobAtkInterval) || 2;
    base.healAtPct = Number(h.healAtPct);
    base.healPct = Number(h.healPct);
    base.myAutoDmg = Number(h.myAutoDmg) || 0;
    /* 사냥터를 골랐을 때는 예시 평타(2,475)로 환산했더라도 그 값을 결과에 남깁니다 */
    if (gh) { base.myAutoDmg = gh.auto; }
    base.hpRegen = Number(h.hpRegen) || 0;
    return base;
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
      '  <p class="ds-head__sub"><b>단일 보스 DPS</b>와 자동사냥 <b>자사계산기</b>(분당 처치·버티기)를 따로 계산합니다</p>',
      '</div>',

      '<div class="ds-lead">',
      '  <p>도술마다 <b>쿨타임</b>과 <b>시전시간</b>이 달라서, 쿨이 비면 <b>평타</b>를 칩니다.',
      '  아래 8칸을 채우면 <b>평타 치는 빈 시간</b>과 <b>초당 피해</b>를 바로 계산합니다.</p>',
      '</div>',

      '<div class="ds-mode" role="tablist" aria-label="계산 모드">',
      '  <button type="button" class="ds-mode__btn" role="tab" data-calc-mode="raid"><b>단일 보스 DPS</b><em>레이드 · 보스 한 마리</em></button>',
      '  <button type="button" class="ds-mode__btn" role="tab" data-calc-mode="hunt"><b>자사계산기</b><em>자동사냥 · 분당 마릿수</em></button>',
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
      '  <div class="ds-sec__head"><span class="ds-sec__num">3</span><h3>도술 장착 8칸</h3><span class="ds-hint">칸을 누르면 도술을 고릅니다</span></div>',
      '  <p class="ds-sec__sub">게임의 도술 칸과 같습니다. <b>기본 1~5칸</b>에 같은 계열 3개가 들어가면 그 계열 <b>신식·궁극기(R)</b>가 열립니다.</p>',
      '  <div class="ds-slots" id="ds-slots"></div>',
      '  <div class="ds-subhead"><b>신식 · 궁극기</b><span>기본 1~5칸 구성으로만 결정됩니다</span></div>',
      '  <div class="ds-sin" id="ds-sin"></div>',
      '</section>',

      '<section class="ds-sec ds-sec--order" id="ds-order-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">4</span><h3>사용 순서 설정</h3><span class="ds-hint" id="ds-order-hint">시전 · DPS 계산 순서</span></div>',
      '  <p class="ds-sec__sub">전투에서 도술이 나가는 순서입니다. <b>장착 칸과 따로</b> 정해서, 신식 조건(기본 1~5칸)은 그대로 두고 <b>원하는 순서</b>로 바꿀 수 있습니다. 궁극기(R)도 원하는 자리에 놓을 수 있어요.</p>',
      '  <div class="ds-order" id="ds-order"></div>',
      '</section>',

      '<section class="ds-sec ds-sec--gold" id="ds-enhance-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">5</span><h3>강화 · 돌파</h3><span class="ds-hint" id="ds-enh-sum"></span></div>',
      '  <p class="ds-sec__sub">강화는 <b>계열 단위</b>(Lv50 · 피해 +75%), 돌파는 <b>도술 하나씩</b>(10단계 · 단계마다 피해 +3% · 쿨 -1.5%). <b>특별</b> 도술 17개만 6돌파에서 <b>[돌파 효과]</b>가 열립니다.</p>',
      '  <div class="ds-enh-wrap" id="ds-enhance"></div>',
      '</section>',

      '<details class="ds-sec ds-tune" id="ds-tune">',
      '  <summary><span class="ds-sec__num">6</span><span class="ds-tune__title">내 스펙 조정</span><em id="ds-tune-sum">쿨감 0% · 60초</em></summary>',
      '  <div class="ds-tune__body" id="ds-tune-body"></div>',
      '</details>',

      '<section class="ds-sec ds-sec--result" id="ds-result-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num">7</span><h3>계산 결과</h3>',
      '    <div class="ds-segs ds-dur-quick" id="ds-dur-quick" role="group" aria-label="전투 시간 빠른 전환"></div>',
      '  </div>',
      '  <p class="ds-sec__sub ds-dur-quick__note">전투 시간 <b>1분(60초) · 2분(120초) · 5분(300초)</b> — 5분으로 보면 기만처럼 편차가 큰 신식의 평균과 60초 쿨 궁극기의 여러 번 발동을 한눈에 볼 수 있습니다.</p>',
      '  <div class="ds-result" id="ds-result"></div>',
      '</section>',

      '<section class="ds-sec ds-sec--hunt" id="ds-hunt-sec">',
      '  <div class="ds-sec__head"><span class="ds-sec__num" id="ds-hunt-num">8</span><h3>자사계산기</h3><span class="ds-hint" id="ds-hunt-hint"></span></div>',
      '  <p class="ds-sec__sub">자동사냥 사냥터에서 <b>분당 몇 마리</b> 잡는지 계산합니다. 몹이 <b>평타 몇 방</b>에 죽는지만 넣으면, 지금 8칸 세팅으로 마리별 체력을 따라가며 시뮬레이션합니다.</p>',
      '  <div class="ds-hunt" id="ds-hunt"></div>',
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
    el.order = $('#ds-order');
    el.orderHint = $('#ds-order-hint');
    el.sin = $('#ds-sin');
    el.enhance = $('#ds-enhance');
    el.enhSum = $('#ds-enh-sum');
    el.tuneSum = $('#ds-tune-sum');
    el.tuneBody = $('#ds-tune-body');
    el.result = $('#ds-result');
    el.durQuick = $('#ds-dur-quick');
    el.hunt = $('#ds-hunt');
    el.huntHint = $('#ds-hunt-hint');
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
        '<span class="ds-slot__name">' + esc(sk.n) + chainBadge(sk.id) + '</span>' +
        '<span class="ds-slot__meta">' + gradeBadge(sk.id, { specialOnly: true }) +
        esc(C.styleName(sk.st)) + ' · ' + num(sk.cd) + '초 · ' + num(sk.ct, 2) + '초</span>' +
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
        '<span>궁극기 <b class="ds-sinon__ult">' + esc(ult ? ult.n : '') + '</b> 자동 장착 · ' + num(ult ? ult.cd : 0) + '초 · 자리는 ④에서</span></p>' +
        '<p class="ds-sinon__mech">' + esc(st.mech.join(' ')) + '</p>' +
        '<div class="ds-tgls">' + toggles + '</div>' +
        '</div>';
    }).join('');

    el.sin.innerHTML = '<div class="ds-sinchips">' + chips + '</div>' +
      (active || '<p class="ds-sin__empty">기본 1~5번 칸에 <b>같은 계열 3개</b>를 넣으면 그 계열 <b>신식</b>과 <b>궁극기(R)</b>가 자동으로 켜집니다.</p>');
  }

  /* ---------------------------------------------------------
     사용 순서 설정 (시전 · DPS 계산 순서)
     · 장착 칸과 별개인 castOrder 를 그립니다. 게임의 「사용 순서 설정」 화면처럼
       1번 → 2번 → … 순서로 늘어놓고 ▲/▼ 로 자리를 바꿉니다(궁극기 R 포함).
     --------------------------------------------------------- */
  function renderOrder() {
    if (!el.order) { return; }
    syncOrder();
    if (el.orderHint) {
      el.orderHint.textContent = S.castOrder.length
        ? (S.castOrder.length + '개 · ▲▼로 자리 바꾸기')
        : '시전 · DPS 계산 순서';
    }
    if (!S.castOrder.length) {
      el.order.innerHTML = '<p class="ds-ord__empty">도술을 장착하면 여기에 <b>사용 순서</b>가 나옵니다. ' +
        '신식이 열리면 <b>궁극기(R)</b>도 함께 들어옵니다.</p>';
      return;
    }
    el.order.innerHTML = S.castOrder.map(function (id, i) {
      var sk = C.skillById(id);
      if (!sk) { return ''; }
      var isUlt = sk.k === 'ult';
      return '<div class="ds-ord' + (isUlt ? ' is-ult' : '') + '" data-ord-row="' + sk.id + '" style="--ds-style:' + C.styleColor(sk.st) + '">' +
        '<span class="ds-ord__no">' + (i + 1) + '</span>' +
        ico(sk.id, 'ds-ico--ord', 30) +
        '<span class="ds-ord__body">' +
        '<span class="ds-ord__name">' + esc(sk.n) + (isUlt ? '<em class="ds-ord__r">R</em>' : '') + chainBadge(sk.id) + '</span>' +
        '<span class="ds-ord__meta">' + esc(C.styleName(sk.st)) + ' · ' + num(sk.cd) + '초 · 시전 ' + num(sk.ct, 2) + '초</span>' +
        '</span>' +
        '<span class="ds-ord__move">' +
        '<button type="button" data-omv="up" data-ord="' + sk.id + '" aria-label="' + esc(sk.n) + ' 앞으로"' +
        (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" data-omv="down" data-ord="' + sk.id + '" aria-label="' + esc(sk.n) + ' 뒤로"' +
        (i === S.castOrder.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '</span>' +
        '</div>';
    }).join('');
  }

  function moveOrder(id, dir) {
    var k = S.castOrder.indexOf(Number(id));
    if (k < 0) { return; }
    var j = k + dir;
    if (j < 0 || j >= S.castOrder.length) { return; }
    var tmp = S.castOrder[k];
    S.castOrder[k] = S.castOrder[j];
    S.castOrder[j] = tmp;
    S.opt = null;
    renderOrder();
    recompute();
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
    var sixOn = transTargets().filter(function (t) {
      return C.transInfo(t.sk.id, S.trans[t.sk.id], S.tr6).t6on;
    }).length;
    if (sixOn) { parts.push('특별 6돌파 ' + sixOn + '개'); }
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

  /* 6돌파 옵션 줄의 상태 문구 — k:'aura' 는 「버프가 돌아가는 동안 전체」에 붙는 효과 */
  function sixOptStateText(o) {
    if (o.k === 'aura') {
      return o.on ? '켜짐 · 10초 동안 모든 도술·평타' : '끄면 +' + num(o.d, 0) + '% 없음';
    }
    if (o.on) { return o.when ? '켜짐 · 그 상태일 때만' : '켜짐 · 계산 반영'; }
    return '켜면 +' + num(o.d, 0) + '%';
  }

  /* 6돌파 옵션 카드 — 특별 도술만. 6돌파 미만이면 미리보기(잠김)로 보여 줍니다.
     · 계산 반영: 고정 피해(d6) + 켜 둔 상황 옵션(extra)
     · 표시만: 대상 수·침묵·이속처럼 딜로 환산할 수 없는 효과 */
  function sixBlockHtml(sk, t) {
    if (!t || !t.has6) {
      if (sk.k === 'ult') { return ''; }
      return '<p class="ds-six ds-six--none">' + esc(C.special.normalLabel) +
        ' 도술 · 6돌파 효과 없음 (단계마다 피해 +3% · 쿨 -1.5%)</p>';
    }
    var on = t.t6on;
    var rows = '';
    if (t.d6) {
      rows += '<li class="ds-six__li is-calc"><span>피해량 +' + num(t.d6, 0) + '%</span><em>계산 반영</em></li>';
    }
    t.opts.forEach(function (o) {
      if (o.calc) {
        rows += '<li class="ds-six__li is-opt"><label><input type="checkbox" data-tr6="' + sk.id + ':' + esc(o.id) + '"' +
          (o.on ? ' checked' : '') + '><span>' + esc(o.t) + '</span></label>' +
          '<em>' + sixOptStateText(o) + '</em>' +
          (o.n ? '<i>' + esc(o.n) + '</i>' : '') + '</li>';
      } else {
        rows += '<li class="ds-six__li is-text"><span>' + esc(o.t) + '</span><em>표시만</em></li>';
      }
    });
    if (!rows) {
      rows = '<li class="ds-six__li is-text"><span>' + esc(t.t6) + '</span><em>표시만</em></li>';
    }
    /* 6돌파 미만 — 줄을 다 펼치지 않고 한 줄로만 미리 보여 줍니다 */
    if (!on) {
      var pre = [];
      if (t.d6) { pre.push('피해량 +' + num(t.d6, 0) + '%'); }
      t.opts.forEach(function (o) { pre.push(o.t); });
      if (!pre.length && t.t6) { pre.push(t.t6); }
      return '<div class="ds-six ds-six--pre is-locked" data-six="' + sk.id + '">' +
        '<p class="ds-six__head"><b>6돌파 옵션</b><em>6돌파로 올리면 열림</em></p>' +
        '<p class="ds-six__preview">' + esc(pre.join(' · ')) + '</p>' +
        '</div>';
    }
    var foot = t.step > 6
      ? t.step + '돌파 — 이 효과는 7~10돌파에서도 그대로이고, 단계마다 피해 +3% · 쿨 -1.5%만 더 붙습니다.'
      : '7~10돌파에서도 이 효과는 그대로 유지됩니다.';
    return '<div class="ds-six is-on" data-six="' + sk.id + '">' +
      '<p class="ds-six__head"><b>6돌파 옵션</b><em>적용 중</em></p>' +
      '<ul class="ds-six__list">' + rows + '</ul>' +
      '<p class="ds-six__foot">' + foot + '</p>' +
      '</div>';
  }

  function transMetaText(id, t) {
    var sk = C.skillById(id);
    var enhPct = C.enhanceBonus(enhLevelOf(sk ? sk.st : ''), id);
    var parts = [];
    if (enhPct > 0) { parts.push('강화 +' + num(enhPct, 1) + '%'); }
    if (t.has) {
      if (t.step > 0) {
        if (t.dmgPct > 0) { parts.push('피해 +' + num(t.dmgPct, 1) + '%'); }
        if (t.cdSec > 0) { parts.push('쿨 -' + num(t.cdSec, 2) + '초'); }
        if (t.d6) { parts.push('6돌파 피해 +' + num(t.d6, 0) + '%'); }
        if (t.extra) { parts.push('옵션 피해 +' + num(t.extra, 0) + '%'); }
        if (t.extraCond) { parts.push('요기범람 중 +' + num(t.extraCond, 0) + '%'); }
        if (t.aura) { parts.push('10초 구간 +' + num(t.aura, 0) + '%'); }
      } else {
        parts.push('돌파 0단계');
      }
    }
    return parts.join(' · ');
  }

  function transRow(sk, label) {
    var st = C.styleOf(sk.st);
    var step = Math.max(0, Math.round(Number(S.trans[sk.id]) || 0));
    var t = C.transInfo(sk.id, step, S.tr6);
    var meta = transMetaText(sk.id, t);
    var control = t.has
      ? '<input type="range" min="0" max="10" step="1" value="' + t.step + '"' +
        ' data-trans="' + sk.id + '" aria-label="' + esc(sk.n) + ' 돌파 단계">'
      : '<p class="ds-trans__none">공개된 돌파 수치가 없습니다 — 「내 스펙 조정」에서 직접 넣어 주세요.</p>';
    return '<div class="ds-trans' + (t.has ? '' : ' is-none') + (C.isSpecial(sk.id) ? ' is-sp' : '') +
      '" data-trans-row="' + sk.id + '" style="--ds-style:' + (st ? st.color : '#7fd1bd') + '">' +
      '<div class="ds-trans__top">' +
      ico(sk.id, 'ds-ico--tune', 18) +
      '<span class="ds-trans__name"><b>' + esc(sk.n) + '</b><em>' + esc(label) + ' · ' + esc(C.styleName(sk.st)) + '</em></span>' +
      gradeBadge(sk.id) +
      '<span class="ds-trans__step" data-trans-val="' + sk.id + '">' + (t.has ? t.step + '돌파' : '–') + '</span>' +
      '</div>' +
      control +
      (meta ? '<p class="ds-trans__meta">' + meta + '</p>' : '') +
      sixBlockHtml(sk, t) +
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
      '<p class="ds-enh__label">도술 돌파 <em>도술 하나씩 · 특별은 6돌파에 [돌파 효과]</em></p>' +
      '<p class="ds-enh__grade">등급 배지 <b class="ds-gr ds-gr--nm">일반</b> (도감 표기 영웅) · ' +
      '<b class="ds-gr ds-gr--sp">특별</b> (도감 표기 전설) — ' + esc(C.special.note6) + '</p>' +
      '<div class="ds-trans__list">' + transHtml + '</div>' +
      '<div class="ds-enh__foot">' +
      '<span>도깨비지지 확인값 (2026-11-24)</span>' +
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
      var sk = C.skillById(id);
      var info = C.transInfo(id, S.trans[id], S.tr6);
      steps[j].textContent = info.has ? info.step + '돌파' : '–';
      var row = steps[j].closest ? steps[j].closest('.ds-trans') : null;
      var meta = row ? row.querySelector('.ds-trans__meta') : null;
      if (meta && info.has) {
        meta.textContent = transMetaText(id, info);
      }
      var box = row ? row.querySelector('.ds-six') : null;
      if (box && sk) {
        var wrap = document.createElement('div');
        wrap.innerHTML = sixBlockHtml(sk, info);
        var fresh = wrap.firstChild;
        if (fresh) { box.parentNode.replaceChild(fresh, box); }
        else { box.parentNode.removeChild(box); }
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
      castOrder: S.castOrder,
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
      trans: S.trans,
      tr6: S.tr6,
      chain: S.chain,
      allDosulDmgPct: S.allDosulDmgPct,
      styleDmgPct: S.styleDmgPct,
      debuffOn: S.debuffOn
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
    if (el.shareName) { el.shareName.focus(); el.shareName.select(); }
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
    S.tr6 = cfg.tr6 && typeof cfg.tr6 === 'object' ? cfg.tr6 : {};
    S.chain = cfg.chain && typeof cfg.chain === 'object' ? cfg.chain : {};
    S.debuffOn = cfg.debuffOn && typeof cfg.debuffOn === 'object' ? cfg.debuffOn : {};
    /* 무기·장비 — 공유 조합에 없던(예전) 조합은 0 / {} 으로 읽습니다 */
    S.allDosulDmgPct = clampPct(cfg.allDosulDmgPct);
    S.styleDmgPct = cleanStyleDmg(cfg.styleDmgPct);
    /* 사용 순서 — 저장한 조합에 있으면 그대로, 예전 조합이면 장착 순서로 되돌립니다 */
    S.castOrder = Array.isArray(cfg.castOrder)
      ? cfg.castOrder.map(function (v) { return Number(v) || null; }).filter(function (v) { return v && C.skillById(v); })
      : [];
    S.opt = null;
    renderSlots();
    renderSin();
    renderOrder();
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
     🏹 사냥터 분당 처치 — 입력 · 결과
     · 몹 체력은 「평타 몇 방」으로 넣습니다(방어력 공식 비공개 대신 체감값).
     · 마릿수·부활 시간은 원터치 프리셋(비경 10·5초 / 사냥터 13·5초)과 직접 입력 둘 다.
     · 치명타 확률(기본 50%)·치명타 피해(%)는 직접 적습니다 — 몹 체력 기준점이
       치명타 50%이므로, 바꾸면 그 기준 대비 기대 피해로 환산합니다.
     --------------------------------------------------------- */
  var HUNT_DURS = [60, 180, 300];
  var HUNT_DUR_LABEL = { 60: '1분', 180: '3분', 300: '5분' };
  var HUNT_Q = [
    { key: 'dungeon', name: '비경', mobs: 10, respawn: 5 },
    { key: 'field', name: '사냥터', mobs: 13, respawn: 5 }
  ];
  var huntCache = { key: '', res: null, cmp: null };

  function huntQuickActive() {
    var h = S.hunt || {};
    for (var i = 0; i < HUNT_Q.length; i++) {
      if (Math.round(Number(h.maxMobs)) === HUNT_Q[i].mobs && Number(h.respawnSec) === HUNT_Q[i].respawn) {
        return HUNT_Q[i].key;
      }
    }
    return '';
  }

  /* 사냥터 선택 방식 — 사냥터(실제 몹 체력) / 직접 입력(몇 방)
     · 기본은 「직접 입력」: 지금까지 쓰던 방식 그대로입니다.
     · 「사냥터 선택」은 깨비지지 일반 사냥터 27곳의 몹 체력 ÷ 내 기본 평타로
       몇 방인지 환산해 같은 엔진에 넣습니다. */
  var HUNT_EXAMPLE_AUTO = 2475;   /* 평타를 안 적었을 때 쓰는 예시 값 — 385K 실측 앵커 */
  var HUNT_DEFAULT_GROUND = '101012';   /* 역병의 부화장 385K — 준형 님 실측 사냥터 */

  function huntGroundList() {
    return (C.huntGrounds ? C.huntGrounds() : []).slice().sort(function (a, b) {
      return (a.cp || 0) - (b.cp || 0);
    });
  }

  function huntAutoUsed(h) {
    var v = Number(h && h.myAutoDmg);
    return v > 0 ? v : HUNT_EXAMPLE_AUTO;
  }

  /* 고른 사냥터로 「평타 몇 방」을 환산 — 사냥터가 없으면 null */
  function huntGroundHits(h) {
    var g = C.huntGround ? C.huntGround(h.groundId || HUNT_DEFAULT_GROUND) : null;
    if (!g) { return null; }
    return { ground: g, auto: huntAutoUsed(h), hits: g.hp / huntAutoUsed(h) };
  }

  function huntGroundSummary(g) {
    if (!g) { return ''; }
    var hp = g.hpMin && g.hpMax && g.hpMin !== g.hpMax
      ? group(g.hpMin) + ' ~ ' + group(g.hpMax) + ' (대표 ' + group(g.hp) + ')'
      : group(g.hp);
    return '권장 전투력 ' + group(g.cp) + ' · Lv ' + esc(g.lv) + ' · 몹 ' + num(g.mobs, 0) + '종 · 몹 체력 ' + hp;
  }

  /* 「몹 체력 ÷ 내 평타 = 몇 방」 줄 — 사냥터를 고른 채 평타만 고쳐도 바로 바뀝니다 */
  function updateHuntCalcLine() {
    var box = document.getElementById('ds-hunt-calc');
    if (!box) { return; }
    var gh = huntGroundHits({ groundId: S.hunt.groundId || HUNT_DEFAULT_GROUND, myAutoDmg: S.hunt.myAutoDmg });
    if (!gh) { box.textContent = '사냥터를 골라 주세요.'; return; }
    box.innerHTML = '몹 체력 <b>' + group(gh.ground.hp) + '</b> ÷ 내 평타 <b>' + group(gh.auto) + '</b> = <b>' +
      num(gh.hits, 2) + '방</b>' +
      (Number(S.hunt.myAutoDmg) > 0 ? ''
        : ' <em>· 평타를 적으면 내 값으로 바뀝니다 (지금은 예시 ' + group(HUNT_EXAMPLE_AUTO) + ')</em>');
  }

  function huntGroundOptions(sel) {
    var list = huntGroundList();
    var html = '';
    var region = '';
    list.forEach(function (g) {
      if (g.region && g.region !== region) {
        if (region) { html += '</optgroup>'; }
        region = g.region;
        html += '<optgroup label="' + esc(region) + '">';
      }
      html += '<option value="' + esc(g.id) + '"' + (String(g.id) === String(sel) ? ' selected' : '') + '>' +
        esc(g.name) + ' · ' + group(g.cp) + '</option>';
    });
    if (region) { html += '</optgroup>'; }
    return html;
  }

  function renderHuntForm() {
    if (!el.hunt) { return; }
    var h = S.hunt || defaults().hunt;
    var act = huntQuickActive();
    var qbtns = HUNT_Q.map(function (q) {
      return '<button type="button" class="ds-hunt__qbtn' + (act === q.key ? ' is-on' : '') + '" data-hunt-preset="' + q.key + '">' +
        esc(q.name) + ' <b>' + q.mobs + '마리 · ' + num(q.respawn, 0) + '초</b></button>';
    }).join('');
    var durBtns = HUNT_DURS.map(function (d) {
      return '<button type="button" class="ds-seg' + (Number(h.duration) === d ? ' is-on' : '') + '" data-hunt-dur="' + d + '">' +
        esc(HUNT_DUR_LABEL[d]) + '</button>';
    }).join('');

    var groundMode = h.hpMode === 'ground';
    var sel = h.groundId || HUNT_DEFAULT_GROUND;
    var gh = groundMode ? huntGroundHits({ groundId: sel, myAutoDmg: h.myAutoDmg }) : null;
    var modeBtns = [
      { k: 'ground', t: '사냥터 선택', s: '실제 몹 체력으로' },
      { k: 'hits', t: '직접 입력', s: '몹이 평타 몇 방에' }
    ].map(function (m) {
      return '<button type="button" class="ds-hunt__modebtn' + (groundMode === (m.k === 'ground') ? ' is-on' : '') + '"' +
        ' role="tab" aria-selected="' + (groundMode === (m.k === 'ground') ? 'true' : 'false') + '"' +
        ' data-hunt-hpmode="' + m.k + '"><b>' + esc(m.t) + '</b><em>' + esc(m.s) + '</em></button>';
    }).join('');

    var hpFields = '';
    if (groundMode) {
      hpFields = [
        '<label class="ds-hunt__f ds-hunt__f--wide"><span>사냥터 <em>깨비지지 ' + huntGroundList().length + '곳</em></span>',
        '  <select class="ds-hunt__select" data-hunt-ground="1" aria-label="사냥터 고르기">' + huntGroundOptions(sel) + '</select></label>',
        '<p class="ds-hunt__gsum" id="ds-hunt-ground-sum">' + huntGroundSummary(gh ? gh.ground : null) + '</p>',
        '<label class="ds-hunt__f"><span>내 기본 평타 데미지</span>',
        '  <input type="number" min="0" max="100000000" step="1" inputmode="numeric" data-hunt="myAutoDmg" placeholder="예: ' + HUNT_EXAMPLE_AUTO + '" value="' + (Number(h.myAutoDmg) > 0 ? num(h.myAutoDmg, 0) : '') + '"></label>',
        '<p class="ds-hunt__calc" id="ds-hunt-calc">' + (gh
          ? '몹 체력 <b>' + group(gh.ground.hp) + '</b> ÷ 내 평타 <b>' + group(gh.auto) + '</b> = <b>' + num(gh.hits, 2) + '방</b>'
            + (Number(h.myAutoDmg) > 0 ? '' : ' <em>· 평타를 적으면 내 값으로 바뀝니다 (지금은 예시 ' + group(HUNT_EXAMPLE_AUTO) + ')</em>')
          : '사냥터를 골라 주세요.') + '</p>',
        '<div class="ds-hunt__grid">',
        '  <label class="ds-hunt__f"><span>최대 마릿수</span>',
        '    <input type="number" min="1" max="60" step="1" inputmode="numeric" data-hunt="maxMobs" value="' + num(h.maxMobs, 0) + '"></label>',
        '  <label class="ds-hunt__f"><span>부활 시간(초)</span>',
        '    <input type="number" min="0.5" max="120" step="0.5" inputmode="decimal" data-hunt="respawnSec" value="' + num(h.respawnSec, 1) + '"></label>',
        '  <label class="ds-hunt__f"><span>치명타 확률 <em>기본 50%</em></span>',
        '    <input type="number" min="0" max="100" step="1" inputmode="numeric" data-hunt="critPct" value="' + num(h.critPct, 1) + '"></label>',
        '  <label class="ds-hunt__f"><span>치명타 피해 <em>기본 20%</em></span>',
        '    <input type="number" min="0" max="500" step="0.1" inputmode="decimal" data-hunt="critDmgPct" value="' + num(h.critDmgPct, 1) + '"></label>',
        '</div>',
        '<p class="ds-hunt__qnote">사냥터를 고르면 <b>깨비지지에 나온 그 사냥터 몹 체력</b>이 그대로 들어가고, ' +
          '<b>몹 체력 ÷ 내 기본 평타</b>로 몇 방인지 계산합니다. 비경처럼 체력이 공개되지 않은 곳은 <b>직접 입력</b>에서 몇 방인지 적어 주세요.</p>'
      ].join('\n');
    } else {
      hpFields = [
        '<div class="ds-hunt__grid">',
        '  <label class="ds-hunt__f"><span>몹이 평타 <b>몇 방</b>에 죽음</span>',
        '    <input type="number" min="1" max="2000" step="1" inputmode="numeric" data-hunt="killHits" value="' + num(h.killHits, 2) + '"></label>',
        '  <label class="ds-hunt__f"><span>내 기본 평타 데미지 <em>선택</em></span>',
        '    <input type="number" min="0" max="100000000" step="1" inputmode="numeric" data-hunt="myAutoDmg" placeholder="예: 2475" value="' + (Number(h.myAutoDmg) > 0 ? num(h.myAutoDmg, 0) : '') + '"></label>',
        '  <label class="ds-hunt__f"><span>최대 마릿수</span>',
        '    <input type="number" min="1" max="60" step="1" inputmode="numeric" data-hunt="maxMobs" value="' + num(h.maxMobs, 0) + '"></label>',
        '  <label class="ds-hunt__f"><span>부활 시간(초)</span>',
        '    <input type="number" min="0.5" max="120" step="0.5" inputmode="decimal" data-hunt="respawnSec" value="' + num(h.respawnSec, 1) + '"></label>',
        '  <label class="ds-hunt__f"><span>치명타 확률 <em>기본 50%</em></span>',
        '    <input type="number" min="0" max="100" step="1" inputmode="numeric" data-hunt="critPct" value="' + num(h.critPct, 1) + '"></label>',
        '  <label class="ds-hunt__f"><span>치명타 피해 <em>기본 20%</em></span>',
        '    <input type="number" min="0" max="500" step="0.1" inputmode="decimal" data-hunt="critDmgPct" value="' + num(h.critDmgPct, 1) + '"></label>',
        '</div>',
        '<p class="ds-hunt__qnote"><b>내 기본 평타 데미지</b>는 선택이에요 — 적으면 몹 체력까지 <b>추정</b>해 드립니다(평타 몇 방 × 내 평타 데미지). ' +
          '비경처럼 몹 체력이 공개되지 않은 곳에 쓰는 방식입니다.</p>'
      ].join('\n');
    }

    el.hunt.innerHTML = [
      '<div class="ds-hunt__mode" role="tablist" aria-label="몹 체력 넣는 방식">' + modeBtns + '</div>',
      '<div class="ds-hunt__quick" role="group" aria-label="사냥터 원터치 설정">' + qbtns + '</div>',
      '<p class="ds-hunt__qnote">원터치로 <b>마릿수 · 부활 시간</b>이 바로 바뀝니다 — 아래 칸에서 직접 고쳐도 됩니다.</p>',
      hpFields,
      '<p class="ds-hunt__qnote"><b>버티기</b> — 내 체력과 <b>몹 1마리 피격 데미지</b>를 적으면 살아 있는 몹 수만큼 맞는 피해로 버티는 시간을 계산합니다(비우면 생략). ' +
        '체력이 <b>발동 %</b> 이하로 떨어지면 장착한 <b>헌신 회복 도술</b>(생명의 흐름·생명의 축복)을 <b>맨 먼저</b> 씁니다. ' +
        '<b>체력 자연 회복</b>을 적으면 인게임처럼 <b>5초마다</b> 그만큼 즉시 회복합니다.</p>',
      '<div class="ds-hunt__grid ds-hunt__grid--hp">',
      '  <label class="ds-hunt__f"><span>내 최대 체력 <em>HP</em></span>',
      '    <input type="number" min="0" max="100000000" step="1000" inputmode="numeric" data-hunt="maxHp" value="' + num(h.maxHp, 0) + '"></label>',
      '  <label class="ds-hunt__f"><span>몹 1마리 피격 데미지</span>',
      '    <input type="number" min="0" max="100000000" step="1" inputmode="numeric" data-hunt="mobDmg" placeholder="비우면 생존 생략 · 예: 794" value="' + (Number(h.mobDmg) > 0 ? num(h.mobDmg, 0) : '') + '"></label>',
      '  <label class="ds-hunt__f"><span>몹 공격 주기(초)</span>',
      '    <input type="number" min="0.2" max="30" step="0.1" inputmode="decimal" data-hunt="mobAtkInterval" value="' + num(h.mobAtkInterval, 1) + '"></label>',
      '  <label class="ds-hunt__f"><span>체력 자연 회복 <em>5초마다</em></span>',
      '    <input type="number" min="0" max="100000000" step="1" inputmode="numeric" data-hunt="hpRegen" placeholder="예: 4804" value="' + (Number(h.hpRegen) > 0 ? num(h.hpRegen, 0) : '') + '"></label>',
      '  <label class="ds-hunt__f"><span>헌신 회복 발동 <em>체력 % 이하</em></span>',
      '    <input type="number" min="0" max="99" step="1" inputmode="numeric" data-hunt="healAtPct" value="' + num(h.healAtPct, 0) + '"></label>',
      '  <label class="ds-hunt__f"><span>회복량 <em>최대 체력 %</em></span>',
      '    <input type="number" min="0" max="500" step="1" inputmode="numeric" data-hunt="healPct" value="' + num(h.healPct, 0) + '"></label>',
      '</div>',
      '<div class="ds-hunt__dur"><span class="ds-hunt__durlabel">계산 시간</span><div class="ds-segs">' + durBtns + '</div></div>',
      '<p class="ds-hunt__qnote">치명타는 <b>' + num(h.critPct, 0) + '%</b> 기준(몹 체력도 이 기준)으로 보고, 바꾸면 그 기준 대비 기대 피해로 환산합니다. ' +
        '<b>치명타 피해</b>는 내 상세 탭의 치명타 피해 증가 수치를 적어 주세요.</p>',
      '<div class="ds-hunt__out" id="ds-hunt-out"></div>'
    ].join('\n');
    renderHuntOut();
  }

  function huntCompute() {
    var cfg = huntConfig();
    var key = [cfg.killHits, cfg.maxMobs, cfg.respawnSec, cfg.huntAutoCoeff, cfg.critPct, cfg.critDmgPct, cfg.duration,
      cfg.slots.join(','), cfg.castOrder.join(','), JSON.stringify(cfg.toggles), JSON.stringify(cfg.enhance),
      JSON.stringify(cfg.trans), JSON.stringify(cfg.tr6), JSON.stringify(cfg.override), cfg.allDosulDmgPct,
      JSON.stringify(cfg.styleDmgPct), cfg.cdReducePct, cfg.castMode, cfg.chargeFull, cfg.autoInterval,
      cfg.gap, cfg.chain ? JSON.stringify(cfg.chain) : '', JSON.stringify(cfg.debuffOn),
      cfg.maxHp, cfg.mobDmg, cfg.mobAtkInterval, cfg.healAtPct, cfg.healPct, cfg.myAutoDmg, cfg.hpRegen,
      (cfg.groundInfo ? cfg.groundInfo.id : '')].join('|');
    if (huntCache.key === key && huntCache.res) { return huntCache; }
    var res = C.simulateHunt(cfg);
    var cmp = null;
    try { cmp = C.huntCompare(cfg); } catch (e) { cmp = null; }
    huntCache = { key: key, res: res, cmp: cmp };
    return huntCache;
  }

  function renderHuntOut() {
    if (!el.hunt) { return; }
    var out = $('#ds-hunt-out');
    if (!out) { return; }
    var h = S.hunt || defaults().hunt;
    if (el.huntHint) {
      el.huntHint.textContent = num(h.maxMobs, 0) + '마리 · ' + num(h.respawnSec, 1) + '초 · 치명타 ' + num(h.critPct, 0) + '%';
    }
    if (!C.simulateHunt) { out.innerHTML = '<p class="ds-hunt__empty">사냥 계산을 불러오지 못했어요.</p>'; return; }
    var got = huntCompute();
    var r = got.res;
    if (!r || !r.ok) { out.innerHTML = '<p class="ds-hunt__empty">' + esc((r && r.message) || '계산하지 못했어요.') + '</p>'; return; }

    var perMin = r.killsPerMin;
    var k1 = r.duration >= 60 ? r.kills1m : Math.round(perMin);
    var k3 = r.duration >= 180 ? r.kills3m : Math.round(perMin * 3);
    var skillW = Math.max(0, Math.min(100, r.skillShare));
    var autoW = 100 - skillW;
    var maxRows = r.rows.length ? r.rows[0].damage : 1;

    var rowsHtml = r.rows.map(function (x) {
      var isUlt = x.kind === 'ult';
      return '<div class="ds-hunt__row' + (isUlt ? ' is-ult' : '') + '">' +
        '<span class="c-name">' + ico(x.id, 'ds-ico--row', 18) +
        '<b>' + esc(x.name) + '</b>' +
        '<small>' + (isUlt ? 'R' : x.slot + '번') + ' · ' + esc(x.styleName) +
        ' · <em class="c-tgt">' + x.tgt + '명</em>' +
        (x.falloff ? ' · 감소' : '') + (x.focus ? ' · 집중' : '') + '</small></span>' +
        '<span class="c-num">' + x.casts + '회</span>' +
        '<span class="c-num c-kill">' + x.kills + '</span>' +
        '<span class="c-pct">' + num(x.share, 1) + '%</span>' +
        '<span class="c-bar"><i style="width:' + Math.max(2, (x.damage / maxRows) * 100).toFixed(1) + '%;background:' + x.color + '"></i></span>' +
        '</div>';
    }).join('');

    /* 버티기 — 받는 DPS · 버티는 시간 · 헌신 회복 · 안전도 */
    var sv = r.survival;
    var LV = { safe: { t: '여유', cls: 'is-safe' }, warn: { t: '주의', cls: 'is-warn' }, danger: { t: '위험', cls: 'is-danger' } };
    var survHtml = '';
    if (sv) {
      var lv = LV[sv.level] || null;
      var line = [];
      if (sv.diedAt != null) {
        line.push('체력이 <b>' + num(sv.diedAt, 1) + '초</b>에 바닥납니다' +
          (sv.healCasts ? ' (헌신 회복 ' + sv.healCasts + '회로는 부족)' : ' — 헌신 회복 도술을 넣거나 물약이 필요합니다') + '.');
      } else if (sv.maxHp > 0) {
        line.push('체력 ' + num(sv.maxHp, 0) + ' ÷ 초당 ' + num(sv.dps, 0) + ' = <b>' + num(sv.life, 1) + '초</b> 이상 버팁니다' +
          (sv.level === 'safe' ? ' — 1분 사냥은 넉넉합니다.' : ' — 1분은 빠듯합니다.'));
      }
      if (sv.healCasts > 0) {
        line.push('헌신 회복 <b>' + sv.healCasts + '회</b> 발동(체력 ' + num(sv.healAtPct, 0) + '% 이하) · 총 <b>+' + num(sv.healed, 0) + ' HP</b> 회복 · 초당 평균 <b>' + num(sv.regen, 0) + ' HP</b>.');
      } else if (sv.healAtPct != null) {
        line.push('헌신 회복은 발동하지 않았습니다(체력이 ' + num(sv.healAtPct, 0) + '% 이하로 내려가지 않았거나 회복 도술이 없음).');
      }
      if (sv.hpRegen > 0) {
        line.push('체력 자연 회복 <b>' + num(sv.hpRegen, 0) + ' HP</b> × <b>' + num(sv.regenInterval, 0) + '초마다</b> → <b>' +
          sv.regenTicks + '회</b> · 총 <b>+' + num(sv.regenTotal, 0) + ' HP</b>' +
          (sv.regenTicks ? ' (초당 평균 <b>' + num(sv.regenNatural, 0) + ' HP</b>)' : '') + '.');
      }
      line.push(sv.sustain === true
        ? '→ <b>무한 자사 가능</b> (회복이 받는 피해를 따라갑니다).'
        : (sv.diedAt != null ? '→ <b>무한 자사 불가</b> — 초당 ' + num(sv.holdRegen, 0) + ' HP 이상 회복이 필요합니다.'
          : (sv.sustain === false ? '→ 초당 <b>' + num(sv.holdRegen, 0) + ' HP</b> 회복이 있어야 계속 버팁니다.' : '')));
      survHtml = '<div class="ds-hunt__surv">' +
        '<p class="ds-hunt__survhead">버티기 <em>' + num(sv.avgAlive, 1) + '마리가 평균 · 몹 1방 ' + num(sv.mobDmg, 0) + ' · ' + num(sv.atkInterval, 1) + '초마다</em>' +
        (lv ? '<b class="ds-hunt__lv ' + lv.cls + '">' + lv.t + '</b>' : '') + '</p>' +
        '<div class="ds-cards ds-hunt__cards">' +
        '  <div class="ds-card"><span>받는 피해(초당)</span><strong>' + num(sv.dps, 0) + '<small>HP/초</small></strong></div>' +
        '  <div class="ds-card"><span>1분 동안 받는 피해</span><strong>' + num(sv.dmg60, 0) + '<small>HP</small></strong></div>' +
        '  <div class="ds-card"><span>버티는 시간</span><strong>' + (sv.diedAt != null ? num(sv.diedAt, 1) : (sv.maxHp > 0 ? '60+' : '–')) + '<small>' + (sv.maxHp > 0 ? '초' : '') + '</small></strong></div>' +
        '  <div class="ds-card"><span>헌신 회복</span><strong>' + sv.healCasts + '<small>회</small></strong></div>' +
        (sv.hpRegen > 0 ? '  <div class="ds-card"><span>자연 회복 (' + num(sv.regenInterval, 0) + '초마다)</span><strong>' + sv.regenTicks + '<small>회 · +' + num(sv.regenTotal, 0) + ' HP</small></strong></div>' : '') +
        '</div>' +
        '<p class="ds-hunt__survnote">' + line.join(' ') + '</p>' +
        '<p class="ds-hunt__survnote ds-hunt__survnote--dim">회복량 계수는 공개 자료에 없어 <b>최대 체력 ' + num(sv.healPct, 0) + '%</b>로 계산했습니다 — 내 회복 도술의 실제 회복량(내 체력 대비 %)을 적어 주세요. ' +
        '물약·받는 피해 감소·보호막은 넣지 않았습니다.</p>' +
        '</div>';
    }
    var cmp = got.cmp ? got.cmp.rows : [];
    var cmpMax = got.cmp ? Math.max(1, got.cmp.best) : 1;
    var cmpHtml = cmp.length ? '<div class="ds-hunt__cmp">' +
      '<p class="ds-hunt__cmphead">프리셋 사냥 속도 비교 <em>같은 조건 · 프리셋 8칸으로 바꿔 계산</em></p>' +
      cmp.map(function (c) {
        return '<div class="ds-hunt__cmprow' + (c.current ? ' is-cur' : '') + '">' +
          '<span class="c-name">' + esc(c.name) + (c.current ? '<em>지금</em>' : '') + '</span>' +
          '<span class="c-num">' + num(c.perMin, 1) + '<small>마리/분</small></span>' +
          '<span class="c-bar"><i style="width:' + Math.max(2, (c.perMin / cmpMax) * 100).toFixed(1) + '%"></i></span>' +
          '</div>';
      }).join('') + '</div>' : '';

    out.innerHTML = [
      '<div class="ds-hunt__hero">',
      '  <p class="ds-hunt__cap">분당 처치 <em>' + num(r.maxMobs, 0) + '마리 · ' + num(r.respawnSec, 1) + '초 · ' +
        (r.ground
          ? esc(r.ground.name) + ' 몹 체력 ' + group(r.ground.hp) + ' ÷ 평타 ' + group(r.ground.auto) + ' = <b>' + num(r.ground.hits, 2) + '방</b>'
          : '몹 체력 평타 ' + num(r.killHits, 1) + '방') + '</em></p>',
      '  <p class="ds-hunt__big">' + num(perMin, 1) + '<small>마리/분</small></p>',
      '  <div class="ds-hunt__pair"><span>1분 <b>' + k1 + '</b>마리</span><span>3분 <b>' + k3 + '</b>마리</span></div>',
      '  <div class="ds-hunt__bar"><i class="is-skill" style="width:' + skillW.toFixed(1) + '%"></i><i class="is-auto" style="width:' + autoW.toFixed(1) + '%"></i></div>',
      '  <div class="ds-hunt__legend"><span><i class="is-skill"></i>도술 <b>' + num(r.skillShare, 1) + '%</b></span><span><i class="is-auto"></i>평타 <b>' + num(r.autoShare, 1) + '%</b></span></div>',
      '</div>',
      '<div class="ds-cards ds-hunt__cards">',
      '  <div class="ds-card"><span>젠 소모율</span><strong>' + num(r.waveUse, 1) + '<small>%</small></strong></div>',
      '  <div class="ds-card"><span>이론 최대</span><strong>' + num(r.theoretical / (r.duration / 60), 1) + '<small>마리/분</small></strong></div>',
      '  <div class="ds-card"><span>평균 살아있는 몹</span><strong>' + num(r.avgAlive, 1) + '<small>마리</small></strong></div>',
      '  <div class="ds-card"><span>평타 횟수</span><strong>' + r.autoCount + '<small>회</small></strong></div>',
      (r.mobHpEstimate ? '  <div class="ds-card ds-card--wide"><span>추정 몹 체력</span><strong>약 ' + group(r.mobHpEstimate) + '<small>HP</small></strong><em>평타 ' + num(r.killHits, 2) + '방 × 내 기본 평타 ' + group(r.myAutoDmg) + '</em></div>' : ''),
      '</div>',
      '<div class="ds-block"><p class="ds-block__title">도술별 기여 · 처치</p>' +
        '<div class="ds-hunt__tbl"><div class="ds-hunt__row ds-hunt__row--head">' +
        '<span class="c-name">도술</span><span class="c-num">발동</span><span class="c-num c-kill">처치</span><span class="c-pct">비중</span></div>' +
        rowsHtml + '</div></div>',
      survHtml,
      cmpHtml,
      '<p class="ds-hunt__note"><b>계산 기준</b> — 몹 체력 = <b>평타 ' + num(r.killHits, 1) + '방</b>(치명타 ' + num(r.critPct, 0) + '% · 치명타 피해 +' + num(r.critDmgPct, 1) + '% 기준). ' +
        '도술 피해는 <b>계수 × 레이드 계산기의 시전당 평균 배수 ÷ 평타 1타 계수(' + num(r.autoCoeff, 0) + '%)</b>이고, ' +
        '맞는 대상은 <b>남은 체력이 가장 적은 몹부터</b> 최대 대상 수만큼입니다. ' +
        '죽은 몹은 <b>죽은 순간 +' + num(r.respawnSec, 1) + '초</b>에 그 몹만 풀피로 돌아오고, 시작할 때는 ' + num(r.maxMobs, 0) + '마리가 모두 살아 있습니다. ' +
        '<b>쿨타임 신식</b>(기만 눈물 · 파멸 요기범람 초기화 · 주술 구슬 · 척결 · 강압 · 절명 형상 · 기동 연쇄)과 ' +
        '<b>용맹의 기운 · 저격 연속 조준</b>은 시전 빈도·평타에 그대로 넣었습니다.</p>',
      '<p class="ds-hunt__note ds-hunt__note--dim"><b>빠진 것</b> — 이동 시간 · 물약 · 받는 피해 감소·보호막 · 화상 같은 지속 피해 · 대상이 흩어진 정도 · 기동 연쇄의 시전 속도(수치 미공개). ' +
        '다중 감소는 <b>하늘의 심판 6인↑(10인 50%) · 대폭발 4인↑(30인 20%)</b> 두 개만 공개돼 있고, 나머지 도술은 감소 없음으로 계산합니다. ' +
        '「적을수록 증가」는 <b>난타·요기 폭발(6돌파)</b>을 실제 맞은 인원으로 환산합니다.</p>'
    ].join('\n');
  }

  /* 결과 상단의 1분 · 2분 · 5분 빠른 전환 */
  function renderDurQuick() {
    if (!el.durQuick) { return; }
    el.durQuick.innerHTML = QUICK_DURATIONS.map(function (d) {
      var on = S.duration === d;
      return '<button type="button" class="ds-seg' + (on ? ' is-on' : '') + '" data-quick-duration="' + d + '" title="' + d + '초" aria-label="' + d + '초" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        esc(QUICK_LABEL[d] || (d + '초')) + '</button>';
    }).join('');
  }

  function setDuration(d) {
    S.duration = Number(d) || 60;
    S.opt = null;
    renderTune();
    recompute();
  }

  /* ---------------------------------------------------------
     내 스펙 조정
     --------------------------------------------------------- */
  function renderTune() {
    el.tuneSum.textContent = tuneSumText();
    renderDurQuick();

    var durBtns = DURATIONS.map(function (d) {
      return '<button type="button" class="ds-seg' + (S.duration === d ? ' is-on' : '') + '" data-duration="' + d + '">' +
        esc(DUR_LABEL[d] || (d + '초')) + '</button>';
    }).join('');

    /* 무기·장비 도술 피해 — 전체 1칸 + 계열 12칸(3열 · 좁은 화면 2열).
       ③ 도술 장착 8칸에 들어 있는 계열은 테두리로 강조합니다. */
    var allPct = clampPct(S.allDosulDmgPct);
    var counts = slotStyleCounts();
    var styleCells = C.styles().map(function (st) {
      var v = clampPct(S.styleDmgPct && S.styleDmgPct[st.key]);
      var cnt = counts[st.key] || 0;
      return '<div class="ds-sdmg__cell' + (cnt > 0 ? ' is-on' : '') + (v > 0 ? ' is-set' : '') + '"' +
        ' data-sdmg-cell="' + esc(st.key) + '" style="--ds-style:' + esc(st.color) + '">' +
        '<span class="ds-sdmg__name"><i></i>' + esc(st.name) +
        (cnt > 0 ? '<em class="ds-sdmg__cnt" title="③ 도술 장착 8칸에 ' + cnt + '개">' + cnt + '</em>' : '') +
        '</span>' +
        '<span class="ds-sdmg__box">' +
        '<input type="number" min="0" max="500" step="0.1" inputmode="decimal" placeholder="0"' +
        ' value="' + (v > 0 ? num(v, 1) : '') + '" data-sdmg="' + esc(st.key) + '"' +
        ' aria-label="' + esc(st.name) + ' 계열 도술 피해 (%)">' +
        '<em>%</em>' +
        '<button type="button" class="ds-sdmg__reset" data-sdmg-reset="' + esc(st.key) + '"' +
        ' aria-label="' + esc(st.name) + ' 계열 도술 피해 초기화">초기화</button>' +
        '</span>' +
        '</div>';
    }).join('');

    var rows = S.slots.map(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      if (!sk) { return ''; }
      var o = S.override[id] || {};
      var cdv = o.cd > 0 ? o.cd : sk.cd;
      var ctv = o.ct > 0 ? o.ct : sk.ct;
      var cv = o.c > 0 ? o.c : sk.c;
      return '<div class="ds-tune__row' + (sk.chain ? ' has-chain' : '') + '" data-tune-row="' + id + '">' +
        '<span class="ds-tune__name">' + ico(sk.id, 'ds-ico--tune', 16) + (i + 1) + '. ' + esc(sk.n) + chainBadge(sk.id) + '</span>' +
        '<label>쿨<input type="number" min="0.5" max="180" step="0.5" data-ov="cd" data-id="' + id + '" value="' + num(cdv, 1) + '"></label>' +
        '<label>시전<input type="number" min="0" max="8" step="0.01" data-ov="ct" data-id="' + id + '" value="' + num(ctv, 2) + '"></label>' +
        '<label>계수<input type="number" min="0" max="4000" step="1" data-ov="c" data-id="' + id + '" value="' + num(cv, 0) + '"></label>' +
        (sk.chain ? '<label class="ds-check ds-check--chain"><input type="checkbox" data-chain="' + id + '"' +
          (C.chainOn(S, id) ? ' checked' : '') + '><span>연계</span></label>' : '') +
        '</div>';
    }).join('');

    /* 디버프 — 지금 덱이 조건부 피해를 받는 디버프와, 파티가 걸어 주는 것으로 보는 토글 */
    var dbDefs = C.data.debuffs || {};
    var dbUsed = {};
    S.slots.forEach(function (id) {
      var sk = id ? C.skillById(id) : null;
      if (sk && sk.db) {
        dbUsed[sk.db.k] = true;
        (sk.db.types || []).forEach(function (tk) { dbUsed[tk] = true; });
      }
    });
    var dbChips = Object.keys(dbDefs).map(function (k) {
      var d = dbDefs[k];
      var on = !!(S.debuffOn && S.debuffOn[k]);
      return '<label class="ds-tgl ds-tgl--db' + (dbUsed[k] ? ' is-used' : '') + '" style="--ds-db:' + esc(d.color || '#8b9aa5') + '">' +
        '<input type="checkbox" data-debuff="' + esc(k) + '"' + (on ? ' checked' : '') + '>' +
        '<span>' + esc(d.name) + (dbUsed[k] ? ' <em>조건부 있음</em>' : '') + '</span></label>';
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
      /* 무기·장비 도술 피해 — 무기 자체의 「전체 도술 피해」 + 추가 옵션의 「계열 도술 피해」 */
      '  <div class="ds-field ds-sdmg" id="ds-sdmg">',
      '    <span class="ds-field__label">무기·장비 도술 피해 <em>평타에는 붙지 않습니다</em></span>',
      '    <label class="ds-sdmg__all">',
      '      <span>전체 도술 피해</span>',
      '      <span class="ds-sdmg__box">',
      '        <input type="number" min="0" max="500" step="0.1" inputmode="decimal" placeholder="0"' +
        ' value="' + (allPct > 0 ? num(allPct, 1) : '') + '" data-sdmg-all aria-label="전체 도술 피해 (%)">',
      '        <em>%</em>',
      '      </span>',
      '    </label>',
      '    <div class="ds-sdmg__head">계열별 도술 피해 <em>무기 추가 옵션 · 최대 2~3개 계열</em></div>',
      '    <div class="ds-sdmg__grid">' + styleCells + '</div>',
      '    <p class="ds-sdmg__note">③ 도술 장착 8칸에 넣은 계열은 <b>테두리</b>로 표시합니다. 전체 +%와 계열 +%를 <b>더해서</b> 그 계열 도술(일반 · 연계기 · 궁극기) 계수에 한 번 곱하고, <b>평타에는 붙지 않습니다</b>.</p>',
      '  </div>',
      '  <div class="ds-field ds-debuff">',
      '    <span class="ds-field__label">디버프 조건 <em>파티원·다른 요소가 걸어 주는 것으로 보고 켜 둡니다</em></span>',
      '    <div class="ds-tgls ds-tgls--db">' + dbChips + '</div>',
      '    <p class="ds-debuff__note">③ 장착한 도술이 조건부 추가 피해를 받는 디버프는 이름 옆에 <b>조건부 있음</b>으로 표시합니다. ' +
        '깨비지지 연결 정보에는 이 디버프들을 <b>거는 도술이 없어</b> 자동 감지가 비어 있으므로, 레이드처럼 파티가 걸어 주는 상황이면 여기서 켜 두세요. ' +
        '해제 시간이 공개된 <b>빙결 3.5초 · 속박 2초</b>는 자동으로도 동작합니다.</p>',
      '  </div>',
      '  <div class="ds-field ds-field--row">',
      '    <label>평타 1회 시간<input type="number" min="0.3" max="3" step="0.05" value="' + num(S.autoInterval, 2) + '" data-auto="interval"></label>',
      '    <label>평타 1회 계수(%)<input type="number" min="0" max="800" step="5" value="' + num(S.autoCoeff, 0) + '" data-auto="coeff"></label>',
      '    <label>도술 사이 간격(초)<input type="number" min="0" max="2" step="0.05" value="' + num(S.gap, 2) + '" data-auto="gap"></label>',
      '  </div>',
      '  <div class="ds-field ds-field--row">',
      '    <label class="ds-check"><input type="checkbox" data-opt="chargeFull"' + (S.chargeFull ? ' checked' : '') + '><span>차지 도술은 최대 차지로</span></label>',
      '    <span class="ds-tune__hint">궁극기(R) 자리는 ④ 사용 순서 설정에서 정합니다</span>',
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
        '<p class="ds-tune__caption"><b>연계</b> — 한 도술을 정해진 시간 안에 한 번 더 쓰는 연계기(월식 · 쌍검 가르기 · 은신 등 6개)를 계산에 넣습니다. 1단계를 써야 2단계가 나가므로 다음 발동 대기시간은 연계를 켜도 <b>1단계 쿨타임</b> 그대로입니다. 체크를 풀면 1단계만 셈합니다.</p>' +
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

  /* 신식 발동 요약 — 계열별 게이지가 이번 전투에서 어떻게 돌았는지 */
  function gaugeFootHtml(r) {
    var list = r.gauge || [];
    return list.map(function (g) {
      var tc = g.tierCasts || [0, 0, 0];
      var s = '';
      if (g.style === 'assassinate') {
        s = '<b>절명 신식</b> — 검의 형상이 최대(5개)일 때 도술마다 <b>궁극기 남은 쿨 -6초</b>(' + g.cuts + '회), ' +
          '형상을 소모한 궁극기 <b>' + g.ultBuffed + '회</b>에 형상 수만큼(3·4·5개 → +55 / 75 / 125%) 피해가 붙었습니다.';
      } else if (g.style === 'combo') {
        s = '<b>연타 신식</b> — 격노는 <b>적중마다 1중첩</b>(최대 50), 중첩당 피해 +0.4%(최대 +20%)입니다. ' +
          '이번 전투 최대 <b>' + g.maxStacks + '중첩</b> · 피해 증가가 붙은 시전 <b>' + g.buffCasts + '회</b>.';
      } else if (g.style === 'smash') {
        s = '<b>강타 신식</b> — 영력이 33·66·100을 넘을 때 <b>그 시전</b> 피해가 +3% · +7% · +10%(1·2·3단계 ' +
          tc.join(' · ') + '회)이고, 영력 100에서 천벌을 쓰면 <b>강압</b>으로 도술 쿨이 초기화됩니다(' + g.triggers + '회).';
      } else if (g.style === 'execution') {
        s = '<b>척살 신식</b> — 척결은 영력 100마다 1중첩(30초 · 최대 10중첩, 중첩당 피해 +2% · 최대 +20%)이고, ' +
          '<b>중첩을 얻을 때마다 다른 도술의 남은 쿨이 20%(궁극기 10%) 줄어듭니다</b> — 이번 전투 ' + g.triggers + '회(최대 ' + g.maxStacks + '중첩).';
      } else if (g.style === 'hex') {
        s = '<b>주술 신식</b> — 영력은 시전마다 +8, 1초마다 -4라 <b>30·60·90</b>을 넘으면 구슬 1·2·3개가 됩니다. ' +
          '그때마다 다른 도술의 남은 쿨이 <b>-0.1 / -0.2 / -0.3초</b>(1·2·3단계 ' + tc.join(' · ') + '회)이고, ' +
          '궁극기는 구슬 단계만큼 <b>+30 / 60 / 90%</b>(' + g.ultBuffed + '회)입니다.';
      } else if (g.style === 'dash') {
        s = '<b>기동 신식</b> — 영력 200(도술 20회)마다 <b>궁극기 쿨을 초기화</b>하고 10초 [연쇄]가 켜집니다(' + g.triggers + '회). ' +
          '연쇄 동안 궁극기 피해 <b>+50%</b> — 이번 전투 연쇄 중 궁극기 ' + g.ultBuffed + '회 · 연쇄가 돌아간 시간 ' + num(g.windowSec, 1) + '초.';
      }
      return s ? '<p class="ds-foot">' + s + '</p>' : '';
    }).join('');
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
      '<b>무기·장비 도술 피해</b>는 전체 +%와 계열 +%를 <b>더해서</b>(예: 전체 +10% · 파멸 +15% → 파멸 도술 ×1.25) 그 계열 도술(일반·연계기·궁극기) 계수에만 곱하고 <b>평타에는 붙지 않습니다</b>. ' +
      '<b>연계기</b>(월식 · 쌍검 가르기 · 은신 같은 6개)는 1단계 시전시간 + 연계 시전시간을 함께 점유하고 피해도 1단계 + 연계를 더하며, 다음 발동은 연계를 켜도 <b>1단계 쿨타임</b>을 그대로 기다립니다. ' +
      '<b>신식</b>은 계열마다 <b>영력·중첩(게이지)</b>이 실제로 차는 만큼만 붙습니다 — 적중·시전·처치로 쌓이고, 단계·중첩·지속시간·최대치 효과를 그대로 계산합니다. ' +
      (r.halfCd ? '<b>기만 신식</b>(눈물 2개)은 궁극기를 뺀 도술 <b>' + r.halfCd.every + '회마다</b> 쿨이 돌고 있는 도술 하나의 <b>남은 쿨을 50%</b> 줄이며, 대상이 <b>무작위 1개</b>라 실제 편차가 있습니다 — 계산기는 쿨 중인 k개 도술의 남은 쿨을 (1 - 0.5/k)배로 함께 줄인 <b>평균 기댓값</b>으로 계산합니다. ' : '') +
      '<b>[주술 신식개방]</b>처럼 계열 신식이 열려야 붙는 추가 피해는 신식이 켜졌을 때만 더합니다. ' +
      (r.snipe ? '<b>저격 신식</b>은 전투가 시작되면 저격 영력이 <b>1초에 25</b>(4초마다 화살촉 1개 · 최대 300 = 화살촉 3개)씩 차오르고, 저격 계열 일반 도술은 화살촉 1개를 써서 그 시전 피해 <b>+45%</b>, 궁극기(정조준)는 모은 화살촉을 모두 써서 1개당 <b>+25%</b>(최대 3개 +75%)입니다. 화살촉을 쓸 때마다 <b>연속 조준</b>이 1중첩(최대 5 · 10초 갱신) 쌓여 중첩당 모든 피해(평타 포함) +5%가 붙습니다. 적 처치·귀보 영력은 넣지 않습니다. ' : '') +
      (r.dmgBuff ? '<b>파멸 요기범람</b>은 궁극기를 뺀 도술 <b>' + r.dmgBuff.every + '회마다</b>(영력 200) 그 순간부터 <b>' + r.dmgBuff.sec + '초 동안만</b> 피해 +' + num(r.dmgBuff.buff * 100, 0) + '%가 붙고, 버프가 끝나면 다시 빠집니다. ' : '') +
      (r.valour ? '<b>용맹의 기운</b>은 시전이 끝난 순간부터 <b>' + r.valour.sec + '초 동안</b> 내가 주는 피해(도술·평타)를 ×' + num(r.valour.mul, 3) + '로 올리고, 10초가 지나면 빠집니다 — 공격력 버프는 <b>헌신 0강 +15% → 50강 +20%</b>(강화 레벨에 비례)이고, 사용 순서에서 앞쪽에 두면 뒤에 쓰는 도술이 버프를 실게 됩니다. ' : '') +
      '평타 1회 시간·계수는 내 스펙 조정에서 바꿀 수 있습니다.</p>' +
      (r.dmgBuff ? '<p class="ds-foot">요기범람 — 이번 전투에서 <b>' + r.dmgBuff.triggers + '회</b> 발동, 버프가 돌아간 시간 <b>' +
        num(r.dmgBuff.activeSec, 1) + '초</b> · +' + num(r.dmgBuff.buff * 100, 0) + '% 적용 시전 <b>' + r.dmgBuff.buffedCasts + '회</b>.</p>' : '') +
      (r.halfCd ? '<p class="ds-foot">기만 신식 발동 — 이번 전투에서 <b>' + r.halfCd.triggers + '회</b> 발동, 쿨 중인 도술 평균 <b>' +
        num(r.halfCd.avgCooling, 1) + '개</b> 중 1개를 줄였습니다' +
        (r.halfCd.wasted ? ' (쿨 중인 도술이 없어 ' + r.halfCd.wasted + '회는 그냥 사라졌습니다)' : '') + '.</p>' : '') +
      (r.valour ? valourFootHtml(r) : '') +
      snipeFootHtml(r) +
      debuffFootHtml(r) +
      gaugeFootHtml(r) +
      excludedFootHtml(r);
  }

  /* 저격 신식 — 시간 기반 화살촉 게이지가 이번 전투에서 어떻게 돌았는지 */
  function snipeFootHtml(r) {
    var s = r.snipe;
    if (!s) { return ''; }
    var aim = s.aim
      ? '연속 조준이 <b>' + num(s.aimTime, 1) + '초</b> 돌았고 평균 <b>' + num(s.aimAvg, 1) + '중첩</b>(최대 ' +
        s.aimMaxStack + '중첩 · 피해 +' + num(s.aimMaxStack * 5, 0) + '%)이었습니다' +
        (s.aimExpiries ? ' · 10초가 지나 끊어진 횟수 ' + s.aimExpiries + '회' : '') + '.'
      : '연속 조준 토글이 꺼져 있어 중첩은 쌓지 않았습니다.';
    return '<p class="ds-foot">저격 신식 — 이번 전투에서 화살촉을 쓴 저격 도술 <b>' + s.shotCasts + '회</b>(화살촉 ' +
      s.shots + '개) · 화살촉 없이 시전 ' + s.noArrowCasts + '회, 정조준은 <b>' + s.ultCasts + '회</b> 발동해 화살촉 <b>' +
      s.ultArrows + '개</b>를 모두 소모했습니다. ' + aim + '</p>';
  }

  /* 디버프 조건부 — 이번 전투에서 어떤 디버프가 얼마나 돌았고, 얼마를 더했는지 */
  function debuffFootHtml(r) {
    var all = r.debuffs || [];
    var active = all.filter(function (d) { return d.casts > 0 || (d.on && d.used); });
    var used = all.filter(function (d) { return d.used; });
    var lines = [];
    if (active.length) {
      lines.push(active.map(function (d) {
        var src = d.on ? '파티가 걸어줌' : '내 덱이 걸어줌';
        return '<b>' + esc(d.name) + '</b> ' +
          (d.casts > 0
            ? '조건부 피해 <b>' + d.casts + '회</b> 발동 · <b>+' + num(d.extra, 0) + '%p</b>(총 계수의 ' + num(d.share, 1) + '%)'
            : '조건부 피해가 붙은 시전 없음') +
          ' <i>(' + src + (d.sec ? ' · ' + d.sec + '초' : '') + ')</i>';
      }).join(' · '));
    } else if (used.length) {
      lines.push('지금은 걸린 디버프가 없어 조건부 피해가 붙지 않았습니다 — 이 덱이 조건부로 받는 디버프: <b>' +
        used.map(function (d) { return esc(d.name); }).join(' · ') + '</b>. ⑥ 내 스펙 조정의 디버프 조건에서 켜 보세요.');
    }
    if (r.statusCond) {
      lines.push('정조준 — 걸린 <b>출혈·화상·감전·약화</b> 1종류당 +' + num(r.statusCond.pct, 0) + '%로 <b>' +
        r.statusCond.casts + '회</b> 시전(평균 ' + num(r.statusCond.avgTypes, 2) + '종 · 최대 ' + r.statusCond.maxTypes +
        '종)해 <b>+' + num(r.statusCond.extra, 0) + '%p</b>(총 계수의 ' + num(r.statusCond.share, 1) + '%)를 더했습니다.');
    }
    if (!lines.length) { return ''; }
    return '<p class="ds-foot">디버프 조건부 — ' + lines.join('<br>') + '</p>';
  }

  /* 계산에서 빠진 항목 — 지금 덱에 해당하는 것만 */
  function excludedFootHtml(r) {
    var list = r.excluded || [];
    if (!list.length) { return ''; }
    return '<p class="ds-foot ds-foot--excluded"><b>계산에서 제외됨</b> — ' +
      list.map(function (x) { return esc(x.t); }).join(' · ') + '.</p>';
  }

  /* 용맹의 기운 — 10초 버프가 이번 전투에서 어떻게 돌았는지 */
  function valourFootHtml(r) {
    var v = r.valour;
    var src = '헌신 ' + v.lv + '강 +' + num(v.atkRaw * 100, 1) + '%' +
      (v.heart ? ' × 하트 +30% = +' + num(v.atk * 100, 1) + '%' : '');
    return '<p class="ds-foot">용맹의 기운 — 이번 전투에서 <b>' + v.triggers + '회</b> 발동, 버프가 돌아간 시간 <b>' +
      num(v.activeSec, 1) + '초</b> · 버프 중 배수 <b>×' + num(v.mul, 3) + '</b>(' + src +
      (v.aura ? ' + 6돌파 주는 피해 +' + num(v.aura * 100, 0) + '%' : '') +
      ')가 붙은 시전 <b>' + v.buffedCasts + '회</b>' +
      (v.autoSec > 0 ? ' · 그 구간 평타 <b>' + num(v.autoSec, 1) + '초</b>' : '') + '.</p>';
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
        '<b>' + esc(x.name) + chainBadge(x.id) + '</b>' +
        '<small>' + (isUlt ? 'R' : x.slot + '번') + ' · ' + esc(x.styleName) + ' ' + num(x.cd) + '초 · ' +
        '시전 ' + num(x.castAll, 2) + '초' + (x.est ? ' · 추정' : '') +
        (x.sinOn ? ' · 신식 +' + num(x.sinCoeff, 0) + '%' : '') +
        (x.enh ? ' · Lv' + x.enh : '') + (x.trans ? ' · ' + x.trans + '돌파' : '') + '</small></span>' +
        '<span class="c-num">' + x.casts + '회</span>' +
        '<span class="c-pct">' + (x.deals ? num(x.share, 1) + '%' : '–') + '</span>' +
        (x.chain ? '<span class="c-chain">연계 <b>' + esc(x.chain.name) + '</b> ' + x.chain.uses + '회 · +' +
          num(x.chain.castLen, 2) + '초 · ' + num(x.chain.coeff, 0) + '% (1단계와 합 ' +
          num(x.coeff + x.chain.coeff, 0) + '%)' +
          ' · 1단계 쿨 ' + num(x.cd) + '초 유지</span>' : '') +
        (x.sinOn ? '<span class="c-chain c-sin">' + esc(x.sinLabel) + ' 신식 +' +
          num(x.sinCoeff, 0) + '% (합 ' + num(x.coeff, 0) + '%)</span>' : '') +
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
      segs.push({ t0: t0, t1: t1, kind: s.kind, name: s.name, id: s.id, color: s.color, isUlt: s.isUlt, chain: s.chain });
    });
    var legend = [];
    var seen = {};
    segs.forEach(function (s) {
      if (s.kind !== 'cast' || s.chain) { return; }
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
      if (s.chain) { cls += ' is-chain'; }
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

  var OPT_MODES = [
    { key: 'idle', label: '⏱️ 평타 빈 시간 최소화 순서', short: '평타 빈 시간 최소화' },
    { key: 'dps', label: '🔥 DPS 최대화 순서', short: 'DPS 최대화' }
  ];

  function optButtons(current) {
    return '<div class="ds-opt__acts ds-opt__acts--row">' + OPT_MODES.map(function (m) {
      var on = current === m.key;
      return '<button type="button" class="ds-btn' + (m.key === 'dps' ? ' ds-btn--accent' : '') +
        (on ? ' is-on' : '') + '" data-act="optimize" data-mode="' + m.key + '">' +
        (on ? '다시 계산 — ' : '') + m.label + '</button>';
    }).join('') + '</div>';
  }

  function optHtml(r) {
    var o = S.opt;
    if (!o || !o.ok) {
      return '<div class="ds-opt">' +
        optButtons(null) +
        '<p class="ds-opt__note">사용 순서의 두 칸 맞바꾸기·한 칸 옮기기를 <b>모두 계산</b>합니다. ' +
        '<b>장착 8칸은 절대 건드리지 않으므로</b> 기본 1~5칸으로 정해진 신식·궁극기는 그대로입니다. ' +
        '⏱️는 <b>평타 빈 시간(초)</b>이 가장 적은 순서(동률이면 DPS 높은 쪽), 🔥는 <b>초당 피해(DPS)</b>가 가장 높은 순서(동률이면 평타 빈 시간 적은 쪽)를 찾습니다.</p>' +
        '</div>';
    }
    var mode = o.mode === 'idle' ? OPT_MODES[0] : OPT_MODES[1];
    var orderIds = (Array.isArray(o.castOrder) && o.castOrder.length) ? o.castOrder : (o.slots || []);
    var names = orderIds.map(function (id, i) {
      var sk = id ? C.skillById(id) : null;
      return sk ? (i + 1) + '.' + sk.n : '';
    }).filter(Boolean).join(' › ');
    var sameKey = mode.key + '|' + o.after.totalCoeff + '|' + o.after.idle;
    var gain = o.mode === 'idle'
      ? (o.gainIdle > 0.05 ? '평타 빈 시간 -' + num(o.gainIdle, 1) + '초' : '평타 빈 시간은 이미 최소')
      : (o.gainDps > 0.05 ? 'DPS +' + num(o.gainDps, 1) : 'DPS 는 이미 최대');
    return '<div class="ds-opt ds-opt--done">' +
      '<p class="ds-opt__head">' + mode.label + ' <em>' + (o.changed ? gain : '지금 순서가 이미 좋습니다') + '</em></p>' +
      '<p class="ds-opt__order">' + esc(names) + '</p>' +
      '<div class="ds-opt__diff">' +
      '<span>평타 빈 시간 ' + num(o.before.idle, 1) + '초 → <b>' + num(o.after.idle, 1) + '초</b></span>' +
      '<span>DPS ' + num(o.before.dps, 1) + ' → <b>' + num(o.after.dps, 1) + '</b></span>' +
      '</div>' +
      (o.changed ? '<div class="ds-opt__acts"><button type="button" class="ds-btn ds-btn--accent" data-act="apply-opt" data-key="' + esc(sameKey) + '">이 순서로 바꾸기</button></div>' : '') +
      optButtons(mode.key) +
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
    renderHuntOut();
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
        '<span class="ds-pk__name">' + esc(sk.n) + '<em>' + esc(C.kindLabel(sk.k)) + '</em>' + gradeBadge(sk.id) + chainBadge(sk.id) + '</span>' +
        '<span class="ds-pk__meta">' + esc(C.styleName(sk.st)) + ' · ' + num(sk.cd) + '초 · 시전 ' + num(sk.ct, 2) + '초 · ' + num(sk.c, 0) + '%' +
        (sk.chain ? ' · 연계 ' + esc(sk.chain.name) + ' ' + num(sk.chain.per[0], 0) + '%' : '') + '</span>' +
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
    renderOrder();
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
    renderOrder();
    renderEnhance();
    renderTune();
    recompute();
  }

  /* ---------------------------------------------------------
     이벤트
     --------------------------------------------------------- */
  /* 계산기 화면 맨 위로 — #screen-dosul 이 스크롤 컨테이너입니다(overflow-y:auto) */
  function scrollDosulTop() {
    if (el.root) {
      if (typeof el.root.scrollTo === 'function') { el.root.scrollTo({ top: 0, behavior: 'auto' }); }
      el.root.scrollTop = 0;
    }
    try { global.scrollTo({ top: 0, behavior: 'auto' }); } catch (e) { /* 창 스크롤이 없는 화면 */ }
  }

  function bind() {
    if (bound) { return; }
    bound = true;

    el.root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) { return; }
      /* ⑦/⑧ 모드 전환 — 단일 보스 DPS ↔ 자사계산기 */
      var md = t.closest('[data-calc-mode]');
      if (md) {
        var mk = md.getAttribute('data-calc-mode') === 'hunt' ? 'hunt' : 'raid';
        if (S.mode !== mk) {
          S.mode = mk;
          applyMode();
          save();
          /* v51 — 모드가 바뀌면 결과 중간이 아니라 계산기 맨 위부터 보이게 합니다 */
          scrollDosulTop();
          global.setTimeout(scrollDosulTop, 60);
        }
        return;
      }
      /* 🏹 몹 체력 넣는 방식 — 사냥터 선택 ↔ 직접 입력 */
      var hmode = t.closest('[data-hunt-hpmode]');
      if (hmode) {
        var want = hmode.getAttribute('data-hunt-hpmode') === 'ground' ? 'ground' : 'hits';
        if (S.hunt.hpMode !== want) {
          S.hunt.hpMode = want;
          if (want === 'ground' && !(C.huntGround && C.huntGround(S.hunt.groundId || ''))) {
            S.hunt.groundId = HUNT_DEFAULT_GROUND;
          }
          huntCache.key = '';
          renderHuntForm();
          recompute();
          save();
        }
        return;
      }
      /* 🏹 사냥터 원터치 프리셋 · 계산 시간 */
      var hq = t.closest('[data-hunt-preset]');
      if (hq) {
        var qk = hq.getAttribute('data-hunt-preset');
        var qq = HUNT_Q.filter(function (x) { return x.key === qk; })[0];
        if (qq) {
          S.hunt.maxMobs = qq.mobs;
          S.hunt.respawnSec = qq.respawn;
          huntCache.key = '';
          renderHuntForm();
          recompute();
        }
        return;
      }
      var hd = t.closest('[data-hunt-dur]');
      if (hd) {
        S.hunt.duration = Number(hd.getAttribute('data-hunt-dur')) || 180;
        huntCache.key = '';
        var hsegs = el.hunt ? el.hunt.querySelectorAll('[data-hunt-dur]') : [];
        for (var hi = 0; hi < hsegs.length; hi++) {
          hsegs[hi].classList.toggle('is-on', Number(hsegs[hi].getAttribute('data-hunt-dur')) === S.hunt.duration);
        }
        renderHuntOut();
        save();
        return;
      }
      var preset = t.closest('[data-preset]');
      if (preset) {
        var p = C.presets().filter(function (x) { return x.id === preset.getAttribute('data-preset'); })[0];
        if (p) {
          S.slots = p.slots.slice(0, 8);
          S.castOrder = [];
          S.opt = null;
          renderPresets(); renderSlots(); renderSin(); renderOrder(); renderEnhance(); renderTune(); recompute();
        }
        return;
      }
      var sdRes = t.closest('[data-sdmg-reset]');
      if (sdRes) {
        /* 계열 도술 피해 한 칸 초기화 — 그 칸만 0으로 */
        var rk = sdRes.getAttribute('data-sdmg-reset');
        if (S.styleDmgPct) { delete S.styleDmgPct[rk]; }
        var rcell = sdRes.closest('[data-sdmg-cell]');
        if (rcell) {
          rcell.classList.remove('is-set');
          var rin = rcell.querySelector('[data-sdmg]');
          if (rin) { rin.value = ''; }
        }
        S.opt = null;
        updateTuneSum();
        recomputeSoon();
        return;
      }
      var act = t.closest('[data-act]');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'clear') {
          S.slots = [null, null, null, null, null, null, null, null];
          S.castOrder = [];
          S.opt = null;
          renderPresets(); renderSlots(); renderSin(); renderOrder(); renderEnhance(); renderTune(); recompute();
        } else if (a === 'picker-close') {
          closePicker();
        } else if (a === 'reset-ov') {
          S.override = {};
          renderTune(); recompute();
        } else if (a === 'trans-reset') {
          S.trans = {};
          S.tr6 = {};
          S.opt = null;
          renderEnhance(); recompute();
        } else if (a === 'optimize') {
          S.opt = C.optimize(config(), act.getAttribute('data-mode') || 'dps');
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
          if (S.opt && S.opt.ok && Array.isArray(S.opt.castOrder)) {
            /* 장착 8칸은 그대로 — 사용 순서만 바꿉니다 */
            S.castOrder = S.opt.castOrder.slice();
            S.opt = null;
            renderOrder(); recompute();
          }
        }
        return;
      }
      var mv = t.closest('[data-mv]');
      if (mv) {
        moveSlot(Number(mv.getAttribute('data-slot')), mv.getAttribute('data-mv') === 'up' ? -1 : 1);
        return;
      }
      var omv = t.closest('[data-omv]');
      if (omv) {
        moveOrder(omv.getAttribute('data-ord'), omv.getAttribute('data-omv') === 'up' ? -1 : 1);
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
        setDuration(seg.getAttribute('data-duration'));
        return;
      }
      var qseg = t.closest('[data-quick-duration]');
      if (qseg) {
        setDuration(qseg.getAttribute('data-quick-duration'));
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
      /* 🏹 사냥터 조건 입력 */
      var hk = t.getAttribute && t.getAttribute('data-hunt');
      if (hk) {
        var hv = Number(t.value);
        if (isFinite(hv)) { S.hunt[hk] = hv; huntCache.key = ''; }
        /* 사냥터를 고른 채 평타만 고치면 「÷ 내 평타 = 몇 방」 줄도 바로 바뀝니다 */
        if (hk === 'myAutoDmg' && S.hunt.hpMode === 'ground') { updateHuntCalcLine(); }
        if (el.huntHint) {
          el.huntHint.textContent = num(S.hunt.maxMobs, 0) + '마리 · ' + num(S.hunt.respawnSec, 1) + '초 · 치명타 ' + num(S.hunt.critPct, 0) + '%';
        }
        recomputeSoon();
        return;
      }
      if (t.id === 'ds-picker-q') {
        S.picker.q = t.value;
        renderPickerList();
        return;
      }
      if (t.id === 'ds-cd-range') {
        S.cdReducePct = Number(t.value);
        var lab = document.getElementById('ds-cd-pct');
        if (lab) { lab.textContent = num(S.cdReducePct, 0) + '%'; }
        updateTuneSum();
        S.opt = null;
        recomputeSoon();
        return;
      }
      if (t.hasAttribute && t.hasAttribute('data-sdmg-all')) {
        S.allDosulDmgPct = t.value === '' ? 0 : clampPct(t.value);
        S.opt = null;
        updateTuneSum();
        recomputeSoon();
        return;
      }
      var sdKey = t.getAttribute && t.getAttribute('data-sdmg');
      if (sdKey) {
        if (!S.styleDmgPct) { S.styleDmgPct = {}; }
        if (t.value === '') { delete S.styleDmgPct[sdKey]; }
        else {
          var sv = clampPct(t.value);
          if (sv > 0) { S.styleDmgPct[sdKey] = sv; } else { delete S.styleDmgPct[sdKey]; }
        }
        var sdCell = t.closest ? t.closest('[data-sdmg-cell]') : null;
        if (sdCell) { sdCell.classList.toggle('is-set', !!S.styleDmgPct[sdKey]); }
        S.opt = null;
        updateTuneSum();
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
      /* 🏹 사냥터 고르기 — 고르면 그 사냥터 몹 체력으로 다시 계산합니다 */
      var hg = t.getAttribute && t.getAttribute('data-hunt-ground');
      if (hg) {
        S.hunt.groundId = t.value || '';
        huntCache.key = '';
        renderHuntForm();
        recompute();
        save();
        return;
      }
      /* 🏹 사냥터 조건 — 칸을 벗어날 때 범위로 다듬습니다 */
      var hck = t.getAttribute && t.getAttribute('data-hunt');
      if (hck) {
        var lim = { killHits: [0.5, 2000], maxMobs: [1, 60], respawnSec: [0.5, 120],
          critPct: [0, 100], critDmgPct: [0, 500], autoCoeff: [10, 3000],
          maxHp: [0, 100000000], mobDmg: [0, 100000000], mobAtkInterval: [0.2, 30],
          healAtPct: [0, 99], healPct: [0, 500],
          myAutoDmg: [0, 100000000], hpRegen: [0, 100000000] };
        var rg = lim[hck] || [0, 1000000];
        var vv = Number(t.value);
        if (!isFinite(vv)) { vv = S.hunt[hck]; }
        if (hck === 'maxMobs') { vv = Math.round(vv); }
        vv = Math.max(rg[0], Math.min(rg[1], vv));
        S.hunt[hck] = vv;
        t.value = num(vv, 2);
        huntCache.key = '';
        if (el.huntHint) {
          el.huntHint.textContent = num(S.hunt.maxMobs, 0) + '마리 · ' + num(S.hunt.respawnSec, 1) + '초 · 치명타 ' + num(S.hunt.critPct, 0) + '%';
        }
        recompute();
        return;
      }
      var chId = t.getAttribute && t.getAttribute('data-chain');
      if (chId) {
        if (t.checked) { delete S.chain[chId]; } else { S.chain[chId] = false; }
        S.opt = null;
        renderSlots();
        recompute();
        return;
      }
      var tr6 = t.getAttribute && t.getAttribute('data-tr6');
      if (tr6) {
        var sep = tr6.indexOf(':');
        var sid = tr6.slice(0, sep);
        var oid = tr6.slice(sep + 1);
        var arr6 = S.tr6[sid] || [];
        if (t.checked) {
          if (arr6.indexOf(oid) < 0) { arr6.push(oid); }
        } else {
          arr6 = arr6.filter(function (x) { return x !== oid; });
        }
        S.tr6[sid] = arr6;
        S.opt = null;
        /* 카드를 다시 그리지 않고 이 줄만 고칩니다 — 방금 누른 체크박스가 그대로 남도록 */
        var oDmg = 0;
        var oWhen = '';
        var oKind = '';
        C.sixOptions(Number(sid)).forEach(function (o) {
          if (o.id === oid) { oDmg = o.d || 0; oWhen = o.when || ''; oKind = o.k || ''; }
        });
        var li = t.closest ? t.closest('.ds-six__li') : null;
        if (li) {
          var em = li.querySelector('em');
          if (em) { em.textContent = sixOptStateText({ k: oKind, d: oDmg, when: oWhen, on: t.checked }); }
        }
        var rowEl = t.closest ? t.closest('.ds-trans') : null;
        if (rowEl) {
          var rid = Number(rowEl.getAttribute('data-trans-row'));
          var rMeta = rowEl.querySelector('.ds-trans__meta');
          if (rMeta) { rMeta.textContent = transMetaText(rid, C.transInfo(rid, S.trans[rid], S.tr6)); }
        }
        recompute();
        return;
      }
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
      /* 디버프 보조 토글 — 파티가 걸어 주는 것으로 보고 전투 내내 켜 둡니다 */
      var db = t.getAttribute && t.getAttribute('data-debuff');
      if (db) {
        if (!S.debuffOn) { S.debuffOn = {}; }
        if (t.checked) { S.debuffOn[db] = true; }
        else { delete S.debuffOn[db]; }
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

  /* 화면 모드 — 단일 보스 DPS / 자사계산기 */
  function applyMode() {
    if (!el.body) { return; }
    var hunt = !!(S && S.mode === 'hunt');
    el.body.classList.toggle('ds-page--hunt', hunt);
    el.body.classList.toggle('ds-page--raid', !hunt);
    var btns = el.body.querySelectorAll('[data-calc-mode]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-calc-mode') === (hunt ? 'hunt' : 'raid');
      btns[i].classList.toggle('is-on', on);
      btns[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var num = document.getElementById('ds-hunt-num');
    if (num) { num.textContent = hunt ? '7' : '8'; }
  }

  function renderAll() {
    renderPresets();
    renderSlots();
    renderSin();
    renderOrder();
    renderEnhance();
    renderTune();
    renderResult();
    renderHuntForm();
    applyMode();
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
