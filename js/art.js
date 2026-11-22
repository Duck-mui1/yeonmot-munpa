/* 연못 — 오리지널 SVG 일러스트
 * 연못 · 연꽃 · 물결 · 반딧불 · 잉어만으로 그린 자체 제작 그래픽입니다.
 */
(function () {
  'use strict';

  var seq = 0;
  function uid(p) {
    seq += 1;
    return p + seq;
  }

  /* ---------- 작은 연꽃 마크 ---------- */
  function mark(size) {
    var s = size || 40;
    var g = uid('mk');
    return (
      '<svg class="mark" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" role="img" aria-label="연못 연꽃 문양">' +
      '<defs>' +
      '<linearGradient id="' + g + 'a" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffe3ec"/><stop offset="1" stop-color="#ee8fab"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + g + 'b" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#f6d9a1"/><stop offset="1" stop-color="#c79a4e"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<ellipse cx="32" cy="46" rx="22" ry="7" fill="#0a2b2c" opacity=".55"/>' +
      '<path d="M32 44c-9 0-17-6-18-15 8-1 14 2 18 8 4-6 10-9 18-8-1 9-9 15-18 15z" fill="#1e6f62" opacity=".9"/>' +
      '<g fill="url(#' + g + 'a)">' +
      '<ellipse cx="32" cy="24" rx="5.4" ry="15"/>' +
      '<ellipse cx="21" cy="28" rx="5" ry="13" transform="rotate(-32 21 28)"/>' +
      '<ellipse cx="43" cy="28" rx="5" ry="13" transform="rotate(32 43 28)"/>' +
      '<ellipse cx="15" cy="36" rx="4.4" ry="11" transform="rotate(-58 15 36)"/>' +
      '<ellipse cx="49" cy="36" rx="4.4" ry="11" transform="rotate(58 49 36)"/>' +
      '</g>' +
      '<circle cx="32" cy="32" r="4.6" fill="url(#' + g + 'b)"/>' +
      '<circle cx="32" cy="32" r="1.8" fill="#fff6df"/>' +
      '</svg>'
    );
  }

  /* ---------- 홈 배너 ---------- */
  function hero() {
    var g = uid('hr');
    var fireflies = '';
    var pts = [[92, 96], [138, 74], [206, 110], [262, 84], [330, 104], [402, 78], [452, 118], [58, 132], [176, 58]];
    for (var i = 0; i < pts.length; i++) {
      fireflies += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + (1.6 + (i % 3) * 0.7) + '" fill="#ffe9b0" opacity="' + (0.45 + (i % 4) * 0.14) + '" filter="url(#' + g + 'g)"/>';
    }

    return (
      '<svg class="hero__svg" viewBox="0 0 480 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="' + g + 's" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#04191d"/><stop offset=".55" stop-color="#083231"/><stop offset="1" stop-color="#0b4441"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + g + 'w" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0d4a48"/><stop offset=".45" stop-color="#093736"/><stop offset="1" stop-color="#05201f"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + g + 'm" cx=".5" cy=".5" r=".5">' +
      '<stop offset="0" stop-color="#fff6dc" stop-opacity=".95"/><stop offset=".35" stop-color="#ffe8b6" stop-opacity=".38"/><stop offset="1" stop-color="#ffe8b6" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<linearGradient id="' + g + 'p" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#ffdfe8"/><stop offset="1" stop-color="#e87f9e"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + g + 'k" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ffd9b8"/><stop offset="1" stop-color="#e2705f"/>' +
      '</linearGradient>' +
      '<linearGradient id="' + g + 'v" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset=".45" stop-color="#03171a" stop-opacity="0"/><stop offset="1" stop-color="#03171a" stop-opacity=".85"/>' +
      '</linearGradient>' +
      '<filter id="' + g + 'g" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.6"/></filter>' +
      '<filter id="' + g + 'b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>' +
      '</defs>' +
      '<rect width="480" height="300" fill="url(#' + g + 's)"/>' +
      '<circle cx="376" cy="80" r="84" fill="url(#' + g + 'm)"/>' +
      '<circle cx="376" cy="80" r="21" fill="#fff8e6" opacity=".92"/>' +
      '<circle cx="369" cy="75" r="4" fill="#f2e4c9" opacity=".5"/>' +
      '<circle cx="383" cy="86" r="2.6" fill="#f2e4c9" opacity=".4"/>' +
      fireflies +
      '<path d="M0 142c46-26 74-10 108-24 30-13 54-6 78 2 32 11 58-14 96-10 40 4 62 20 98 12 34-8 66-2 100 12v42H0z" fill="#06282a" opacity=".85"/>' +
      '<path d="M0 158c52-14 86 6 126-4 40-10 62 10 104 4 44-6 70-16 112-4 34 10 76 2 138 8v46H0z" fill="#083a38" opacity=".9"/>' +
      '<rect y="168" width="480" height="132" fill="url(#' + g + 'w)"/>' +
      '<ellipse cx="376" cy="196" rx="26" ry="52" fill="#ffe8b6" opacity=".1"/>' +
      '<g stroke="#bfe6da" fill="none" opacity=".16">' +
      '<ellipse cx="120" cy="206" rx="62" ry="7"/><ellipse cx="330" cy="222" rx="82" ry="8"/>' +
      '<ellipse cx="210" cy="252" rx="120" ry="9"/><ellipse cx="60" cy="268" rx="70" ry="6"/>' +
      '<ellipse cx="420" cy="256" rx="66" ry="7"/>' +
      '</g>' +
      '<g stroke="#f7d9a4" fill="none" opacity=".22"><ellipse cx="376" cy="210" rx="34" ry="4"/><ellipse cx="376" cy="228" rx="50" ry="5"/></g>' +
      /* 연잎 */
      '<g opacity=".95">' +
      '<ellipse cx="92" cy="214" rx="46" ry="17" fill="#0f5a4f"/>' +
      '<path d="M92 214l40-9-34 16z" fill="#0a3b36"/>' +
      '<ellipse cx="140" cy="236" rx="30" ry="11" fill="#0c4a42"/>' +
      '<ellipse cx="38" cy="238" rx="26" ry="10" fill="#0b453e"/>' +
      '</g>' +
      /* 연꽃 */
      '<g transform="translate(112 186)">' +
      '<g fill="url(#' + g + 'p)">' +
      '<ellipse cx="0" cy="-10" rx="6" ry="17"/>' +
      '<ellipse cx="-12" cy="-4" rx="6" ry="15" transform="rotate(-34 -12 -4)"/>' +
      '<ellipse cx="12" cy="-4" rx="6" ry="15" transform="rotate(34 12 -4)"/>' +
      '<ellipse cx="-20" cy="4" rx="5" ry="12" transform="rotate(-62 -20 4)"/>' +
      '<ellipse cx="20" cy="4" rx="5" ry="12" transform="rotate(62 20 4)"/>' +
      '</g>' +
      '<circle cx="0" cy="1" r="5" fill="#f4d79b"/><circle cx="0" cy="1" r="2" fill="#fff3d6"/>' +
      '</g>' +
      /* 잉어 */
      '<g opacity=".95">' +
      '<path d="M262 214c22-16 52-14 66 2 8 9 4 18-8 21-16 4-32-2-44-10-6-4-11-8-14-13z" fill="url(#' + g + 'k)"/>' +
      '<path d="M328 217c10-7 20-9 26-6-6 5-8 10-7 15-5 1-13-2-19-9z" fill="#f0b191" opacity=".85"/>' +
      '<circle cx="276" cy="214" r="2.2" fill="#3b1c17"/>' +
      '<path d="M300 208c6 3 10 8 12 14" stroke="#ffe1c6" stroke-width="2" fill="none" opacity=".5"/>' +
      '<path d="M196 244c18-13 42-11 54 2 7 8 3 15-7 17-14 3-27-2-37-9-5-3-8-6-10-10z" fill="url(#' + g + 'k)" opacity=".8"/>' +
      '<path d="M250 246c8-6 16-7 21-5-5 4-7 8-6 12-4 1-10-1-15-7z" fill="#f0b191" opacity=".7"/>' +
      '<circle cx="208" cy="244" r="1.8" fill="#3b1c17"/>' +
      '</g>' +
      /* 갈대 */
      '<g stroke="#0b3f3a" stroke-width="2.4" fill="none" opacity=".95">' +
      '<path d="M446 300c-4-40 2-70 12-96"/><path d="M462 300c2-34 10-58 22-78"/><path d="M430 300c-8-30-6-54 2-72"/>' +
      '</g>' +
      '<g fill="#0b3f3a" opacity=".95">' +
      '<ellipse cx="458" cy="196" rx="3.4" ry="10" transform="rotate(12 458 196)"/>' +
      '<ellipse cx="484" cy="214" rx="3.2" ry="9" transform="rotate(20 484 214)"/>' +
      '<ellipse cx="432" cy="222" rx="3" ry="9" transform="rotate(-14 432 222)"/>' +
      '</g>' +
      '<rect y="150" width="480" height="150" fill="url(#' + g + 'v)"/>' +
      '</svg>'
    );
  }

  /* ---------- 앨범 카드 일러스트 ---------- */
  function scene(kind) {
    var g = uid('sc');
    var palettes = {
      moon: ['#061f27', '#0d3d47', '#f6e6bf'],
      boss: ['#120f22', '#22203d', '#f0a6b8'],
      koi: ['#062a29', '#0d4f45', '#ffd0b0'],
      group: ['#082026', '#123f41', '#ffe0a8'],
      firefly: ['#041a1a', '#0a3a33', '#ffe9a8'],
      lantern: ['#0a1c22', '#123f42', '#ffd6c4'],
      reed: ['#131f2a', '#2a4148', '#ffd9a1'],
      wave: ['#04191f', '#0a3a44', '#d8f1e6']
    };
    var p = palettes[kind] || palettes.moon;

    var defs =
      '<defs>' +
      '<linearGradient id="' + g + 's" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + p[0] + '"/><stop offset="1" stop-color="' + p[1] + '"/>' +
      '</linearGradient>' +
      '<radialGradient id="' + g + 'r" cx=".5" cy=".5" r=".5">' +
      '<stop offset="0" stop-color="' + p[2] + '" stop-opacity=".55"/><stop offset="1" stop-color="' + p[2] + '" stop-opacity="0"/>' +
      '</radialGradient>' +
      '<linearGradient id="' + g + 'p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffdbe6"/><stop offset="1" stop-color="#e07d9b"/></linearGradient>' +
      '<linearGradient id="' + g + 'w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c4548" stop-opacity=".9"/><stop offset="1" stop-color="#041a1e"/></linearGradient>' +
      '</defs>';

    var body = '';

    if (kind === 'moon') {
      body =
        '<circle cx="214" cy="86" r="72" fill="url(#' + g + 'r)"/>' +
        '<circle cx="214" cy="86" r="34" fill="#fdf3d8" opacity=".9"/>' +
        '<ellipse cx="214" cy="196" rx="22" ry="54" fill="#fdf3d8" opacity=".14"/>' +
        '<g stroke="#cfeade" fill="none" opacity=".2"><ellipse cx="214" cy="190" rx="40" ry="5"/><ellipse cx="214" cy="214" rx="66" ry="7"/><ellipse cx="120" cy="228" rx="70" ry="6"/><ellipse cx="250" cy="236" rx="60" ry="5"/></g>' +
        '<g transform="translate(96 200)" opacity=".95">' +
        '<ellipse cx="0" cy="10" rx="52" ry="15" fill="#0a3733"/>' +
        '<g fill="url(#' + g + 'p)"><ellipse cx="8" cy="-14" rx="7" ry="19"/><ellipse cx="-6" cy="-8" rx="6" ry="16" transform="rotate(-30 -6 -8)"/><ellipse cx="22" cy="-8" rx="6" ry="16" transform="rotate(30 22 -8)"/><ellipse cx="-18" cy="0" rx="5" ry="12" transform="rotate(-55 -18 0)"/><ellipse cx="34" cy="0" rx="5" ry="12" transform="rotate(55 34 0)"/></g>' +
        '<circle cx="8" cy="-12" r="5" fill="#f6d99f"/>' +
        '</g>' +
        '<g fill="#ffe9b0" opacity=".8"><circle cx="62" cy="70" r="2"/><circle cx="98" cy="104" r="1.6"/><circle cx="272" cy="62" r="1.8"/><circle cx="300" cy="120" r="1.5"/><circle cx="152" cy="128" r="1.4"/></g>';
    } else if (kind === 'boss') {
      body =
        '<circle cx="238" cy="78" r="66" fill="url(#' + g + 'r)"/>' +
        '<path d="M0 226c40-16 66-58 96-58 26 0 30 18 46 18 18 0 26-26 46-26 22 0 30 24 46 24 20 0 30-18 46-18 18 0 34 26 40 44v30H0z" fill="#080a16" opacity=".9"/>' +
        '<path d="M150 214c0-42 26-70 62-70 34 0 54 20 62 44 6 18 0 30-12 34-14 4-28-4-38-14-8-8-18-12-28-10-16 4-24 18-30 34-3 8-7 12-12 12-2 0-4-1-4-4z" fill="#0a0d1c"/>' +
        '<circle cx="204" cy="168" r="4.6" fill="#ffb0c4"/><circle cx="242" cy="164" r="4.6" fill="#ffb0c4"/>' +
        '<circle cx="204" cy="168" r="10" fill="#ffb0c4" opacity=".22"/><circle cx="242" cy="164" r="10" fill="#ffb0c4" opacity=".22"/>' +
        '<g fill="#f4e6c8" opacity=".75">' +
        '<path d="M96 206c-8-16-2-28 8-28 8 0 12 8 10 16l-4 12z"/><circle cx="104" cy="174" r="6"/>' +
        '<path d="M134 212c-6-14 0-24 8-24 7 0 10 7 8 14l-3 10z"/><circle cx="141" cy="184" r="5"/>' +
        '</g>' +
        '<g stroke="#ffd6e0" stroke-width="2" fill="none" opacity=".35"><path d="M268 132c18 4 30 16 34 32"/><path d="M286 198c14 10 18 24 14 38"/></g>';
    } else if (kind === 'koi') {
      body =
        '<circle cx="160" cy="72" r="58" fill="url(#' + g + 'r)"/>' +
        '<ellipse cx="160" cy="72" rx="24" ry="24" fill="#fdf0d4" opacity=".35"/>' +
        '<g opacity=".95">' +
        '<path d="M52 132c40-30 96-26 124 10 16 20 8 36-14 42-30 8-62-4-84-24-12-10-22-20-26-28z" fill="#f0a382"/>' +
        '<path d="M176 146c18-14 36-16 46-10-12 8-16 18-14 28-10 0-24-6-32-18z" fill="#f6c3a6"/>' +
        '<circle cx="80" cy="132" r="4" fill="#3a1c16"/>' +
        '<path d="M108 118c14 6 24 18 28 32" stroke="#ffe6cf" stroke-width="3" fill="none" opacity=".55"/>' +
        '<path d="M234 190c34-20 74-16 94 6 10 12 2 24-14 26-24 4-48-4-64-16-8-6-14-12-16-16z" fill="#e8b98f" opacity=".85"/>' +
        '<path d="M328 196c14-10 26-10 32-6-8 6-10 12-8 18-8 0-18-4-24-12z" fill="#f6c3a6" opacity=".8"/>' +
        '<circle cx="256" cy="192" r="3.4" fill="#3a1c16"/>' +
        '</g>' +
        '<g fill="none" stroke="#eafff7" opacity=".35"><circle cx="196" cy="96" r="5"/><circle cx="210" cy="80" r="3.4"/><circle cx="214" cy="102" r="2.4"/><circle cx="98" cy="180" r="4"/><circle cx="86" cy="196" r="2.6"/></g>' +
        '<g stroke="#a9dccf" fill="none" opacity=".18"><ellipse cx="160" cy="222" rx="120" ry="9"/><ellipse cx="246" cy="234" rx="80" ry="6"/></g>';
    } else if (kind === 'group') {
      body =
        '<circle cx="252" cy="62" r="62" fill="url(#' + g + 'r)"/>' +
        '<circle cx="252" cy="62" r="19" fill="#fdf0d6" opacity=".6"/>' +
        '<path d="M0 196c52-18 84 2 126-6 44-8 66 6 104 2 34-4 60-6 90 6v42H0z" fill="#06241f" opacity=".9"/>' +
        '<g stroke="#bfe6da" fill="none" opacity=".14"><ellipse cx="160" cy="222" rx="140" ry="7"/><ellipse cx="96" cy="236" rx="80" ry="5"/></g>';
      var people = [
        { x: 66, y: 208, s: 0.92, lantern: false },
        { x: 116, y: 196, s: 1.12, lantern: true },
        { x: 166, y: 206, s: 0.98, lantern: false },
        { x: 220, y: 192, s: 1.2, lantern: false },
        { x: 276, y: 204, s: 0.9, lantern: true }
      ];
      for (var i = 0; i < people.length; i++) {
        var p2 = people[i];
        body += '<g transform="translate(' + p2.x + ' ' + p2.y + ') scale(' + p2.s + ')">' +
          '<path d="M-15 20c0-19 7-30 15-30s15 11 15 30c-8 4-22 4-30 0z" fill="#0a3833"/>' +
          '<path d="M-9 20c0-12 4-18 9-18s9 6 9 18z" fill="#0f4a42" opacity=".7"/>' +
          '<circle cx="0" cy="-19" r="9" fill="#f3ddc0"/>' +
          '<path d="M-10-24c2-9 18-9 20 0-5 4-15 4-20 0z" fill="#0b2b28"/>' +
          (p2.lantern
            ? '<circle cx="11" cy="-2" r="12" fill="#ffd9a0" opacity=".18"/>' +
              '<circle cx="11" cy="-2" r="3.6" fill="#ffe3b4"/>' +
              '<path d="M11 1.6v6" stroke="#e0b784" stroke-width="1.2"/>'
            : '') +
          '</g>';
      }
      body +=
        '<g fill="#ffdfa6"><circle cx="50" cy="104" r="2"/><circle cx="92" cy="76" r="1.6"/><circle cx="148" cy="94" r="1.8"/><circle cx="210" cy="62" r="1.5"/><circle cx="300" cy="108" r="2.1"/><circle cx="330" cy="74" r="1.4"/><circle cx="128" cy="150" r="1.6"/></g>';
    } else if (kind === 'firefly') {
      body =
        '<path d="M0 150c48-18 70-46 110-46 32 0 42 22 66 22 26 0 34-30 62-30 30 0 40 30 62 30 28 0 40-16 80-6v80H0z" fill="#041a18" opacity=".85"/>' +
        '<g stroke="#0d3f34" stroke-width="2" fill="none" opacity=".8"><path d="M28 240c4-40 0-70-8-96"/><path d="M300 240c-2-34 4-58 14-76"/></g>';
      var dots = [[60, 120], [92, 86], [130, 132], [168, 74], [204, 118], [238, 90], [276, 132], [312, 78], [346, 108], [120, 176], [250, 168], [188, 202], [300, 190], [76, 200]];
      for (var j = 0; j < dots.length; j++) {
        var op = (0.5 + (j % 4) * 0.13).toFixed(2);
        body +=
          '<circle cx="' + dots[j][0] + '" cy="' + dots[j][1] + '" r="9" fill="#ffe9a8" opacity="' + (op * 0.22).toFixed(2) + '"/>' +
          '<circle cx="' + dots[j][0] + '" cy="' + dots[j][1] + '" r="2.4" fill="#fff6d2" opacity="' + op + '"/>';
      }
      body +=
        '<g transform="translate(180 196)" opacity=".9"><ellipse cx="0" cy="12" rx="40" ry="10" fill="#072e29"/><g fill="url(#' + g + 'p)"><ellipse cx="0" cy="-8" rx="5" ry="14"/><ellipse cx="-10" cy="-2" rx="4.4" ry="12" transform="rotate(-34 -10 -2)"/><ellipse cx="10" cy="-2" rx="4.4" ry="12" transform="rotate(34 10 -2)"/></g><circle cx="0" cy="-6" r="3.6" fill="#f6d99f"/></g>';
    } else if (kind === 'lantern') {
      body =
        '<circle cx="92" cy="62" r="52" fill="url(#' + g + 'r)"/>' +
        '<g opacity=".9"><path d="M0 172c40-10 70 6 110 0 44-6 68 8 110 2 38-6 70-2 100 4v62H0z" fill="#0b3438"/></g>' +
        '<g transform="translate(214 168)">' +
        '<circle cx="0" cy="0" r="58" fill="#ffd9c0" opacity=".16"/>' +
        '<path d="M-26 6c0-20 12-32 26-32s26 12 26 32-12 30-26 30S-26 26-26 6z" fill="#ffb9a1" opacity=".92"/>' +
        '<path d="M-26 6c0-20 12-32 26-32s26 12 26 32z" fill="#ffe3cd" opacity=".7"/>' +
        '<circle cx="0" cy="4" r="9" fill="#fff3da"/>' +
        '<path d="M-16 40h32l-5 8h-22z" fill="#e8a48d"/>' +
        '</g>' +
        '<ellipse cx="214" cy="240" rx="34" ry="7" fill="#ffd9c0" opacity=".25"/>' +
        '<g fill="#ffd9c0" opacity=".5"><circle cx="150" cy="196" r="2"/><circle cx="272" cy="206" r="2.2"/><circle cx="286" cy="182" r="1.6"/></g>' +
        '<g stroke="#bfe6da" fill="none" opacity=".18"><ellipse cx="160" cy="222" rx="120" ry="7"/><ellipse cx="250" cy="236" rx="70" ry="5"/></g>';
    } else if (kind === 'reed') {
      body =
        '<circle cx="238" cy="72" r="80" fill="url(#' + g + 'r)"/>' +
        '<circle cx="238" cy="72" r="18" fill="#ffe9c2" opacity=".55"/>' +
        '<path d="M0 170c50-28 84-14 122-22 32-7 54-2 82 4 40 8 66-10 116-4v92H0z" fill="#0a2b30" opacity=".9"/>' +
        '<g stroke="#123c3c" stroke-width="3" fill="none">' +
        '<path d="M40 240c-2-46 4-78 16-104"/><path d="M66 240c4-40 14-68 30-88"/><path d="M96 240c-4-34 2-60 12-80"/>' +
        '<path d="M278 240c-2-40 6-72 20-94"/><path d="M306 240c2-34 12-58 26-74"/>' +
        '</g>' +
        '<g fill="#123c3c">' +
        '<ellipse cx="55" cy="128" rx="4" ry="12" transform="rotate(10 55 128)"/>' +
        '<ellipse cx="97" cy="150" rx="3.6" ry="10" transform="rotate(14 97 150)"/>' +
        '<ellipse cx="298" cy="136" rx="4" ry="12" transform="rotate(16 298 136)"/>' +
        '<ellipse cx="332" cy="158" rx="3.4" ry="10" transform="rotate(20 332 158)"/>' +
        '</g>' +
        '<g stroke="#f7d9a4" fill="none" opacity=".2"><ellipse cx="180" cy="212" rx="130" ry="8"/><ellipse cx="90" cy="230" rx="80" ry="6"/></g>';
    } else {
      /* wave */
      body =
        '<circle cx="252" cy="64" r="66" fill="url(#' + g + 'r)"/>' +
        '<circle cx="252" cy="64" r="16" fill="#f4f7e8" opacity=".6"/>' +
        '<path d="M0 150c50 22 82-6 122-18 44-13 62 12 100 24 30 9 50 4 98-10v94H0z" fill="#0b4247" opacity=".9"/>' +
        '<path d="M0 150c44 10 68-24 108-26 40-2 58 24 96 30 34 6 56-4 116-4v44c-56-8-84 6-116 2-36-4-56-22-96-20-40 2-64 24-108 12z" fill="url(#' + g + 'w)"/>' +
        '<g fill="#dff7ec" opacity=".8"><circle cx="86" cy="132" r="2.4"/><circle cx="104" cy="122" r="1.8"/><circle cx="126" cy="128" r="1.4"/><circle cx="180" cy="146" r="2"/><circle cx="204" cy="136" r="1.6"/></g>' +
        '<g stroke="#cdeee1" fill="none" opacity=".22"><path d="M22 196c30-10 52-2 74 0"/><path d="M122 214c34-10 62 0 92 2"/><path d="M240 190c28-8 48 0 66 2"/></g>';
    }

    return (
      '<svg class="scene" viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
      defs +
      '<rect width="320" height="240" fill="url(#' + g + 's)"/>' +
      body +
      '<rect y="120" width="320" height="120" fill="url(#' + g + 'w)" opacity=".25"/>' +
      '</svg>'
    );
  }

  /* ---------- 배경 물결 장식 ---------- */
  function ripple() {
    return (
      '<svg class="ripple" viewBox="0 0 600 600" aria-hidden="true" focusable="false">' +
      '<g fill="none" stroke="#7fd1bd" stroke-width="1">' +
      '<circle cx="300" cy="300" r="120" opacity=".14"/>' +
      '<circle cx="300" cy="300" r="200" opacity=".1"/>' +
      '<circle cx="300" cy="300" r="290" opacity=".07"/>' +
      '<circle cx="300" cy="300" r="380" opacity=".05"/>' +
      '</g></svg>'
    );
  }

  window.YM_ART = {
    mark: mark,
    hero: hero,
    scene: scene,
    ripple: ripple
  };
})();
