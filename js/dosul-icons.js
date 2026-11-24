/* =========================================================
   ⚔️ 도술 아이콘 — 게임 도술 아이콘 그림
   ---------------------------------------------------------
   도깨비지지(kkaebi.gg) 도술 도감이 쓰는 게임 아이콘(100×100 webp)을
   assets/dosul/<도술 id>.webp 로 내려받아 씁니다. 106개 전부 있습니다.
   (도술 아이콘의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시
    즉시 삭제될 수 있습니다 — 화면 하단에도 같은 문구를 둡니다.)
   ========================================================= */
(function (global) {
  'use strict';

  var CREDIT = '도술 아이콘의 저작권은 「도깨비의 세계」에 있으며, 권리자 요청 시 즉시 삭제될 수 있습니다.';
  var SOURCE = 'kkaebi.gg (도깨비지지) 도술 도감';

  /* 내려받아 둔 아이콘 목록 — 여기 없는 id 는 계열 색 글자 타일로 대신합니다 */
  var IDS = [
    1010010, 1010011, 1010012, 1010020, 1010030, 1010040,
    1010050, 1010060, 1010070, 1010080, 1020010, 1020011,
    1020012, 1020013, 1020020, 1020030, 1020040, 1020050,
    1020060, 1020070, 1020080, 1030010, 1030020, 1030030,
    1030040, 1030050, 1030060, 1030070, 1030080, 1040010,
    1040011, 1040012, 1040013, 1040020, 1040030, 1040040,
    1040050, 1040060, 1040070, 1040080, 1050010, 1050020,
    1050030, 1050040, 1050050, 1050060, 1050070, 1070010,
    1070011, 1070012, 1070013, 1070014, 1070020, 1070030,
    1070040, 1070041, 1070042, 1070050, 1070051, 1070060,
    1080010, 1080020, 1080030, 1080040, 1080050, 1080060,
    1080080, 1090010, 1090020, 1090021, 1090030, 1090040,
    1090050, 1090060, 1090070, 1100010, 1100020, 1100030,
    1100040, 1100050, 1100051, 1100060, 1100070, 1110010,
    1110020, 1110030, 1110040, 1110050, 1110060, 1110070,
    1120010, 1120020, 1120030, 1120040, 1120050, 1120060,
    1120070, 1130010, 1130020, 1130030, 1130040, 1130050,
    1130060, 1130070, 1130080, 1130090,
  ];

  var HAVE = {};
  IDS.forEach(function (id) { HAVE[id] = true; });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function src(id) { return './assets/dosul/' + Number(id) + '.webp'; }
  function has(id) { return !!HAVE[Number(id)]; }

  /* 크기·모양은 CSS 클래스(ds-ico--slot 등)가 정하고, 여기서는 그 힌트만 붙입니다 */
  function html(id, opts) {
    var o = opts || {};
    var n = Number(id);
    var D = global.YM_DOSUL;
    var sk = D && D.skillById ? D.skillById(n) : null;
    var color = sk && D.styleColor ? D.styleColor(sk.st) : '#7fd1bd';
    var cls = 'ds-ico' + (o.cls ? ' ' + o.cls : '');
    var size = o.size || 0;
    var style = '--ds-style:' + esc(color) + (size ? ';--ds-ico-size:' + size + 'px' : '');
    var label = o.label || '';
    if (!has(n)) {
      /* 안전 폴백 — 아이콘 파일이 없을 때만 나옵니다 */
      return '<span class="' + cls + ' is-fallback" style="' + style + '"' +
        (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"') + '>' +
        '<b aria-hidden="true">' + esc(sk ? sk.n.slice(0, 1) : '?') + '</b></span>';
    }
    return '<span class="' + cls + '" style="' + style + '"' +
      (label ? ' role="img" aria-label="' + esc(label) + '"' : ' aria-hidden="true"') + '>' +
      '<img src="' + src(n) + '" alt="" ' +
      'width="' + (size || 40) + '" height="' + (size || 40) + '" ' +
      (o.lazy ? 'loading="lazy" ' : '') + 'decoding="async" draggable="false">' +
      '</span>';
  }

  global.YM_DOSUL_ICONS = {
    version: '2026-11-24',
    credit: CREDIT,
    source: SOURCE,
    ids: function () { return IDS.slice(); },
    has: has,
    src: src,
    html: html
  };
})(window);
