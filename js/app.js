/* 연못문파 — 도깨비의 세계
 * 프로토타입 앱 로직 (서버 없음 · 모든 데이터는 이 기기에만)
 */
(function () {
  'use strict';

  var D = window.YM_DATA;
  var ART = window.YM_ART;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var AVATARS = [
    'linear-gradient(145deg,#a9e3d1,#4f9f8c)',
    'linear-gradient(145deg,#ffd7e2,#d98aa5)',
    'linear-gradient(145deg,#f0d9a5,#b9974f)',
    'linear-gradient(145deg,#b8d6e8,#5b8fa8)',
    'linear-gradient(145deg,#cfe6c0,#7aa86f)',
    'linear-gradient(145deg,#e6d0ea,#9a7bb0)'
  ];
  var ROLE_CLASS = {
    '문주': 'role--master',
    '부문주': 'role--vice',
    '장로': 'role--elder',
    '정예': 'role--elite',
    '문파원': ''
  };
  var CATEGORY = {
    '전체': null,
    '풍경': ['moon', 'firefly', 'reed'],
    '사냥': ['koi', 'wave'],
    '보스': ['boss'],
    '일상': ['group', 'lantern']
  };

  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem('ym.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { window.localStorage.setItem('ym.' + key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    },
    remove: function (key) {
      try { window.localStorage.removeItem('ym.' + key); } catch (e) { /* noop */ }
    }
  };

  var S = {
    user: null,
    tab: 'home',
    chat: [],
    category: '전체',
    memberFilter: 'all',
    query: '',
    likes: {},
    attendance: null,
    installEvent: null,
    firstSendNoted: false
  };

  /* ---------------- 유틸 ---------------- */
  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) % 9973; }
    return h;
  }
  function avatarStyle(name) { return AVATARS[hash(name) % AVATARS.length]; }
  function initial(name) { return String(name).trim().charAt(0) || '연'; }

  function dayStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }
  function dayKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }
  function addDays(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }
  function nextWeekday(dow, hour, minute) {
    var now = new Date();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    var diff = (dow - target.getDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= now.getTime()) { diff = 7; }
    target.setDate(target.getDate() + diff);
    return target;
  }
  function eventDate(ev) {
    if (ev.type === 'weekly') { return nextWeekday(ev.weekday, ev.hour, ev.minute); }
    var d = addDays(ev.days || 0);
    d.setHours(ev.hour, ev.minute, 0, 0);
    return d;
  }
  function ddayOf(date) {
    var diff = Math.round((dayStart(date) - dayStart(new Date())) / 86400000);
    if (diff <= 0) { return '오늘'; }
    if (diff === 1) { return '내일'; }
    return 'D-' + diff;
  }
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function relDay(daysAgo) {
    var d = addDays(-daysAgo);
    return (d.getMonth() + 1) + '.' + d.getDate();
  }

  /* ---------------- 토스트 / 모달 ---------------- */
  var toastTimer = null;
  function toast(message) {
    var el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    window.requestAnimationFrame(function () { el.classList.add('is-show'); });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.classList.remove('is-show');
      window.setTimeout(function () { el.hidden = true; }, 260);
    }, 2400);
  }

  function openModal(html) {
    var modal = $('#modal');
    $('#modal-body').innerHTML = html;
    modal.hidden = false;
    document.body.classList.add('is-locked');
    var panel = $('.modal__panel', modal);
    window.setTimeout(function () { panel.focus(); }, 30);
  }
  function closeModal() {
    var modal = $('#modal');
    if (modal.hidden) { return; }
    modal.hidden = true;
    $('#modal-body').innerHTML = '';
    document.body.classList.remove('is-locked');
  }

  /* ---------------- 배경 반딧불 ---------------- */
  function buildFireflies() {
    var host = $('#fireflies');
    if (!host) { return; }
    var html = '';
    for (var i = 0; i < 26; i++) {
      var left = (Math.random() * 100).toFixed(2);
      var top = (Math.random() * 100).toFixed(2);
      var delay = (Math.random() * 7).toFixed(2);
      var dur = (5 + Math.random() * 6).toFixed(2);
      var size = (2 + Math.random() * 2.4).toFixed(1);
      html += '<span style="left:' + left + '%;top:' + top + '%;width:' + size + 'px;height:' + size +
        'px;animation-delay:' + delay + 's;animation-duration:' + dur + 's"></span>';
    }
    host.innerHTML = html;
  }

  /* ---------------- 시작 ---------------- */
  function init() {
    buildFireflies();
    $('#auth-art').innerHTML = ART.hero();
    $('#auth-mark').innerHTML = ART.mark(40);
    $('#topbar-mark').innerHTML = ART.mark(32);

    bindAuth();
    bindTabs();
    bindChat();
    bindGlobal();
    bindInstall();

    var settings = store.get('settings', null);
    if (settings && settings.theme === 'moon') { document.documentElement.setAttribute('data-theme', 'moon'); }

    S.likes = store.get('likes', {}) || {};
    S.attendance = store.get('attendance', null);

    var session = store.get('session', null);
    if (session && session.nick) {
      enterApp(false, session.nick, guestFromSession(session), session.since);
    }
  }

  /* ---------------- 로그인 / 가입 ---------------- */
  function bindAuth() {
    var segLogin = $('#seg-login');
    var segSignup = $('#seg-signup');

    segLogin.addEventListener('click', function () { switchAuth('login'); });
    segSignup.addEventListener('click', function () { switchAuth('signup'); });

    $('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = $('#login-nick').value.trim();
      var pin = $('#login-pin').value.trim();
      var code = $('#login-code').value.trim().toUpperCase();

      var problem = validateNick(nick) || validatePin(pin) || validateCode(code);
      showError('login-error', problem, ['#login-nick', '#login-pin', '#login-code']);
      if (problem) { return; }

      enterApp(true, nick, false);
      toast(nick + ' 님, 다시 오셨네요 🪷');
    });

    $('#signup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = $('#signup-nick').value.trim();
      var pin = $('#signup-pin').value.trim();
      var pin2 = $('#signup-pin2').value.trim();
      var code = $('#signup-code').value.trim().toUpperCase();

      var problem = validateNick(nick) || validatePin(pin) || validateCode(code);
      if (!problem && pin !== pin2) { problem = 'PIN이 서로 달라요. 같은 숫자를 두 번 입력해 주세요.'; }
      showError('signup-error', problem, ['#signup-nick', '#signup-pin', '#signup-pin2', '#signup-code']);
      if (problem) { return; }

      enterApp(true, nick, false);
      toast('연못문파에 오신 것을 환영해요, ' + nick + ' 님 🪷');
    });

    $('#trial-btn').addEventListener('click', function () {
      enterApp(true, '연못손님', true);
      toast('체험 모드예요. 편하게 둘러보세요 🌿');
    });
  }

  function switchAuth(mode) {
    var isLogin = mode === 'login';
    $('#seg-login').classList.toggle('is-active', isLogin);
    $('#seg-signup').classList.toggle('is-active', !isLogin);
    $('#seg-login').setAttribute('aria-selected', String(isLogin));
    $('#seg-signup').setAttribute('aria-selected', String(!isLogin));
    $('#login-form').hidden = !isLogin;
    $('#signup-form').hidden = isLogin;
    showError('login-error', '', []);
    showError('signup-error', '', []);
  }

  function validateNick(nick) {
    if (!nick) { return '닉네임을 입력해 주세요.'; }
    if (!/^[가-힣a-zA-Z0-9_]{2,10}$/.test(nick)) {
      return '닉네임은 한글·영문·숫자 2~10자로 정해주세요.';
    }
    return '';
  }
  function validatePin(pin) {
    if (!/^\d{4}$/.test(pin)) { return 'PIN은 숫자 4자리로 입력해 주세요.'; }
    return '';
  }
  function validateCode(code) {
    if (!code) { return '초대 코드를 입력해 주세요.'; }
    if (['YEONMOT', '연못', '연못문파'].indexOf(code) === -1) {
      return '초대 코드가 맞지 않아요. 운영진에게 확인해 주세요. (체험용 코드: YEONMOT)';
    }
    return '';
  }
  function showError(id, message, fields) {
    var el = $('#' + id);
    if (!el) { return; }
    el.textContent = message || '';
    el.hidden = !message;
    fields.forEach(function (sel) {
      var input = $(sel);
      if (!input) { return; }
      if (message) { input.setAttribute('aria-invalid', 'true'); }
      else { input.removeAttribute('aria-invalid'); }
    });
  }

  function guestFromSession(session) {
    return !!(session && session.guest);
  }

  function enterApp(save, nick, guest, since) {
    S.user = {
      nick: nick,
      guest: !!guest,
      since: since || new Date().toISOString()
    };
    if (save) { store.set('session', S.user); }

    $('#auth-view').hidden = true;
    $('#main-view').hidden = false;

    renderHome();
    renderChat();
    renderAlbum();
    renderMembers();
    renderMe();
    updateTopbar();
    switchTab('home', true);
  }

  function logout() {
    S.user = null;
    store.remove('session');
    closeModal();
    $('#main-view').hidden = true;
    $('#auth-view').hidden = false;
    $('#login-pin').value = '';
    $('#signup-form').reset();
    window.scrollTo(0, 0);
    $('#auth-view').scrollTop = 0;
    toast('연못을 잠시 떠났어요. 다시 오시길 기다릴게요.');
  }

  /* ---------------- 탭 ---------------- */
  function bindTabs() {
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  function switchTab(tab, silent) {
    S.tab = tab;
    $$('.tab').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('is-active', on);
      if (on) { btn.setAttribute('aria-current', 'page'); }
      else { btn.removeAttribute('aria-current'); }
    });
    $$('.screen').forEach(function (screen) {
      screen.classList.toggle('is-active', screen.getAttribute('data-screen') === tab);
    });
    var active = $('#screen-' + tab);
    if (active) { active.scrollTop = 0; }
    if (tab === 'chat') {
      window.requestAnimationFrame(function () { scrollChat(false); });
    }
    if (!silent) {
      if (tab === 'home') { updateTopbar(); }
      if (tab === 'members') { renderMembers(); }
    }
  }

  function updateTopbar() {
    var el = $('#topbar-online');
    if (!el) { return; }
    var online = membersAll().filter(function (m) { return m.status === 'on'; }).length;
    el.textContent = online + '명 접속';
  }

  /* ---------------- 홈 ---------------- */
  function renderHome() {
    var g = D.guild;
    var attendance = attendanceState();
    var html = '';

    html += '<header class="screen__head">' +
      '<p class="kicker">' + esc(g.game) + '</p>' +
      '<h2 class="screen__title">연못문파</h2>' +
      '<p class="screen__sub">' + esc(g.motto) + '</p>' +
      '</header>';

    html += '<section class="hero" aria-label="연못문파 배너">' + ART.hero() +
      '<div class="hero__pills">' +
      '<span class="pill pill--gold">문파 레벨 ' + g.level + '</span>' +
      '<span class="pill">문파원 ' + g.members + ' / ' + g.capacity + '</span>' +
      '</div>' +
      '<div class="hero__overlay">' +
      '<div class="hero__caption"><strong>연못문파</strong><span>오늘도 고요한 연못에 물결을 남겨요</span></div>' +
      '<button type="button" class="wave-btn' + (attendance.done ? ' is-done' : '') + '" id="wave-btn"' +
      (attendance.done ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      '<span class="wave-btn__ring" aria-hidden="true"></span>' +
      '<span id="wave-label">' + attendanceLabel(attendance) + '</span>' +
      '</button>' +
      '</div></section>';

    html += '<div class="stats">' +
      '<div class="stat"><strong>' + fmtNum(g.weeklyContribution) + '</strong><span>이번 주 기여도</span></div>' +
      '<div class="stat"><strong>' + g.weeklyAttendance + '명</strong><span>이번 주 출석</span></div>' +
      '<div class="stat"><strong>+' + g.newMembers + '</strong><span>새 문파원</span></div>' +
      '</div>';

    /* 공지 */
    html += '<section class="section" aria-labelledby="home-notice-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-notice-title">공지</h3>' +
      '<span class="section__more">' + D.notices.length + '개</span></div>';
    D.notices.forEach(function (n, i) {
      var open = i === 0;
      var body = '';
      n.body.forEach(function (p) { body += '<p>' + esc(p) + '</p>'; });
      html += '<article class="notice' + (open ? ' is-open' : '') + '">' +
        '<button type="button" class="notice__head" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="notice-body-' + n.id + '">' +
        '<span class="notice__pin" aria-hidden="true">' +
        (n.pinned
          ? '<svg viewBox="0 0 16 16" width="13" height="13" focusable="false"><path d="M5.2 1.6 10.8 7.2 9 9l2 4-4-2-1.8 1.8L1.5 7.3 5.2 1.6z" fill="currentColor" opacity=".85"/></svg>'
          : '<svg viewBox="0 0 16 16" width="13" height="13" focusable="false"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".55"/><circle cx="8" cy="8" r="2" fill="currentColor" opacity=".7"/></svg>') +
        '</span>' +
        '<span class="notice__main">' +
        '<span class="notice__title">' +
        (n.pinned ? '<span class="badge">고정</span>' : '') +
        '<span class="badge badge--jade">' + esc(n.tag) + '</span>' +
        esc(n.title) +
        '</span>' +
        '<span class="notice__meta">' + esc(n.author) + ' · ' + esc(n.role) + ' · ' + relDay(n.daysAgo) + '</span>' +
        '<span class="notice__summary">' + esc(n.summary) + '</span>' +
        '</span>' +
        '<span class="notice__chevron" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span></button>' +
        '<div class="notice__body" id="notice-body-' + n.id + '">' + body + '</div>' +
        '</article>';
    });
    html += '</section>';

    /* 일정 */
    html += '<section class="section" aria-labelledby="home-event-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-event-title">모임 일정</h3>' +
      '<span class="section__more">다가오는 일정</span></div><div class="events">';
    D.events.forEach(function (ev) {
      var date = eventDate(ev);
      var dd = ddayOf(date);
      html += '<article class="event">' +
        '<div class="event__date"><span class="event__d">' + date.getDate() + '</span>' +
        '<span class="event__m">' + (date.getMonth() + 1) + '월 · ' + WEEKDAYS[date.getDay()] + '</span></div>' +
        '<div class="event__info"><div class="event__title">' + esc(ev.title) + '</div>' +
        '<div class="event__meta"><span>' + pad(ev.hour) + ':' + pad(ev.minute) + '</span><span>·</span><span>' + esc(ev.place) + '</span></div>' +
        '<div class="event__meta"><span>' + esc(ev.note) + '</span></div></div>' +
        '<span class="event__dday' + (dd === '오늘' || dd === '내일' ? ' is-soon' : '') + '">' + dd + '</span>' +
        '</article>';
    });
    html += '</div></section>';

    /* 쿠폰 */
    html += '<section class="section" aria-labelledby="home-coupon-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-coupon-title">도깨비의 세계 쿠폰</h3>' +
      '<span class="section__more">옆으로 넘겨보세요</span></div>' +
      '<div class="coupons">';
    D.coupons.forEach(function (c) {
      html += '<article class="coupon">' +
        '<div class="coupon__head"><span class="coupon__title">' + esc(c.title) + '</span>' +
        '<span class="badge badge--lotus">' + esc(c.until) + '까지</span></div>' +
        '<p class="coupon__reward">' + esc(c.reward) + '</p>' +
        '<div class="coupon__code"><span>' + esc(c.code) + '</span>' +
        '<button type="button" class="coupon__copy" data-copy="' + esc(c.code) + '">복사</button></div>' +
        '<p class="coupon__until">게임 내 쿠폰 등록창에 입력해 보세요</p>' +
        '</article>';
    });
    html += '</div><p class="section__note">프로토타입용 예시 쿠폰이에요. 실제 게임에서 쓰이는 코드가 아닙니다.</p></section>';

    /* 사냥 팁 */
    html += '<section class="section" aria-labelledby="home-tip-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-tip-title">사냥 팁</h3>' +
      '<span class="section__more">문파원 공유</span></div><div class="tips">';
    D.tips.forEach(function (t, i) {
      html += '<div class="tip"><span class="tip__num">' + (i + 1) + '</span>' +
        '<div><p class="tip__title">' + esc(t.title) + '</p>' +
        '<p class="tip__text">' + esc(t.text) + '</p></div></div>';
    });
    html += '</div></section>';

    html += '<section class="section"><div class="privacy"><strong>이 앱에 대해</strong>' +
      '<p>연못문파를 위한 작은 커뮤니티 앱 프로토타입이에요. 공지·일정·쿠폰·앨범·대화는 체험용 예시로 채워져 있습니다.</p>' +
      '<p>이름·전화번호·이메일은 받지 않고, 입력한 닉네임과 기록은 이 기기에만 저장돼요.</p></div></section>';

    $('#home-body').innerHTML = html;

    var waveBtn = $('#wave-btn');
    if (waveBtn) {
      waveBtn.addEventListener('click', function () {
        waveBtn.classList.add('is-pulsing');
        window.setTimeout(function () { waveBtn.classList.remove('is-pulsing'); }, 950);
        markAttendance(waveBtn);
      });
    }

    $$('.notice__head', $('#home-body')).forEach(function (head) {
      head.addEventListener('click', function () {
        var card = head.parentNode;
        var open = card.classList.toggle('is-open');
        head.setAttribute('aria-expanded', String(open));
      });
    });

    $$('[data-copy]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyText(btn.getAttribute('data-copy'));
      });
    });
  }

  function attendanceState() {
    var saved = store.get('attendance', null);
    var today = dayKey(new Date());
    if (saved && saved.date === today) {
      return { done: true, streak: saved.streak || 1 };
    }
    return { done: false, streak: saved ? (saved.streak || 0) : 0 };
  }
  function attendanceLabel(state) {
    if (state.done) { return '오늘의 물결 · ' + state.streak + '일째'; }
    return '오늘의 물결 남기기';
  }
  function markAttendance(btn) {
    var state = attendanceState();
    if (state.done) {
      toast('오늘은 이미 물결을 남기셨어요 · ' + state.streak + '일 연속');
      return;
    }
    var prev = store.get('attendance', null);
    var yesterday = dayKey(addDays(-1));
    var streak = prev && prev.date === yesterday ? (prev.streak || 1) + 1 : 1;
    store.set('attendance', { date: dayKey(new Date()), streak: streak });
    btn.classList.add('is-done');
    btn.setAttribute('aria-pressed', 'true');
    var label = $('#wave-label', btn);
    if (label) { label.textContent = attendanceLabel({ done: true, streak: streak }); }
    toast(streak > 1 ? '물결을 남겼어요 · ' + streak + '일 연속 🪷' : '오늘의 첫 물결을 남겼어요 🪷');
  }

  function copyText(text) {
    var done = function () { toast('쿠폰 코드 ' + text + ' 를 복사했어요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('복사가 안 되면 코드를 길게 눌러 선택해 주세요: ' + text); }
    document.body.removeChild(ta);
  }

  /* ---------------- 채팅 ---------------- */
  function chatTime(ts) {
    var d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function loadChat() {
    var saved = store.get('chat', null);
    if (saved && saved.length) { return saved; }
    var now = Date.now();
    var seeded = D.chatSeed.map(function (m, i) {
      return {
        id: 'seed-' + i,
        name: m.system ? '' : m.name,
        role: m.role || '',
        text: m.text,
        ts: m.system ? now - 1000 * 60 * 180 : now - 1000 * 60 * (m.minutesAgo || 0),
        system: !!m.system,
        mine: false
      };
    });
    store.set('chat', seeded);
    return seeded;
  }

  function bindChat() {
    var form = $('#composer');
    var input = $('#chat-input');
    var chips = $('#chat-chips');

    D.quickChat.forEach(function (text) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = text;
      btn.addEventListener('click', function () {
        sendChat(text);
      });
      chips.appendChild(btn);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendChat(input.value);
    });

    input.addEventListener('input', function () {
      $('#chat-send').disabled = input.value.trim().length === 0;
    });
    $('#chat-send').disabled = true;
  }

  function sendChat(raw) {
    var text = String(raw || '').trim().slice(0, 200);
    if (!text) { return; }
    var msg = {
      id: 'm-' + Date.now(),
      name: S.user ? S.user.nick : '연못손님',
      role: S.user && S.user.guest ? '체험' : '문파원',
      text: text,
      ts: Date.now(),
      mine: true
    };
    S.chat.push(msg);
    store.set('chat', S.chat);

    if (!S.firstSendNoted && !store.get('firstSendNoted', false)) {
      S.chat.push({
        id: 'sys-' + Date.now(),
        system: true,
        text: '체험 모드 안내 · 지금 보낸 메시지는 이 기기에만 남고 다른 문파원에게는 전달되지 않아요.',
        ts: Date.now() + 1,
        mine: false
      });
      store.set('chat', S.chat);
      store.set('firstSendNoted', true);
      S.firstSendNoted = true;
    }

    renderChat();
    $('#chat-input').value = '';
    $('#chat-send').disabled = true;
    scrollChat(true);
  }

  function scrollChat(smooth) {
    var list = $('#chat-list');
    if (!list) { return; }
    window.requestAnimationFrame(function () {
      if (smooth && list.scrollTo) {
        list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
      } else {
        list.scrollTop = list.scrollHeight;
      }
    });
  }

  function renderChat() {
    if (!S.chat.length) { S.chat = loadChat(); }
    var list = $('#chat-list');
    var html = '';
    S.chat.forEach(function (m) {
      if (m.system) {
        html += '<div class="msg--system">' + esc(m.text) + '</div>';
        return;
      }
      html += '<div class="msg' + (m.mine ? ' msg--mine' : '') + '">' +
        '<span class="msg__avatar" style="background:' + avatarStyle(m.name) + '" aria-hidden="true">' + esc(initial(m.name)) + '</span>' +
        '<div class="msg__col">' +
        '<div class="msg__who"><span>' + esc(m.mine ? '나' : m.name) + '</span>' +
        (m.role ? '<span class="msg__role">' + esc(m.role) + '</span>' : '') +
        '</div>' +
        '<div class="msg__bubble">' + esc(m.text) + '</div>' +
        '<div class="msg__time">' + chatTime(m.ts) + '</div>' +
        '</div></div>';
    });
    list.innerHTML = html;
    scrollChat(false);
  }

  /* ---------------- 앨범 ---------------- */
  function albumLikes(item) {
    var liked = !!S.likes[item.id];
    return { liked: liked, count: item.likes + (liked ? 1 : 0) };
  }

  function renderAlbum() {
    var html = '<header class="screen__head">' +
      '<p class="kicker">문파앨범</p>' +
      '<h2 class="screen__title">연못에 남긴 장면들</h2>' +
      '<p class="screen__sub">스크린샷과 추억을 함께 모아두는 곳이에요</p>' +
      '</header>';

    html += '<div class="filters" role="group" aria-label="앨범 분류">';
    Object.keys(CATEGORY).forEach(function (name) {
      html += '<button type="button" class="chip' + (S.category === name ? ' is-active' : '') +
        '" data-category="' + esc(name) + '" aria-pressed="' + (S.category === name) + '">' + esc(name) + '</button>';
    });
    html += '</div>';

    var allowed = CATEGORY[S.category];
    var items = D.album.filter(function (item) {
      return !allowed || allowed.indexOf(item.kind) !== -1;
    });

    html += '<div class="gallery">';
    if (!items.length) {
      html += '<div class="empty" style="grid-column:1/-1">아직 이 분류의 장면이 없어요.</div>';
    }
    items.forEach(function (item) {
      var like = albumLikes(item);
      html += '<button type="button" class="shot" data-shot="' + esc(item.id) + '" aria-label="' + esc(item.title) + ' 크게 보기">' +
        '<span class="shot__art">' + ART.scene(item.kind) + '</span>' +
        (relDay(item.daysAgo) === relDay(0) ? '<span class="shot__new">NEW</span>' : '') +
        '<span class="shot__meta">' +
        '<span class="shot__title">' + esc(item.title) + '</span>' +
        '<span class="shot__sub"><span>' + esc(item.author) + '</span>' +
        '<span class="shot__like" data-like-count="' + esc(item.id) + '">' +
        heartSvg(like.liked) + ' ' + like.count + '</span></span>' +
        '</span></button>';
    });
    html += '</div>';

    html += '<div class="section"><button type="button" class="btn btn--ghost" id="upload-btn">스크린샷 올리기</button>' +
      '<p class="section__note">프로토타입에서는 실제 사진 업로드가 열려 있지 않아요. 정식 버전에서 문파원 모두가 올릴 수 있게 붙일 예정입니다.</p></div>';

    $('#album-body').innerHTML = html;

    $$('[data-category]', $('#album-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.category = btn.getAttribute('data-category');
        renderAlbum();
      });
    });
    $$('[data-shot]', $('#album-body')).forEach(function (btn) {
      btn.addEventListener('click', function () { openLightbox(btn.getAttribute('data-shot')); });
    });
    var upload = $('#upload-btn');
    if (upload) {
      upload.addEventListener('click', function () {
        toast('지금은 둘러보기만 열려 있어요. 정식 버전에서 올릴 수 있게 준비할게요.');
      });
    }
  }

  function heartSvg(filled) {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 14S1.8 10.2 1.8 5.9A3.4 3.4 0 0 1 8 3.6a3.4 3.4 0 0 1 6.2 2.3C14.2 10.2 8 14 8 14z" fill="' +
      (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.3"/></svg>';
  }

  function openLightbox(id) {
    var item = null;
    D.album.forEach(function (a) { if (a.id === id) { item = a; } });
    if (!item) { return; }
    var like = albumLikes(item);
    var html = '<div class="lightbox">' +
      '<div class="lightbox__art">' + ART.scene(item.kind) + '</div>' +
      '<h3 class="lightbox__title" id="modal-title">' + esc(item.title) + '</h3>' +
      '<p class="lightbox__meta">' + esc(item.author) + ' · ' + relDay(item.daysAgo) + ' · 문파앨범</p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="like-btn" id="like-btn" aria-pressed="' + like.liked + '">' +
      heartSvg(like.liked) + '<span id="like-text">물결 ' + like.count + '</span></button>' +
      '<span class="section__more">마음이 닿으면 한 번 눌러주세요</span>' +
      '</div></div>';
    openModal(html);

    var likeBtn = $('#like-btn');
    likeBtn.addEventListener('click', function () {
      S.likes[item.id] = !S.likes[item.id];
      store.set('likes', S.likes);
      var updated = albumLikes(item);
      likeBtn.setAttribute('aria-pressed', String(updated.liked));
      likeBtn.innerHTML = heartSvg(updated.liked) + '<span id="like-text">물결 ' + updated.count + '</span>';
      var counter = $('[data-like-count="' + item.id + '"]');
      if (counter) {
        counter.innerHTML = heartSvg(updated.liked) + ' ' + updated.count;
      }
    });
  }

  /* ---------------- 문파원 ---------------- */
  function membersAll() {
    var list = D.members.slice();
    if (S.user) {
      list.unshift({
        name: S.user.nick,
        role: S.user.guest ? '체험' : '신규',
        level: 0,
        status: 'on',
        last: '지금 접속 중',
        me: true
      });
    }
    return list;
  }

  function renderMembers() {
    var all = membersAll();
    var online = all.filter(function (m) { return m.status === 'on'; }).length;
    var html = '<header class="screen__head">' +
      '<p class="kicker">문파원</p>' +
      '<h2 class="screen__title">함께 있는 사람들</h2>' +
      '<p class="screen__sub">' + D.guild.members + '명의 문파원이 연못을 지키고 있어요</p>' +
      '</header>';

    html += '<div class="member-stats">' +
      '<div class="stat"><strong>' + (all.length) + '</strong><span>전체 문파원</span></div>' +
      '<div class="stat"><strong>' + online + '</strong><span>지금 접속</span></div>' +
      '<div class="stat"><strong>+' + D.guild.newMembers + '</strong><span>이번 주 새 식구</span></div>' +
      '</div>';

    html += '<div class="member-tools">' +
      '<div class="search">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.6 15.6 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
      '<input type="search" id="member-search" placeholder="닉네임으로 찾기" aria-label="문파원 닉네임 검색" value="' + esc(S.query) + '">' +
      '</div></div>';

    html += '<div class="filters" role="group" aria-label="접속 상태 필터" style="margin-left:0;margin-right:0;padding-left:0;padding-right:0">';
    [['all', '전체'], ['on', '접속 중'], ['away', '자리 비움']].forEach(function (pair) {
      html += '<button type="button" class="chip' + (S.memberFilter === pair[0] ? ' is-active' : '') +
        '" data-mfilter="' + pair[0] + '" aria-pressed="' + (S.memberFilter === pair[0]) + '">' + pair[1] + '</button>';
    });
    html += '</div>';

    var q = S.query.trim().toLowerCase();
    var rows = all.filter(function (m) {
      if (S.memberFilter !== 'all' && m.status !== S.memberFilter) { return false; }
      if (q && m.name.toLowerCase().indexOf(q) === -1) { return false; }
      return true;
    });

    html += '<div class="member-list">';
    if (!rows.length) {
      html += '<div class="empty">조건에 맞는 문파원이 없어요.</div>';
    }
    rows.forEach(function (m) {
      var statusLabel = m.status === 'on' ? '접속 중' : (m.status === 'away' ? '자리 비움' : '오프라인');
      html += '<article class="member' + (m.me ? ' member--me' : '') + '">' +
        '<span class="member__avatar" style="background:' + avatarStyle(m.name) + '" aria-hidden="true">' + esc(initial(m.name)) +
        '<span class="status status--' + (m.status === 'on' ? 'on' : (m.status === 'away' ? 'away' : 'off')) + '"></span></span>' +
        '<div class="member__info">' +
        '<div class="member__name"><span>' + esc(m.name) + '</span>' +
        (m.me ? '<span class="member__me-tag">나</span>' : '') +
        '<span class="role ' + (ROLE_CLASS[m.role] || '') + '">' + esc(m.role) + '</span></div>' +
        '<div class="member__meta"><span>' + statusLabel + '</span><span class="sep">·</span><span>' + esc(m.last) + '</span></div>' +
        '</div>' +
        '<div class="member__level">' + (m.level ? 'Lv.' + m.level : 'Lv.–') + '<span>연못 등급</span></div>' +
        '</article>';
    });
    html += '</div>';

    html += '<p class="section__note">접속 상태와 등급은 체험용 예시 데이터예요. 정식 버전에서는 게임 연동 없이 직접 관리할 수 있게 만들 예정입니다.</p>';

    $('#members-body').innerHTML = html;

    $$('[data-mfilter]', $('#members-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.memberFilter = btn.getAttribute('data-mfilter');
        renderMembers();
      });
    });
    var search = $('#member-search');
    search.addEventListener('input', function () {
      S.query = search.value;
      var pos = search.selectionStart;
      renderMembers();
      var next = $('#member-search');
      next.focus();
      try { next.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
    });
  }

  /* ---------------- 내정보 ---------------- */
  function renderMe() {
    if (!S.user) { return; }
    var settings = store.get('settings', { theme: 'pond', notify: true });
    var name = S.user.nick;
    var guest = S.user.guest;
    var since = new Date(S.user.since);
    var sinceText = since.getFullYear() + '.' + pad(since.getMonth() + 1) + '.' + pad(since.getDate());

    var html = '<header class="screen__head">' +
      '<p class="kicker">내정보</p>' +
      '<h2 class="screen__title">나의 연못</h2>' +
      '<p class="screen__sub">닉네임과 화면 설정을 이 기기에서 관리해요</p>' +
      '</header>';

    html += '<section class="profile">' +
      '<div class="profile__top">' +
      '<div class="profile__avatar" aria-hidden="true">' + esc(initial(name)) + '</div>' +
      '<div><div class="profile__name"><strong>' + esc(name) + '</strong>' +
      '<span class="role role--elite">' + (guest ? '체험 모드' : '문파원') + '</span></div>' +
      '<p class="profile__meta"><span>' + (guest ? '둘러보는 중' : '새로 합류한 문파원') + '</span><span class="sep">·</span><span>' + sinceText + '부터</span></p>' +
      '</div></div>' +
      '<div class="profile__level">' +
      '<div class="profile__level-head"><span>연못 등급 <b>Lv.' + (guest ? '1' : '12') + '</b></span><span>다음 등급까지 ' + (guest ? '12' : '240') + ' 물방울</span></div>' +
      '<div class="progress"><div class="progress__bar" style="width:' + (guest ? '8' : '64') + '%"></div></div>' +
      '</div></section>';

    html += '<div class="menu-card">' +
      '<h3 class="menu-card__title">앱으로 쓰기</h3>' +
      '<button type="button" class="row row--action" id="install-row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="row__text"><span class="row__label">홈 화면에 추가</span>' +
      '<span class="row__desc" id="install-desc">연못문파를 앱처럼 열 수 있어요</span></span>' +
      '<span class="row__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '</button>' +
      '<div class="steps" id="install-steps">' +
      '<h4>안드로이드 (크롬)</h4>' +
      '<ol><li>오른쪽 위 점 세 개를 눌러요</li><li>“앱 설치” 또는 “홈 화면에 추가”를 골라요</li><li>“설치”를 누르면 홈 화면에 생겨요</li></ol>' +
      '<h4>아이폰 (사파리)</h4>' +
      '<ol><li>아래쪽 공유 버튼을 눌러요</li><li>목록에서 “홈 화면에 추가”를 골라요</li><li>오른쪽 위 “추가”를 누르면 끝이에요</li></ol>' +
      '<p>설치하면 주소창 없이 전체 화면으로 열려요. 한 번 열어두면 연못 배경까지 그대로 기억합니다.</p>' +
      '</div>' +
      '</div>';

    html += '<div class="menu-card">' +
      '<h3 class="menu-card__title">화면과 알림</h3>' +
      '<div class="row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 14.5A2.5 2.5 0 0 1 17.5 12V9a5.5 5.5 0 1 0-11 0v3A2.5 2.5 0 0 1 4 14.5 1.5 1.5 0 0 0 4 17.5h3a5 5 0 0 0 10 0h3a1.5 1.5 0 0 0 0-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>' +
      '<span class="row__text"><span class="row__label">달빛 모드</span><span class="row__desc">연못을 조금 더 푸른 밤빛으로</span></span>' +
      '<button type="button" class="switch" id="theme-switch" role="switch" aria-checked="' + (settings.theme === 'moon') + '" aria-pressed="' + (settings.theme === 'moon') + '" aria-label="달빛 모드"></button>' +
      '</div>' +
      '<div class="row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.4 6.4l1.4 1.4M16.2 16.2l1.4 1.4M17.6 6.4l-1.4 1.4M7.8 16.2l-1.4 1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>' +
      '<span class="row__text"><span class="row__label">새 소식 알림</span><span class="row__desc">공지와 원정 시간을 알려드려요</span></span>' +
      '<button type="button" class="switch" id="notify-switch" role="switch" aria-checked="' + (settings.notify !== false) + '" aria-pressed="' + (settings.notify !== false) + '" aria-label="새 소식 알림"></button>' +
      '</div>' +
      '<button type="button" class="row row--action" id="rules-row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 4h9l4 4v12H6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 9h6M9 12.5h6M9 16h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".75"/></svg></span>' +
      '<span class="row__text"><span class="row__label">문파 생활 안내</span><span class="row__desc">서로의 속도를 존중하는 몇 가지 약속</span></span>' +
      '<span class="row__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '</button>' +
      '</div>';

    html += '<div class="privacy"><strong>개인정보를 모으지 않아요</strong>' +
      '<p>닉네임·PIN·초대 코드는 로그인 화면에서 확인용으로만 쓰고 서버로 보내지 않습니다. PIN은 저장하지 않아요.</p>' +
      '<p>대화·출석·좋아요 기록은 이 기기의 저장 공간에만 남고, 이 앱은 외부로 아무것도 전송하지 않아요.</p>' +
      '</div>';

    html += '<div class="me-actions">' +
      '<button type="button" class="btn btn--quiet" id="logout-btn">로그아웃</button>' +
      '<button type="button" class="btn btn--quiet" id="reset-btn">기록 지우기</button>' +
      '</div>';

    html += '<p class="version">연못문파 프로토타입 · v0.1</p>';

    $('#me-body').innerHTML = html;

    $('#theme-switch').addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', String(on));
      this.setAttribute('aria-checked', String(on));
      document.documentElement.setAttribute('data-theme', on ? 'moon' : 'pond');
      settings.theme = on ? 'moon' : 'pond';
      store.set('settings', settings);
      toast(on ? '달빛 모드로 바꿨어요 🌙' : '연못 모드로 돌아왔어요 🌿');
    });

    $('#notify-switch').addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', String(on));
      this.setAttribute('aria-checked', String(on));
      settings.notify = on;
      store.set('settings', settings);
      toast(on ? '알림 설정을 기억해 둘게요 (프로토타입)' : '알림 설정을 꺼 두었어요 (프로토타입)');
    });

    $('#rules-row').addEventListener('click', showRules);
    $('#install-row').addEventListener('click', function () {
      if (S.installEvent) {
        S.installEvent.prompt();
        S.installEvent = null;
        return;
      }
      var steps = $('#install-steps');
      var open = steps.classList.toggle('is-open');
      this.setAttribute('aria-expanded', String(open));
      $('#install-desc').textContent = open ? '아래 순서를 따라 눌러보세요' : '연못문파를 앱처럼 열 수 있어요';
    });

    $('#logout-btn').addEventListener('click', function () {
      openModal('<h3 class="lightbox__title" id="modal-title" style="margin-top:0">연못을 잠시 떠날까요?</h3>' +
        '<p class="lightbox__meta">언제든 다시 돌아오실 수 있어요. 저장된 기록은 이 기기에 남아 있습니다.</p>' +
        '<div class="lightbox__actions">' +
        '<button type="button" class="btn btn--primary" id="confirm-logout">로그아웃</button>' +
        '<button type="button" class="btn btn--ghost" data-close="1">머무르기</button>' +
        '</div>');
      $('#confirm-logout').addEventListener('click', logout);
    });

    $('#reset-btn').addEventListener('click', function () {
      openModal('<h3 class="lightbox__title" id="modal-title" style="margin-top:0">이 기기의 기록을 지울까요?</h3>' +
        '<p class="lightbox__meta">대화, 출석, 좋아요, 닉네임이 모두 지워집니다. 되돌릴 수 없어요.</p>' +
        '<div class="lightbox__actions">' +
        '<button type="button" class="btn btn--primary" id="confirm-reset">모두 지우기</button>' +
        '<button type="button" class="btn btn--ghost" data-close="1">그대로 두기</button>' +
        '</div>');
      $('#confirm-reset').addEventListener('click', function () {
        try {
          Object.keys(window.localStorage).forEach(function (key) {
            if (key.indexOf('ym.') === 0) { window.localStorage.removeItem(key); }
          });
        } catch (e) { /* noop */ }
        closeModal();
        S.chat = [];
        S.likes = {};
        S.attendance = null;
        S.user = null;
        document.documentElement.removeAttribute('data-theme');
        $('#main-view').hidden = true;
        $('#auth-view').hidden = false;
        toast('이 기기의 기록을 지웠어요.');
      });
    });
  }

  function showRules() {
    openModal('<h3 class="lightbox__title" id="modal-title" style="margin-top:0">문파 생활 안내</h3>' +
      '<p class="lightbox__meta">강제가 아니라, 함께 오래 머물기 위한 약속이에요.</p>' +
      '<div class="privacy" style="margin-top:14px">' +
      '<p>1. 잘 모르는 분께는 먼저 인사 한마디를 건네요.</p>' +
      '<p>2. 원정에 늦거나 못 가면 채팅방에 미리 알려요. 기다리는 사람이 있으니까요.</p>' +
      '<p>3. 스크린샷과 이야기를 공유할 때는 함께 나온 문파원의 닉네임을 한 번 살펴요.</p>' +
      '<p>4. 실명·연락처 같은 개인정보는 채팅방에 남기지 않아요.</p>' +
      '<p>5. 잠수해도 괜찮아요. 돌아왔을 때 자리가 남아 있으면 충분합니다.</p>' +
      '</div>' +
      '<div class="lightbox__actions"><button type="button" class="btn btn--ghost" data-close="1">알겠어요</button></div>');
  }

  /* ---------------- PWA 설치 ---------------- */
  function bindInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.installEvent = e;
      var desc = $('#install-desc');
      if (desc) { desc.textContent = '지금 바로 앱으로 설치할 수 있어요'; }
    });
  }

  /* ---------------- 전역 이벤트 ---------------- */
  function bindGlobal() {
    $('#modal').addEventListener('click', function (e) {
      var target = e.target;
      if (target && target.getAttribute && target.getAttribute('data-close')) {
        closeModal();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); }
    });
  }

  /* ---------------- 서비스 워커 ---------------- */
  if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is optional */ });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
