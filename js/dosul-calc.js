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
    var onList = (opts && opts[key]) || [];
    var extra = 0;
    var list = (t6 && t6.o ? t6.o : []).map(function (o) {
      var isOn = !!(o.id && on6 && onList.indexOf(o.id) >= 0);
      var calc = o.k !== 'text' && (o.d || 0) > 0;
      if (isOn && calc) { extra += o.d; }
      return { id: o.id || '', t: o.t || '', d: o.d || 0, n: o.n || '', calc: calc, on: isOn };
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
      extra: extra
    };
  }

  function styleOf(key) { return STYLE_BY_KEY[key] || null; }
  function styleName(key) { var s = STYLE_BY_KEY[key]; return s ? s.name : key; }
  function styleColor(key) { var s = STYLE_BY_KEY[key]; return s ? s.color : '#7fd1bd'; }
  function skillById(id) { return SKILL_BY_ID[id] || null; }
  function allSkills() { return DATA.skills.slice(); }
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

    /* 신식 토글 → 효과 모으기 */
    var fx = { ultCd: 0, cd: 0, cdPct: 0, dmg: 0, ultDmg: 0, resetEvery: 0, ultResetEvery: 0, halfCdEvery: 0 };
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
    var cdMul = (1 - cdPct) * (1 - fx.cdPct);

    var ov = config.override || {};
    var enh = config.enhance || {};
    var transCfg = config.trans || {};
    var tr6Cfg = config.tr6 || {};

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

      /* 돌파: 쿨타임은 그 도술만 줄고(최대 기본의 90%), 계수는 단계 누적 + 6돌파 효과 */
      var cdAfterTrans = Math.max(cdBase * 0.1, cdBase - Math.min(cdBase * 0.9, tr.cdSec));
      var cd = cdAfterTrans * cdMul;
      var trMul = 1 + (tr.dmgPct + tr.d6 + tr.extra) / 100;
      return {
        id: sk.id, slot: slot, name: sk.n, style: sk.st, kind: sk.k,
        cdBase: cdBase, cd: cd,
        cast: ct * scale, castBase: ct, est: est,
        coeff: coeffBase * (1 + enhPct / 100) * trMul * (sk.k === 'ult' ? ultDmgMul : dmgMul),
        hits: sk.h, charge: sk.ch || 0,
        enh: enhLv, enhPct: enhPct,
        trans: tr.step, transDmgPct: tr.dmgPct, transCd: tr.cdSec,
        tr6: tr.t6on, tr6Pct: tr.d6, tr6Text: tr.t6, hasTrans: tr.has,
        tr6Extra: tr.extra, tr6Opts: tr.opts, sp: isSpecial(sk.id), grade: gradeOf(sk.id)
      };
    }

    var i;
    for (i = 0; i < 8; i++) {
      var id = config.slots[i];
      if (!id) { continue; }
      var e = makeEntry(id, i);
      if (e) { entries.push(e); }
    }

    /* 신식 활성 → 궁극기 자동 장착(맨 뒤 순번) */
    var ultEntry = null;
    if (sin.length && config.useUlt !== false) {
      var ultId = sin[0].style.ult;
      ultEntry = makeEntry(ultId, 99);
      if (ultEntry) {
        ultEntry.kind = 'ult';
        ultEntry.cd = Math.max(1, ultEntry.cd - fx.ultCd);
        ultEntry.ultFirst = config.ultFirst !== false;
      }
    }

    return {
      entries: entries, ult: ultEntry, fx: fx, toggles: activeToggles, sin: sin,
      dmgMul: dmgMul, ultDmgMul: ultDmgMul
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
      toggles: config.toggles || {},
      override: config.override || {},
      enhance: config.enhance || {},
      trans: config.trans || {},
      tr6: config.tr6 || {}
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
    for (i = 0; i < n; i++) {
      list[i].order = i;
      list[i].readyAt = 0;
      list[i].casts = 0;
      list[i].done = 0;
      list[i].occupied = 0;
      list[i].damage = 0;
    }
    var ult = built.ult;
    if (ult) { ult.order = cfg.ultFirst ? -1 : 900; }

    var fx = built.fx;
    var castsSinceReset = 0;
    var castsSinceUltReset = 0;
    var castSeq = 0;
    var t = 0;
    var idle = 0;
    var segments = [];
    var guard = 0;
    var EPS = 1e-7;
    var cdReducePerCast = fx.cd || 0;

    function applyFlatCd(now, exceptIdx) {
      if (!cdReducePerCast) { return; }
      for (var j = 0; j < n; j++) {
        if (j === exceptIdx) { continue; }
        var e = list[j];
        if (e.readyAt > now) {
          e.readyAt = Math.max(now, e.readyAt - cdReducePerCast);
        }
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
          segments.push({ t0: t, t1: end, kind: 'auto', name: '평타' });
        }
        t = end;
        continue;
      }

      var cur = list[pick];
      var castLen = cur.cast + gap;
      if (t + castLen > duration) { castLen = duration - t; }
      if (castLen <= EPS) { break; }

      cur.casts += 1;
      cur.occupied += castLen;
      cur.damage += cur.coeff;
      castSeq += 1;

      segments.push({
        t0: t, t1: t + castLen, kind: 'cast', name: cur.name, id: cur.id,
        style: cur.style, color: styleColor(cur.style),
        isUlt: cur.kind === 'ult', slot: cur.id === (ult ? ult.id : -1) ? 'R' : (cur.slot + 1)
      });

      /* 쿨타임은 「시전을 시작한 순간」부터 흐릅니다 */
      var cd = cur.cd;
      if (fx.halfCdEvery && castSeq % fx.halfCdEvery === 0) { cd = cd * 0.5; }
      cur.readyAt = t + Math.max(0.1, cd);

      applyFlatCd(t, pick);

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
          trans: en.trans, transDmgPct: round(en.transDmgPct, 1), transCd: round(en.transCd, 2),
          tr6: en.tr6, tr6Pct: en.tr6Pct, tr6Text: en.tr6Text, hasTrans: en.hasTrans,
          tr6Extra: round(en.tr6Extra || 0, 1), tr6Opts: en.tr6Opts, sp: en.sp, grade: en.grade
        });
      }
    }
    rows.sort(function (a, b) {
      if (a.kind === 'ult' && b.kind !== 'ult') { return -1; }
      if (b.kind === 'ult' && a.kind !== 'ult') { return 1; }
      return String(a.slot).localeCompare(String(b.slot));
    });

    var autoCount = idle / cfg.autoInterval;
    var autoDamage = autoCount * cfg.autoCoeff;
    var totalCoeff = skillDamage + autoDamage;
    var idlePct = duration > 0 ? (idle / duration) * 100 : 0;
    var uptime = 100 - idlePct;

    rows.forEach(function (r) {
      r.share = totalCoeff > 0 ? round((r.damage / totalCoeff) * 100, 1) : 0;
      r.deals = r.coeff > 0;
    });

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
      segments: segments,
      sin: built.sin.map(function (s) {
        return { key: s.key, name: s.style.name, count: s.count, color: s.style.color, ult: skillById(s.style.ult) };
      }),
      toggles: built.toggles,
      dmgMul: round(built.dmgMul, 3),
      ultDmgMul: round(built.ultDmgMul, 3),
      totalCasts: rows.reduce(function (a, r) { return a + r.casts; }, 0)
    };
  }

  /* ---------------------------------------------------------
     평타 빈 시간을 줄이는 순서 찾기 (지역 탐색)
     지금 순서 → 두 칸 맞바꾸기 / 한 칸 옮기기를 모두 해 보고
     초당 피해(DPS)가 늘어나는 쪽으로 계속 고칩니다.
     --------------------------------------------------------- */
  function optimize(config, rounds) {
    var base = simulate(config);
    if (!base.ok) { return base; }
    var maxRound = rounds || 4;
    var best = config.slots.slice(0, 8);
    var bestRes = base;
    var pass;
    for (pass = 0; pass < maxRound; pass++) {
      var improved = false;
      var cand = [];
      var a, b;
      for (a = 0; a < 8; a++) {
        for (b = a + 1; b < 8; b++) {
          if (!best[a] && !best[b]) { continue; }
          var sw = best.slice();
          var tmp = sw[a]; sw[a] = sw[b]; sw[b] = tmp;
          cand.push(sw);
        }
      }
      for (a = 0; a < 8; a++) {
        for (b = 0; b < 8; b++) {
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
        cfg.slots = cand[i];
        var res = simulate(cfg);
        if (!res.ok) { continue; }
        if (res.dps > bestRes.dps + 0.05) {
          bestRes = res;
          best = cand[i];
          improved = true;
        }
      }
      if (!improved) { break; }
    }
    return {
      ok: true,
      before: base,
      after: bestRes,
      slots: best,
      changed: best.join(',') !== config.slots.slice(0, 8).join(','),
      gainDps: round(bestRes.dps - base.dps, 1),
      gainIdle: round(base.idle - bestRes.idle, 2)
    };
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
    skillById: skillById,
    styleOf: styleOf,
    styleName: styleName,
    styleColor: styleColor,
    presets: presets,
    styleCounts: styleCounts,
    sinStyles: sinStyles,
    kindLabel: function (k) { return KIND_LABEL[k] || k; },
    simulate: simulate,
    optimize: optimize
  };
})(window);
