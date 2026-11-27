/* =========================================================
   ⚔️ 도술 효율 · 평타 빈 시간 계산기 — 시뮬레이션 엔진
   ---------------------------------------------------------
   도술마다 「쿨타임」과 「시전(동작) 시간」이 있습니다.
   자동 사냥은 쿨이 돌아온 도술을 슬롯 순서대로 쓰고,
   쓸 도술이 하나도 없을 때 기본 공격(평타)을 칩니다.

   이 엔진은 그 규칙을 그대로 따라가며
     ① 도술을 쓰지 못해 평타를 치는 시간(초·%)
     ② 도술 가동률
     ③ 도술별 발동 횟수 · 기여 피해 · 차지 시간
     ④ 초반 시전 타임라인
   을 계산합니다. 시간은 이벤트(쿨이 돌아오는 순간) 단위로
   정확히 나눠 계산하므로 0.05초 눈금 오차가 없습니다.
   ========================================================= */
(function (global) {
  'use strict';

  var DATA = global.YM_DOSUL_DATA || { styles: [], skills: [], presets: [] };

  var STYLE_BY_KEY = {};
  var SKILL_BY_ID = {};
  DATA.styles.forEach(function (s) { STYLE_BY_KEY[s.key] = s; });
  DATA.skills.forEach(function (s) { SKILL_BY_ID[s.id] = s; });

  /* 공개 자료에 시전 시간이 없는 도술(은신·최후의 저항)은 0.5초로 둡니다. */
  var FALLBACK_CAST = 0.5;

  var KIND_LABEL = { attack: '공격', buff: '강화', heal: '회복', move: '이동', ult: '궁극기' };

  function clone(o) {
    var r = {};
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { r[k] = o[k]; } }
    return r;
  }

  function round(n, d) {
    var p = Math.pow(10, d || 0);
    return Math.round(n * p) / p;
  }

  /* ---------------------------------------------------------
     강화(계열 레벨) · 돌파(도술 단계) — 2026-11-24 도깨비지지 확인값
     · 강화는 계열 단위: 표시 계수 = 기본 계수 × (1 + 강화 보너스)
     · 돌파는 도술 단위: 단계마다 계수 +3%, 쿨타임 -1.5%(그 도술만)
       6돌파부터 [돌파 효과]가 붙어 계수가 더 오릅니다.
     --------------------------------------------------------- */
  var ENH = DATA.enhance || { max: 50, bonus: [], alt: {} };
  var TRANS = DATA.trans || {};
  var TRANS6 = DATA.trans6 || {};
  var SPECIAL = DATA.special || { label: '특별', normalLabel: '일반', gradeMap: {}, effectIds: [] };

  /* ---------------------------------------------------------
     🏹 사냥 계산용 데이터 — 도술별 최대 타격 대상 수 · 다중 감소 · 적을수록 증가
     (dosul-data.js hunt · 2026-11-27 덱깨비 도술 도감 확인값)
     --------------------------------------------------------- */
  var HUNT = DATA.hunt || { targets: {}, falloff: {}, focus: {} };

  /* 한 번에 맞히는 최대 대상 수 — 공개값이 없으면 1명으로 봅니다 */
  function huntTargets(id) {
    var v = HUNT.targets ? HUNT.targets[String(id)] : 0;
    var n = Math.round(Number(v) || 0);
    return n > 0 ? n : 1;
  }

  /* 다중 타격 피해 감소 배수 — n명을 맞혔을 때의 피해 배율(1 = 감소 없음)
     · from 인원에서 감소 0%, at 인원에서 pct% 까지 (사이 인원은 선형 추정)
     · at 위로는 pct% 로 고정 */
  function huntFalloffMul(id, n) {
    var f = HUNT.falloff ? HUNT.falloff[String(id)] : null;
    if (!f || !(n > 0)) { return 1; }
    var from = Number(f.from) || 0;
    var at = Number(f.at) || from;
    var pct = Math.max(0, Math.min(100, Number(f.pct) || 0));
    if (!from || n < from) { return 1; }
    var span = Math.max(1, at - (from - 1));
    var red = (pct / 100) * Math.min(1, (n - (from - 1)) / span);
    return Math.max(1 - pct / 100, 1 - red);
  }

  /* 「타격 대상이 적을수록 피해 증가」 모양 — 1명 1.0 · upto명 이상 0 */
  function huntFocusShape(id, n) {
    var f = HUNT.focus ? HUNT.focus[String(id)] : null;
    var upto = f ? (Number(f.upto) || 5) : 5;
    var t = Math.max(1, Number(n) || 1);
    if (t >= upto) { return 0; }
    return (upto - t) / Math.max(1, upto - 1);
  }

  function huntData() { return HUNT; }

  /* 🏹 사냥터 27곳 — 깨비지지 일반 사냥터의 권장 전투력·몹 체력 (dosul-data.js huntGrounds)
     · 사냥터를 고르면 몹 체력 ÷ 내 기본 평타로 「평타 몇 방」을 만들어 같은 엔진에 넣습니다.
     · 공개 사냥터가 27곳뿐이라 비경처럼 체력이 없는 곳은 「직접 입력」으로 계산합니다. */
  var GROUNDS = Array.isArray(DATA.huntGrounds) ? DATA.huntGrounds : [];
  var GROUND_BY_ID = {};
  GROUNDS.forEach(function (g) { if (g && g.id) { GROUND_BY_ID[String(g.id)] = g; } });

  function huntGrounds() { return GROUNDS; }
  function huntGround() {
    for (var i = 0; i < arguments.length; i += 1) {
      var g = GROUND_BY_ID[String(arguments[i])];
      if (g) { return g; }
    }
    return null;
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  /* ---------------------------------------------------------
     등급 — 게임은 일반·특별, 도감은 영웅·전설로 부릅니다.
     · 특별(전설) 도술 17개만 6돌파에 [돌파 효과]가 있고,
       그 효과는 7~10돌파에서도 같은 값으로 유지됩니다.
     --------------------------------------------------------- */
  function gradeOf(id) {
    var sk = SKILL_BY_ID[id];
    if (!sk) { return ''; }
    return (SPECIAL.gradeMap && SPECIAL.gradeMap[sk.g]) || sk.g || '';
  }

  function isSpecial(id) {
    var sk = SKILL_BY_ID[id];
    return !!sk && sk.g === '전설';
  }

  /* 6돌파 [돌파 효과]가 있는 도술인지 (전설 일반 도술 17개) */
  function hasSixEffect(id) {
    return Object.prototype.hasOwnProperty.call(TRANS6, String(id));
  }

  function sixOptions(id) {
    var t = TRANS6[String(id)];
    return (t && t.o) ? t.o : [];
  }

  /* 계열 강화 Lv(0~50) → 피해 계수 보너스(%) */
  function enhanceBonus(level, id) {
    var n = Math.round(Number(level) || 0);
    if (n <= 0) { return 0; }
    var max = ENH.max || 50;
    n = clamp(n, 0, max);
    var v = (ENH.bonus || [])[n - 1];
    if (!v) { return 0; }
    var scale = ENH.alt && ENH.alt[id];
    return scale ? v * scale : v;
  }

  function enhanceMax() { return ENH.max || 50; }

  /* 도술 돌파 정보 — 없으면(null) 계산에 넣지 않고 화면에서 안내합니다
     opts : 6돌파 옵션 중 켜 둔 것의 id 배열 (상황별 추가 피해) */
  function transInfo(id, step, opts) {
    var key = String(id);
    var has = Object.prototype.hasOwnProperty.call(TRANS, key);
    var base = has ? TRANS[key] : null;
    var n = clamp(Math.round(Number(step) || 0), 0, 10);
    if (!base) { n = 0; }
    var t6 = TRANS6[key] || null;
    var on6 = !!(t6 && n >= 6);
    /* opts[key] 가 아예 없으면 사용자가 이 도술의 6돌파 옵션 줄을 한 번도 건드리지
       않은 것입니다 — def:true 옵션(용맹의 기운 「자신과 아군이 주는 피해 +20%(10초)」)은
       그때만 기본 켜짐으로 보고, 한 번이라도 건드리면(arr6) 그 값을 그대로 따릅니다. */
    var rawOpts = (opts && Object.prototype.hasOwnProperty.call(opts, key)) ? opts[key] : undefined;
    var touched = Array.isArray(rawOpts);
    var onList = touched ? rawOpts : [];
    var extra = 0;
    /* when 이 있는 옵션(하늘의 심판 「요기범람 상태일 때 +50%」·묵영정정·용사비등 「속박 대상 +20%」)은
       늘 붙지 않고, 그 상태가 살아 있는 시전에만 더합니다 */
    var extraCond = 0;
    var conds = [];
    /* k:'aura' — 그 도술 자신이 아니라 **버프가 돌아가는 동안의 모든 시전**에
       곱해지는 옵션입니다(용맹의 기운 6돌파 +20%(10초)). 시뮬레이터가 따로 곱합니다. */
    var aura = 0;
    /* k:'one' — 「맞는 인원이 적을수록 피해 증가」(난타 +60% · 요기 폭발 +70%).
       레이드(단일 보스)에서는 늘 최대치라 그대로 더하지만, 사냥 계산은 맞은 인원으로
       환산해야 하므로 focusD 로 따로 넘겨 줍니다. */
    var focusD = 0;
    var list = (t6 && t6.o ? t6.o : []).map(function (o) {
      var isOn = !!(o.id && on6 && (onList.indexOf(o.id) >= 0 || (o.def && !touched)));
      var calc = o.k !== 'text' && (o.d || 0) > 0;
      if (isOn && calc) {
        if (o.k === 'aura') { aura += o.d; }
        else if (o.when) { extraCond += o.d; conds.push({ when: o.when, d: o.d }); }
        else { extra += o.d; if (o.id === 'one') { focusD += o.d; } }
      }
      return { id: o.id || '', t: o.t || '', d: o.d || 0, n: o.n || '', k: o.k || '',
        calc: calc, on: isOn, when: o.when || '', def: !!o.def };
    });
    return {
      has: !!base,
      step: n,
      dmgPct: base ? base.d * n : 0,
      cdSec: base ? base.c * n : 0,
      d6: on6 ? (t6.d || 0) : 0,
      t6: t6 ? t6.t : '',
      t6on: on6,
      has6: !!(t6),
      opts: list,
      extra: extra,
      extraCond: extraCond,
      conds: conds,
      aura: aura,
      focusD: focusD
    };
  }

  function styleOf(key) { return STYLE_BY_KEY[key] || null; }  function styleName(key) { var s = STYLE_BY_KEY[key]; return s ? s.name : key; }
  function styleColor(key) { var s = STYLE_BY_KEY[key]; return s ? s.color : '#7fd1bd'; }
  function skillById(id) { return SKILL_BY_ID[id] || null; }
  function allSkills() { return DATA.skills.slice(); }
  /* 연계기가 있는 도술 목록 (106개 중 6개) · 그 도술의 연계 정보 */
  function chainSkills() { return DATA.skills.filter(function (s) { return !!s.chain; }); }
  function chainOf(id) {
    var sk = SKILL_BY_ID[id];
    return (sk && sk.chain) ? sk.chain : null;
  }
  function chainOn(config, id) {
    if (!chainOf(id)) { return false; }
    return !(config && config.chain && config.chain[id] === false);
  }
  function presets() { return DATA.presets.slice(); }
  function styles() { return DATA.styles.slice(); }

  /* 신식 판정: 기본 1~5칸에 같은 계열 3개 이상 */
  function styleCounts(slots) {
    var counts = {};
    for (var i = 0; i < 5; i++) {
      var id = slots[i];
      var sk = id ? SKILL_BY_ID[id] : null;
      if (!sk) { continue; }
      counts[sk.st] = (counts[sk.st] || 0) + 1;
    }
    return counts;
  }

  function sinStyles(slots) {
    var counts = styleCounts(slots);
    var out = [];
    for (var k in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, k) && counts[k] >= 3) {
        out.push({ key: k, count: counts[k], style: STYLE_BY_KEY[k] });
      }
    }
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  /* ---------------------------------------------------------
     장착(slots)과 사용 순서(castOrder) 분리 — 2026-11-24
     · slots     : 게임의 도술 8칸. **기본 1~5칸 구성만이 신식·궁극기(R)** 를 결정합니다.
     · castOrder : 전투에서 도술이 나가는 우선순위. 게임의 「사용 순서 설정」 화면처럼
                   장착 칸과 따로 정하고, 활성화된 궁극기(R)도 이 목록에 들어갑니다.
     --------------------------------------------------------- */
  function equippedIds(slots) {
    var out = [];
    var seen = {};
    for (var i = 0; i < 8; i++) {
      var id = slots[i];
      if (!id) { continue; }
      var sk = SKILL_BY_ID[id];
      if (!sk || seen[id]) { continue; }
      seen[id] = true;
      out.push(id);
    }
    return out;
  }

  /* 지금 켜져 있는 신식 궁극기 id — 신식이 없거나 useUlt=false면 null */
  function activeUltId(slots, useUlt) {
    if (useUlt === false) { return null; }
    var sin = sinStyles(slots);
    if (!sin.length) { return null; }
    var ult = sin[0].style.ult;
    return (ult && SKILL_BY_ID[ult]) ? ult : null;
  }

  /* 장착 칸에 맞춰 사용 순서를 정리합니다.
     · 빠진 도술은 목록에서 지우고
     · 새로 장착한 도술은 **끝에 덧붙이며** (이미 정해 둔 다른 도술 순서는 그대로)
     · 궁극기는 처음 열릴 때 앞에 들어갑니다(예전 기본 동작). 이후엔 원하는 자리로 옮기면 됩니다. */
  function syncCastOrder(slots, castOrder, opts) {
    var o = opts || {};
    var ultId = activeUltId(slots, o.useUlt);
    var all = equippedIds(slots);
    if (ultId != null && all.indexOf(ultId) < 0) { all.push(ultId); }
    var prev = Array.isArray(castOrder) ? castOrder : [];
    var out = [];
    var seen = {};
    prev.forEach(function (v) {
      var id = Number(v);
      if (!id || seen[id] || all.indexOf(id) < 0) { return; }
      seen[id] = true;
      out.push(id);
    });
    all.forEach(function (id) {
      if (seen[id]) { return; }
      seen[id] = true;
      if (id === ultId && o.ultFirst !== false) { out.unshift(id); }
      else { out.push(id); }
    });
    return out;
  }

  /* 슬롯(도술 id 배열 8칸) → 시뮬레이션용 항목 */
  function buildEntries(config) {
    var entries = [];
    var cdPct = Math.max(0, Math.min(60, config.cdReducePct || 0)) / 100;
    var castMode = config.castMode === 'motion' ? 'motion' : 'delay';
    var scale = config.castScale > 0 ? config.castScale : 1;
    var chargeFull = config.chargeFull !== false;
    var sin = sinStyles(config.slots);
    var sinKeys = {};
    sin.forEach(function (s) { sinKeys[s.key] = true; });

    /* 사용 순서 — 장착 칸과 별개로 정해진 시전 우선순위 */
    var orderIds = syncCastOrder(config.slots, config.castOrder, {
      useUlt: config.useUlt,
      ultFirst: config.ultFirst
    });
    function ordOf(id) {
      var k = orderIds.indexOf(id);
      return k < 0 ? 999 : k;
    }

    /* 신식 토글 → 효과 모으기
       · dmg         상시 피해 증가(배수에 바로 넣음)
       · dmgBuff     버프형 피해 증가 — 「dmgBuffEvery」회마다 발동해 「dmgBuffSec」초 동안만 붙습니다
         (파멸 요기범람: 영력 200 = 도술 14회마다 → 30초간 피해 +20%) */
    var fx = { ultCd: 0, cd: 0, cdPct: 0, dmg: 0, snipeDmg: 0, ultDmg: 0, resetEvery: 0, ultResetEvery: 0, halfCdEvery: 0,
      dmgBuff: 0, dmgBuffEvery: 0, dmgBuffSec: 0, heartBuff: 0 };
    var activeToggles = [];
    DATA.styles.forEach(function (st) {
      if (!sinKeys[st.key]) { return; }
      var on = config.toggles && config.toggles[st.key] ? config.toggles[st.key] : [];
      st.toggles.forEach(function (t) {
        if (on.indexOf(t.id) < 0) { return; }
        activeToggles.push({ style: st.key, label: t.label, fx: t.fx });
        for (var k in t.fx) {
          if (Object.prototype.hasOwnProperty.call(t.fx, k)) {
            fx[k] = (fx[k] || 0) + t.fx[k];
          }
        }
      });
    });

    var dmgMul = 1 + fx.dmg;
    var ultDmgMul = 1 + fx.dmg + fx.ultDmg;
    /* 저격 신식 — 「궁극기 외 저격 도술」이 화살촉 1개를 소모할 때만 피해 +45%.
       같은 방에 같이 넣은 다른 계열 도술에는 붙지 않습니다(화면의 「저격 계열 도술」 문구 그대로). */
    var snipeDmgMul = 1 + fx.snipeDmg;
    var cdMul = (1 - cdPct) * (1 - fx.cdPct);

    var ov = config.override || {};
    var enh = config.enhance || {};
    var transCfg = config.trans || {};
    var tr6Cfg = config.tr6 || {};
    /* ---------------------------------------------------------
       무기·장비 도술 피해 — 2026-11-24 준형 님 요청
       · 무기 자체에 붙는 「전체 도술 피해 +%」 (allDosulDmgPct)
       · 무기 추가 옵션의 「특정 계열 도술 피해 +%」 (styleDmgPct[계열])
       두 값은 **합연산**으로 한 번에 곱합니다:
         1 + (전체 + 그 계열) / 100
       대상은 그 계열 도술 전부(일반 도술 · 연계기 · 그 계열 궁극기)이고
       평타에는 붙지 않습니다.
       --------------------------------------------------------- */
    var gearAllPct = Math.max(0, Math.min(500, Number(config.allDosulDmgPct) || 0));
    var gearStyleCfg = (config.styleDmgPct && typeof config.styleDmgPct === 'object') ? config.styleDmgPct : {};

    function makeEntry(id, slot) {
      var sk = SKILL_BY_ID[id];
      if (!sk) { return null; }
      var o = ov[id] || {};
      var rawCast = o.ct > 0 ? o.ct : sk.ct;
      var est = false;
      if (castMode === 'motion' && sk.mv && !(o.ct > 0)) { rawCast = sk.mv; }
      if (!rawCast) { rawCast = FALLBACK_CAST; est = true; }
      var ct = rawCast;
      if (chargeFull && sk.ch) { ct += sk.ch; }
      var cdBase = o.cd > 0 ? o.cd : sk.cd;
      var coeffBase = o.c > 0 ? o.c : sk.c;

      /* 강화는 그 도술의 계열 레벨을 따릅니다 */
      var enhLv = Math.round(Number(enh[sk.st]) || 0);
      var enhPct = enhanceBonus(enhLv, sk.id);
      var tr = transInfo(sk.id, transCfg[id], tr6Cfg);
      /* 디버프 — 이 도술이 받는 조건부 추가 피해(db) · 거는 디버프(dbI) · 비공개 수치(unk) */
      var db = sk.db || null;
      var dbI = sk.dbI || null;

      /* 돌파: 쿨타임은 그 도술만 줄고(최대 기본의 90%), 계수는 단계 누적 + 6돌파 효과 */
      var cdAfterTrans = Math.max(cdBase * 0.1, cdBase - Math.min(cdBase * 0.9, tr.cdSec));
      var cd = cdAfterTrans * cdMul;
      /* 사냥 계산(hunt)에서는 「맞는 인원이 적을수록 증가」 옵션을 실제 맞은 인원으로
         환산하므로, 여기 고정 +% 에서는 빼 둡니다(레이드 계산은 그대로) */
      var trExtra = (tr.extra || 0) - (config.hunt ? (tr.focusD || 0) : 0);
      var trMul = 1 + (tr.dmgPct + tr.d6 + trExtra) / 100;
      /* 조건부 돌파 옵션(요기범람 +50%) — 그 상태에서만 곱합니다 */
      var trMulCond = 1 + (tr.dmgPct + tr.d6 + trExtra + (tr.extraCond || 0)) / 100;
      var condRatio = trMul > 0 ? trMulCond / trMul : 1;
      /* 궁극기 = 상시 피해 + 궁극기 피해(화살촉 3개) / 저격 일반 도술 = 상시 피해 × 저격 +45% / 그 밖 = 상시 피해 */
      var styleMul = (sk.st === 'snipe' && sk.k !== 'ult') ? dmgMul * snipeDmgMul : dmgMul;
      /* 무기·장비 — 전체 +% 와 그 계열 +% 를 더해 이 도술 계수에만 곱합니다(평타 제외) */
      var gearStylePct = Math.max(0, Math.min(500, Number(gearStyleCfg[sk.st]) || 0));
      var gearPct = gearAllPct + gearStylePct;
      var gearMul = 1 + gearPct / 100;
      var allMul = (1 + enhPct / 100) * trMul * (sk.k === 'ult' ? ultDmgMul : styleMul) * gearMul;

      /* 연계기 — 1단계 뒤에 같은 도술을 이어 쓰면 연계 도술이 따로 나갑니다.
         · 시간 : 1단계 시전 + 연계 시전×횟수 (그만큼 평타 칠 시간이 줄어듭니다)
         · 피해 : 1단계 계수 + 연계 계수×횟수 (강화·돌파·신식 배수가 똑같이 붙습니다)
         · 토글 : 「내 스펙 조정」에서 도술별로 끄면 1단계만 계산합니다 */
      /* [OO 신식개방] 조건부 — 그 계열 신식이 열렸을 때만 붙는 추가 피해.
         106개 중 황천의 부름(주술) 하나입니다. 시전은 그대로, 피해만 더합니다. */
      var sinBonus = 0;
      var sinHits = 0;
      var sinDef = sk.sin || null;
      if (sinDef && sinKeys[sinDef.style]) {
        sinBonus = (sinDef.c || 0) * ((o.c > 0 && sk.c > 0) ? o.c / sk.c : 1);
        sinHits = sinDef.h || 0;
      }

      var chain = null;
      var chainDef = sk.chain || null;
      if (chainDef && !(config.chain && config.chain[sk.id] === false)) {
        var ratio = (o.c > 0 && sk.c > 0) ? o.c / sk.c : 1;
        var per = (chainDef.per || []).map(function (v) { return v * ratio; });
        var perSum = 0;
        for (var pi = 0; pi < per.length; pi++) { perSum += per[pi]; }
        var uses = Math.max(1, Math.round(Number(chainDef.uses) || 1));
        var chCastPer = (chainDef.cast != null ? chainDef.cast : ct) * scale;
        chain = {
          name: chainDef.name || '연계',
          uses: uses,
          window: Number(chainDef.window) || 0,
          cool: Number(chainDef.cool) || 0,
          per: per,
          coeff: perSum * allMul,
          ratio: ratio,
          hits: Number(chainDef.hits) || 0,
          castPer: chCastPer,
          castLen: chCastPer * uses,
          condRatio: condRatio,
          est: !!chainDef.est
        };
      }

      return {
        id: sk.id, slot: slot, name: sk.n, style: sk.st, kind: sk.k,
        ord: ordOf(sk.id),
        cdBase: cdBase, cd: cd,
        cast: ct * scale, castBase: ct, est: est,
        coeff: (coeffBase + sinBonus) * allMul,
        sinOn: sinBonus > 0,
        sinCoeff: sinBonus * allMul,
        sinLabel: sinDef ? (sinDef.label || '신식개방') : '',
        sinNote: sinDef ? (sinDef.note || '') : '',
        condRatio: condRatio,
        tr6CondPct: tr.extraCond || 0,
        chain: chain,
        chainCast: chain ? chain.castLen : 0,
        chainCoeff: chain ? chain.coeff : 0,
        hits: sk.h + sinHits, charge: sk.ch || 0,
        enh: enhLv, enhPct: enhPct,
        gearPct: gearPct, gearAllPct: gearAllPct, gearStylePct: gearStylePct,
        trans: tr.step, transDmgPct: tr.dmgPct, transCd: tr.cdSec,
        tr6: tr.t6on, tr6Pct: tr.d6, tr6Text: tr.t6, hasTrans: tr.has,
        tr6Extra: trExtra, tr6ExtraCond: tr.extraCond || 0, tr6Opts: tr.opts, sp: isSpecial(sk.id), grade: gradeOf(sk.id),
        /* 사냥 계산용 — 한 번에 맞히는 최대 대상 수 · 「적을수록 증가」 값 */
        tgt: huntTargets(sk.id), focusD: tr.focusD || 0,
        dbKey: db ? (db.k || '') : '', dbPct: db ? (Number(db.pct) || 0) : 0,
        dbTypes: (db && Array.isArray(db.types)) ? db.types.slice() : [],
        dbInflict: dbI ? (dbI.k || '') : '', dbInflictSec: dbI ? (Number(dbI.sec) || 0) : 0,
        conds: tr.conds || [], unk: sk.unk || ''
      };
    }

    var i;
    for (i = 0; i < 8; i++) {
      var id = config.slots[i];
      if (!id) { continue; }
      var e = makeEntry(id, i);
      if (e) { entries.push(e); }
    }

    /* 신식 활성 → 궁극기 자동 장착. 자리는 「사용 순서 설정」(castOrder)을 그대로 따릅니다 */
    var ultEntry = null;
    if (sin.length && config.useUlt !== false) {
      var ultId = sin[0].style.ult;
      ultEntry = makeEntry(ultId, 99);
      if (ultEntry) {
        ultEntry.kind = 'ult';
        ultEntry.cd = Math.max(1, ultEntry.cd - fx.ultCd);
      }
    }

    /* ---------------------------------------------------------
       용맹의 기운(1120060) — 시전이 끝난 순간부터 10초 버프
       · 기본 : 그 10초 동안 내가 주는 피해 ×1.15 (공격력 +15%)
         헌신 계열 **강화 레벨**에 따라 0강 +15% → 50강 +20% 로 오릅니다
       · 헌신 신식 「하트 3개 → 이로운 효과 +30%」가 켜져 있으면
         그 값에 ×1.3 (0강 0.195 · 50강 0.26)
       · 6돌파 [돌파 효과] 「자신과 아군이 주는 피해 +20%(10초)」는
         trans6 의 k:'aura' 옵션이라 같은 10초 구간에 ×1.20 으로 따로 곱합니다
       두 배수는 곱이라 6돌파 + 하트면 0강 ×1.195 × 1.20 = ×1.434 입니다.
       버프가 켜진 동안 시전한 **다른 모든 도술(궁극기 포함)과 평타**에 붙고,
       10초가 지나면 빠졌다가 다음 시전에 다시 켜집니다.
       --------------------------------------------------------- */
    var VALOUR = DATA.valour || { id: 1120060, sec: 10, atk: 0.15 };
    var valour = null;
    var hasValour = false;
    for (i = 0; i < entries.length; i++) {
      if (entries[i].id === VALOUR.id) { hasValour = true; break; }
    }
    if (!hasValour && ultEntry && ultEntry.id === VALOUR.id) { hasValour = true; }
    if (hasValour) {
      var vMaxLv = enhanceMax();
      var vLv = clamp(Math.round(Number(enh['sacrifice']) || 0), 0, vMaxLv);
      var vAtkBase = (VALOUR.atk != null ? VALOUR.atk : 0.15);
      var vAtkTop = (VALOUR.atk50 != null ? VALOUR.atk50 : 0.20);
      /* 공격력 버프는 헌신 강화 레벨에 따라 0강 +15% → 50강 +20% (직선 보간) */
      var vAtkRaw = vAtkBase + (vAtkTop - vAtkBase) * (vMaxLv > 0 ? vLv / vMaxLv : 0);
      var vHeart = (fx.heartBuff || 0) > 0;
      var vAtk = vAtkRaw * (1 + (fx.heartBuff || 0));
      var vInfo = transInfo(VALOUR.id, transCfg[VALOUR.id], tr6Cfg);
      var vAura = (vInfo.aura || 0) / 100;
      valour = {
        id: VALOUR.id,
        sec: VALOUR.sec > 0 ? VALOUR.sec : 10,
        atk: vAtk, atkRaw: vAtkRaw, lv: vLv, lvMax: vMaxLv, heart: vHeart,
        aura: vAura,
        step: vInfo.step, on6: vInfo.t6on,
        mul: (1 + vAtk) * (1 + vAura)
      };
    }

    /* ---------------------------------------------------------
       신식 게이지 — 2026-11-24 확인값
       · 계열마다 영력·중첩을 쌓아 두고, 켜 둔 토글에 따라
         이번 시전의 피해 배수 / 남은 쿨 감소 / 궁극기 강화가 붙습니다.
       · 정의는 dosul-data.js 의 styles[].gauge (max · perCast · perHit · perKill ·
         decayPerSec · tiers · stacks · ultReset · ultCdCut · ultBuff)
       · 저격(snipe)은 **시간에 따라 저절로 차는** 게이지라(perSec) 아래 simulator가
         전투 시간을 따라가며 따로 계산합니다 — 여기서는 설정만 모아 둡니다.
       --------------------------------------------------------- */
    var gauges = [];
    var snipe = null;
    var DB = DATA.debuffs || {};
    var dbOnCfg = (config.debuffOn && typeof config.debuffOn === 'object') ? config.debuffOn : {};
    var debuffs = [];
    var dk;
    for (dk in DB) {
      if (!Object.prototype.hasOwnProperty.call(DB, dk)) { continue; }
      debuffs.push({
        k: dk, name: DB[dk].name || dk, sec: DB[dk].sec || 0,
        color: DB[dk].color || '#8b9aa5', on: !!dbOnCfg[dk]
      });
    }
    DATA.styles.forEach(function (st) {
      if (!sinKeys[st.key] || !st.gauge) { return; }
      var on = config.toggles && config.toggles[st.key] ? config.toggles[st.key] : [];
      if (st.key === 'snipe') {
        snipe = {
          style: st.key, name: st.name, def: st.gauge, on: on.slice(),
          quiver: on.indexOf(st.gauge.castGate || 'quiver') >= 0,
          aim: on.indexOf(st.gauge.aimGate || 'aim') >= 0,
          ultdmg: on.indexOf(st.gauge.ultGate || 'ultdmg') >= 0
        };
        return;
      }
      gauges.push({ style: st.key, name: st.name, def: st.gauge, on: on.slice() });
    });

    return {
      entries: entries, ult: ultEntry, fx: fx, toggles: activeToggles, sin: sin, gauges: gauges,
      snipe: snipe, debuffs: debuffs,
      dmgMul: dmgMul, ultDmgMul: ultDmgMul, snipeDmgMul: snipeDmgMul, order: orderIds,
      valour: valour
    };
  }

  /* ---------------------------------------------------------
     시뮬레이션
     --------------------------------------------------------- */
  function simulate(config) {
    var cfg = {
      slots: config.slots || [],
      duration: config.duration || 60,
      cdReducePct: config.cdReducePct || 0,
      castMode: config.castMode || 'delay',
      castScale: config.castScale || 1,
      chargeFull: config.chargeFull !== false,
      autoInterval: config.autoInterval > 0 ? config.autoInterval : 1,
      gap: config.gap > 0 ? config.gap : 0,
      autoCoeff: config.autoCoeff >= 0 ? config.autoCoeff : 100,
      ultFirst: config.ultFirst !== false,
      useUlt: config.useUlt !== false,
      castOrder: Array.isArray(config.castOrder) ? config.castOrder : null,
      toggles: config.toggles || {},
      override: config.override || {},
      enhance: config.enhance || {},
      trans: config.trans || {},
      tr6: config.tr6 || {},
      chain: config.chain || {},
      debuffOn: (config.debuffOn && typeof config.debuffOn === 'object') ? config.debuffOn : {},
      allDosulDmgPct: config.allDosulDmgPct || 0,
      styleDmgPct: (config.styleDmgPct && typeof config.styleDmgPct === 'object') ? config.styleDmgPct : {}
    };
    var built = buildEntries(cfg);
    var gap = cfg.gap || 0;
    var list = built.entries.slice();
    if (built.ult) { list.push(built.ult); }
    var duration = cfg.duration;

    if (!list.length) {
      return {
        ok: false, reason: 'empty',
        message: '도술을 1개 이상 넣어 주세요.'
      };
    }

    var n = list.length;
    var i;
    var j;
    for (i = 0; i < n; i++) {
      /* order = 사용 순서 설정(castOrder)에서의 자리. 궁극기도 같은 목록을 따릅니다 */
      list[i].order = (list[i].ord != null ? list[i].ord : i);
      list[i].readyAt = 0;
      list[i].casts = 0;
      list[i].done = 0;
      list[i].occupied = 0;
      list[i].damage = 0;
      list[i].chainUses = 0;
      list[i].chainOcc = 0;
      list[i].chainDamage = 0;
      /* 저격 신식 — 이 도술이 화살촉을 쓴 횟수 / 연속 조준 중첩이 붙은 회차 합 */
      list[i].snipeShots = 0;
      list[i].aimStacks = 0;
    }
    var ult = built.ult;

    /* ---------------------------------------------------------
       저격 신식 — 시간 기반 화살촉 게이지 (2026-11-27)
       · 전투 시작 0에서 **1초마다 영력 +25** (4초에 화살촉 1개) · 최대 300 = 화살촉 3개
       · 궁극기 외 저격 도술 : 화살촉 1개(영력 100)를 소모 → 그 시전 피해 +45%
       · 궁극기(정조준)      : 모은 화살촉을 **모두** 소모 → 1개당 +25% (1·2·3개 → +25/50/75%)
       · 연속 조준 : 화살촉을 쓸 때마다 1중첩(최대 5 · 10초 · 새로 쓰면 갱신)
                    → 중첩당 모든 PvE 피해(도술 + 평타) +5%
       · 귀보·적 처치 영력(+100)은 단일 보스 기준이라 계산에 넣지 않습니다.
       --------------------------------------------------------- */
    var snipe = built.snipe || null;
    var sDef = snipe ? snipe.def : null;
    var sp = null;
    if (snipe) {
      sp = {
        energy: 0, energyT: 0, maxEnergy: 0,
        shots: 0, shotCasts: 0, noArrowCasts: 0,
        ultCasts: 0, ultArrows: 0,
        aim: 0, aimUntil: -Infinity, markT: 0,
        aimTime: 0, stackSec: 0, maxStack: 0, expiries: 0, buffCasts: 0,
        autoAimSec: 0, log: []
      };
    }

    /* ---------------------------------------------------------
       디버프(상태 이상) — 지금 덱이 거는 것(자동) + 파티가 걸어 주는 것(토글)
       · 자동 : skills[].dbI 가 있는 도술이 적중하면 그 디버프가 지속시간 동안 살아 있습니다
       · 수동 : config.debuffOn[k] 를 켜면 전투 내내 걸려 있는 것으로 봅니다(레이드 파티원 등)
       · 조건부 피해 : skills[].db(k·pct) 와 6돌파 옵션의 when 이 그 디버프에 해당될 때만 붙습니다
       --------------------------------------------------------- */
    var dbDefs = built.debuffs || [];
    var dbInfo = {};
    var statusStat = { casts: 0, types: 0, maxTypes: 0, extra: 0 };
    var hasStatusCond = false;
    for (i = 0; i < n; i++) { if (list[i].dbKey === 'status') { hasStatusCond = true; break; } }
    dbDefs.forEach(function (d) {
      dbInfo[d.k] = d;
      d.until = -Infinity;
      d.windows = [];
      d.casts = 0;
      d.extra = 0;
    });
    function dbActive(key, now) {
      if (!key) { return false; }
      var d = dbInfo[key];
      if (!d) { return false; }
      return d.on || now < d.until - EPS;
    }
    function dbUptime(d) {
      if (d.on) { return duration; }
      if (!d.windows.length) { return 0; }
      var ws = d.windows.slice().sort(function (a, b) { return a[0] - b[0]; });
      var total = 0, cs = ws[0][0], ce = ws[0][1];
      for (var wi = 1; wi < ws.length; wi++) {
        if (ws[wi][0] <= ce + EPS) { ce = Math.max(ce, ws[wi][1]); }
        else { total += ce - cs; cs = ws[wi][0]; ce = ws[wi][1]; }
      }
      var tail = Math.max(0, Math.min(duration, ce) - Math.max(0, cs));
      return Math.min(duration, total + tail);
    }
    /* 6돌파 옵션의 when — 요기범람 구간 또는 그 디버프가 살아 있는 시전 */
    function condOn(when, now) {
      if (!when) { return false; }
      if (when === 'overflow') { return now < buffUntil - EPS; }
      return dbActive(when, now);
    }
    /* 시전이 끝난 순간 그 디버프를 겁니다(적중 시점) */
    function dbInflictAfterCast(cur, castEnd) {
      if (!cur.dbInflict || !dbInfo[cur.dbInflict]) { return; }
      var d = dbInfo[cur.dbInflict];
      var sec = cur.dbInflictSec || d.sec || 0;
      if (sec <= 0) { return; }
      var end = castEnd + sec;
      if (end > d.until) { d.until = end; }
      d.windows.push([castEnd, end]);
    }

    var fx = built.fx;
    var castsSinceReset = 0;
    var castsSinceUltReset = 0;
    var castSeq = 0;
    /* 기만 신식 — 궁극기를 제외한 시전 횟수로 눈물(최대 2개)을 세고,
       3회째(= 눈물 2개를 모은 다음 시전)마다 쿨 중인 도술 1개의 남은 쿨을 50% 줄입니다 */
    var nonUltSeq = 0;
    var halfTrig = 0, halfHit = 0, halfCoolSum = 0;
    /* 파멸 요기범람 — 14회마다 켜지는 30초 피해 +20% 버프 구간 */
    var buffUntil = -Infinity;
    var castsSinceBuff = 0;
    var buffTrig = 0;
    var buffHitCasts = 0;
    var buffTime = 0;
    var buffFrom = -Infinity;
    /* 용맹의 기운 — 시전이 끝난 순간부터 10초 버프 구간
       (버프 동안 시전한 다른 도술·평타에 valour.mul 이 곱해집니다) */
    var valour = built.valour || null;
    var vUntil = -Infinity;
    var vFrom = -Infinity;
    var vTrig = 0;
    var vTime = 0;
    var vCasts = 0;
    var vIdle = 0;
    var t = 0;
    var idle = 0;
    var segments = [];
    var guard = 0;
    var EPS = 1e-7;
    var cdReducePerCast = fx.cd || 0;

    function applyFlatCd(now, exceptIdx, sec) {
      var amt = sec || cdReducePerCast;
      if (!amt) { return; }
      for (var j = 0; j < n; j++) {
        if (j === exceptIdx) { continue; }
        var e = list[j];
        if (e.readyAt > now) {
          e.readyAt = Math.max(now, e.readyAt - amt);
        }
      }
    }

    /* ---------------------------------------------------------
       신식 게이지 상태 — 계열별 영력·중첩
       --------------------------------------------------------- */
    var gauges = (built.gauges || []).map(function (g) {
      return {
        style: g.style, name: g.name, def: g.def, on: g.on || [],
        v: 0, lastT: 0, stacks: [], until: -Infinity,
        triggers: 0, cuts: 0, buffCasts: 0, ultBuffed: 0,
        maxStacks: 0, tierCasts: [0, 0, 0, 0, 0], windowSec: 0
      };
    });

    function gOn(g, id) { return !!id && g.on.indexOf(id) >= 0; }

    /* ---------------------------------------------------------
       저격 신식 — 화살촉 게이지 (시간 누적 · 소모 · 연속 조준 만료)
       --------------------------------------------------------- */
    /* 지금 시각의 저격 영력 — 1초에 25씩 차고 최대 300에서 멈춥니다 */
    function spEnergyAt(now) {
      var e = sp.energy + (sDef.perSec || 0) * (now - sp.energyT);
      return Math.max(0, Math.min(sDef.max, e));
    }
    /* 연속 조준 — 중첩이 바뀌기 전 시점까지 가동 시간·중첩×시간을 쌓고,
       10초가 지나면 0중첩으로 돌립니다(마지막 화살촉 소모로부터 10초) */
    function spAimAdvance(now) {
      if (!sp || now <= sp.markT) { return; }
      if (sp.aim > 0) {
        var end = Math.min(now, sp.aimUntil);
        if (end > sp.markT) {
          sp.aimTime += end - sp.markT;
          sp.stackSec += sp.aim * (end - sp.markT);
        }
      }
      if (now >= sp.aimUntil) {
        if (sp.aim > 0) { sp.expiries += 1; }
        sp.aim = 0;
      }
      sp.markT = now;
    }
    function spAimMul() {
      return (sp && sp.aim > 0 && snipe.aim) ? 1 + (sDef.aimPerStack || 0) * sp.aim : 1;
    }
    /* 화살촉을 쓴 만큼 연속 조준을 쌓고 10초 타이머를 갱신합니다 */
    function spGainAim(now, stacks) {
      if (!sp || !snipe.aim || stacks <= 0) { return; }
      sp.aim = Math.min(sDef.aimMax || 5, sp.aim + stacks);
      sp.aimUntil = now + (sDef.aimSec || 10);
      if (sp.aim > sp.maxStack) { sp.maxStack = sp.aim; }
    }

    function gDecay(g, now) {
      var d = g.def.decayPerSec;
      if (!d) { return; }
      var dt = now - g.lastT;
      if (dt > 0) { g.v = Math.max(0, g.v - d * dt); }
    }

    /* 살아 있는 척결 중첩 수 (30초 지속) */
    function liveStacks(g, now) {
      if (!g.stacks) { return 0; }
      var keep = [];
      for (var k = 0; k < g.stacks.length; k++) {
        if (now - g.stacks[k] <= g.def.stacks.sec + EPS) { keep.push(g.stacks[k]); }
      }
      g.stacks = keep;
      return keep.length;
    }

    /* 지금 영력이 도달한 단계 (0 = 아직 1단계 전) */
    function tierIdx(g, now) {
      var tiers = g.def.tiers;
      if (!tiers) { return 0; }
      var v = g.v;
      if (g.def.decayPerSec) { v = Math.max(0, v - (g.def.decayPerSec * Math.max(0, now - g.lastT))); }
      var idx = 0;
      for (var k = 0; k < tiers.length; k++) {
        if (v >= tiers[k].at - EPS) { idx = k + 1; }
      }
      return idx;
    }

    /* 이번 시전의 피해 배수 — 영력 단계 · 격노/척결 중첩 · 궁극기 형상·구슬·연쇄 */
    function gaugeMul(now, cur) {
      var mul = 1;
      var k, g, d, ti, td, live;
      for (k = 0; k < gauges.length; k++) {
        g = gauges[k]; d = g.def;
        if (d.stack && gOn(g, d.stack.gate)) {
          /* 연타 — 영력 1당 중첩 1 (적중마다) */
          live = Math.max(0, Math.floor(g.v + EPS));
          if (live > 0) {
            mul *= 1 + Math.min(d.stack.max, d.stack.per * live);
            if (live > g.maxStacks) { g.maxStacks = live; }
            g.buffCasts += 1;
          }
        }
        if (d.stacks && gOn(g, d.stacks.gate)) {
          /* 척살 — 척결 중첩(30초 지속) 1개당 피해 +2% (최대 10중첩 +20%) */
          live = liveStacks(g, now);
          if (live > 0) {
            mul *= 1 + Math.min(d.stacks.dmg * d.stacks.max, d.stacks.dmg * live);
            if (live > g.maxStacks) { g.maxStacks = live; }
            g.buffCasts += 1;
          }
        }
        if (d.tiers && gOn(g, d.gate)) {
          ti = tierIdx(g, now);
          if (ti > 0) {
            td = d.tiers[ti - 1];
            if (td.dmg) {
              mul *= 1 + td.dmg;
              if (cur.kind !== 'ult') { g.buffCasts += 1; g.tierCasts[ti - 1] += 1; }
            }
          }
        }
      }
      if (cur && cur.kind === 'ult') {
        for (k = 0; k < gauges.length; k++) {
          g = gauges[k]; d = g.def;
          /* 절명 — 형상 3·4·5개 소모 시 궁극기 피해 +55 / 75 / 125% */
          if (d.ultTiers && gOn(g, d.ultGate)) {
            var have = Math.min(d.max, Math.floor(g.v + EPS));
            var best = 0;
            for (var u = 0; u < d.ultTiers.length; u++) {
              if (have >= d.ultTiers[u].at) { best = Math.max(best, d.ultTiers[u].dmg); }
            }
            if (best) { mul *= 1 + best; g.ultBuffed += 1; }
          }
          /* 주술 — 구슬 단계별 궁극기 피해 +30 / 60 / 90% */
          if (d.tiers && d.tierUltGate && gOn(g, d.tierUltGate)) {
            ti = tierIdx(g, now);
            if (ti > 0 && d.tiers[ti - 1].ultDmg) {
              mul *= 1 + d.tiers[ti - 1].ultDmg;
              g.ultBuffed += 1;
            }
          }
          /* 기동 — 연쇄 10초 동안 궁극기 피해 +50% */
          if (d.ultBuff && gOn(g, d.ultBuff.gate) && now < g.until - EPS) {
            mul *= 1 + d.ultBuff.pct;
            g.ultBuffed += 1;
          }
        }
      }
      return mul;
    }

    /* 시전이 끝난 뒤 게이지가 차고, 최대치 효과가 터집니다 */
    function gaugeAfterCast(cur, now, castLen, pickIdx) {
      var tEnd = now + castLen;
      for (var k = 0; k < gauges.length; k++) {
        var g = gauges[k];
        var d = g.def;
        if (cur.kind === 'ult') {
          /* 강타 — 영력 100에서 천벌을 쓰면 [강압] */
          if (d.ultReset && d.ultReset.on === 'ult' && gOn(g, d.ultReset.gate) && g.v >= d.max - EPS) {
            for (var a = 0; a < n; a++) {
              if (list[a].kind !== 'ult') { list[a].readyAt = tEnd; }
            }
            g.v = 0; g.triggers += 1;
            segments.push({ t0: tEnd, t1: tEnd, kind: 'mark', name: g.name + ' 강압', style: g.style, color: styleColor(g.style) });
          }
          /* 절명 — 궁극기가 형상을 모두 소모합니다 (3개 미만이면 피해 증가 없음) */
          if (d.ultTiers) { g.v = 0; }
          continue;
        }
        if (d.decayPerSec) { gDecay(g, now); }
        /* 연타 — 3초 동안 적중이 없으면 격노가 전부 사라집니다 */
        if (d.idleResetSec && now - g.lastT > d.idleResetSec + EPS) { g.v = 0; }
        var hits = (cur.hits || 0) + (cur.chain ? cur.chain.hits * cur.chain.uses : 0);
        var gain = (d.perCast || 0) + (d.perHit || 0) * hits + (d.perKill || 0) * 1;
        if (gain) { g.v = Math.min(d.max, g.v + gain); }
        g.lastT = now;

        /* 절명 — 형상이 최대일 때 도술마다 궁극기 남은 쿨 -6초 */
        if (d.ultCdCut && gOn(g, d.ultCdCut.gate) && ult && g.v >= d.max - EPS) {
          if (ult.readyAt > tEnd + EPS) {
            ult.readyAt = Math.max(tEnd, ult.readyAt - d.ultCdCut.sec);
            g.cuts += 1; g.triggers += 1;
          }
        }

        /* 척살 — 척결 중첩: 피해 +2%씩(최대 20%) · 중첩을 얻을 때마다 남은 쿨 -20%(궁극기 -10%) */
        if (d.stacks && gOn(g, d.stacks.gate) && g.v >= d.max - EPS) {
          g.v = 0;
          g.stacks.push(tEnd);
          g.triggers += 1;
          var live = liveStacks(g, tEnd);
          if (live > g.maxStacks) { g.maxStacks = live; }
          for (var b = 0; b < n; b++) {
            if (b === pickIdx) { continue; }
            var e2 = list[b];
            if (e2.readyAt > tEnd + EPS) {
              var cutPct = (e2.kind === 'ult') ? d.stacks.ultCdCut : d.stacks.cdCut;
              e2.readyAt = tEnd + (e2.readyAt - tEnd) * (1 - cutPct);
            }
          }
          g.cuts += 1;
          segments.push({ t0: tEnd, t1: tEnd, kind: 'mark', name: g.name + ' 척결', style: g.style, color: styleColor(g.style) });
        }

        /* 주술 — 구슬 단계별로 다른 도술의 남은 쿨 -0.1/-0.2/-0.3초 */
        if (d.tiers && gOn(g, d.gate)) {
          var ti = tierIdx(g, tEnd);
          if (ti > 0 && d.tiers[ti - 1].flatCd) {
            applyFlatCd(tEnd, pickIdx, d.tiers[ti - 1].flatCd);
            g.cuts += 1;
            g.tierCasts[ti - 1] += 1;
          }
        }

        /* 기동 — 영력 200에서 궁극기 쿨 초기화 + [연쇄] 10초 */
        if (d.ultReset && d.ultReset.on === 'max' && gOn(g, d.ultReset.gate) && ult && g.v >= d.max - EPS) {
          ult.readyAt = tEnd;
          g.v = 0; g.triggers += 1;
          if (d.ultBuff) {
            g.until = tEnd + d.ultBuff.sec;
            g.windowSec += Math.max(0, Math.min(d.ultBuff.sec, duration - tEnd));
          }
          segments.push({ t0: tEnd, t1: tEnd, kind: 'mark', name: g.name + ' 연쇄', style: g.style, color: styleColor(g.style) });
        }
        if (g.v > g.maxStacks && !d.stacks) { g.maxStacks = g.v; }
      }
    }

    while (t < duration - EPS && guard++ < 20000) {
      /* 쓸 수 있는 도술 고르기 — 슬롯 순서(우선순위)대로 */
      var pick = -1;
      var pickOrder = Infinity;
      var nextReady = Infinity;
      for (i = 0; i < n; i++) {
        var e = list[i];
        if (e.readyAt <= t + EPS) {
          if (e.order < pickOrder) { pickOrder = e.order; pick = i; }
        } else if (e.readyAt < nextReady) {
          nextReady = e.readyAt;
        }
      }

      if (pick < 0) {
        /* 쿨이 모두 비었다 → 평타 구간 */
        var end = Math.min(duration, nextReady === Infinity ? duration : nextReady);
        if (end > t + EPS) {
          idle += end - t;
          /* 용맹의 기운 버프가 걸린 시간만 따로 세어 평타에도 배수를 붙입니다 */
          if (valour) {
            var vOv = Math.min(end, vUntil) - Math.max(t, vFrom);
            if (vOv > 0) { vIdle += vOv; }
          }
          /* 저격 — 평타 구간에도 연속 조준 중첩만큼 피해가 붙습니다(10초 안에서만) */
          if (sp && snipe.aim && sp.aim > 0) {
            var aimEnd = Math.min(end, sp.aimUntil);
            if (aimEnd > t) { sp.autoAimSec += sp.aim * (sDef.aimPerStack || 0) * (aimEnd - t); }
          }
          if (sp) { spAimAdvance(end); }
          segments.push({ t0: t, t1: end, kind: 'auto', name: '평타' });
        }
        t = end;
        continue;
      }

      var cur = list[pick];
      /* 연계기가 켜져 있으면 1단계 + 연계 시전 시간을 한 번에 점유합니다 */
      var castLen = cur.cast + (cur.chain ? cur.chainCast : 0) + gap;
      if (t + castLen > duration) { castLen = duration - t; }
      if (castLen <= EPS) { break; }

      cur.casts += 1;
      cur.occupied += castLen;
      /* ---------------------------------------------------------
         저격 신식 — 시전 시작 순간의 영력으로 화살촉을 소모합니다.
         · 궁극기 외 저격 도술 : 영력 100(화살촉 1개)이 있으면 소모 → 그 시전 피해 +45%
           (화살촉이 없으면 그냥 시전 — 피해 증가 없음)
         · 궁극기(정조준) : 모은 화살촉을 모두 소모 → 1개당 +25%
         · 소모한 화살촉 1개마다 연속 조준 1중첩 (그 시전부터 붙습니다)
         --------------------------------------------------------- */
      var snipeMul = 1;
      if (sp) {
        spAimAdvance(t);
        var eNow = spEnergyAt(t);
        sp.energy = eNow;
        sp.energyT = t;
        if (eNow > sp.maxEnergy) { sp.maxEnergy = eNow; }
        var arrows = Math.min(sDef.arrowMax || 3, Math.floor(eNow / (sDef.arrowPer || 100) + EPS));
        if (cur.kind === 'ult') {
          sp.ultCasts += 1;
          if (arrows > 0) {
            sp.energy = Math.max(0, sp.energy - arrows * (sDef.arrowPer || 100));
            sp.ultArrows += arrows;
            if (snipe.ultdmg) { snipeMul = 1 + (sDef.ultPerArrow || 0) * arrows; }
            spGainAim(t, arrows);
          }
          sp.log.push({ t: round(t, 2), kind: 'ult', arrows: arrows, mul: round(snipeMul, 3) });
        } else if (cur.style === 'snipe') {
          if (eNow >= (sDef.arrowPer || 100) - EPS) {
            sp.energy = Math.max(0, sp.energy - (sDef.arrowPer || 100));
            sp.shots += 1;
            sp.shotCasts += 1;
            cur.snipeShots += 1;
            if (snipe.quiver) { snipeMul = 1 + (sDef.castDmg || 0); }
            spGainAim(t, 1);
            sp.log.push({ t: round(t, 2), kind: 'shot', arrows: 1, mul: round(snipeMul, 3) });
          } else {
            sp.noArrowCasts += 1;
          }
        }
      }
      /* 연속 조준 — 화살촉을 쓴 그 시전부터 중첩만큼 피해가 붙습니다(도술·평타 공통) */
      var aimMul = spAimMul();
      if (sp && aimMul > 1) { sp.buffCasts += 1; cur.aimStacks += sp.aim; }
      /* 버프형 피해 증가(파멸 요기범람) — 버프가 살아 있는 시점의 시전에만 붙습니다 */
      var buffMul = (fx.dmgBuff && t < buffUntil - EPS) ? (1 + fx.dmgBuff) : 1;
      if (buffMul !== 1) { buffHitCasts += 1; }
      /* 신식 게이지 배수(영력 단계 · 격노/척결 중첩 · 궁극기 형상·구슬·연쇄)와
         조건부 6돌파 옵션(하늘의 심판 「요기범람일 때 +50%」) */
      /* 6돌파 조건 옵션(요기범람 +50% · 속박 +20%)과 디버프 조건부 피해 */
      var gMul = gaugeMul(t, cur);
      var condMul = 1;
      for (var ci = 0; ci < (cur.conds || []).length; ci++) {
        if (condOn(cur.conds[ci].when, t)) { condMul *= 1 + cur.conds[ci].d / 100; }
      }
      var dbMul = 1;
      var dbCount = 0;
      if (cur.dbKey === 'status' && cur.dbTypes && cur.dbTypes.length) {
        /* 정조준 — 걸려 있는 출혈·화상·감전·약화 1종류당 +15% (최대 4종 +60%) */
        for (var di = 0; di < cur.dbTypes.length; di++) {
          if (dbActive(cur.dbTypes[di], t)) { dbCount += 1; }
        }
        if (dbCount > 0) {
          dbMul = 1 + (cur.dbPct / 100) * dbCount;
          statusStat.casts += 1;
          statusStat.types += dbCount;
          if (dbCount > statusStat.maxTypes) { statusStat.maxTypes = dbCount; }
        }
      } else if (cur.dbKey && dbActive(cur.dbKey, t) && cur.dbPct > 0) {
        dbMul = 1 + cur.dbPct / 100;
        dbInfo[cur.dbKey].casts += 1;
      }
      /* 용맹의 기운 — 버프가 켜져 있는 동안의 시전에만 곱합니다(시작 시점 기준) */
      var vMul = 1;
      if (valour && t >= vFrom - EPS && t < vUntil - EPS) {
        vMul = valour.mul;
        vCasts += 1;
      }
      var castMul = buffMul * gMul * condMul * vMul * snipeMul * aimMul;
      if (dbMul > 1) {
        var dbExtra = (cur.coeff + (cur.chain ? cur.chain.coeff : 0)) * castMul * (dbMul - 1);
        if (cur.dbKey === 'status') { statusStat.extra += dbExtra; }
        else { dbInfo[cur.dbKey].extra += dbExtra; }
      }
      castMul *= dbMul;
      cur.damage += cur.coeff * castMul;
      if (cur.chain) {
        cur.damage += cur.chain.coeff * castMul;
        cur.chainUses += cur.chain.uses;
        cur.chainDamage += cur.chain.coeff * castMul;
      }
      castSeq += 1;

      var mainLen = Math.min(cur.cast, castLen);
      var slotName = cur.id === (ult ? ult.id : -1) ? 'R' : (cur.slot + 1);
      segments.push({
        t0: t, t1: t + mainLen, kind: 'cast', name: cur.name, id: cur.id,
        style: cur.style, color: styleColor(cur.style),
        isUlt: cur.kind === 'ult', slot: slotName
      });
      if (cur.chain && castLen - mainLen > EPS) {
        var chLen = castLen - mainLen;
        cur.chainOcc += chLen;
        segments.push({
          t0: t + mainLen, t1: t + mainLen + chLen, kind: 'cast', chain: true,
          name: cur.name + ' · ' + cur.chain.name, id: cur.id,
          style: cur.style, color: styleColor(cur.style),
          isUlt: cur.kind === 'ult', slot: slotName
        });
      }

      /* 쿨타임은 「시전을 시작한 순간」부터 흐릅니다.
         연계를 써도 쿨타임은 1단계 기준 그대로입니다(쿨감·돌파 반영).
         1단계를 써야 2단계가 나가는 구조라 2단계 쿨(5~6초)은
         다음 발동의 대기시간이 아닙니다 — 은신 25초 · 묵직한 주먹 9초 ·
         쌍검 가르기 10초 · 월식 12초를 그대로 기다립니다. */
      var cd = cur.cd;

      /* 파멸 신식(요기범람) — 궁극기를 제외한 도술을 쓸 때마다 영력 15.
         14회(= 영력 200)가 된 순간에 요기범람이 켜져 30초 동안 피해 +20%가 붙습니다.
         (14회 쿨 초기화 토글과 별개로, 피해 +20% 토글만 켜도 14회마다 발동합니다.
          영력은 그 도술을 쓴 뒤에 차므로, 14회째 도술이 끝난 시점부터 30초를 세고
          그 도술 자체에는 +20%가 붙지 않습니다.) */
      if (cur.kind !== 'ult' && fx.dmgBuffEvery > 0) {
        castsSinceBuff += 1;
        if (castsSinceBuff >= fx.dmgBuffEvery) {
          castsSinceBuff = 0;
          buffTrig += 1;
          var buffStart = Math.min(duration, t + castLen);
          if (buffUntil > buffStart + EPS) {
            /* 아직 버프가 남아 있으면 끝만 30초 더 */
          } else {
            if (buffFrom > -Infinity) {
              buffTime += Math.max(0, Math.min(duration, buffUntil) - buffFrom);
            }
            buffFrom = buffStart;
          }
          buffUntil = buffStart + (fx.dmgBuffSec > 0 ? fx.dmgBuffSec : 30);
        }
      }

      /* 용맹의 기운 — 이 시전이 **끝나는 순간**부터 10초 버프가 켜집니다.
         · 시전한 그 도술에는 붙지 않고, 그 뒤에 쓰는 도술·평타에 붙습니다
         · 10초가 지나면 자동으로 빠지고, 다음 시전에 다시 켜집니다
         · 버프 중에 다시 발동하면 끝나는 시각만 10초 더 밀립니다 */
      if (valour && cur.id === valour.id) {
        var vStart = Math.min(duration, t + castLen);
        if (vUntil > vStart + EPS) {
          /* 아직 버프가 남아 있으면 끝만 10초 더 */
        } else {
          if (vFrom > -Infinity) {
            vTime += Math.max(0, Math.min(duration, vUntil) - vFrom);
          }
          vFrom = vStart;
        }
        vUntil = vStart + valour.sec;
        vTrig += 1;
      }

      /* 기만 신식(눈물 2개 소모) — 「쿨타임이 돌고 있는 도술 1개」의 남은 쿨을 50% 줄입니다.
         · 눈물은 궁극기를 제외한 도술을 쓸 때마다 1개(최대 2개) 쌓이고,
           눈물 2개일 때 궁극기를 제외한 도술을 쓰면 2개를 소모합니다 → 3회마다 발동
         · 대상은 그 순간 쿨이 돌고 있는 도술 중 무작위 1개입니다(궁극기·방금 쓴 도술 제외).
           어느 도술이 걸리느냐에 따라 DPS가 달라지므로, 쿨 중인 도술 k개의 남은 시간을
           (1 - 0.5 / k)배로 **함께** 줄여 무작위 1개의 평균 기댓값으로 계산합니다.
           (k=1 → 남은 쿨 절반, k=2 → 각 25% 감소 = 하나가 걸릴 때의 기댓값)
         · 쿨 중인 도술이 하나도 없으면 눈물만 낭비됩니다(감소 없음). */
      if (fx.halfCdEvery > 0 && cur.kind !== 'ult') {
        nonUltSeq += 1;
        if (nonUltSeq % fx.halfCdEvery === 0) {
          halfTrig += 1;
          var coolCount = 0;
          for (j = 0; j < n; j++) {
            if (j === pick || list[j].kind === 'ult') { continue; }
            if (list[j].readyAt > t + EPS) { coolCount += 1; }
          }
          if (coolCount > 0) {
            var keepRatio = 1 - 0.5 / coolCount;
            for (j = 0; j < n; j++) {
              if (j === pick || list[j].kind === 'ult') { continue; }
              if (list[j].readyAt > t + EPS) {
                list[j].readyAt = t + (list[j].readyAt - t) * keepRatio;
              }
            }
            halfHit += 1;
            halfCoolSum += coolCount;
          }
        }
      }

      cur.readyAt = t + Math.max(0.1, cd);

      applyFlatCd(t, pick);

      /* 신식 게이지 — 이 시전으로 영력/중첩이 차고, 최대치 효과가 터집니다
         (시전이 끝난 시점 기준 · 방금 쓴 도술은 남은 쿨 감소에서 제외) */
      gaugeAfterCast(cur, t, castLen, pick);
      /* 디버프 — 이 도술이 거는 디버프는 시전이 끝난 순간(적중)부터 지속시간만큼 삽니다 */
      dbInflictAfterCast(cur, t + castLen);

      t = t + castLen;

      /* 신식 게이지 — 일정 횟수마다 쿨 초기화 */
      if (cur.kind !== 'ult') {
        castsSinceReset += 1;
        castsSinceUltReset += 1;
        if (fx.resetEvery && castsSinceReset >= fx.resetEvery) {
          castsSinceReset = 0;
          for (i = 0; i < n; i++) {
            if (list[i].kind !== 'ult') { list[i].readyAt = t; }
          }
          segments.push({ t0: t, t1: t, kind: 'mark', name: '요기/강압', style: cur.style, color: styleColor(cur.style) });
        }
        if (fx.ultResetEvery && ult && castsSinceUltReset >= fx.ultResetEvery) {
          castsSinceUltReset = 0;
          ult.readyAt = t;
        }
      }
    }

    /* 결과 정리 */
    if (buffFrom > -Infinity) {
      buffTime += Math.max(0, Math.min(duration, buffUntil) - buffFrom);
    }
    if (vFrom > -Infinity) {
      vTime += Math.max(0, Math.min(duration, vUntil) - vFrom);
    }
    /* 저격 — 전투가 끝날 때까지의 연속 조준 시간·영력을 마저 셉니다 */
    if (sp) {
      spAimAdvance(duration);
      var spEnd = spEnergyAt(duration);
      sp.energy = spEnd;
      sp.energyT = duration;
      if (spEnd > sp.maxEnergy) { sp.maxEnergy = spEnd; }
    }
    var castTotal = 0;
    var skillDamage = 0;
    var rows = [];
    for (i = 0; i < n; i++) {
      var en = list[i];
      castTotal += en.occupied;
      skillDamage += en.damage;
      if (en.casts > 0 || en.kind === 'ult') {
        rows.push({
          id: en.id, name: en.name, style: en.style, styleName: styleName(en.style),
          color: styleColor(en.style), kind: en.kind,
          slot: en.kind === 'ult' ? 'R' : (en.slot + 1),
          casts: en.casts, cdBase: round(en.cdBase, 2), cd: round(en.cd, 2),
          cast: round(en.cast, 2), est: en.est,
          coeff: round(en.coeff, 1), damage: round(en.damage, 1),
          occupied: round(en.occupied, 2), hits: en.hits,
          enh: en.enh, enhPct: round(en.enhPct, 1),
          gearPct: round(en.gearPct || 0, 1), gearAllPct: round(en.gearAllPct || 0, 1),
          gearStylePct: round(en.gearStylePct || 0, 1),
          trans: en.trans, transDmgPct: round(en.transDmgPct, 1), transCd: round(en.transCd, 2),
          tr6: en.tr6, tr6Pct: en.tr6Pct, tr6Text: en.tr6Text, hasTrans: en.hasTrans,
          tr6Extra: round(en.tr6Extra || 0, 1), tr6ExtraCond: round(en.tr6ExtraCond || 0, 1),
          tr6Opts: en.tr6Opts, sp: en.sp, grade: en.grade,
          chain: en.chain ? {
            name: en.chain.name, uses: en.chain.uses, window: en.chain.window, cool: en.chain.cool,
            per: en.chain.per.map(function (v) { return round(v, 1); }),
            coeff: round(en.chain.coeff, 1), hits: en.chain.hits,
            castPer: round(en.chain.castPer, 2), castLen: round(en.chain.castLen, 2),
            est: en.chain.est
          } : null,
          sinOn: !!en.sinOn, sinCoeff: round(en.sinCoeff || 0, 1),
          sinLabel: en.sinLabel || '', sinNote: en.sinNote || '',
          chainUses: en.chainUses, chainOcc: round(en.chainOcc, 2),
          chainDamage: round(en.chainDamage, 1),
          castAll: round(en.cast + (en.chain ? en.chain.castLen : 0), 2),
          hitsAll: en.chain ? (en.hits + en.chain.hits * en.chain.uses) : en.hits,
          snipeShots: en.snipeShots || 0,
          aimStacks: en.aimStacks || 0
        });
      }
    }
    rows.sort(function (a, b) {
      if (a.kind === 'ult' && b.kind !== 'ult') { return -1; }
      if (b.kind === 'ult' && a.kind !== 'ult') { return 1; }
      return String(a.slot).localeCompare(String(b.slot));
    });

    var autoCount = idle / cfg.autoInterval;
    /* 용맹의 기운 버프가 걸린 평타 구간만 배수를 더 받습니다 */
    var autoBuffedCount = valour ? (vIdle / cfg.autoInterval) : 0;
    var autoDamage = autoCount * cfg.autoCoeff +
      autoBuffedCount * cfg.autoCoeff * (valour ? (valour.mul - 1) : 0) +
      (sp ? (sp.autoAimSec / cfg.autoInterval) * cfg.autoCoeff : 0);
    var totalCoeff = skillDamage + autoDamage;
    var idlePct = duration > 0 ? (idle / duration) * 100 : 0;
    var uptime = 100 - idlePct;

    rows.forEach(function (r) {
      r.share = totalCoeff > 0 ? round((r.damage / totalCoeff) * 100, 1) : 0;
      /* 연계가 켜진 도술은 1단계 계수가 0이어도(은신) 연계 피해로 딜을 합니다 */
      r.deals = (r.coeff + (r.chain ? r.chain.coeff : 0)) > 0;
      r.coeffAll = round(r.coeff + (r.chain ? r.chain.coeff : 0), 1);
    });

    /* 신식 게이지 발동 기록 — 계열별 영력·중첩이 어떻게 돌았는지 */
    var gaugeOut = gauges.map(function (g) {
      return {
        style: g.style, name: g.name, max: g.def.max,
        triggers: g.triggers, cuts: g.cuts, buffCasts: g.buffCasts,
        ultBuffed: g.ultBuffed, maxStacks: g.maxStacks,
        tierCasts: g.tierCasts.slice(0, 3), windowSec: round(g.windowSec, 1)
      };
    });
    /* 저격은 시간 기반 게이지라 따로 담습니다 — 화면은 r.snipe 을 읽습니다 */
    if (sp) {
      gaugeOut.push({
        style: 'snipe', name: '저격', max: sDef.max,
        triggers: sp.shotCasts, cuts: 0, buffCasts: sp.buffCasts,
        ultBuffed: sp.ultCasts, maxStacks: sp.maxStack,
        tierCasts: [0, 0, 0], windowSec: round(sp.aimTime, 1)
      });
    }

    /* 디버프 조건부 — 이번 전투에서 어떤 디버프가 얼마나 돌았고, 얼마를 더했는지 */
    var debuffRows = [];
    dbDefs.forEach(function (d) {
      var equipped = false;
      for (var qi = 0; qi < n; qi++) {
        if (list[qi].dbKey === d.k) { equipped = true; break; }
        if ((list[qi].dbTypes || []).indexOf(d.k) >= 0) { equipped = true; break; }
        for (var qj = 0; qj < (list[qi].conds || []).length; qj++) {
          if (list[qi].conds[qj].when === d.k) { equipped = true; break; }
        }
        if (equipped) { break; }
      }
      debuffRows.push({
        k: d.k, name: d.name, sec: d.sec, color: d.color, on: !!d.on,
        uptime: round(dbUptime(d), 1), casts: d.casts, extra: round(d.extra, 1),
        share: totalCoeff > 0 ? round((d.extra / totalCoeff) * 100, 1) : 0,
        used: equipped
      });
    });
    /* 계산에서 빠진 항목 — 지금 덱(활성 신식 · 장착 도술)에 해당하는 것만 */
    var EXCL = DATA.exclusions || {};
    var excluded = [];
    (built.sin || []).forEach(function (s) {
      (EXCL[s.key] || []).forEach(function (txt) { excluded.push({ k: s.key, name: s.style.name, t: txt }); });
    });
    var seenUnk = {};
    for (i = 0; i < n; i++) {
      if (list[i].unk && !seenUnk[list[i].id]) {
        seenUnk[list[i].id] = 1;
        excluded.push({ k: list[i].style, name: styleName(list[i].style), t: list[i].name + ' — ' + list[i].unk });
      }
    }

    return {
      ok: true,
      duration: duration,
      idle: round(idle, 2),
      idlePct: round(idlePct, 1),
      uptime: round(uptime, 1),
      castTotal: round(castTotal, 2),
      autoCount: round(autoCount, 1),
      autoInterval: cfg.autoInterval,
      gap: gap,
      autoCoeffBase: cfg.autoCoeff,
      autoDamage: round(autoDamage, 1),
      skillDamage: round(skillDamage, 1),
      totalCoeff: round(totalCoeff, 1),
      dps: round(duration > 0 ? totalCoeff / duration : 0, 1),
      autoShare: totalCoeff > 0 ? round((autoDamage / totalCoeff) * 100, 1) : 0,
      rows: rows,
      castOrder: built.order.slice(),
      segments: segments,
      sin: built.sin.map(function (s) {
        return { key: s.key, name: s.style.name, count: s.count, color: s.style.color, ult: skillById(s.style.ult) };
      }),
      toggles: built.toggles,
      /* 파멸 요기범람 — 14회마다 30초간 켜진 피해 +20% 버프가 실제로 몇 번·몇 초 돌았는지 */
      dmgBuff: fx.dmgBuff > 0 ? {
        buff: fx.dmgBuff,
        every: fx.dmgBuffEvery,
        sec: fx.dmgBuffSec > 0 ? fx.dmgBuffSec : 30,
        triggers: buffTrig,
        activeSec: round(buffTime, 1),
        buffedCasts: buffHitCasts
      } : null,
      /* 용맹의 기운 — 10초 버프가 이번 전투에서 몇 번 · 몇 초 돌았고,
         그 구간에 시전한 도술이 몇 회인지 */
      valour: valour ? {
        id: valour.id, sec: valour.sec,
        atk: valour.atk, atkRaw: valour.atkRaw, lv: valour.lv, lvMax: valour.lvMax,
        heart: valour.heart, aura: valour.aura, mul: valour.mul,
        step: valour.step, on6: valour.on6,
        triggers: vTrig, activeSec: round(vTime, 1),
        buffedCasts: vCasts, autoSec: round(vIdle, 2)
      } : null,
      /* 기만 신식 발동 기록 — 화면·테스트가 「쿨 중인 도술을 줄였는지」 확인할 수 있게 남깁니다 */
      halfCd: fx.halfCdEvery > 0 ? {
        every: fx.halfCdEvery,
        triggers: halfTrig,
        hits: halfHit,
        wasted: halfTrig - halfHit,
        avgCooling: halfHit ? round(halfCoolSum / halfHit, 2) : 0
      } : null,
      dmgMul: round(built.dmgMul, 3),
      ultDmgMul: round(built.ultDmgMul, 3),
      snipeDmgMul: round(built.snipeDmgMul, 3),
      /* 무기·장비 — 화면·테스트가 어떤 +%가 곱해졌는지 확인할 수 있게 남깁니다 */
      gear: { allPct: round(Math.max(0, Math.min(500, Number(cfg.allDosulDmgPct) || 0)), 1), stylePct: (function () {
        var out = {};
        for (var gk in cfg.styleDmgPct) {
          if (Object.prototype.hasOwnProperty.call(cfg.styleDmgPct, gk)) {
            out[gk] = round(Math.max(0, Math.min(500, Number(cfg.styleDmgPct[gk]) || 0)), 1);
          }
        }
        return out;
      })() },
      /* 신식 게이지 발동 기록 — 계열별 영력·중첩이 어떻게 돌았는지 */
      gauge: gaugeOut,
      /* 저격 신식 — 시간 기반 화살촉 게이지가 이번 전투에서 어떻게 돌았는지 */
      snipe: sp ? {
        max: sDef.max, perSec: sDef.perSec,
        arrowPer: sDef.arrowPer || 100, arrowMax: sDef.arrowMax || 3,
        quiver: !!snipe.quiver, aim: !!snipe.aim, ultdmg: !!snipe.ultdmg,
        energyEnd: round(Math.max(0, Math.min(sDef.max, sp.energy)), 1),
        maxEnergy: round(sp.maxEnergy, 1),
        arrowsGained: Math.round(sp.shots + sp.ultArrows + Math.max(0, sp.energy) / (sDef.arrowPer || 100)),
        shots: sp.shots, shotCasts: sp.shotCasts, noArrowCasts: sp.noArrowCasts,
        ultCasts: sp.ultCasts, ultArrows: sp.ultArrows,
        aimTime: round(sp.aimTime, 1),
        aimAvg: sp.aimTime > 0 ? round(sp.stackSec / sp.aimTime, 1) : 0,
        aimMaxStack: sp.maxStack, aimExpiries: sp.expiries, aimCasts: sp.buffCasts,
        autoAimSec: round(sp.autoAimSec, 2),
        log: sp.log.slice(-60)
      } : null,
      /* 디버프 조건부 발동 — 화면·테스트가 발동 횟수와 기여를 확인합니다 */
      debuffs: debuffRows,
      /* 정조준 — 걸린 상태이상 종류 수만큼 붙는 피해 */
      statusCond: hasStatusCond ? (function () {
        var pct = 0;
        for (var si = 0; si < n; si++) { if (list[si].dbKey === 'status') { pct = list[si].dbPct; break; } }
        return {
          pct: pct, casts: statusStat.casts, maxTypes: statusStat.maxTypes,
          avgTypes: statusStat.casts ? round(statusStat.types / statusStat.casts, 2) : 0,
          extra: round(statusStat.extra, 1),
          share: totalCoeff > 0 ? round((statusStat.extra / totalCoeff) * 100, 1) : 0
        };
      })() : null,
      /* 계산에서 제외된 항목 — 처치·귀보·피격·비공개 수치 */
      excluded: excluded,
      totalCasts: rows.reduce(function (a, r) { return a + r.casts; }, 0)
    };
  }

  /* ---------------------------------------------------------
     순서 추천 — **사용 순서(castOrder)만** 고칩니다
       · 장착 8칸(slots)은 절대 건드리지 않으므로 기본 1~5칸의 신식 조건은 그대로!
       · 두 칸 맞바꾸기 / 한 칸 옮기기를 모두 해 보고
         mode 'idle' : 평타 빈 시간(초)이 가장 적은 순서 (동률이면 DPS 높은 쪽)
         mode 'dps'  : 초당 피해(DPS)가 가장 높은 순서 (동률이면 평타 빈 시간 적은 쪽)
     좋아지지 않을 때까지 여러 바퀴(라운드) 돌립니다. 궁극기(R) 자리까지 같이 찾습니다.
     --------------------------------------------------------- */
  function betterThan(mode, cand, best) {
    if (mode === 'idle') {
      if (cand.idle < best.idle - 0.01) { return true; }
      if (cand.idle > best.idle + 0.01) { return false; }
      return cand.dps > best.dps + 0.05;
    }
    if (cand.dps > best.dps + 0.05) { return true; }
    if (cand.dps < best.dps - 0.05) { return false; }
    return cand.idle < best.idle - 0.01;
  }

  function optimize(config, mode, rounds) {
    mode = mode === 'idle' ? 'idle' : 'dps';
    var base = simulate(config);
    if (!base.ok) { return base; }
    var start = (base.castOrder || []).slice();
    var fixedSlots = (config.slots || []).slice(0, 8);
    if (start.length < 2) {
      return {
        ok: true, mode: mode, before: base, after: base,
        slots: fixedSlots, castOrder: start, changed: false,
        gainDps: 0, gainIdle: 0
      };
    }
    var maxRound = rounds || 4;
    var best = start.slice();
    var bestRes = base;
    var pass;
    for (pass = 0; pass < maxRound; pass++) {
      var improved = false;
      var cand = [];
      var a, b;
      var nOrd = best.length;
      for (a = 0; a < nOrd; a++) {
        for (b = a + 1; b < nOrd; b++) {
          var sw = best.slice();
          var tmp = sw[a]; sw[a] = sw[b]; sw[b] = tmp;
          cand.push(sw);
        }
      }
      for (a = 0; a < nOrd; a++) {
        for (b = 0; b < nOrd; b++) {
          if (a === b) { continue; }
          var mv = best.slice();
          var v = mv[a];
          mv.splice(a, 1);
          mv.splice(b, 0, v);
          cand.push(mv);
        }
      }
      for (var i = 0; i < cand.length; i++) {
        var cfg = clone(config);
        cfg.slots = fixedSlots;
        cfg.castOrder = cand[i];
        var res = simulate(cfg);
        if (!res.ok) { continue; }
        if (betterThan(mode, res, bestRes)) {
          bestRes = res;
          best = cand[i];
          improved = true;
        }
      }
      if (!improved) { break; }
    }
    return {
      ok: true,
      mode: mode,
      before: base,
      after: bestRes,
      slots: fixedSlots,
      castOrder: best,
      changed: best.join(',') !== start.join(','),
      gainDps: round(bestRes.dps - base.dps, 1),
      gainIdle: round(base.idle - bestRes.idle, 2)
    };
  }

  /* =========================================================
     🏹 사냥터 분당 처치 시뮬레이션 — 2026-11-27
     ---------------------------------------------------------
     · 몹 체력 = 평타 N방 = N × 평타 1타 (계산 단위 「타」)
     · 도술 1회가 한 마리에게 넣는 피해 = (계수 × 평균 배수 ÷ 평타 1타 계수) 타
     · 맞는 대상 = 살아 있는 몹 가운데 남은 체력이 가장 적은 몹부터 최대 대상 수만큼
     · 죽은 몹은 죽은 순간 + respawnSec 초에 그 몹만 풀피로 부활(개별 리스폰)
     · 시작 시 maxMobs 마리가 모두 살아 있음
     · 다중 감소(심판 6인↑ · 대폭발 4인↑)와 「적을수록 증가」(난타·요기 폭발)를 실제 맞은 인원으로 환산
     · 도술별 평균 배수는 레이드 계산기(simulate)를 300초 돌려 얻은 시전당 평균 배수를 씁니다
       (신식 게이지·용맹의 기운·요기범람·저격 화살촉·디버프가 평균으로 들어감)
     ========================================================= */
  function clampNum(v, lo, hi, dft) {
    var n = Number(v);
    if (!isFinite(n)) { return dft; }
    return Math.max(lo, Math.min(hi, n));
  }

  function simulateHunt(config) {
    var c = config || {};
    var HD = HUNT.defaults || { killHits: 10, maxMobs: 13, respawnSec: 5, duration: 180 };
    var cfg = {
      slots: c.slots || [],
      duration: clampNum(c.duration, 1, 600, HD.duration || 180),
      cdReducePct: c.cdReducePct || 0,
      castMode: c.castMode || 'delay',
      castScale: c.castScale || 1,
      chargeFull: c.chargeFull !== false,
      autoInterval: c.autoInterval > 0 ? c.autoInterval : 1,
      gap: c.gap > 0 ? c.gap : 0,
      autoCoeff: c.autoCoeff >= 0 ? c.autoCoeff : 100,
      ultFirst: c.ultFirst !== false,
      useUlt: c.useUlt !== false,
      castOrder: Array.isArray(c.castOrder) ? c.castOrder : null,
      toggles: c.toggles || {},
      override: c.override || {},
      enhance: c.enhance || {},
      trans: c.trans || {},
      tr6: c.tr6 || {},
      chain: c.chain || {},
      debuffOn: (c.debuffOn && typeof c.debuffOn === 'object') ? c.debuffOn : {},
      allDosulDmgPct: c.allDosulDmgPct || 0,
      styleDmgPct: (c.styleDmgPct && typeof c.styleDmgPct === 'object') ? c.styleDmgPct : {},
      hunt: true,
      killHits: clampNum(c.killHits, 0.5, 2000, HD.killHits || 10),
      maxMobs: Math.round(clampNum(c.maxMobs, 1, 60, HD.maxMobs || 13)),
      respawnSec: clampNum(c.respawnSec, 0.5, 120, HD.respawnSec || 5),
      huntAuto: clampNum(c.huntAutoCoeff != null ? c.huntAutoCoeff : (HUNT.autoCoeff || 95), 10, 3000, 95),
      /* 치명타 — 기본 50%(2026-11-27 준형 님 지시) · 치명타 피해 증가 기본 +20%
         평타 타수(몹 체력)는 「치명타 50% · 치타피해 +20%」에서 잰 기준이므로,
         다른 확률로 바꾸면 그 기준 대비 기대 피해 배수로 환산합니다:
           (1 + p × cd) ÷ (1 + 0.5 × 0.2) */
      critPct: clampNum(c.critPct, 0, 100, 50),
      critDmgPct: clampNum(c.critDmgPct, 0, 500, 20),
      /* 생존 계산 — 내 최대 체력 · 몹 1방 피격 · 몹 공격 주기 (0이면 생존 계산 생략) */
      maxHp: clampNum(c.maxHp, 0, 1e9, 0),
      mobDmg: clampNum(c.mobDmg, 0, 1e9, 0),
      mobAtkInterval: clampNum(c.mobAtkInterval, 0.2, 30, 2),
      /* 헌신 회복 — 체력이 이 % 이하가 되면 회복 도술을 최우선으로 씁니다.
         회복량 계수는 공개 자료에 없어 「최대 체력 %」로 받습니다(기본 30%). */
      healAtPct: clampNum(c.healAtPct, 0, 99, 70),
      healPct: clampNum(c.healPct, 0, 500, 30),
      /* 내 기본 평타 데미지 — 몹 체력 추정에만 쓰고 계산 자체는 평타 계수 그대로입니다.
         사냥터를 골랐을 때는 killHits 를 「몹 체력 ÷ 내 평타」로 만들어 넘깁니다. */
      myAutoDmg: clampNum(c.myAutoDmg, 0, 1e9, 0),
      groundInfo: c.groundInfo || null,
      /* 체력 자연 회복 — 인게임처럼 5.0초마다 한 번, 입력한 만큼 즉시 회복합니다.
         (초당으로 나눠 붙이지 않고 5·10·15…초 시점에 한꺼번에) */
      hpRegen: clampNum(c.hpRegen, 0, 1e9, 0)
    };
    var critFactor = (1 + (cfg.critPct / 100) * (cfg.critDmgPct / 100)) /
      (1 + 0.5 * 0.2);
    var duration = cfg.duration;

    var built = buildEntries(cfg);
    var list = built.entries.slice();
    if (built.ult) { list.push(built.ult); }
    var n = list.length;
    var i, k;
    for (i = 0; i < n; i++) {
      list[i].order = (list[i].ord != null ? list[i].ord : i);
      list[i].readyAt = 0;
      list[i].casts = 0;
      list[i].kills = 0;
      list[i].damage = 0;
      list[i].targets = 0;
      list[i].fallHits = 0;
    }

    /* 도술별 평균 배수 — 레이드 계산기 300초를 한 번 돌려 시전당 평균 배수를 씁니다 */
    var avgMul = {};
    var probeDps = null;
    if (n) {
      var pc = clone(cfg);
      pc.hunt = true;
      pc.duration = 300;
      var pr = simulate(pc);
      if (pr && pr.ok) {
        probeDps = pr.dps;
        pr.rows.forEach(function (r) {
          var base = (r.coeff || 0) + (r.chain ? r.chain.coeff : 0);
          if (base > 0 && r.casts > 0) { avgMul[r.id] = r.damage / (base * r.casts); }
        });
      }
    }

    /* 사냥터 상태 */
    var mobHp = cfg.killHits;
    var mobs = [];
    for (i = 0; i < cfg.maxMobs; i++) {
      mobs.push({ i: i, hp: mobHp, alive: true, deadAt: -1, respawnAt: 0 });
    }
    var EPS = 1e-9;

    /* ---------------------------------------------------------
       쿨타임 신식 (v52) — 단일 보스 계산기(simulate)와 **같은 규칙**을 자사 루프에도 씁니다.
       예전에는 자사계산기가 시전당 피해 배수(avgMul)만 가져오고 쿨타임은
       「시전 시작 + 도술 쿨」만 계산해서, 아래 신식이 하나도 붙지 않았습니다.
         · 기만 눈물(halfCdEvery 3)      : 궁극기를 뺀 도술 3회마다 쿨 중인 도술 1개 남은 쿨 -50%
         · 파멸 요기범람(resetEvery 14)  : 14회마다 궁극기를 뺀 도술 쿨 초기화
         · 평면 쿨감(fx.cd)              : 시전마다 다른 도술 남은 쿨 -초
         · 신식 게이지 — 척결 중첩(남은 쿨 -20% · 궁극기 -10%) · 주술 구슬(-0.1/-0.2/-0.3초)
           · 절명 형상 5개(궁극기 -6초) · 강타 강압(도술 쿨 초기화) · 기동 연쇄(궁극기 초기화)
       시전 **빈도**만 바꾸고, 시전 1회의 피해 배수는 위 평균 배수(avgMul)를 그대로 씁니다.
       토글은 buildEntries 가 simulate 와 똑같이 읽으므로, 켜 둔 신식만 붙습니다.
       --------------------------------------------------------- */
    var fx = built.fx;
    var ult = built.ult || null;
    var valour = built.valour || null;
    var cdReducePerCast = fx.cd || 0;
    var castsSinceReset = 0;
    var castsSinceUltReset = 0;
    var nonUltSeq = 0;
    var cdFx = { halfTrig: 0, halfHit: 0, halfCoolSum: 0, resetTrig: 0, gaugeCuts: 0, ultResetTrig: 0, flatCdCuts: 0 };
    /* 신식 게이지 상태 — 쿨에 영향을 주는 부분만 씁니다(피해 배수는 avgMul 몫) */
    var gauges = (built.gauges || []).map(function (g) {
      return { style: g.style, name: g.name, def: g.def, on: g.on || [], v: 0, lastT: 0, stacks: [] };
    });
    function gOn(g, id) { return !!id && g.on.indexOf(id) >= 0; }
    function gDecay(g, now) {
      var d = g.def.decayPerSec;
      if (!d) { return; }
      var dt = now - g.lastT;
      if (dt > 0) { g.v = Math.max(0, g.v - d * dt); }
    }
    function liveStacks(g, now) {
      var keep = [];
      for (var q = 0; q < g.stacks.length; q++) {
        if (now - g.stacks[q] <= g.def.stacks.sec + EPS) { keep.push(g.stacks[q]); }
      }
      g.stacks = keep;
      return keep.length;
    }
    function tierIdx(g, now) {
      var tiers = g.def.tiers;
      if (!tiers) { return 0; }
      var v = g.v;
      if (g.def.decayPerSec) { v = Math.max(0, v - (g.def.decayPerSec * Math.max(0, now - g.lastT))); }
      var idx = 0;
      for (var q = 0; q < tiers.length; q++) { if (v >= tiers[q].at - EPS) { idx = q + 1; } }
      return idx;
    }
    /* 방금 쓴 도술(exceptIdx)을 뺀 나머지 중 쿨이 도는 도술의 남은 쿨을 sec 만큼 줄입니다 */
    function applyFlatCd(now, exceptIdx, sec) {
      var amt = sec || cdReducePerCast;
      if (!amt) { return; }
      var cut = 0;
      for (var q = 0; q < n; q++) {
        if (q === exceptIdx) { continue; }
        var e2 = list[q];
        if (e2.readyAt > now) { e2.readyAt = Math.max(now, e2.readyAt - amt); cut += 1; }
      }
      if (cut) { cdFx.flatCdCuts += 1; }
    }
    /* 시전이 끝난 시점(tEnd)에 차는 신식 영력·중첩과 그 최대치 효과 가운데 쿨에 닿는 것만 */
    function huntGaugeAfterCast(cur, tStart, len, pickIdx, killedNow) {
      var tEnd = tStart + len;
      for (var q = 0; q < gauges.length; q++) {
        var g = gauges[q];
        var d = g.def;
        if (cur.kind === 'ult') {
          /* 강타 — 영력 100에서 천벌을 쓰면 [강압] : 다른 도술 쿨 초기화 */
          if (d.ultReset && d.ultReset.on === 'ult' && gOn(g, d.ultReset.gate) && g.v >= d.max - EPS) {
            for (var a = 0; a < n; a++) {
              if (list[a].kind !== 'ult') { list[a].readyAt = tEnd; }
            }
            g.v = 0;
            cdFx.gaugeCuts += 1;
          }
          /* 절명 — 궁극기가 형상을 모두 소모합니다 */
          if (d.ultTiers) { g.v = 0; }
          continue;
        }
        if (d.decayPerSec) { gDecay(g, tStart); }
        /* 연타 — 3초 동안 적중이 없으면 격노가 사라집니다 */
        if (d.idleResetSec && tStart - g.lastT > d.idleResetSec + EPS) { g.v = 0; }
        var hits = (cur.hits || 0) + (cur.chain ? cur.chain.hits * cur.chain.uses : 0);
        /* 처치로 차는 영력(척살 등)은 자사에서 그 시전이 실제로 잡은 마릿수로 셉니다
           (레이드 계산기는 단일 보스라 1마리로 보지만, 자사는 한 번에 여러 마리를 잡습니다) */
        var gain = (d.perCast || 0) + (d.perHit || 0) * hits + (d.perKill || 0) * Math.max(1, killedNow || 0);
        if (gain) { g.v = Math.min(d.max, g.v + gain); }
        g.lastT = tStart;

        /* 절명 — 형상이 최대일 때 도술마다 궁극기 남은 쿨 -6초 */
        if (d.ultCdCut && gOn(g, d.ultCdCut.gate) && ult && g.v >= d.max - EPS) {
          if (ult.readyAt > tEnd + EPS) {
            ult.readyAt = Math.max(tEnd, ult.readyAt - d.ultCdCut.sec);
            cdFx.gaugeCuts += 1;
          }
        }

        /* 척살 — 척결 중첩을 얻을 때마다 남은 쿨 -20%(궁극기 -10%) */
        if (d.stacks && gOn(g, d.stacks.gate) && g.v >= d.max - EPS) {
          g.v = 0;
          g.stacks.push(tEnd);
          liveStacks(g, tEnd);
          for (var b = 0; b < n; b++) {
            if (b === pickIdx) { continue; }
            var e3 = list[b];
            if (e3.readyAt > tEnd + EPS) {
              var cutPct = (e3.kind === 'ult') ? d.stacks.ultCdCut : d.stacks.cdCut;
              e3.readyAt = tEnd + (e3.readyAt - tEnd) * (1 - cutPct);
            }
          }
          cdFx.gaugeCuts += 1;
        }

        /* 주술 — 구슬 단계별로 다른 도술의 남은 쿨 -0.1/-0.2/-0.3초 */
        if (d.tiers && gOn(g, d.gate)) {
          var ti = tierIdx(g, tEnd);
          if (ti > 0 && d.tiers[ti - 1].flatCd) {
            applyFlatCd(tEnd, pickIdx, d.tiers[ti - 1].flatCd);
            cdFx.gaugeCuts += 1;
          }
        }

        /* 기동 — 영력 200에서 궁극기 쿨 초기화 */
        if (d.ultReset && d.ultReset.on === 'max' && gOn(g, d.ultReset.gate) && ult && g.v >= d.max - EPS) {
          ult.readyAt = tEnd;
          g.v = 0;
          cdFx.ultResetTrig += 1;
        }
      }
    }

    var t = 0;
    var lastT = 0;
    var kills = 0;
    /* 용맹의 기운 — 시전이 끝난 순간부터 10초간 내가 주는 피해(평타 포함) ×1.15~1.26.
       도술 피해는 레이드 계산기의 평균 배수(avgMul)에 이미 들어 있으므로
       자사 루프에서는 **평타**에만 버프 구간을 따라가며 곱합니다. */
    var vFrom = -Infinity;
    var vUntil = -Infinity;
    var vSec = 0;
    var vCasts = 0;
    var vAutoHits = 0;
    /* 저격 신식 — 화살촉은 **시간으로 차고**(1초에 25 · 최대 300) 시전할 때 소모되므로,
       자사 루프에서도 시계를 따라가며 연속 조준 중첩을 세어 **평타**에 곱합니다.
       (도술 피해에 붙는 화살촉·연속 조준 배수는 avgMul 에 이미 들어 있습니다) */
    var snipe = built.snipe || null;
    var sDef = snipe ? snipe.def : null;
    var spE = 0;
    var spT = 0;
    var aimN = 0;
    var aimUntil = -Infinity;
    var aimSeen = 0;
    var aimAutoHits = 0;
    function spEnergyAt(now) {
      return Math.max(0, Math.min(sDef.max, spE + (sDef.perSec || 0) * (now - spT)));
    }
    function spTakeArrows(now, cur) {
      spE = spEnergyAt(now);
      spT = now;
      var per = sDef.arrowPer || 100;
      var got = 0;
      if (cur.kind === 'ult') {
        got = Math.min(sDef.arrowMax || 3, Math.floor(spE / per + EPS));
      } else if (cur.style === 'snipe' && spE >= per - EPS) {
        got = 1;
      }
      if (got <= 0) { return; }
      spE = Math.max(0, spE - got * per);
      if (!snipe.aim) { return; }
      aimN = Math.min(sDef.aimMax || 5, aimN + got);
      aimUntil = now + (sDef.aimSec || 10);
      if (aimN > aimSeen) { aimSeen = aimN; }
    }
    var autoCount = 0;
    var autoMiss = 0;
    var autoDamage = 0;
    var autoKills = 0;
    var skillDamage = 0;
    var respawnCount = 0;
    var aliveSec = 0;
    var killLog = [];
    var respawnLog = [];
    var hitLog = [];
    /* 버티기 — 체력 추적 (몹 1방 피격이 있어야 켜집니다) */
    var hpTrack = cfg.mobDmg > 0 && cfg.maxHp > 0;
    var hp = cfg.maxHp;
    var hpMin = cfg.maxHp;
    var diedAt = null;
    var healed = 0;
    var healCasts = 0;
    var hpAt60 = null;
    var guard = 0;
    /* 체력 자연 회복 (5초마다) */
    var REGEN_SEC = 5;
    var regenTicks = 0;
    var regenTotal = 0;
    var nextRegenAt = REGEN_SEC;

    function aliveCountNow() {
      var cA = 0;
      for (var m = 0; m < mobs.length; m++) { if (mobs[m].alive) { cA += 1; } }
      return cA;
    }
    function stepTo(now) {
      if (now <= lastT + EPS) { return; }
      if (diedAt != null) { lastT = now; return; }
      var doRegen = hpTrack && cfg.hpRegen > 0;
      var steps = 0;
      /* 5초 회복 지점마다 구간을 끊어, 5·10·15…초에 정확히 한 번씩 회복합니다 */
      while (lastT < now - EPS && steps++ < 100000) {
        var segEnd = now;
        if (doRegen && nextRegenAt > lastT + EPS && nextRegenAt < segEnd - EPS) { segEnd = nextRegenAt; }
        var span = segEnd - lastT;
        /* 사망한 뒤에는 살아 있는 몹 수를 더 세지 않습니다 */
        var acNow = aliveCountNow();
        if (hpTrack) {
          var rate = acNow * cfg.mobDmg / cfg.mobAtkInterval;
          if (rate > 0) {
            var need = hp / rate;
            if (need <= span + EPS) {
              /* 이 구간 안에서 체력이 바닥 — 살아 있던 need 초까지만 셉니다 */
              diedAt = lastT + need;
              aliveSec += acNow * Math.max(0, need);
              hp = 0;
              hpMin = 0;
              lastT = now;
              return;
            }
            hp -= rate * span;
            if (hp < hpMin) { hpMin = hp; }
          }
        }
        aliveSec += acNow * span;
        lastT = segEnd;
        /* 이 시각이 5초 회복 지점이고 아직 살아 있으면 즉시 회복 (최대 체력 상한) */
        if (doRegen && Math.abs(lastT - nextRegenAt) <= EPS) {
          var beforeRegen = hp;
          hp = Math.min(cfg.maxHp, hp + cfg.hpRegen);
          regenTotal += hp - beforeRegen;
          regenTicks += 1;
          nextRegenAt += REGEN_SEC;
        }
      }
    }
    function respawnUpTo(now) {
      for (var m = 0; m < mobs.length; m++) {
        var mb = mobs[m];
        if (!mb.alive && mb.respawnAt <= now + EPS) {
          mb.alive = true;
          mb.hp = mobHp;
          respawnCount += 1;
          if (respawnLog.length < 200) {
            respawnLog.push({ mob: mb.i, killAt: round(mb.deadAt, 3), at: round(now, 3) });
          }
        }
      }
    }
    /* 남은 체력이 가장 적은 몹부터 — 같은 체력이면 먼저 나온 칸 */
    function aliveList() {
      var out = [];
      for (var m = 0; m < mobs.length; m++) { if (mobs[m].alive) { out.push(mobs[m]); } }
      out.sort(function (a, b) { return (a.hp - b.hp) || (a.i - b.i); });
      return out;
    }
    function applyHit(targets, dmgPer, owner, now) {
      var dealt = 0;
      var killed = 0;
      for (var m = 0; m < targets.length; m++) {
        var mb = targets[m];
        if (!mb.alive) { continue; }
        var real = Math.min(mb.hp, dmgPer);
        dealt += real;
        mb.hp -= dmgPer;
        if (mb.hp <= EPS) {
          mb.alive = false;
          mb.deadAt = now;
          mb.respawnAt = now + cfg.respawnSec;
          killed += 1;
          kills += 1;
          if (killLog.length < 3000) {
            killLog.push({ t: round(now, 3), mob: mb.i, by: owner ? owner.name : '평타', id: owner ? owner.id : 0 });
          }
        }
      }
      if (owner) {
        owner.damage += dealt;
        owner.kills += killed;
        skillDamage += dealt;
      } else {
        autoDamage += dealt;
        autoKills += killed;
      }
      return killed;
    }

    while (t < duration - EPS && guard++ < 100000) {
      respawnUpTo(t);
      stepTo(t);
      var pick = -1;
      var pickOrder = Infinity;
      var nextReady = Infinity;
      var healPick = -1;
      var healOrder = Infinity;
      var healLine = cfg.maxHp * cfg.healAtPct / 100;
      for (i = 0; i < n; i++) {
        var e = list[i];
        /* 회복 도술은 자사에서 「체력이 정한 % 이하」일 때만 씁니다 */
        if (hpTrack && e.kind === 'heal' && hp > healLine + EPS) { continue; }
        if (e.readyAt <= t + EPS) {
          if (e.order < pickOrder) { pickOrder = e.order; pick = i; }
          if (e.kind === 'heal' && e.order < healOrder) { healOrder = e.order; healPick = i; }
        } else if (e.readyAt < nextReady) {
          nextReady = e.readyAt;
        }
      }
      /* 헌신 회복 — 체력이 정한 % 이하이고 회복 도술이 준비돼 있으면 맨 먼저 씁니다
         (자사에서 헌신을 최우선으로 두는 운용 그대로 · 시전 시간만큼 다른 도술이 밀립니다) */
      if (diedAt != null) { break; }
      if (hpTrack && healPick >= 0) { pick = healPick; }

      if (pick >= 0) {
        var cur = list[pick];
        var castLen = cur.cast + (cur.chain ? cur.chainCast : 0) + cfg.gap;
        if (t + castLen > duration) { castLen = duration - t; }
        if (castLen <= EPS) { break; }
        var start = t;
        var end = start + castLen;
        stepTo(end);
        respawnUpTo(end);
        var alive = aliveList();
        var cap = Math.min(cur.tgt || 1, alive.length);
        var hits = cap > 0 ? alive.slice(0, cap) : [];
        var baseDmg = ((cur.coeff || 0) + (cur.chain ? cur.chain.coeff : 0)) * (avgMul[cur.id] || 1) / cfg.huntAuto * critFactor;
        var fallMul = huntFalloffMul(cur.id, hits.length);
        var focMul = cur.focusD ? (1 + (cur.focusD / 100) * huntFocusShape(cur.id, hits.length)) : 1;
        var perHit = baseDmg * fallMul * focMul;
        if (hitLog.length < 200) {
          hitLog.push({
            t: round(end, 3), id: cur.id, name: cur.name,
            targets: hits.map(function (mb) { return mb.i; }),
            perHit: round(perHit, 4), fall: round(fallMul, 4), focus: round(focMul, 4)
          });
        }
        var killedNow = applyHit(hits, perHit, cur, end);
        if (hpTrack && cur.kind === 'heal' && diedAt == null) {
          var beforeHp = hp;
          hp = Math.min(cfg.maxHp, hp + cfg.maxHp * cfg.healPct / 100);
          healed += hp - beforeHp;
          healCasts += 1;
          cur.healed = (cur.healed || 0) + (hp - beforeHp);
        }
        if (hpAt60 == null && end >= 60) { hpAt60 = round(hp, 0); }
        cur.casts += 1;
        /* 저격 — 시전 시작 순간에 화살촉을 소모하고 연속 조준 중첩을 쌓습니다(평타용) */
        if (snipe && sDef) { spTakeArrows(start, cur); }
        cur.targets += hits.length;
        cur.fallHits += 1;
        /* 기만 신식(눈물 2개 소모) — 궁극기를 뺀 도술 3회마다 「쿨이 도는 도술 1개」의 남은 쿨 -50%.
           어느 도술이 걸릴지 모르므로 쿨 중인 k개의 남은 시간을 (1 - 0.5/k)배로 함께 줄여
           무작위 1개의 평균 기댓값으로 계산합니다(simulate 와 같은 방식). */
        if (fx.halfCdEvery > 0 && cur.kind !== 'ult') {
          nonUltSeq += 1;
          if (nonUltSeq % fx.halfCdEvery === 0) {
            cdFx.halfTrig += 1;
            var coolCount = 0;
            for (k = 0; k < n; k++) {
              if (k === pick || list[k].kind === 'ult') { continue; }
              if (list[k].readyAt > start + EPS) { coolCount += 1; }
            }
            if (coolCount > 0) {
              var keepRatio = 1 - 0.5 / coolCount;
              for (k = 0; k < n; k++) {
                if (k === pick || list[k].kind === 'ult') { continue; }
                if (list[k].readyAt > start + EPS) {
                  list[k].readyAt = start + (list[k].readyAt - start) * keepRatio;
                }
              }
              cdFx.halfHit += 1;
              cdFx.halfCoolSum += coolCount;
            }
          }
        }
        cur.readyAt = start + Math.max(0.1, cur.cd);
        /* 평면 쿨감 신식 — 시전할 때마다 다른 도술의 남은 쿨을 그만큼 줄입니다 */
        applyFlatCd(start, pick);
        /* 신식 게이지 — 척결 중첩·주술 구슬·절명 형상·강타 강압·기동 연쇄의 쿨 효과
           (처치로 차는 영력은 이 시전이 잡은 마릿수로 셈니다) */
        huntGaugeAfterCast(cur, start, castLen, pick, killedNow);
        /* 용맹의 기운 — 이 시전이 끝나는 순간부터 10초 버프 (평타에 곱해집니다) */
        if (valour && cur.id === valour.id) {
          var vStart = Math.min(duration, end);
          if (vUntil > vStart + EPS) {
            /* 아직 버프가 남아 있으면 끝만 10초 더 */
          } else {
            if (vFrom > -Infinity) {
              vSec += Math.max(0, Math.min(duration, vUntil) - vFrom);
            }
            vFrom = vStart;
          }
          vUntil = vStart + valour.sec;
          vCasts += 1;
        }
        t = end;
        /* 일정 횟수마다 쿨 초기화 (파멸 요기범람 14회 등) */
        if (cur.kind !== 'ult') {
          castsSinceReset += 1;
          castsSinceUltReset += 1;
          if (fx.resetEvery && castsSinceReset >= fx.resetEvery) {
            castsSinceReset = 0;
            for (k = 0; k < n; k++) {
              if (list[k].kind !== 'ult') { list[k].readyAt = t; }
            }
            cdFx.resetTrig += 1;
          }
          if (fx.ultResetEvery && ult && castsSinceUltReset >= fx.ultResetEvery) {
            castsSinceUltReset = 0;
            ult.readyAt = t;
          }
        }
        continue;
      }

      /* 쓸 도술이 없을 때 — nextReady(또는 다음 부활) 까지 평타 */
      var nextRespawn = Infinity;
      for (k = 0; k < mobs.length; k++) {
        if (!mobs[k].alive && mobs[k].respawnAt > t + EPS && mobs[k].respawnAt < nextRespawn) { nextRespawn = mobs[k].respawnAt; }
      }
      var until = Math.min(duration, nextReady === Infinity ? duration : nextReady, nextRespawn);
      /* 평타는 0초부터 autoInterval 초마다 오는 고정 박자입니다 — 시전 중에 걸린 박자는 건너뜁니다 */
      var iv = cfg.autoInterval;
      var at = Math.ceil((t - EPS) / iv) * iv;
      var loopGuard = 0;
      while (at < until - EPS && loopGuard++ < 100000) {
        stepTo(at);
        respawnUpTo(at);
        var aliveA = aliveList();
        autoCount += 1;
        /* 용맹의 기운 버프가 걸린 평타만 그만큼 더 칩니다 */
        var aMul = (valour && at >= vFrom - EPS && at < vUntil - EPS) ? valour.mul : 1;
        if (aMul !== 1) { vAutoHits += 1; }
        /* 저격 연속 조준 — 중첩당 평타 피해 +5% (10초 안에서만) */
        if (snipe && snipe.aim && aimN > 0 && at < aimUntil - EPS) {
          aMul *= 1 + (sDef.aimPerStack || 0) * aimN;
          aimAutoHits += 1;
        }
        if (aliveA.length) { applyHit([aliveA[0]], critFactor * aMul, null, at); }
        else { autoMiss += 1; }
        at += iv;
      }
      stepTo(until);
      t = until;
    }
    stepTo(duration);
    if (vFrom > -Infinity) {
      vSec += Math.max(0, Math.min(duration, vUntil) - vFrom);
    }

    /* 생존 — 살아 있는 몹 수의 시간 평균 × 몹 1방 피격 ÷ 공격 주기 = 받는 DPS.
       (죽어서 리스폰을 기다리는 몹은 때리지 못하므로 평균 살아있는 몹으로 셉니다) */
    var life = (diedAt != null && diedAt > 0) ? diedAt : duration;
    var avgAliveMobs = aliveSec / (life || duration);
    var survival = null;
    if (cfg.mobDmg > 0) {
      var inDps = avgAliveMobs * (cfg.mobDmg / cfg.mobAtkInterval);
      var surviveSec = diedAt != null ? diedAt : ((cfg.maxHp > 0 && inDps > 0) ? Infinity : null);
      var regen = life > 0 ? healed / life : 0;
      var natPerSec = life > 0 ? regenTotal / life : 0;
      survival = {
        maxHp: cfg.maxHp, mobDmg: cfg.mobDmg, atkInterval: cfg.mobAtkInterval,
        healAtPct: cfg.healAtPct, healPct: cfg.healPct,
        healCasts: healCasts, healed: round(healed, 0),
        hpRegen: cfg.hpRegen, regenInterval: REGEN_SEC,
        regenTicks: regenTicks, regenTotal: round(regenTotal, 0), regenNatural: round(natPerSec, 1),
        avgAlive: round(avgAliveMobs, 2),
        dps: round(inDps, 1),
        dmg60: round(inDps * 60, 0),
        surviveSec: surviveSec === Infinity ? null : (surviveSec != null ? round(surviveSec, 1) : null),
        diedAt: diedAt != null ? round(diedAt, 1) : null,
        life: round(life, 1),
        hpEnd: round(hp, 0), hpMin: round(hpMin, 0), hpAt60: hpAt60,
        regen: round(regen, 1),
        sustain: cfg.maxHp > 0 ? ((regen + natPerSec) >= inDps - 1e-9 && diedAt == null) : null,
        level: diedAt != null ? 'danger' : (surviveSec === Infinity ? 'safe' : 'warn'),
        needRegen60: cfg.maxHp > 0 ? round(Math.max(0, inDps - cfg.maxHp / 60), 1) : round(inDps, 1),
        holdRegen: round(inDps, 1)
      };
    }
    var theoretical = cfg.maxMobs * (duration / cfg.respawnSec);
    var totalDamage = autoDamage + skillDamage;
    var rows = [];
    var skillKills = 0;
    for (i = 0; i < n; i++) {
      var en = list[i];
      skillKills += en.kills;
      if (en.casts > 0 || en.kind === 'ult') {
        rows.push({
          id: en.id, name: en.name, style: en.style, styleName: styleName(en.style),
          color: styleColor(en.style), kind: en.kind, slot: en.kind === 'ult' ? 'R' : (en.slot + 1),
          tgt: en.tgt || 1, casts: en.casts, kills: en.kills,
          damage: round(en.damage, 1),
          avgTargets: en.casts ? round(en.targets / en.casts, 2) : 0,
          share: totalDamage > 0 ? round((en.damage / totalDamage) * 100, 1) : 0,
          cd: round(en.cd, 2), cast: round(en.cast + (en.chain ? en.chain.castLen : 0), 2),
          falloff: (HUNT.falloff && HUNT.falloff[String(en.id)]) ? (HUNT.falloff[String(en.id)].label || '') : '',
          focus: en.focusD ? (HUNT.focus && HUNT.focus[String(en.id)] ? (HUNT.focus[String(en.id)].label || '') : '') : ''
        });
      }
    }
    rows.sort(function (a, b) { return b.damage - a.damage; });

    var k1 = 0;
    var k3 = 0;
    for (i = 0; i < killLog.length; i++) {
      if (killLog[i].t <= 60 + EPS) { k1 += 1; }
      if (killLog[i].t <= 180 + EPS) { k3 += 1; }
    }

    return {
      ok: true,
      duration: duration,
      killHits: round(cfg.killHits, 2),
      maxMobs: cfg.maxMobs,
      respawnSec: cfg.respawnSec,
      autoCoeff: cfg.huntAuto,
      autoInterval: cfg.autoInterval,
      critPct: cfg.critPct,
      critDmgPct: cfg.critDmgPct,
      critFactor: round(critFactor, 4),
      mobHpUnits: round(mobHp, 2),
      /* 내 기본 평타 데미지를 적었으면 몹 1마리 체력을 어림합니다 (평타 몇 방 × 내 평타) */
      myAutoDmg: cfg.myAutoDmg,
      mobHpEstimate: cfg.myAutoDmg > 0 ? round(cfg.myAutoDmg * cfg.killHits, 0) : null,
      /* 사냥터를 골라 계산했으면 그 이름·권장 전투력·몹 체력을 결과에 함께 남깁니다 */
      ground: cfg.groundInfo || null,
      kills: kills,
      killsPerMin: round(kills / ((life || duration) / 60), 1),
      kills1m: k1,
      kills3m: k3,
      theoretical: round(theoretical, 1),
      waveUse: theoretical > 0 ? round((kills / theoretical) * 100, 1) : 0,
      life: round(life || duration, 1),
      avgAlive: round(avgAliveMobs, 2),
      survival: survival,
      respawns: respawnCount,
      autoCount: autoCount, autoMiss: autoMiss,
      autoDamage: round(autoDamage, 1), autoKills: autoKills,
      skillDamage: round(skillDamage, 1), skillKills: skillKills,
      totalDamage: round(totalDamage, 1),
      autoShare: totalDamage > 0 ? round((autoDamage / totalDamage) * 100, 1) : 0,
      skillShare: totalDamage > 0 ? round((skillDamage / totalDamage) * 100, 1) : 0,
      probeDps: probeDps,
      /* 쿨타임 신식이 이번 사냥에서 몇 번 돌았는지 — 화면에는 쓰지 않고 회귀 테스트·확인용 */
      cdFx: cdFx,
      /* 용맹의 기운 — 평타에 붙은 버프 구간(헌신). 도술은 avgMul 에 이미 포함 */
      valour: valour ? {
        sec: valour.sec, mul: round(valour.mul, 4), lv: valour.lv,
        casts: vCasts, buffSec: round(vSec, 1),
        buffPct: duration > 0 ? round((vSec / duration) * 100, 1) : 0,
        autoHits: vAutoHits
      } : null,
      /* 저격 — 평타에 붙은 연속 조준 중첩(10초 · 최대 5중첩 × +5%) */
      snipeAim: snipe ? { on: !!snipe.aim, maxStack: aimSeen, autoHits: aimAutoHits } : null,
      rows: rows,
      killLog: killLog.slice(0, 400),
      respawnLog: respawnLog.slice(0, 120),
      hitLog: hitLog.slice(0, 200)
    };
  }

  /* 프리셋·조합 비교 — 같은 사냥 조건에서 어느 세팅이 빠른지 */
  function huntCompare(config) {
    var cur = simulateHunt(config);
    var rows = [{ id: 'current', name: '지금 세팅', current: true, kills: cur.kills, perMin: cur.killsPerMin }];
    presets().forEach(function (p) {
      var c = clone(config || {});
      c.slots = p.slots.slice(0, 8);
      c.castOrder = [];
      var r = simulateHunt(c);
      rows.push({ id: p.id, name: p.name, note: p.note || '', current: false, kills: r.kills, perMin: r.killsPerMin });
    });
    var best = 0;
    rows.forEach(function (r) { if (r.perMin > best) { best = r.perMin; } });
    rows.forEach(function (r) { r.best = best > 0 && Math.abs(r.perMin - best) < 1e-9; });
    return { base: cur, rows: rows, best: best };
  }

  global.YM_DOSUL = {
    data: DATA,
    enhanceBonus: enhanceBonus,
    enhanceMax: enhanceMax,
    transInfo: transInfo,
    gradeOf: gradeOf,
    isSpecial: isSpecial,
    hasSixEffect: hasSixEffect,
    sixOptions: sixOptions,
    special: SPECIAL,
    styles: styles,
    allSkills: allSkills,
    chainSkills: chainSkills,
    chainOf: chainOf,
    chainOn: chainOn,
    skillById: skillById,
    styleOf: styleOf,
    styleName: styleName,
    styleColor: styleColor,
    presets: presets,
    styleCounts: styleCounts,
    sinStyles: sinStyles,
    equippedIds: equippedIds,
    activeUltId: activeUltId,
    syncCastOrder: syncCastOrder,
    kindLabel: function (k) { return KIND_LABEL[k] || k; },
    simulate: simulate,
    optimize: optimize,
    simulateHunt: simulateHunt,
    huntCompare: huntCompare,
    huntData: huntData,
    huntGrounds: huntGrounds,
    huntGround: huntGround,
    huntTargets: huntTargets,
    huntFalloffMul: huntFalloffMul,
    huntFocusShape: huntFocusShape
  };
})(window);
