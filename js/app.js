/* 연못 — 도깨비의 세계
 * 화면 로직: 체험 모드(이 기기 안에서만)와 실제 문파 모드(Supabase)를 같은 화면 코드로 그립니다.
 *
 *  · 체험 모드 : js/data.js 의 예시 데이터 + localStorage (로그인 없이 둘러보기)
 *  · 실제 모드 : js/db.js → Supabase RPC (가입 · 로그인 · 출석 · 채팅 · 앨범 · 쿠폰 · 관리자)
 *  · 개인정보 제로 원칙: 닉네임과 PIN 만 다루고, 이름 · 전화번호 · 이메일은 받지 않습니다.
 */
(function () {
  'use strict';

  var D = window.YM_DATA;
  var ART = window.YM_ART;
  var DB = window.YM_DB;

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
  var ROLE_LABEL = { admin: '문주', officer: '운영진', member: '문파원', guest: '체험' };
  var ROLE_CLASS = { admin: 'role--master', officer: 'role--elder', member: '', guest: 'role--elite' };
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
    mode: 'trial',        // 'trial' | 'live'
    ready: false,
    me: null,
    clan: null,
    notices: [],
    events: [],
    coupons: [],
    guides: [],
    guideOpen: false,
    absences: [],
    members: [],
    album: [],
    albumImages: {},
    chat: [],
    tab: 'home',
    category: '전체',
    memberFilter: 'all',
    query: '',
    likes: {},
    attendance: null,
    installEvent: null,
    installHidden: store.get('installHidden', {}) || {},
    firstSendNoted: false,
    realtime: 'off',
    busy: false,
    eventPending: false,
    adminSettings: null
  };

  /* ============================================================
     유틸
     ============================================================ */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) % 9973; }
    return h;
  }
  function avatarStyle(name) { return AVATARS[hash(String(name || '연')) % AVATARS.length]; }
  function initial(name) { return String(name || '연').trim().charAt(0) || '연'; }

  /* ---------- 쿠폰 ----------
     화면에서는 코드와 마지막 날만 받습니다. DB(admin_create_coupon)는 내용·보상을 1~60자로
     요구하므로 빈 자리는 COUPON_BLANK('-') 로 채워 보내고, 카드에서는 '-' 를 빈 값으로 봅니다. */
  var COUPON_BLANK = '-';
  function couponText(value) {
    var text = String(value === null || value === undefined ? '' : value).trim();
    return (text === '' || text === COUPON_BLANK) ? '' : text;
  }

  /* ---------- 프로필 그림 (일러스트 preset: / 내 사진 data:image/) ---------- */
  var AVATAR_PRESETS = ['lotus', 'koi', 'frog', 'firefly', 'moon', 'leaf', 'turtle', 'lantern', 'duck'];

  function presetName(value) {
    if (typeof value !== 'string' || value.indexOf('preset:') !== 0) { return null; }
    var kind = value.slice(7);
    return AVATAR_PRESETS.indexOf(kind) === -1 ? null : kind;
  }
  function isImageAvatar(value) {
    return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
  }
  function avatarInner(name, avatar) {
    var preset = presetName(avatar);
    if (preset) { return ART.avatar(preset); }
    if (isImageAvatar(avatar)) { return '<img class="avatar__img" src="' + esc(avatar) + '" alt="">'; }
    return esc(initial(name));
  }
  /** 아바타 한 칸 — 일러스트/사진이 없으면 닉네임 첫 글자 */
  function avatarSpan(cls, name, avatar, inner) {
    var painted = !!presetName(avatar) || isImageAvatar(avatar);
    return '<span class="' + cls + (painted ? ' avatar--art' : '') + '" aria-hidden="true"' +
      (painted ? '' : ' style="background:' + avatarStyle(name) + '"') + '>' +
      avatarInner(name, avatar) + (inner || '') + '</span>';
  }
  function myAvatarValue() {
    if (isLive()) { return S.me ? (S.me.avatar || null) : null; }
    return (S.user && S.user.avatar) || null;
  }
  function memberAvatarById(id) {
    if (!id) { return null; }
    var hit = S.members.filter(function (m) { return m.id === id; })[0];
    return hit ? (hit.avatar || null) : null;
  }
  function memberAvatarByName(nickname) {
    if (!nickname) { return null; }
    var hit = S.members.filter(function (m) { return m.nickname === nickname; })[0];
    return hit ? (hit.avatar || null) : null;
  }
  function fmtNum(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

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
  /** 반복 요일 정리 — 0(일)~6(토) 밖의 값은 버리고, 중복을 지워 차례대로 (DB 규칙과 같습니다) */
  function repeatDays(value) {
    var list = Object.prototype.toString.call(value) === '[object Array]' ? value : [];
    var days = [];
    list.forEach(function (raw) {
      var d = Number(raw);
      if (d >= 0 && d <= 6 && days.indexOf(d) === -1) { days.push(d); }
    });
    return days.sort(function (a, b) { return a - b; });
  }
  /** '수·토' 처럼 요일 이름을 이어 붙입니다 */
  function weekdaysLabel(days) {
    return repeatDays(days).map(function (d) { return WEEKDAYS[d]; }).join('·');
  }
  /**
   * 매주 반복의 '다음 예정 시각' — 오늘이 그 요일이면 오늘로 보고,
   * 아니면 오늘부터 가장 가까운 그 요일로 넘어갑니다. (서버의 next_weekly_at 과 같은 셈)
   */
  function nextWeeklyFrom(days, hour, minute) {
    var list = repeatDays(days);
    var now = new Date();
    var hh = hour === undefined ? 20 : hour;
    var mm = minute === undefined ? 0 : minute;
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (list.indexOf(now.getDay()) !== -1 || !list.length) { return base; }
    for (var i = 1; i <= 7; i++) {
      var t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm, 0, 0);
      if (list.indexOf(t.getDay()) !== -1) { return t; }
    }
    return base;
  }
  /** 카드에 보여 줄 시각 — 매주 반복은 요일·시간으로 다음 예정 시각을 다시 계산합니다 */
  function eventMoment(ev) {
    var base = new Date(ev && ev.starts_at);
    if (!ev || !ev.repeat_weekly) { return base; }
    var days = repeatDays(ev.repeat_weekdays);
    if (!days.length) { return base; }
    var hh = isNaN(base.getTime()) ? 20 : base.getHours();
    var mm = isNaN(base.getTime()) ? 0 : base.getMinutes();
    return nextWeeklyFrom(days, hh, mm);
  }
  /** 오늘 열리는 문파컨텐츠인가 — 1회성은 오늘 날짜, 매주 반복은 오늘 요일이 들어 있으면 오늘 */
  function isTodayEvent(ev) {
    if (!ev) { return false; }
    if (ev.repeat_weekly) {
      return repeatDays(ev.repeat_weekdays).indexOf(new Date().getDay()) !== -1;
    }
    var at = new Date(ev.starts_at);
    if (isNaN(at.getTime())) { return false; }
    return dayKey(at) === dayKey(new Date());
  }
  function ddayOf(date) {
    var diff = Math.round((dayStart(date) - dayStart(new Date())) / 86400000);
    if (diff <= 0) { return '오늘'; }
    if (diff === 1) { return '내일'; }
    return 'D-' + diff;
  }
  function shortDate(value) {
    var m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (Number(m[2]) + '.' + m[3]) : String(value || '');
  }
  /** ISO 시각 → <input type="datetime-local"> 값 (기기 시간대 그대로) */
  function toLocalInput(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) { return ''; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  /** 쿠폰의 마지막 날 → <input type="date"> 값 (체험 예시는 '12.31' 같은 짧은 표기) */
  function couponDateValue(coupon) {
    if (!coupon) { return ''; }
    var iso = String(coupon.expires_on || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { return iso; }
    var m = String(coupon.until || '').match(/^(\d{1,2})\.(\d{1,2})$/);
    if (!m) { return ''; }
    var now = new Date();
    var date = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
    if (date.getTime() < dayStart(now)) {
      date = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
    }
    return dayKey(date);
  }
  /** 자리비움 배지 — 오늘이 기간 안이면 '자리비움 중', 아직이면 '예정' */
  function absenceState(absence) {
    var today = dayKey(new Date());
    var start = String(absence.start_date || '').slice(0, 10);
    return start > today ? '예정' : '자리비움 중';
  }
  function relDayLabel(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) { return ''; }
    return (d.getMonth() + 1) + '.' + d.getDate();
  }
  function timeLabel(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) { return ''; }
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dateLabel(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) { return ''; }
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }
  function joinedLabel(value) {
    // null · undefined 는 new Date(null)=1970-01-01 로 읽히므로 먼저 걸러 냅니다.
    if (!value) { return ''; }
    var text = dateLabel(value);
    return text ? text + ' 가입' : '';
  }
  function seenLabel(value) {
    if (!value) { return '오랫동안 조용했어요'; }
    var d = new Date(value);
    var mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (isNaN(mins)) { return ''; }
    if (mins < 5) { return '지금 접속 중'; }
    if (mins < 60) { return mins + '분 전'; }
    if (mins < 60 * 24) { return Math.floor(mins / 60) + '시간 전'; }
    if (mins < 60 * 48) { return '어제'; }
    return (d.getMonth() + 1) + '.' + d.getDate();
  }
  function isOnline(value) {
    if (!value) { return false; }
    var d = new Date(value);
    return Date.now() - d.getTime() < 5 * 60 * 1000;
  }
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  /* ============================================================
     토스트 / 모달
     ============================================================ */
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
    }, 2800);
  }

  /* v49 — 🛍️ 포인트 샵 · 🏠 마이홈은 모양만 먼저. 누르면 이 안내만 띄웁니다 */
  var SOON_NOTICE = '아직 기능 준비 중입니다. 추후 업데이트에서 열릴 예정이에요!';
  function soonNotice() { toast(SOON_NOTICE); }

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

  function modalTitle(text) {
    return '<h3 class="lightbox__title" id="modal-title" style="margin-top:0">' + esc(text) + '</h3>';
  }

  function errorMessage(err) {
    if (!err) { return '알 수 없는 문제가 생겼어요.'; }
    return err.message || '알 수 없는 문제가 생겼어요.';
  }

  function isAuthError(err) {
    if (!err) { return false; }
    var code = String(err.code || '');
    var msg = String(err.message || '');
    if (code === '28000' || code === '28P01') { return true; }
    return msg.indexOf('다시 로그인') !== -1;
  }

  /* ============================================================
     권한 · 모드 도우미
     ============================================================ */
  function isLive() { return S.mode === 'live'; }
  function isAdmin() { return isLive() && S.me && S.me.role === 'admin'; }
  function myId() { return S.me ? S.me.id : null; }
  function myNick() { return S.me ? S.me.nickname : ''; }
  function myRole() { return S.me ? S.me.role : null; }
  /** 자리비움 삭제는 운영진(문주·운영진)만 */
  function canDeleteAbsence() {
    return isLive() && (myRole() === 'admin' || myRole() === 'officer');
  }
  /** 다른 문파원 대신 자리비움을 올릴 수 있는가 — 운영진(문주·부문주)만 */
  function canProxyAbsence() {
    return isLive() && (myRole() === 'admin' || myRole() === 'officer');
  }
  /** 공략 삭제는 올린 본인 또는 운영진(문주·운영진)만 */
  function canDeleteGuide(guide) {
    if (!isLive() || !guide) { return false; }
    if (myRole() === 'admin' || myRole() === 'officer') { return true; }
    return !!guide.created_by && guide.created_by === myId();
  }

  /* ---------- 글 수정 권한 ----------
     공지 · 문파컨텐츠 · 쿠폰: 문주(만들기·지우기와 같은 권한)
     공략: 올린 본인 또는 운영진(삭제와 같은 권한)
     앨범: 올린 본인 또는 운영진 — 글만 고칩니다(사진은 그대로)
     자리비움: 수정 없음 — 기간·이유를 바꾸려면 지우고 다시 등록합니다. */
  function canEditNotice() { return !isLive() || isAdmin(); }
  function canEditEvent() { return !isLive() || isAdmin(); }
  function canEditCoupon() { return !isLive() || isAdmin(); }
  function canEditGuide(guide) { return !isLive() || canDeleteGuide(guide); }
  function canEditAlbum(item) {
    if (!item) { return false; }
    if (!isLive()) { return true; }
    if (myRole() === 'admin' || myRole() === 'officer') { return true; }
    return !!item.author_id && item.author_id === myId();
  }

  /** 수정 RPC 가 아직 서버에 없을 때(마이그레이션 전) — 알아듣기 쉬운 안내로 바꿉니다 */
  function editErrorHint(err) {
    var msg = errorMessage(err);
    var code = String(err && err.code);
    if (code === 'PGRST202'
        || msg.indexOf('Could not find the function') !== -1
        || msg.indexOf('이 기능이 아직') !== -1) {
      var which = S.eventPending ? 'supabase/migration-clan-contents.sql' : 'supabase/migration-edit-posts.sql';
      S.eventPending = false;
      var hint = '서버에 이 기능이 아직 준비되지 않았어요. SQL Editor 에서 ' + which + ' 을(를) 한 번 실행해 주세요.';
      toast(hint);
      return hint;
    }
    return msg;
  }

  /* ============================================================
     체험 모드 데이터
     ============================================================ */
  function trialEventDate(ev) {
    if (ev.repeat_weekly || ev.type === 'weekly') {
      var days = repeatDays(ev.repeat_weekdays || [ev.weekday]);
      return nextWeeklyFrom(days.length ? days : [6], ev.hour, ev.minute);
    }
    var d = addDays(ev.days || 0);
    d.setHours(ev.hour === undefined ? 20 : ev.hour, ev.minute || 0, 0, 0);
    return d;
  }

  function buildTrialState() {
    var attendance = attendanceState();

    S.clan = {
      name: D.guild.name,
      motto: D.guild.motto,
      capacity: D.guild.capacity,
      member_count: D.guild.members,
      new_members_7d: D.guild.newMembers,
      today_waves: D.guild.weeklyAttendance,
      week_waves: D.guild.weeklyAttendance,
      level: D.guild.level
    };

    S.me = {
      id: 'guest',
      nickname: S.user.nick,
      role: 'guest',
      level: 0,
      avatar: S.user.avatar || null,
      joined_at: S.user.since,
      wave: { today_done: attendance.done, streak: attendance.streak, total: attendance.done ? attendance.streak : Math.max(0, attendance.streak) }
    };

    S.notices = D.notices.map(function (n, i) {
      return {
        id: n.id,
        title: n.title,
        body: n.body.join('\n\n'),
        tag: n.tag,
        pinned: !!n.pinned,
        author: n.author,
        roleLabel: n.role,
        created_at: addDays(-(n.daysAgo || i)).toISOString()
      };
    });

    S.events = mapEvents(D.events.map(function (ev, i) {
      return {
        id: 'e' + i,
        title: ev.title,
        place: ev.place,
        tag: ev.tag,
        note: ev.note,
        starts_at: trialEventDate(ev).toISOString(),
        ends_at: null,
        repeat_weekly: !!ev.repeat_weekly,
        repeat_weekdays: ev.repeat_weekly ? repeatDays(ev.repeat_weekdays) : []
      };
    }));

    S.coupons = D.coupons.map(function (c, i) {
      return { id: 'cp' + i, code: c.code, title: c.title, reward: c.reward, until: c.until, tone: c.tone };
    });

    S.guides = (D.guides || []).map(function (g) {
      return {
        id: g.id,
        title: g.title,
        video_id: g.videoId || null,
        youtube_url: g.videoId ? 'https://www.youtube.com/watch?v=' + g.videoId : null,
        created_by: null,
        kind: g.kind || 'moon'
      };
    });

    S.absences = (D.absences || []).map(function (a, i) {
      return {
        id: 'ab' + i,
        member_id: null,
        nickname: a.name,
        avatar: null,
        start_date: dayKey(addDays(a.fromDays || 0)),
        end_date: dayKey(addDays(a.toDays || 0)),
        reason: a.reason
      };
    }).sort(function (a, b) {
      return a.start_date < b.start_date ? -1 : (a.start_date > b.start_date ? 1 : 0);
    });

    S.members = D.members.map(function (m, i) {
      var role = m.role === '문주' ? 'admin' : (m.role === '문파원' ? 'member' : 'officer');
      return {
        id: 'm' + i,
        nickname: m.name,
        role: role,
        roleLabel: m.role,
        roleClass: m.role === '문주' ? 'role--master' : (m.role === '부문주' ? 'role--vice' : (m.role === '장로' ? 'role--elder' : (m.role === '정예' ? 'role--elite' : ''))),
        level: m.level,
        status: 'active',
        filterKey: m.status === 'on' ? 'on' : (m.status === 'away' ? 'away' : 'off'),
        online: m.status === 'on',
        lastLabel: m.last,
        statusLabel: m.status === 'on' ? '접속 중' : (m.status === 'away' ? '자리 비움' : '오프라인'),
        // 높은 등급일수록 오래전에 들어온 것으로 예시 날짜를 만듭니다.
        joined_at: addDays(-(410 - i * 17)).toISOString(),
        me: false
      };
    });
    S.members.unshift({
      id: 'guest',
      nickname: S.user.nick,
      role: 'guest',
      roleLabel: '체험',
      roleClass: 'role--elite',
      level: 0,
      status: 'active',
      filterKey: 'on',
      online: true,
      lastLabel: '지금 접속 중',
      statusLabel: '접속 중',
      joined_at: S.user.since,
      avatar: S.user.avatar || null,
      me: true
    });

    S.album = D.album.map(function (a) {
      return {
        id: a.id,
        title: a.title,
        caption: a.caption || '',
        author_id: null,
        author: a.author,
        author_role: '',
        kind: a.kind,
        likes: a.likes,
        liked: !!S.likes[a.id],
        created_at: addDays(-(a.daysAgo || 0)).toISOString()
      };
    });

    S.chat = loadTrialChat();
    S.ready = true;
  }

  function loadTrialChat() {
    var saved = store.get('chat', null);
    if (saved && saved.length) {
      return saved.map(function (m) {
        return {
          id: m.id,
          member_id: m.mine ? 'guest' : null,
          nickname: m.system ? null : m.name,
          roleLabel: m.system ? '' : (m.mine ? '체험' : (m.role || '')),
          kind: m.system ? 'system' : 'text',
          body: m.text,
          created_at: new Date(m.ts).toISOString(),
          mine: !!m.mine
        };
      });
    }
    var now = Date.now();
    var seeded = D.chatSeed.map(function (m, i) {
      return {
        id: 'seed-' + i,
        member_id: null,
        nickname: m.system ? null : m.name,
        roleLabel: m.system ? '' : (m.role || ''),
        kind: m.system ? 'system' : 'text',
        body: m.text,
        created_at: new Date(m.system ? now - 1000 * 60 * 180 : now - 1000 * 60 * (m.minutesAgo || 0)).toISOString(),
        mine: false
      };
    });
    store.set('chat', seeded.map(function (m) {
      return { id: m.id, name: m.nickname, role: m.roleLabel, text: m.body, ts: new Date(m.created_at).getTime(), system: m.kind === 'system', mine: false };
    }));
    return seeded;
  }

  function persistTrialChat() {
    store.set('chat', S.chat.map(function (m) {
      return {
        id: m.id,
        name: m.nickname,
        role: m.roleLabel,
        text: m.body,
        ts: new Date(m.created_at).getTime(),
        system: m.kind === 'system',
        mine: !!m.mine
      };
    }));
  }

  function attendanceState() {
    var saved = store.get('attendance', null);
    var today = dayKey(new Date());
    if (saved && saved.date === today) {
      return { done: true, streak: saved.streak || 1 };
    }
    return { done: false, streak: saved ? (saved.streak || 0) : 0 };
  }

  /* ============================================================
     실제 문파 데이터 불러오기
     ============================================================ */
  function mapNotice(n) {
    var author = S.members.filter(function (m) { return m.id === n.author_id; })[0];
    return {
      id: n.id,
      title: n.title,
      body: n.body || '',
      tag: n.tag || '공지',
      pinned: !!n.pinned,
      author: author ? author.nickname : '운영진',
      author_avatar: author ? (author.avatar || null) : null,
      roleLabel: author ? author.roleLabel : '',
      created_at: n.created_at
    };
  }

  function mapMember(m, fromAdmin) {
    var role = m.member_role || m.role || 'member';
    var online = isOnline(m.last_seen_at);
    return {
      id: m.id,
      nickname: m.nickname,
      role: role,
      roleLabel: ROLE_LABEL[role] || '문파원',
      roleClass: ROLE_CLASS[role] || '',
      level: m.member_level || m.level || 0,
      status: m.status || 'active',
      filterKey: m.status === 'kicked' ? 'kicked' : (m.status === 'banned' ? 'banned' : (online ? 'online' : 'offline')),
      online: online,
      lastLabel: seenLabel(m.last_seen_at),
      statusLabel: m.status === 'kicked' ? '내보냄' : (m.status === 'banned' ? '차단됨' : (online ? '접속 중' : '자리 비움')),
      last_seen_at: m.last_seen_at,
      wave_today: !!m.wave_today,
      joined_at: m.joined_at,
      avatar: m.avatar || null,
      me: m.id === myId()
    };
  }

  function mapChat(c) {
    return {
      id: c.id,
      member_id: c.member_id,
      nickname: c.nickname || (c.kind === 'system' ? null : '문파원'),
      roleLabel: c.kind === 'system' ? '' : (ROLE_LABEL[c.role] || ''),
      kind: c.kind || 'text',
      body: c.body,
      avatar: c.avatar || null,
      created_at: c.created_at,
      mine: !!c.member_id && c.member_id === myId()
    };
  }

  function mapGuide(g) {
    return {
      id: g.id,
      title: g.title,
      video_id: g.video_id || null,
      youtube_url: g.youtube_url || (g.video_id ? 'https://www.youtube.com/watch?v=' + g.video_id : 'https://www.youtube.com/'),
      created_by: g.created_by || null,
      kind: g.kind || 'moon',
      created_at: g.created_at
    };
  }

  function mapAbsence(a) {
    return {
      id: a.id,
      member_id: a.member_id || null,
      nickname: a.nickname || a.target_name || '문파원',
      avatar: a.avatar || null,
      target_name: a.target_name || null,
      is_proxy: !!a.is_proxy,
      proxy_by: a.proxy_by || null,
      start_date: String(a.start_date || '').slice(0, 10),
      end_date: String(a.end_date || '').slice(0, 10),
      reason: a.reason || '',
      created_at: a.created_at
    };
  }

  function mapAlbum(p) {
    return {
      id: p.id,
      title: p.title || '',
      caption: p.caption || '',
      author_id: p.author_id,
      author: p.author || '문파원',
      author_role: p.author_role || '',
      author_avatar: p.author_avatar || null,
      image_mime: p.image_mime,
      image_bytes: p.image_bytes,
      likes: p.likes || 0,
      liked: !!p.liked,
      created_at: p.created_at
    };
  }

  function loadLiveAll() {
    return DB.overview().then(function (data) {
      S.clan = data.clan;
      S.me = {
        id: data.me.id,
        nickname: data.me.nickname,
        role: data.me.role,
        level: data.me.level,
        avatar: data.me.avatar || null,
        joined_at: (S.me && S.me.joined_at) || data.me.joined_at || null,
        wave: { today_done: data.me.today_wave, streak: data.me.streak, total: data.me.total_waves }
      };
      return Promise.all([
        DB.listMembers().then(function (rows) {
          S.members = (rows || []).map(function (m) { return mapMember(m, false); });
        }, function () { S.members = []; }),
        DB.listNotices().then(function (rows) {
          S.noticeRows = rows || [];
        }, function () { S.noticeRows = []; }),
        DB.listEvents().then(function (rows) {
          S.events = mapEvents(rows);
        }, function () { S.events = []; }),
        DB.listCoupons().then(function (rows) {
          S.coupons = (rows || []).map(function (c) {
            return { id: c.id, code: c.code, title: c.title, reward: c.reward, expires_on: c.expires_on, tone: c.tone || 'lotus' };
          });
        }, function () { S.coupons = []; }),
        DB.listGuides().then(function (rows) {
          S.guides = (rows || []).map(mapGuide);
        }, function () { S.guides = []; }),
        DB.listAbsences().then(function (rows) {
          S.absences = (rows || []).map(mapAbsence);
        }, function () { S.absences = []; }),
        DB.listAlbum(12).then(function (rows) {
          S.album = (rows || []).map(mapAlbum);
        }, function () { S.album = []; }),
        DB.listChat(50).then(function (rows) {
          S.chat = (rows || []).map(mapChat).sort(function (a, b) { return a.id - b.id; });
        }, function () { S.chat = []; })
      ]);
    }).then(function () {
      S.notices = (S.noticeRows || []).map(mapNotice);
      S.ready = true;
    });
  }

  /** 관리자 화면용: 강퇴 · 차단까지 포함한 전체 목록 */
  function loadAdminMembers() {
    return DB.admin.listMembers().then(function (rows) {
      S.members = (rows || []).map(function (m) { return mapMember(m, true); });
      return S.members;
    });
  }

  /** 공지 · 문파컨텐츠는 공개 테이블에서 읽고, 작성자 닉네임은 문파원 목록으로 맞춥니다. */
  function reloadClanContent() {
    return Promise.all([
      DB.listGuides().then(function (rows) { S.guides = (rows || []).map(mapGuide); }, function () {}),
      DB.listNotices().then(function (rows) { S.noticeRows = rows || []; }, function () {}),
      DB.listEvents().then(function (rows) { S.events = mapEvents(rows); }, function () {})
    ]).then(function () {
      S.notices = (S.noticeRows || []).map(mapNotice);
    });
  }

  /* ============================================================
     배경 반딧불
     ============================================================ */
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

  /* ============================================================
     시작
     ============================================================ */
  function init() {
    buildFireflies();

    /* 🔗 외부 체험 링크(?guest=TOKEN) — 문파 자료를 하나도 불러오지 않고 체험 화면만 그립니다. */
    var guestToken = guestTokenFromUrl();
    if (guestToken) {
      startGuest(guestToken);
      return;
    }

    $('#auth-art').innerHTML = ART.hero();
    $('#auth-mark').innerHTML = ART.mark(40);
    $('#topbar-mark').innerHTML = ART.mark(32);

    bindAuth();
    bindTabs();
    bindChat();
    bindGlobal();

    var settings = store.get('settings', null);
    if (settings && settings.theme === 'moon') { document.documentElement.setAttribute('data-theme', 'moon'); }

    S.likes = store.get('likes', {}) || {};
    S.attendance = store.get('attendance', null);

    resume();
  }

  function resume() {
    var liveSession = DB && DB.session ? DB.session() : null;
    if (liveSession && liveSession.token) {
      S.mode = 'live';
      S.user = { nick: (liveSession.member && liveSession.member.nickname) || '문파원', guest: false };
      showMain(true);
      DB.profile().then(function (profile) {
        S.me = {
          id: profile.id,
          nickname: profile.nickname,
          role: profile.role,
          level: profile.level,
          avatar: profile.avatar || null,
          joined_at: profile.joined_at,
          wave: { today_done: profile.wave.today_done, streak: profile.wave.streak, total: profile.wave.total }
        };
        return loadLiveAll();
      }).then(function () {
        afterEnter();
      }).catch(function (err) {
        if (isAuthError(err)) {
          DB.clearSession();
          S.mode = 'trial';
          showAuth();
          showError('login-error', '로그인 시간이 지났어요. 다시 들어와 주세요.', ['#login-nick', '#login-pin']);
        } else {
          renderLoadError(errorMessage(err));
        }
      });
      return;
    }

    var session = store.get('session', null);
    if (session && session.nick) {
      S.mode = 'trial';
      S.user = { nick: session.nick, guest: !!session.guest, since: session.since, avatar: store.get('avatar', null) || null };
      showMain(true);
      buildTrialState();
      afterEnter();
    }
  }

  function showMain(loading) {
    $('#auth-view').hidden = true;
    $('#main-view').hidden = false;
    renderInstallBanners();
    S.user = S.user || {};
    if (loading && !S.ready) {
      S.ready = false;
      ['home', 'album', 'members', 'me'].forEach(function (tab) {
        var host = $('#' + tab + '-body');
        if (host) {
          host.innerHTML = '<div class="empty">연못을 불러오는 중이에요…</div>';
        }
      });
    }
  }

  function showAuth() {
    $('#main-view').hidden = true;
    $('#auth-view').hidden = false;
    renderInstallBanners();
    window.scrollTo(0, 0);
    $('#auth-view').scrollTop = 0;
  }

  function afterEnter() {
    renderAll();
    updateTopbar();
    switchTab(S.tab || 'home', true);
    startRealtime();
    startChatPoll();
  }

  /** 서버에서 문파 자료를 끝까지 못 받았을 때 — 다시 시도할 수 있는 자리 */
  function renderLoadError(message) {
    var host = $('#home-body');
    if (!host) { return; }
    host.innerHTML = '<div class="empty">' + esc(message) +
      '<div style="margin-top:12px"><button type="button" class="btn btn--small btn--ghost" id="retry-load">다시 불러오기</button></div></div>';
    var btn = $('#retry-load');
    if (btn) { btn.addEventListener('click', retryLoad); }
  }

  function retryLoad() {
    showMain(true);
    DB.profile().then(function (profile) {
      S.me = {
        id: profile.id, nickname: profile.nickname, role: profile.role, level: profile.level,
        avatar: profile.avatar || null,
        joined_at: profile.joined_at,
        wave: { today_done: profile.wave.today_done, streak: profile.wave.streak, total: profile.wave.total }
      };
      return loadLiveAll();
    }).then(function () {
      afterEnter();
    }).catch(function (err) {
      if (isAuthError(err)) {
        DB.clearSession();
        S.mode = 'trial';
        showAuth();
        return;
      }
      renderLoadError(errorMessage(err));
    });
  }

  function renderAll() {
    renderHome();
    renderChat();
    renderAlbum();
    renderMembers();
    renderMe();
  }

  /* ============================================================
     실시간
     ============================================================ */
  function startRealtime() {
    if (!isLive()) { return; }
    var result = DB.startRealtime({
      onChat: onRealtimeChat,
      onClanChange: onRealtimeClan,
      onStatus: function (status) {
        S.realtime = status;
        updateLiveBadge();
      }
    });
    S.realtime = result.ok ? 'connecting' : 'off';
    updateLiveBadge();
  }

  function updateLiveBadge() {
    var label = $('#topbar-online');
    if (!label) { return; }
    if (isLive()) {
      var text = S.clan ? ('문파원 ' + (S.clan.member_count || 0) + '명') : '연결 중';
      if (S.realtime === 'live') { text += ' · 실시간'; }
      else if (S.realtime === 'down') { text += ' · 다시 연결 중'; }
      label.textContent = text;
    }
  }

  var clanRefreshTimer = null;
  function onRealtimeClan() {
    if (!isLive()) { return; }
    window.clearTimeout(clanRefreshTimer);
    clanRefreshTimer = window.setTimeout(function () {
      reloadClanContent().then(function () {
        if (S.tab === 'home') { renderHome(); }
      }).catch(function () {});
    }, 400);
  }

  function onRealtimeChat(payload) {
    if (!isLive() || !payload) { return; }
    var record = payload.new || payload.record || payload;
    if (!record || record.id === undefined) { return; }

    // 삭제는 본문이 비워진 UPDATE 로 옵니다.
    if (payload.eventType === 'UPDATE' && record.deleted_at) {
      var before = S.chat.length;
      S.chat = S.chat.filter(function (m) { return String(m.id) !== String(record.id); });
      if (before !== S.chat.length && S.tab === 'chat') { renderChat(); }
      return;
    }

    if (S.chat.some(function (m) { return String(m.id) === String(record.id); })) { return; }

    var known = S.members.filter(function (m) { return m.id === record.member_id; })[0];
    var msg = mapChat({
      id: record.id,
      member_id: record.member_id,
      nickname: known ? known.nickname : (record.member_id === myId() ? myNick() : null),
      role: known ? known.role : null,
      kind: record.kind,
      body: record.body,
      created_at: record.created_at
    });
    if (!msg.nickname && msg.kind !== 'system') { msg.nickname = '문파원'; }

    S.chat.push(msg);
    S.chat.sort(function (a, b) { return a.id - b.id; });

    if (S.tab === 'chat') {
      renderChat();
      scrollChat(true);
    } else {
      var tab = $('.tab[data-tab="chat"]');
      if (tab && !msg.mine) { tab.classList.add('has-news'); }
    }
  }

  var chatPollTimer = null;
  function startChatPoll() {
    window.clearInterval(chatPollTimer);
    if (!isLive()) { return; }
    // 실시간 구독이 끊긴 환경에서도 채팅 탭은 10초마다 새 소식을 확인합니다.
    chatPollTimer = window.setInterval(function () {
      if (!isLive() || S.tab !== 'chat' || S.realtime === 'live') { return; }
      refreshChat();
    }, 10000);
  }

  /* ============================================================
     로그인 / 가입
     ============================================================ */
  function bindAuth() {
    var segLogin = $('#seg-login');
    var segSignup = $('#seg-signup');

    segLogin.addEventListener('click', function () { switchAuth('login'); });
    segSignup.addEventListener('click', function () { switchAuth('signup'); });

    $('#login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = $('#login-nick').value.trim();
      var pin = $('#login-pin').value.trim();

      var problem = validateNick(nick) || validatePin(pin);
      showError('login-error', problem, ['#login-nick', '#login-pin']);
      if (problem) { return; }

      setFormBusy('login-form', true, '연못으로 들어가는 중…');
      S.mode = 'live';
      S.user = { nick: nick, guest: false };
      DB.login(nick, pin).then(function () {
        showMain(true);
        return DB.profile();
      }).then(function (profile) {
        S.me = {
          id: profile.id,
          nickname: profile.nickname,
          role: profile.role,
          level: profile.level,
          avatar: profile.avatar || null,
          joined_at: profile.joined_at,
          wave: { today_done: profile.wave.today_done, streak: profile.wave.streak, total: profile.wave.total }
        };
        S.user = { nick: profile.nickname, guest: false };
        return loadLiveAll();
      }).then(function () {
        afterEnter();
        toast(profileGreeting());
      }).catch(function (err) {
        S.mode = 'trial';
        DB.clearSession();
        showError('login-error', errorMessage(err), ['#login-nick', '#login-pin']);
      }).then(function () {
        setFormBusy('login-form', false);
      });
    });

    $('#signup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = $('#signup-nick').value.trim();
      var pin = $('#signup-pin').value.trim();
      var pin2 = $('#signup-pin2').value.trim();
      var code = $('#signup-code').value.trim();

      var problem = validateNick(nick) || validatePin(pin) || validateCode(code);
      if (!problem && pin !== pin2) { problem = 'PIN이 서로 달라요. 같은 숫자를 두 번 입력해 주세요.'; }
      showError('signup-error', problem, ['#signup-nick', '#signup-pin', '#signup-pin2', '#signup-code']);
      if (problem) { return; }

      setFormBusy('signup-form', true, '문파원으로 들이는 중…');
      S.mode = 'live';
      DB.register(nick, pin, code).then(function (data) {
        S.user = { nick: nick, guest: false };
        showMain(true);
        return loadLiveAll().then(function () { return data; });
      }).then(function (data) {
        afterEnter();
        if (data && data.is_first_admin) {
          openModal(modalTitle('문주가 되셨어요 🪷') +
            '<p class="lightbox__meta">아직 문주가 없던 연못이라, 첫 가입자이신 ' + esc(nick) + ' 님이 자동으로 문주가 되었어요.</p>' +
            '<div class="privacy" style="margin-top:14px">' +
            '<p>· 홈에서 공지 · 문파컨텐츠 · 쿠폰을 만들고 지울 수 있어요.</p>' +
            '<p>· 문파원 탭에서 직위 변경 · 내보내기 · 차단을 할 수 있어요.</p>' +
            '<p>· 내정보의 <b>문파 관리</b>에서 초대 코드를 확인하고 바꿀 수 있어요.</p>' +
            '<p>· 처음 초대 코드는 <b>YEONMOT</b> 이에요. 문파원을 들이기 전에 새 코드로 바꿔 두세요.</p>' +
            '</div><div class="lightbox__actions"><button type="button" class="btn btn--primary" id="first-admin-ok">알겠어요</button></div>');
          var ok = $('#first-admin-ok');
          if (ok) { ok.addEventListener('click', closeModal); }
        } else {
          toast('연못에 오신 것을 환영해요, ' + nick + ' 님 🪷');
        }
      }).catch(function (err) {
        S.mode = 'trial';
        DB.clearSession();
        showError('signup-error', errorMessage(err), ['#signup-nick', '#signup-pin', '#signup-code']);
      }).then(function () {
        setFormBusy('signup-form', false);
      });
    });

    $('#trial-btn').addEventListener('click', function () {
      S.mode = 'trial';
      S.user = { nick: '연못손님', guest: true, since: new Date().toISOString(), avatar: store.get('avatar', null) || null };
      store.set('session', S.user);
      showMain(true);
      buildTrialState();
      afterEnter();
      toast('체험 모드예요. 편하게 둘러보세요 🌿');
    });
  }

  function profileGreeting() {
    var hour = new Date().getHours();
    if (hour < 6) { return myNick() + ' 님, 늦은 시간에도 연못에 들러 주셨네요 🪷'; }
    if (hour < 12) { return myNick() + ' 님, 좋은 아침이에요 ☀️'; }
    if (hour < 18) { return myNick() + ' 님, 다시 오셨네요 🪷'; }
    return myNick() + ' 님, 오늘 하루도 수고 많으셨어요 🌙';
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
    if (code.length < 4 || code.length > 20) { return '초대 코드는 4~20자예요. 운영진에게 확인해 주세요.'; }
    return '';
  }
  function showError(id, message, fields) {
    var el = $('#' + id);
    if (!el) { return; }
    el.textContent = message || '';
    el.hidden = !message;
    (fields || []).forEach(function (sel) {
      var input = $(sel);
      if (!input) { return; }
      if (message) { input.setAttribute('aria-invalid', 'true'); }
      else { input.removeAttribute('aria-invalid'); }
    });
  }

  function setFormBusy(formSel, busy, label) {
    var form = $(formSel);
    if (!form) { return; }
    var btn = $('button[type="submit"]', form);
    if (!btn) { return; }
    if (busy) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = label || '잠시만요…';
      btn.disabled = true;
    } else {
      if (btn.dataset.label) { btn.textContent = btn.dataset.label; }
      btn.disabled = false;
    }
  }

  function logout() {
    var wasLive = isLive();
    var finish = function () {
      if (wasLive) { DB.stopRealtime(); }
      S.mode = 'trial';
      S.user = null;
      S.me = null;
      S.clan = null;
      S.ready = false;
      S.notices = [];
      S.events = [];
      S.coupons = [];
      S.absences = [];
      S.members = [];
      S.album = [];
      S.albumImages = {};
      S.chat = [];
      S.realtime = 'off';
      store.remove('session');
      closeModal();
      showAuth();
      $('#login-pin').value = '';
      $('#signup-form').reset();
      $('#login-form').reset();
      toast('연못을 잠시 떠났어요. 다시 오시길 기다릴게요.');
    };

    if (wasLive) {
      DB.logout().then(finish, finish);
    } else {
      finish();
    }
  }

  /* ============================================================
     탭
     ============================================================ */
  function bindTabs() {
    $$('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.getAttribute('data-tab')); });
    });
  }

  /** ⚔️ 도술 탭 — 계산기 화면을 그립니다 (한 번만 뼈대를 만들고 이후엔 값만 다시 계산) */
  function renderDosul() {
    var D = window.YM_DOSUL_UI;
    if (!D) {
      var body = $('#dosul-body');
      if (body) { body.innerHTML = '<p class="ds-empty">도술 계산기를 불러오지 못했어요. 새로고침해 주세요.</p>'; }
      return;
    }
    D.mount({
      live: isLive(),
      nickname: isLive() ? myNick() : '',
      api: isLive() ? {
        list: function () { return DB.listDosulBuilds(40); },
        save: function (build) { return DB.saveDosulBuild(build); },
        remove: function (id) { return DB.deleteDosulBuild(id); }
      } : null,
      toast: toast
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
    var activeTabBtn = $('.tab[data-tab="' + tab + '"]');
    if (activeTabBtn) { activeTabBtn.classList.remove('has-news'); }

    $$('.screen').forEach(function (screen) {
      screen.classList.toggle('is-active', screen.getAttribute('data-screen') === tab);
    });
    var active = $('#screen-' + tab);
    if (active) { active.scrollTop = 0; }
    if (tab === 'chat') {
      window.requestAnimationFrame(function () { scrollChat(false); });
      if (isLive() && !silent) { refreshChat(); }
    }
    if (tab === 'dosul') { renderDosul(); }
    if (!silent) {
      if (tab === 'home') { renderHome(); }
      if (tab === 'members') { refreshMembers(); }
      if (tab === 'album') { renderAlbum(); }
      if (tab === 'me') { renderMe(); }
    }
  }

  function updateTopbar() {
    var el = $('#topbar-online');
    if (!el) { return; }
    if (isLive()) {
      updateLiveBadge();
      return;
    }
    var online = S.members.filter(function (m) { return m.online; }).length;
    el.textContent = online + '명 접속';
  }

  /* ============================================================
     홈
     ============================================================ */
  /** 홈 바로가기 4버튼 — 공지 · 공략 · 쿠폰 · 자리비움 (각 섹션 개수 표시) */
  function shortcutBar() {
    var items = [
      { target: 'sec-notices', label: '공지', count: S.notices.length,
        icon: '<path d="M12 4a5.2 5.2 0 0 0-5.2 5.2c0 4.1-1.6 5.5-1.6 5.5h13.6s-1.6-1.4-1.6-5.5A5.2 5.2 0 0 0 12 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10.2 18a2 2 0 0 0 3.6 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
      { target: 'sec-guides', label: '공략', count: S.guides.length,
        icon: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.2 8.7 16.2 12l-6 3.3z" fill="currentColor"/>' },
      { target: 'sec-coupons', label: '쿠폰', count: S.coupons.length,
        icon: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v1.9a1.9 1.9 0 0 0 0 3.7v1.9A1.5 1.5 0 0 1 18.5 17h-13A1.5 1.5 0 0 1 4 15.5v-1.9a1.9 1.9 0 0 0 0-3.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9.2v5.6" stroke="currentColor" stroke-width="1.4" stroke-dasharray="1.4 1.8" stroke-linecap="round"/>' },
      { target: 'sec-absences', label: '자리비움', count: S.absences.length,
        icon: '<path d="M15.6 4.7a8 8 0 1 0 3.7 12.4 6.3 6.3 0 0 1-3.7-12.4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' }
    ];
    var html = '<nav class="shortcuts" aria-label="홈 바로가기">';
    items.forEach(function (it) {
      html += '<button type="button" class="shortcut" data-jump="' + it.target + '" aria-controls="' + it.target + '">' +
        '<span class="shortcut__icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17" focusable="false">' + it.icon + '</svg></span>' +
        '<span class="shortcut__label">' + esc(it.label) + '</span>' +
        '<span class="shortcut__count' + (it.count ? '' : ' is-zero') + '">' + fmtNum(it.count) + '</span>' +
        '</button>';
    });
    html += '</nav>';
    return html;
  }

  /**
   * 오늘의 문파컨텐츠 — 오늘 열리는 것(1회성은 오늘 날짜, 매주 반복은 오늘 요일)만 홈 위쪽에.
   * 하나도 없으면 아무것도 그리지 않습니다.
   */
  function todayBar() {
    var today = S.events.filter(isTodayEvent).sort(function (a, b) {
      return eventMoment(a) - eventMoment(b);
    });
    if (!today.length) { return ''; }

    var html = '<section class="today" id="today-contents" aria-labelledby="today-contents-title">' +
      '<p class="today__head"><span class="today__eyebrow" id="today-contents-title">🔥 오늘의 문파컨텐츠</span>' +
      '<span class="today__more" aria-hidden="true">문파컨텐츠로 가기</span></p>' +
      '<div class="today__list">';
    today.forEach(function (ev) {
      var when = eventMoment(ev);
      var repeat = !!ev.repeat_weekly && repeatDays(ev.repeat_weekdays).length > 0;
      html += '<button type="button" class="today__item" data-jump="sec-events" aria-controls="sec-events">' +
        '<span class="today__time">오늘 ' + timeLabel(when) + '</span>' +
        '<span class="today__body">' +
        '<span class="today__title">' + esc(ev.title) +
        (repeat ? '<span class="today__weekly">매주</span>' : '') + '</span>' +
        '<span class="today__meta">' + esc(ev.place || '장소 미정') +
        (ev.tag ? ' · ' + esc(ev.tag) : '') + '</span>' +
        '</span></button>';
    });
    html += '</div></section>';
    return html;
  }

  /**
   * 🏠 마이홈 카드 (v49 시안) — 초기 마이홈 그림 위에 말풍선과 포인트 배지.
   * 이번 버전은 모양만 먼저 보여 주고, 누르면 준비 중 안내만 띄웁니다.
   */
  function myHomeCard() {
    return '<button type="button" class="myhome" id="myhome-card" aria-label="마이홈 — 아바타를 준비 중이에요">' +
      '<img class="myhome__img" src="./assets/img/myhome-starter.webp" width="724" height="543" ' +
      'alt="연못 마이홈 — 아직 아바타를 준비 중인 방" loading="lazy" decoding="async">' +
      '<span class="myhome__veil" aria-hidden="true"></span>' +
      '<span class="myhome__bubble">현재 마이홈 아바타 작업중입니다. 업데이트 이후에 사용 가능합니다</span>' +
      '<span class="myhome__points">10,000 P</span>' +
      '</button>';
  }

  /** 바로가기 → 해당 섹션으로 부드럽게 스크롤 · 잠깐 테두리로 알려 줍니다 */
  function jumpToSection(btn) {
    var target = document.getElementById(btn.getAttribute('data-jump'));
    if (!target) { return; }
    $$('.shortcut', $('#home-body')).forEach(function (b) { b.classList.remove('is-active'); });
    btn.classList.add('is-active');
    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    target.classList.add('is-flash');
    window.setTimeout(function () {
      target.classList.remove('is-flash');
      btn.classList.remove('is-active');
    }, 1300);
  }

  /**
   * 🏠 홈 상단 — 연못 일러스트(연꽃·잉어·물결)를 제목 뒤 배경으로 은은하게 깔고,
   * 그 위에 「도깨비의 세계 · 문파 / 연못 / 물결이 모여…」를 놓습니다 (v50 시안).
   */
  function homeHead(clan) {
    return '<header class="home-head" aria-label="연못">' +
      '<div class="home-head__pond" aria-hidden="true">' + ART.hero({ back: true }) + '</div>' +
      '<div class="home-head__text">' +
      '<p class="kicker">도깨비의 세계' + (isLive() ? ' · 문파' : ' · 체험') + '</p>' +
      '<h2 class="screen__title">' + esc(clan.name || '연못') + '</h2>' +
      '<p class="screen__sub">' + esc(clan.motto || '') + '</p>' +
      '</div>' +
      '<div class="home-head__pills">' +
      (clan.level ? '<span class="pill pill--gold">문파 레벨 ' + esc(clan.level) + '</span>' : '') +
      '<span class="pill">문파원 ' + fmtNum(clan.member_count) + ' / ' + fmtNum(clan.capacity) + '</span>' +
      '</div>' +
      '</header>';
  }

  /**
   * 🪷 오늘의 물결 — 예전 연못 배너 안에 있던 버튼을 통계 카드 아래 바로가기로 옮겼습니다.
   * 하는 일은 그대로 (누르면 오늘의 물결을 남기고 연속 일수를 알려 줌).
   */
  function waveBar(wave) {
    return '<button type="button" class="wave-btn wave-btn--bar' + (wave.today_done ? ' is-done' : '') + '" id="wave-btn"' +
      (wave.today_done ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      '<span class="wave-btn__ring" aria-hidden="true"></span>' +
      '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">' +
      '<path d="M4 12.5c2.6 0 2.6-1.6 5.2-1.6s2.6 1.6 5.2 1.6 2.6-1.6 5.2-1.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M5.5 17.5c2.2 0 2.2-1.3 4.4-1.3s2.2 1.3 4.4 1.3 2.2-1.3 4.4-1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>' +
      '</svg>' +
      '<span id="wave-label">' + waveLabel(wave) + '</span></button>';
  }

  function renderHome() {
    if (!S.ready || !S.clan) {
      $('#home-body').innerHTML = '<div class="empty">연못을 불러오는 중이에요…</div>';
      return;
    }

    var clan = S.clan;
    var wave = (S.me && S.me.wave) || { today_done: false, streak: 0, total: 0 };
    var admin = isAdmin();
    var html = '';

    /* 상단 — 연못 일러스트를 배경으로 깔아 랜딩 화면처럼 (v50) */
    html += homeHead(clan);

    /* 오늘의 문파컨텐츠 — 연못 일러스트 바로 아래에 이어지도록 (없으면 통째로 숨김) */
    html += todayBar();

    /* 시안처럼 문파컨텐츠와 통계 사이에 큰 마이홈 카드 */
    html += myHomeCard();

    html += '<div class="stats">' +
      '<div class="stat"><strong>' + fmtNum(clan.today_waves) + '</strong><span>오늘의 물결</span></div>' +
      '<div class="stat"><strong>' + fmtNum(clan.week_waves) + '</strong><span>이번 주 출석</span></div>' +
      '<div class="stat"><strong>+' + fmtNum(clan.new_members_7d) + '</strong><span>새 문파원</span></div>' +
      '</div>';

    /* 오늘의 물결 남기기 — 예전 연못 배너 안에 있던 버튼 (기능 유지) */
    html += waveBar(wave);

    /* 바로가기 — 통계 카드 아래 · 공지 위에서 섹션으로 부드럽게 내려갑니다 */
    html += shortcutBar();

    /* 공지 */
    html += '<section class="section" id="sec-notices" aria-labelledby="home-notice-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-notice-title">공지</h3>' +
      '<span class="section__hadd">' + (admin ? '<button type="button" class="tool tool--add" data-add="notice">+ 공지 추가</button>' : '') +
      '<span class="section__more">' + S.notices.length + '개</span></span></div>';

    if (!S.notices.length) {
      html += '<div class="empty">아직 공지가 없어요.' + (admin ? ' 위의 <b>+ 공지 추가</b>로 첫 공지를 남겨 보세요.' : '') + '</div>';
    }

    S.notices.forEach(function (n, i) {
      var open = i === 0;
      var body = '';
      paragraphs(n.body).forEach(function (p) { body += '<p>' + esc(p) + '</p>'; });
      html += '<article class="notice' + (open ? ' is-open' : '') + '">' +
        '<button type="button" class="notice__head" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="notice-body-' + esc(n.id) + '">' +
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
        '<span class="notice__meta">' + avatarSpan('avatar--xs', n.author, n.author_avatar) +
        '<span>' + esc(n.author) + (n.roleLabel ? ' · ' + esc(n.roleLabel) : '') + ' · ' + relDayLabel(n.created_at) + '</span></span>' +
        '<span class="notice__summary">' + esc(String(n.body || '').split('\n')[0]) + '</span>' +
        '</span>' +
        '<span class="notice__chevron" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</span></button>' +
        '<div class="notice__body" id="notice-body-' + esc(n.id) + '">' + body + '</div>' +
        (canEditNotice() ? '<div class="item-tools">' +
          (isAdmin() ? '<button type="button" class="tool" data-pin="' + esc(n.id) + '" data-pinned="' + (n.pinned ? '1' : '0') + '">' +
            (n.pinned ? '고정 해제' : '고정') + '</button>' +
            '<button type="button" class="tool tool--danger" data-del-notice="' + esc(n.id) + '">삭제</button>' : '') +
          '<button type="button" class="tool tool--edit" data-edit-notice="' + esc(n.id) + '">수정</button></div>' : '') +
        '</article>';
    });
    html += '</section>';

    /* 문파컨텐츠 (예전 이름: 모임 일정) */
    html += '<section class="section" id="sec-events" aria-labelledby="home-event-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-event-title">문파컨텐츠</h3>' +
      '<span class="section__hadd">' + (admin ? '<button type="button" class="tool tool--add" data-add="event">+ 문파컨텐츠 추가</button>' : '') +
      '<span class="section__more">다가오는 문파컨텐츠</span></span></div>';

    if (!S.events.length) {
      html += '<div class="empty">아직 올라온 문파컨텐츠가 없어요.' + (admin ? ' 위의 <b>+ 문파컨텐츠 추가</b>로 첫 컨텐츠를 남겨 보세요.' : '') + '</div>';
    } else {
      html += '<div class="events">';
      S.events.forEach(function (ev) {
        var days = repeatDays(ev.repeat_weekdays);
        var repeat = !!ev.repeat_weekly && days.length > 0;
        var when = eventMoment(ev);
        var date = isNaN(when.getTime()) ? new Date(ev.starts_at) : when;
        var dd = ddayOf(date);
        html += '<article class="event' + (repeat ? ' event--weekly' : '') + '">' +
          '<div class="event__main">' +
          '<div class="event__date"><span class="event__d">' + date.getDate() + '</span>' +
          '<span class="event__m">' + (date.getMonth() + 1) + '월 · ' + WEEKDAYS[date.getDay()] + '</span></div>' +
          '<div class="event__info"><div class="event__title">' + esc(ev.title) + '</div>' +
          '<div class="event__meta">' +
          (repeat
            ? '<span class="event__weekly">매주</span><span>' + esc(weekdaysLabel(days)) + ' ' + timeLabel(when) + '</span>'
            : '<span>' + timeLabel(ev.starts_at) + '</span>') +
          '<span>·</span><span>' + esc(ev.place || '장소 미정') + '</span></div>' +
          (ev.note ? '<div class="event__meta"><span>' + esc(ev.note) + '</span></div>' : '') +
          '</div>' +
          '<span class="event__dday' + (dd === '오늘' || dd === '내일' ? ' is-soon' : '') + '">' + dd + '</span>' +
          '</div>' +
          (canEditEvent() ? '<div class="item-tools">' +
            (isAdmin() ? '<button type="button" class="tool tool--danger" data-del-event="' + esc(ev.id) + '">문파컨텐츠 삭제</button>' : '') +
            '<button type="button" class="tool tool--edit" data-edit-event="' + esc(ev.id) + '">수정</button></div>' : '') +
          '</article>';
      });
      html += '</div>';
    }
    html += '</section>';

    /* 쿠폰 */
    html += '<section class="section" id="sec-coupons" aria-labelledby="home-coupon-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-coupon-title">도깨비의 세계 쿠폰</h3>' +
      '<span class="section__hadd">' + (admin ? '<button type="button" class="tool tool--add" data-add="coupon">+ 쿠폰 추가</button>' : '') +
      '<span class="section__more">옆으로 넘겨보세요</span></span></div>';

    if (!S.coupons.length) {
      html += '<div class="empty">지금은 쓸 수 있는 쿠폰이 없어요.</div>';
    } else {
      html += '<div class="coupons">';
      S.coupons.forEach(function (c) {
        var until = c.expires_on ? String(c.expires_on).replace(/-/g, '.').replace(/^(\d{4})\./, '') + '까지'
          : (c.until ? c.until + '까지' : '기한 없음');
        var title = couponText(c.title);
        var reward = couponText(c.reward);
        html += '<article class="coupon">' +
          '<div class="coupon__head">' +
          (title ? '<span class="coupon__title">' + esc(title) + '</span>' : '') +
          '<span class="badge badge--lotus">' + esc(until) + '</span></div>' +
          (reward ? '<p class="coupon__reward">' + esc(reward) + '</p>' : '') +
          '<div class="coupon__code"><span>' + esc(c.code) + '</span>' +
          '<button type="button" class="coupon__copy" data-copy="' + esc(c.code) + '">복사</button></div>' +
          '<p class="coupon__until">게임 내 쿠폰 등록창에 입력해 보세요</p>' +
          (canEditCoupon() ? '<div class="item-tools">' +
            (isAdmin() ? '<button type="button" class="tool tool--danger" data-del-coupon="' + esc(c.id) + '">쿠폰 삭제</button>' : '') +
            '<button type="button" class="tool tool--edit" data-edit-coupon="' + esc(c.id) + '">수정</button></div>' : '') +
          '</article>';
      });
      html += '</div>';
      if (!isLive()) { html += '<p class="section__note">체험 모드의 예시 쿠폰이에요. 실제 게임에서 쓰이는 코드가 아닙니다.</p>'; }
    }
    html += '</section>';

    /* 공략 — 유튜브 영상 2×2 */
    html += '<section class="section" id="sec-guides" aria-labelledby="home-guide-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-guide-title">공략</h3>' +
      '<span class="section__hadd">' + (isLive() ? '<button type="button" class="tool tool--add" data-add="guide">+ 공략 추가</button>' : '') +
      '<span class="section__more">' + (S.guides.length ? S.guides.length + '개' : '영상으로 보기') + '</span></span></div>';

    if (!S.guides.length) {
      html += '<div class="empty">아직 올라온 공략 영상이 없어요.' +
        (isLive() ? ' 위의 <b>+ 공략 추가</b>에 유튜브 주소를 붙여 넣어 보세요.' : ' 문파원이 공략 영상을 올리면 이곳에서 볼 수 있어요.') + '</div>';
    } else {
      var shown = S.guideOpen ? S.guides : S.guides.slice(0, 4);
      html += '<div class="guides" id="guide-grid">';
      shown.forEach(function (g) {
        var thumb = g.video_id ? 'https://i.ytimg.com/vi/' + g.video_id + '/hqdefault.jpg' : '';
        var open = g.youtube_url
          ? '<a class="guide__link" href="' + esc(g.youtube_url) + '" target="_blank" rel="noopener noreferrer" data-guide="' + esc(g.id) + '" aria-label="' + esc(g.title) + ' — 유튜브에서 열기">'
          : '<div class="guide__link guide__link--sample" role="button" tabindex="0" data-sample="' + esc(g.id) + '" aria-label="' + esc(g.title) + ' — 예시 카드">';
        html += '<div class="guide">' + open +
          '<span class="guide__thumb">' + ART.scene(g.kind || 'moon') +
          (thumb ? '<img class="guide__img" src="' + esc(thumb) + '" alt="" loading="lazy" decoding="async">' : '') +
          '<span class="guide__play" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" focusable="false"><path d="M9 6.4 18.6 12 9 17.6z" fill="currentColor"/></svg></span>' +
          '</span>' +
          '<span class="guide__title">' + esc(g.title) + '</span>' +
          (g.youtube_url ? '</a>' : '</div>') +
          (canDeleteGuide(g) ? '<button type="button" class="guide__del" data-del-guide="' + esc(g.id) + '" aria-label="공략 삭제">×</button>' : '') +
          (canEditGuide(g) ? '<button type="button" class="guide__edit" data-edit-guide="' + esc(g.id) + '" aria-label="공략 수정">' +
            '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17 4 20z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg></button>' : '') +
          '</div>';
      });
      html += '</div>';
      if (S.guides.length > 4) {
        html += '<button type="button" class="btn btn--ghost btn--small guides__more" id="guide-more">' +
          (S.guideOpen ? '접어 두기' : '공략 더 보기 (' + (S.guides.length - 4) + ')') + '</button>';
      }
      if (!isLive()) {
        html += '<p class="section__note">체험 모드의 예시 카드예요. 실제 문파에서는 문파원 누구나 유튜브 주소를 붙여 넣어 공략을 올릴 수 있어요.</p>';
      }
    }
    html += '</section>';

    /* 문파원 자리비움 — 잠시 연못을 비우는 문파원 알림 (수정 없음 — 지우고 다시 등록) */
    html += '<section class="section" id="sec-absences" aria-labelledby="home-absence-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-absence-title">문파원 자리비움</h3>' +
      '<span class="section__hadd">' + (isLive() ? '<button type="button" class="tool tool--add" data-add="absence">+ 자리비움 등록</button>' : '') +
      '<span class="section__more">' + (S.absences.length ? S.absences.length + '건' : '지금은 모두 함께') + '</span></span></div>';

    if (!S.absences.length) {
      html += '<div class="empty">지금은 자리비움 중인 문파원이 없어요.' +
        (isLive() ? ' 위의 <b>+ 자리비움 등록</b>으로 잠시 비우는 기간을 알려 주세요.' : '') + '</div>';
    } else {
      html += '<div class="absences">';
      S.absences.forEach(function (a) {
        var state = absenceState(a);
        html += '<article class="absence">' +
          avatarSpan('avatar--xs', a.nickname, a.avatar) +
          '<div class="absence__main">' +
          '<div class="absence__top"><span class="absence__name">' + esc(a.nickname) + '</span>' +
          '<span class="badge ' + (state === '자리비움 중' ? 'badge--lotus' : 'badge--jade') + '">' + state + '</span>' +
          (a.is_proxy ? '<span class="badge badge--proxy">대리</span>' : '') + '</div>' +
          '<div class="absence__period">' + esc(shortDate(a.start_date)) + ' ~ ' + esc(shortDate(a.end_date)) + '</div>' +
          '<p class="absence__reason">' + esc(a.reason) + '</p>' +
          (a.is_proxy && a.proxy_by ? '<p class="absence__proxy">' + esc(a.proxy_by) + ' 님이 대신 올렸어요</p>' : '') +
          '</div>' +
          (canDeleteAbsence() ? '<button type="button" class="absence__del" data-del-absence="' + esc(a.id) + '" aria-label="' + esc(a.nickname) + ' 자리비움 삭제">×</button>' : '') +
          '</article>';
      });
      html += '</div>';
      if (!isLive()) {
        html += '<p class="section__note">체험 모드의 예시예요. 실제 문파에서는 로그인한 문파원 누구나 자리비움을 올리고, 삭제는 운영진만 할 수 있어요.</p>';
      }
    }
    html += '</section>';

    html += '<section class="section"><div class="privacy"><strong>이 연못에 대해</strong>' +
      (isLive()
        ? '<p>연못 문파원이 함께 쓰는 공간이에요. 공지 · 문파컨텐츠 · 쿠폰은 문주가, 채팅 · 앨범 · 공략 · 자리비움은 문파원 모두가 채웁니다.</p>' +
          '<p>이름 · 전화번호 · 이메일은 받지 않아요. 닉네임과 PIN 만 쓰고, PIN 은 되돌릴 수 없는 암호로만 저장돼요.</p>'
        : '<p>연못을 위한 작은 커뮤니티 앱의 체험 모드예요. 공지 · 문파컨텐츠 · 쿠폰 · 공략 · 자리비움 · 앨범 · 대화는 예시로 채워져 있습니다.</p>' +
          '<p>입력한 닉네임과 기록은 이 기기에만 저장돼요.</p>') +
      '</div></section>';

    $('#home-body').innerHTML = html;

    var waveBtn = $('#wave-btn');
    if (waveBtn) {
      waveBtn.addEventListener('click', function () {
        waveBtn.classList.add('is-pulsing');
        window.setTimeout(function () { waveBtn.classList.remove('is-pulsing'); }, 950);
        markAttendance(waveBtn);
      });
    }

    var myHomeEl = $('#myhome-card');
    if (myHomeEl) { myHomeEl.addEventListener('click', soonNotice); }

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

    /* 공략 썸네일 — 외부 썸네일이 안 뜨면 연못 그림이 그대로 비치게 */
    $$('.guide__img', $('#home-body')).forEach(function (img) {
      img.addEventListener('error', function () { img.classList.add('is-broken'); });
      img.addEventListener('load', function () { img.classList.add('is-loaded'); });
      if (img.complete && img.naturalWidth) { img.classList.add('is-loaded'); }
    });

    var guideMore = $('#guide-more');
    if (guideMore) {
      guideMore.addEventListener('click', function () {
        S.guideOpen = !S.guideOpen;
        renderHome();
      });
    }

    $$('.guide__link--sample', $('#home-body')).forEach(function (card) {
      var note = function () {
        toast('체험 모드의 예시 카드예요. 실제 문파에서는 올라온 유튜브 영상으로 열려요.');
      };
      card.addEventListener('click', note);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); note(); }
      });
    });

    $$('[data-del-guide]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        confirmDeleteGuide(btn.getAttribute('data-del-guide'));
      });
    });

    /* 바로가기 · 글 수정 — 누를 수 있는 사람에게만 버튼이 그려져 있습니다 */
    $$('[data-jump]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () { jumpToSection(btn); });
    });

    $$('[data-edit-notice]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-notice');
        var notice = S.notices.filter(function (x) { return x.id === id; })[0];
        if (notice) { openNoticeForm(notice); }
      });
    });

    $$('[data-edit-event]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-event');
        var event = S.events.filter(function (x) { return x.id === id; })[0];
        if (event) { openEventForm(event); }
      });
    });

    $$('[data-edit-coupon]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-edit-coupon');
        var coupon = S.coupons.filter(function (x) { return x.id === id; })[0];
        if (coupon) { openCouponForm(coupon); }
      });
    });

    $$('[data-edit-guide]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-edit-guide');
        var guide = S.guides.filter(function (x) { return x.id === id; })[0];
        if (guide) { openGuideForm(guide); }
      });
    });

    $$('[data-add]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-add');
        if (kind === 'notice') { openNoticeForm(); }
        else if (kind === 'event') { openEventForm(); }
        else if (kind === 'coupon') { openCouponForm(); }
        else if (kind === 'guide') { openGuideForm(); }
        else if (kind === 'absence') { openAbsenceForm(); }
      });
    });

    $$('[data-del-absence]', $('#home-body')).forEach(function (btn) {
      btn.addEventListener('click', function () { confirmDeleteAbsence(btn.getAttribute('data-del-absence')); });
    });

    if (admin) {
      $$('[data-del-notice]', $('#home-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmDeleteNotice(btn.getAttribute('data-del-notice')); });
      });
      $$('[data-pin]', $('#home-body')).forEach(function (btn) {
        btn.addEventListener('click', function () {
          toggleNoticePin(btn.getAttribute('data-pin'), btn.getAttribute('data-pinned') === '1');
        });
      });
      $$('[data-del-event]', $('#home-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmDeleteEvent(btn.getAttribute('data-del-event')); });
      });
      $$('[data-del-coupon]', $('#home-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmDeleteCoupon(btn.getAttribute('data-del-coupon')); });
      });
    }
  }

  function waveLabel(wave) {
    if (wave.today_done) { return '오늘의 물결 · ' + (wave.streak || 1) + '일째'; }
    if (wave.streak) { return '오늘의 물결 남기기 · ' + wave.streak + '일 이어가는 중'; }
    return '오늘의 물결 남기기';
  }

  function markAttendance(btn) {
    var wave = (S.me && S.me.wave) || { today_done: false, streak: 0 };
    if (wave.today_done) {
      toast('오늘은 이미 물결을 남기셨어요 · ' + (wave.streak || 1) + '일 연속');
      return;
    }

    if (isLive()) {
      DB.markAttendance().then(function (res) {
        S.me.wave = { today_done: true, streak: res.streak, total: res.total };
        if (S.clan) {
          S.clan.today_waves = (S.clan.today_waves || 0) + (res.already ? 0 : 1);
          S.clan.week_waves = (S.clan.week_waves || 0) + (res.already ? 0 : 1);
        }
        updateWaveButton(btn, S.me.wave);
        toast(res.already ? '오늘은 이미 물결을 남기셨어요 · ' + res.streak + '일 연속' : '물결을 남겼어요 · ' + res.streak + '일 연속 🪷');
      }).catch(function (err) {
        toast(errorMessage(err));
      });
      return;
    }

    var prev = store.get('attendance', null);
    var yesterday = dayKey(addDays(-1));
    var streak = prev && prev.date === yesterday ? (prev.streak || 1) + 1 : 1;
    store.set('attendance', { date: dayKey(new Date()), streak: streak });
    S.attendance = { date: dayKey(new Date()), streak: streak };
    S.me.wave = { today_done: true, streak: streak, total: streak };
    if (S.clan) { S.clan.today_waves = (S.clan.today_waves || 0) + 1; }
    updateWaveButton(btn, S.me.wave);
    toast(streak > 1 ? '물결을 남겼어요 · ' + streak + '일 연속 🪷' : '오늘의 첫 물결을 남겼어요 🪷');
  }

  function updateWaveButton(btn, wave) {
    if (!btn) { return; }
    btn.classList.add('is-done');
    btn.setAttribute('aria-pressed', 'true');
    var label = $('#wave-label', btn);
    if (label) { label.textContent = waveLabel(wave); }
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

  /* ============================================================
     채팅
     ============================================================ */
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

  function refreshChat() {
    if (!isLive()) { return; }
    DB.listChat(50).then(function (rows) {
      S.chat = (rows || []).map(mapChat).sort(function (a, b) { return a.id - b.id; });
      renderChat();
    }).catch(function () {});
  }

  function sendChat(raw) {
    var text = String(raw || '').trim().slice(0, 500);
    if (!text) { return; }

    if (isLive()) {
      var input = $('#chat-input');
      var send = $('#chat-send');
      send.disabled = true;
      DB.postChat(text).then(function (msg) {
        input.value = '';
        if (!S.chat.some(function (m) { return m.id === msg.id; })) {
          S.chat.push(mapChat({
            id: msg.id, member_id: msg.member_id, nickname: msg.nickname,
            role: msg.role, kind: 'text', body: msg.body, created_at: msg.created_at
          }));
          renderChat();
        }
        scrollChat(true);
      }).catch(function (err) {
        toast(errorMessage(err));
        send.disabled = false;
      });
      return;
    }

    var msg = {
      id: 'm-' + Date.now(),
      member_id: 'guest',
      nickname: S.user ? S.user.nick : '연못손님',
      roleLabel: '체험',
      kind: 'text',
      body: text,
      created_at: new Date().toISOString(),
      mine: true
    };
    S.chat.push(msg);

    if (!S.firstSendNoted && !store.get('firstSendNoted', false)) {
      S.chat.push({
        id: 'sys-' + Date.now(),
        member_id: null,
        nickname: null,
        roleLabel: '',
        kind: 'system',
        body: '체험 모드 안내 · 지금 보낸 메시지는 이 기기에만 남고 다른 문파원에게는 전달되지 않아요.',
        created_at: new Date(Date.now() + 1).toISOString(),
        mine: false
      });
      store.set('firstSendNoted', true);
      S.firstSendNoted = true;
    }

    persistTrialChat();
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
    var notice = $('#chat-notice');
    if (notice) {
      notice.textContent = isLive()
        ? '문파 채팅방이에요. 보낸 메시지는 문파원 모두에게 바로 보여요. 서로의 속도를 존중해 주세요.'
        : '체험용 대화방이에요. 보낸 메시지는 이 기기에만 저장되고 다른 사람에게는 전달되지 않아요.';
    }

    var list = $('#chat-list');
    if (!list) { return; }
    if (!S.chat.length) {
      list.innerHTML = '<div class="msg--system">아직 대화가 없어요. 먼저 인사 한마디 건네볼까요?</div>';
      return;
    }

    var admin = isAdmin();
    var html = '';
    S.chat.forEach(function (m) {
      if (m.kind === 'system') {
        html += '<div class="msg--system">' + esc(m.body) + '</div>';
        return;
      }
      var who = m.mine ? '나' : (m.nickname || '문파원');
      var chatAvatar = m.mine ? myAvatarValue() : (m.avatar || memberAvatarByName(m.nickname));
      html += '<div class="msg' + (m.mine ? ' msg--mine' : '') + '">' +
        avatarSpan('msg__avatar', m.nickname || '연', chatAvatar) +
        '<div class="msg__col">' +
        '<div class="msg__who"><span>' + esc(who) + '</span>' +
        (m.roleLabel ? '<span class="msg__role">' + esc(m.roleLabel) + '</span>' : '') +
        (admin ? '<button type="button" class="msg__del" data-del-msg="' + esc(m.id) + '" aria-label="메시지 지우기">지우기</button>' : '') +
        '</div>' +
        '<div class="msg__bubble">' + esc(m.body) + '</div>' +
        '<div class="msg__time">' + timeLabel(m.created_at) + '</div>' +
        '</div></div>';
    });
    list.innerHTML = html;
    scrollChat(false);

    if (admin) {
      $$('[data-del-msg]', list).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmDeleteMessage(btn.getAttribute('data-del-msg')); });
      });
    }
  }

  /* ============================================================
     앨범
     ============================================================ */
  function renderAlbum() {
    var admin = isAdmin();
    var html = '<header class="screen__head">' +
      '<p class="kicker">문파앨범</p>' +
      '<h2 class="screen__title">연못에 남긴 장면들</h2>' +
      '<p class="screen__sub">스크린샷과 추억을 함께 모아두는 곳이에요</p>' +
      '</header>';

    if (!isLive()) {
      html += '<div class="filters" role="group" aria-label="앨범 분류">';
      Object.keys(CATEGORY).forEach(function (name) {
        html += '<button type="button" class="chip' + (S.category === name ? ' is-active' : '') +
          '" data-category="' + esc(name) + '" aria-pressed="' + (S.category === name) + '">' + esc(name) + '</button>';
      });
      html += '</div>';
    }

    // 체험 모드는 그림 종류로 나누고, 실제 문파 앨범은 올라온 사진을 그대로 보여 줍니다.
    var allowed = CATEGORY[S.category];
    var items = isLive() ? S.album : S.album.filter(function (item) {
      return !allowed || allowed.indexOf(item.kind) !== -1;
    });

    html += '<div class="gallery">';
    if (!S.ready) {
      html += '<div class="empty" style="grid-column:1/-1">앨범을 불러오는 중이에요…</div>';
    } else if (!items.length) {
      html += '<div class="empty" style="grid-column:1/-1">아직 이곳에 남긴 장면이 없어요.</div>';
    }
    items.forEach(function (item) {
      var img = S.albumImages[item.id];
      var ready = img && img !== 'loading' && img !== 'failed';
      var text = albumText(item);
      var alt = text ? text.slice(0, 60) : '연못에 남긴 사진';
      var art = ready
        ? '<img class="shot__img" src="' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy">'
        : ((item.image_mime && img !== 'failed')
          ? '<span class="shot__loading">사진을 불러오는 중…</span>'
          : ART.scene(item.kind || 'moon'));
      var canDelete = admin || (isLive() && item.author_id && item.author_id === myId());
      var authorAvatar = memberAvatarById(item.author_id) || item.author_avatar;
      html += '<div class="shot" role="button" tabindex="0" data-shot="' + esc(item.id) + '" aria-label="' + esc(text ? text.slice(0, 40) : '사진') + ' 크게 보기">' +
        '<span class="shot__art">' + art + '</span>' +
        (relDayLabel(item.created_at) === relDayLabel(new Date()) ? '<span class="shot__new">NEW</span>' : '') +
        (canDelete ? '<button type="button" class="shot__del" data-del-album="' + esc(item.id) + '" aria-label="사진 지우기">×</button>' : '') +
        '<span class="shot__meta">' +
        (text ? '<span class="shot__title' + (item.caption ? ' shot__title--body' : '') + '">' + esc(text) + '</span>' : '') +
        '<span class="shot__sub">' + '<span class="shot__author">' + avatarSpan('avatar--xs', item.author, authorAvatar) + '<span>' + esc(item.author) + '</span></span>' +
        '<span class="shot__like" data-like-count="' + esc(item.id) + '">' +
        heartSvg(item.liked) + ' ' + item.likes + '</span></span>' +
        '</span></div>';
    });
    html += '</div>';

    html += '<div class="section"><button type="button" class="btn btn--ghost" id="upload-btn">사진 올리기</button>' +
      '<p class="section__note">' + (isLive()
        ? '사진은 긴 변 1,280px · 800KB 이하로 자동으로 줄여서 올라가요. 하루 10장까지 올릴 수 있습니다. 글은 안 적어도 돼요.'
        : '체험 모드에서는 사진 올리기가 열려 있지 않아요. 실제 문파로 들어가면 문파원 모두가 올릴 수 있습니다.') +
      '</p></div>';

    $('#album-body').innerHTML = html;

    $$('[data-category]', $('#album-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.category = btn.getAttribute('data-category');
        renderAlbum();
      });
    });

    $$('[data-shot]', $('#album-body')).forEach(function (card) {
      var open = function () { openLightbox(card.getAttribute('data-shot')); };
      card.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('[data-del-album]')) { return; }
        open();
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });

    if (isLive()) {
      $$('[data-del-album]', $('#album-body')).forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          confirmDeleteAlbum(btn.getAttribute('data-del-album'));
        });
      });
    }

    var upload = $('#upload-btn');
    if (upload) {
      upload.addEventListener('click', function () {
        if (!isLive()) {
          toast('체험 모드에서는 사진 올리기가 열려 있지 않아요. 실제 문파에서 올릴 수 있습니다.');
          return;
        }
        openAlbumForm();
      });
    }

    if (isLive()) { loadAlbumImages(items); }
  }

  function loadAlbumImages(items) {
    items.forEach(function (item) {
      if (!item.image_mime || S.albumImages[item.id]) { return; }
      S.albumImages[item.id] = 'loading';
      DB.albumImage(item.id).then(function (res) {
        S.albumImages[item.id] = res.data_url;
        var img = $('[data-shot="' + item.id + '"] .shot__art');
        if (img) {
          var text = albumText(item);
          img.innerHTML = '<img class="shot__img" src="' + esc(res.data_url) + '" alt="' + esc(text ? text.slice(0, 60) : '연못에 남긴 사진') + '" loading="lazy">';
        }
      }).catch(function () {
        S.albumImages[item.id] = 'failed';
        var img = $('[data-shot="' + item.id + '"] .shot__art');
        if (img) { img.innerHTML = ART.scene('moon'); }
      });
    });
  }

  function heartSvg(filled) {
    return '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 14S1.8 10.2 1.8 5.9A3.4 3.4 0 0 1 8 3.6a3.4 3.4 0 0 1 6.2 2.3C14.2 10.2 8 14 8 14z" fill="' +
      (filled ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="1.3"/></svg>';
  }

  function findAlbumItem(id) {
    return S.album.filter(function (a) { return a.id === id; })[0] || null;
  }

  /** 앨범 카드에 보여 줄 글 — 글이 있으면 글, 없으면 글 기능 이전에 올린 사진의 제목.
   *  둘 다 없으면 빈 글자를 돌려주고, 화면은 사진·작성자만 그립니다. */
  function albumText(item) {
    if (!item) { return ''; }
    return String(item.caption || item.title || '').replace(/\s+$/, '');
  }

  /** 서버(구버전 포함)는 제목 1~40자를 요구합니다. 글의 첫 줄을 제목 자리에 함께 보내
   *  화면에는 글만 보이게 하고, 글 없이 올리는 것은 새 스키마에서만 됩니다. */
  function albumTitleFor(text) {
    var lines = String(text || '').split('\n');
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i].trim();
      if (line) { return line.slice(0, 40); }
    }
    return '';
  }

  /* ------------------------------------------------------------
     사진 크게 보기 — 원본 해상도 그대로 띄우고, 확대·축소 / 끌어서 이동
     ------------------------------------------------------------ */
  var V = {
    open: false, scale: 1, base: 1, min: 1, max: 1, x: 0, y: 0,
    natW: 0, natH: 0, pointers: {}, pinch: null, drag: null,
    lastTap: 0, hintTimer: 0, bound: false
  };

  function stageBox() {
    var stage = $('#viewer-stage');
    var r = stage.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  function localPoint(e) {
    var st = stageBox();
    return { x: e.clientX - st.left, y: e.clientY - st.top };
  }

  function openViewer(src, alt) {
    var el = $('#viewer');
    if (!src || !el) { return; }
    var img = $('#viewer-img');
    V.open = true;
    V.scale = 1; V.base = 1; V.min = 1; V.max = 1; V.x = 0; V.y = 0;
    V.natW = 0; V.natH = 0; V.pointers = {}; V.pinch = null; V.drag = null; V.lastTap = 0;
    img.classList.add('is-loading');
    img.setAttribute('alt', alt || '연못에 남긴 사진');
    el.hidden = false;
    document.body.classList.add('is-locked');
    bindViewer();
    showViewerHint();

    var loaded = function () {
      V.natW = img.naturalWidth || 1;
      V.natH = img.naturalHeight || 1;
      img.style.width = V.natW + 'px';
      img.style.height = V.natH + 'px';
      img.classList.remove('is-loading');
      fitViewer(true);
    };
    img.onload = loaded;
    img.onerror = function () {
      toast('사진을 열지 못했어요.');
      closeViewer();
    };
    img.removeAttribute('style');
    img.src = src;
    if (img.complete && img.naturalWidth > 0) { loaded(); }
  }

  function closeViewer() {
    var el = $('#viewer');
    if (!el || el.hidden) { return; }
    V.open = false;
    V.pointers = {}; V.pinch = null; V.drag = null;
    el.hidden = true;
    var img = $('#viewer-img');
    img.style.transform = '';
    img.removeAttribute('src');
    window.clearTimeout(V.hintTimer);
    if ($('#modal').hidden) { document.body.classList.remove('is-locked'); }
  }

  function showViewerHint() {
    var hint = $('#viewer-hint');
    if (!hint) { return; }
    hint.classList.remove('is-fade');
    window.clearTimeout(V.hintTimer);
    V.hintTimer = window.setTimeout(function () { hint.classList.add('is-fade'); }, 3600);
  }

  /** 화면에 꼭 맞는 크기를 기준(base)으로 삼고, 그 기준에서 6배까지 넓힐 수 있게 합니다. */
  function fitViewer(reset) {
    var st = stageBox();
    var pad = 14;
    var availW = Math.max(60, st.w - pad * 2);
    var availH = Math.max(60, st.h - pad * 2 - 64);   // 위 조작줄 자리
    var fit = Math.min(availW / V.natW, availH / V.natH);
    V.base = Math.min(fit, 1);          // 작은 사진은 늘리지 않고 원래 크기까지만
    V.min = V.base;
    V.max = Math.max(V.base * 6, 1);
    if (reset) { V.scale = fit; V.x = 0; V.y = 0; }
    V.scale = Math.min(V.max, Math.max(V.min, V.scale));
    clampViewer();
    applyViewer();
    updateViewerButtons();
  }

  function clampViewer() {
    var st = stageBox();
    var mx = Math.max(0, (V.natW * V.scale - st.w) / 2);
    var my = Math.max(0, (V.natH * V.scale - st.h) / 2);
    V.x = Math.min(mx, Math.max(-mx, V.x));
    V.y = Math.min(my, Math.max(-my, V.y));
  }

  function applyViewer() {
    var img = $('#viewer-img');
    /* 그림은 left/top 50%에 놓여 있어 왼쪽 위 모서리가 판 가운데에 있습니다.
       몸통(그림) 가운데가 (판 가운데 + 이동값)에 오도록 그만큼 되돌립니다. */
    var tx = V.x - (V.natW * V.scale) / 2;
    var ty = V.y - (V.natH * V.scale) / 2;
    img.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + V.scale + ')';
  }

  function updateViewerButtons() {
    var outBtn = $('#viewer-out');
    var inBtn = $('#viewer-in');
    var pill = $('#viewer-fit');
    if (outBtn) { outBtn.disabled = V.scale <= V.min + 0.0005; }
    if (inBtn) { inBtn.disabled = V.scale >= V.max - 0.0005; }
    if (pill) { pill.textContent = V.scale < 0.999 ? '1:1' : '맞춤'; }
  }

  /** (ax, ay) 지점을 그 자리에 둔 채 배율만 바꿉니다. */
  function zoomViewerTo(next, ax, ay) {
    var st = stageBox();
    var s2 = Math.min(V.max, Math.max(V.min, next));
    if (Math.abs(s2 - V.scale) < 0.0008) { return; }
    var cx = st.w / 2, cy = st.h / 2;
    var px = (ax - cx - V.x) / V.scale;
    var py = (ay - cy - V.y) / V.scale;
    V.scale = s2;
    V.x = ax - cx - px * s2;
    V.y = ay - cy - py * s2;
    clampViewer();
    applyViewer();
    updateViewerButtons();
  }

  function viewerCenter() {
    var st = stageBox();
    return { x: st.w / 2, y: st.h / 2 };
  }

  function bindViewer() {
    if (V.bound) { return; }
    V.bound = true;
    var stage = $('#viewer-stage');
    stage.addEventListener('pointerdown', onViewerDown);
    stage.addEventListener('pointermove', onViewerMove);
    stage.addEventListener('pointerup', onViewerUp);
    stage.addEventListener('pointercancel', onViewerUp);
    stage.addEventListener('wheel', onViewerWheel, { passive: false });
    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer-in').addEventListener('click', function () {
      var c = viewerCenter();
      zoomViewerTo(V.scale * 1.7, c.x, c.y);
    });
    $('#viewer-out').addEventListener('click', function () {
      var c = viewerCenter();
      zoomViewerTo(V.scale / 1.7, c.x, c.y);
    });
    $('#viewer-fit').addEventListener('click', function () {
      var c = viewerCenter();
      if (V.scale < 0.999) { zoomViewerTo(Math.min(V.max, 1), c.x, c.y); }
      else { zoomViewerTo(V.base, c.x, c.y); }
    });
    window.addEventListener('resize', function () {
      if (V.open && V.natW) { fitViewer(false); }
    });
  }

  function onViewerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) { return; }
    var p = localPoint(e);
    V.pointers[e.pointerId] = { x: p.x, y: p.y };
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    var n = Object.keys(V.pointers).length;
    if (n === 1) {
      V.drag = { nx: p.x, ny: p.y, ox: V.x, oy: V.y, moved: 0, t: Date.now() };
      V.pinch = null;
    } else if (n === 2) {
      startPinch();
    }
    e.preventDefault();
  }

  function startPinch() {
    var ids = Object.keys(V.pointers);
    var a = V.pointers[ids[0]];
    var b = V.pointers[ids[1]];
    var d = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
    V.pinch = { d: d, s: V.scale, x: V.x, y: V.y, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    V.drag = null;
  }

  function onViewerMove(e) {
    if (!V.pointers[e.pointerId]) { return; }
    var p = localPoint(e);
    V.pointers[e.pointerId] = { x: p.x, y: p.y };
    var ids = Object.keys(V.pointers);

    if (ids.length >= 2 && V.pinch) {
      var a = V.pointers[ids[0]];
      var b = V.pointers[ids[1]];
      var d = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)) || 1;
      var mx = (a.x + b.x) / 2;
      var my = (a.y + b.y) / 2;
      var st = stageBox();
      var cx = st.w / 2, cy = st.h / 2;
      var s2 = Math.min(V.max, Math.max(V.min, V.pinch.s * (d / V.pinch.d)));
      var px = (V.pinch.mx - cx - V.pinch.x) / V.pinch.s;
      var py = (V.pinch.my - cy - V.pinch.y) / V.pinch.s;
      V.scale = s2;
      V.x = mx - cx - px * s2;
      V.y = my - cy - py * s2;
      clampViewer();
      applyViewer();
      updateViewerButtons();
      e.preventDefault();
      return;
    }

    if (V.drag) {
      var dx = p.x - V.drag.nx;
      var dy = p.y - V.drag.ny;
      V.drag.moved = Math.max(V.drag.moved, Math.abs(dx) + Math.abs(dy));
      if (V.scale > V.min + 0.0005) {
        V.x = V.drag.ox + dx;
        V.y = V.drag.oy + dy;
        clampViewer();
        applyViewer();
      }
      $('#viewer-stage').classList.add('is-dragging');
      if (V.drag.moved > 4) { e.preventDefault(); }
    }
  }

  function onViewerUp(e) {
    if (!V.pointers[e.pointerId]) { return; }
    var p = localPoint(e);
    var moved = V.drag ? V.drag.moved : 99;
    var started = V.drag ? V.drag.t : 0;
    delete V.pointers[e.pointerId];
    $('#viewer-stage').classList.remove('is-dragging');
    var ids = Object.keys(V.pointers);
    if (ids.length === 1) {
      var q = V.pointers[ids[0]];
      V.pinch = null;
      V.drag = { nx: q.x, ny: q.y, ox: V.x, oy: V.y, moved: 99, t: Date.now() };
      return;
    }
    if (ids.length > 1) { return; }
    V.pinch = null;
    V.drag = null;
    if (moved < 8 && Date.now() - started < 340) { tapViewer(p); }
  }

  /** 한 번 누르면 — 사진 밖은 닫기, 사진 안은 두 번 누르기로 확대/원래대로 */
  function tapViewer(p) {
    var st = stageBox();
    var dw = V.natW * V.scale;
    var dh = V.natH * V.scale;
    var left = st.w / 2 + V.x - dw / 2;
    var top = st.h / 2 + V.y - dh / 2;
    var onPhoto = p.x >= left && p.x <= left + dw && p.y >= top && p.y <= top + dh;
    if (!onPhoto) { closeViewer(); return; }
    var now = Date.now();
    if (now - V.lastTap < 320) {
      V.lastTap = 0;
      if (V.scale > V.base * 1.3) { zoomViewerTo(V.base, p.x, p.y); }
      else { zoomViewerTo(Math.min(V.max, V.base * 2.6), p.x, p.y); }
      return;
    }
    V.lastTap = now;
  }

  function onViewerWheel(e) {
    e.preventDefault();
    var p = localPoint(e);
    var f = Math.exp(-e.deltaY * 0.0016);
    zoomViewerTo(V.scale * f, p.x, p.y);
  }

  function openLightbox(id) {
    var item = findAlbumItem(id);
    if (!item) { return; }
    var image = S.albumImages[item.id];
    var text = albumText(item);
    var alt = text ? text.slice(0, 60) : '연못에 남긴 사진';
    var ready = image && image !== 'loading' && image !== 'failed';
    var art;
    if (ready) {
      /* 사진을 누르면 원본 해상도로 크게 보는 뷰어가 열립니다 */
      art = '<button type="button" class="lightbox__zoom" id="lightbox-zoom" aria-label="사진 원본 크게 보기">' +
        '<img class="shot__img" src="' + esc(image) + '" alt="' + esc(alt) + '">' +
        '<span class="lightbox__zoom-badge">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
        '크게 보기</span></button>';
    } else {
      art = (item.image_mime && image !== 'failed' ? '<span class="shot__loading">사진을 불러오는 중…</span>' : ART.scene(item.kind || 'moon'));
    }

    var canDelete = isAdmin() || (isLive() && item.author_id && item.author_id === myId());
    var canEdit = canEditAlbum(item);
    // 글이 있으면 글만, 글 기능 이전에 올린 사진은 제목을 그대로 머리말로 보여 줍니다.
    var heading = item.caption ? '연못의 장면' : (item.title || '연못의 장면');

    var html = '<div class="lightbox">' +
      '<div class="lightbox__art">' + art + '</div>' +
      modalTitle(heading) +
      '<p class="lightbox__meta">' + esc(item.author) + ' · ' + relDayLabel(item.created_at) + ' · 문파앨범</p>' +
      (item.caption ? '<p class="lightbox__caption">' + esc(item.caption) + '</p>' : '') +
      '<div class="lightbox__actions">' +
      '<button type="button" class="like-btn" id="like-btn" aria-pressed="' + item.liked + '">' +
      heartSvg(item.liked) + '<span id="like-text">물결 ' + item.likes + '</span></button>' +
      '<span class="section__more">마음이 닿으면 한 번 눌러주세요</span>' +
      '</div>' +
      ((canEdit || canDelete)
        ? '<div class="item-tools" style="justify-content:flex-start;margin-top:12px">' +
          (canEdit ? '<button type="button" class="tool tool--edit" id="album-edit">글 고치기</button>' : '') +
          (canDelete ? '<button type="button" class="tool tool--danger" id="album-del">이 사진 지우기</button>' : '') +
          '</div>'
        : '') +
      '</div>';
    openModal(html);

    var zoomBtn = $('#lightbox-zoom');
    if (zoomBtn) {
      zoomBtn.addEventListener('click', function () { openViewer(image, alt); });
    }

    var likeBtn = $('#like-btn');
    likeBtn.addEventListener('click', function () {
      if (isLive()) {
        DB.toggleAlbumLike(item.id).then(function (res) {
          item.liked = res.liked;
          item.likes = res.likes;
          likeBtn.setAttribute('aria-pressed', String(item.liked));
          likeBtn.innerHTML = heartSvg(item.liked) + '<span id="like-text">물결 ' + item.likes + '</span>';
          var counter = $('[data-like-count="' + item.id + '"]');
          if (counter) { counter.innerHTML = heartSvg(item.liked) + ' ' + item.likes; }
        }).catch(function (err) { toast(errorMessage(err)); });
        return;
      }
      item.liked = !item.liked;
      item.likes += item.liked ? 1 : -1;
      S.likes[item.id] = item.liked;
      store.set('likes', S.likes);
      likeBtn.setAttribute('aria-pressed', String(item.liked));
      likeBtn.innerHTML = heartSvg(item.liked) + '<span id="like-text">물결 ' + item.likes + '</span>';
      var counter = $('[data-like-count="' + item.id + '"]');
      if (counter) { counter.innerHTML = heartSvg(item.liked) + ' ' + item.likes; }
    });

    var del = $('#album-del');
    if (del) {
      del.addEventListener('click', function () {
        closeModal();
        confirmDeleteAlbum(item.id);
      });
    }

    var edit = $('#album-edit');
    if (edit) {
      edit.addEventListener('click', function () { openAlbumTextForm(item); });
    }
  }

  /** 앨범 사진 글 고치기 — 사진은 그대로 두고 글만 바꿉니다. 비우면 사진만 남습니다. */
  function openAlbumTextForm(item) {
    var LIMIT = 300;
    var text = albumText(item);
    openModal(modalTitle('사진 글 고치기') +
      '<p class="lightbox__meta">사진은 그대로 두고 글만 바꿔요. 글을 비우면 사진만 남습니다.</p>' +
      '<form class="form" id="album-edit-form" novalidate style="margin-top:14px">' +
      '<label class="field"><span class="field__label">글 <span class="field__opt">(선택)</span></span>' +
      '<textarea class="field__input field__textarea" id="album-edit-caption" maxlength="' + LIMIT + '" rows="4" placeholder="남기고 싶은 말이 있으면 적어 주세요. 비워 두면 사진만 남아요.">' + esc(text) + '</textarea>' +
      '<span class="field__count" id="album-edit-count" aria-live="polite">' + text.length + ' / ' + LIMIT + '</span></label>' +
      '<p class="form__error" id="album-edit-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">글 고치기</button>' +
      '</form>');

    var form = $('#album-edit-form');
    var captionEl = $('#album-edit-caption');
    var countEl = $('#album-edit-count');
    captionEl.addEventListener('input', function () {
      countEl.textContent = captionEl.value.length + ' / ' + LIMIT;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var caption = captionEl.value.trim();
      var errEl = $('#album-edit-error');
      if (caption.length > LIMIT) {
        errEl.textContent = '글은 ' + LIMIT + '자까지 쓸 수 있어요.';
        errEl.hidden = false;
        return;
      }
      var btn = $('button[type="submit"]', form);
      btn.disabled = true;

      if (!isLive()) {
        item.caption = caption;
        item.title = albumTitleFor(caption);
        closeModal();
        toast('글을 고쳤어요.');
        renderAlbum();
        return;
      }

      DB.updateAlbumPostText(item.id, caption).then(function (res) {
        item.caption = (res && res.caption !== undefined) ? res.caption : caption;
        item.title = (res && res.title !== undefined) ? res.title : albumTitleFor(caption);
        closeModal();
        toast('글을 고쳤어요.');
        renderAlbum();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = editErrorHint(err);
        errEl.hidden = false;
      });
    });
  }

  function openAlbumForm() {
    openModal(modalTitle('사진 올리기') +
      '<p class="lightbox__meta">스크린샷이나 연못에서 찍은 장면을 남겨 보세요. 글은 안 적어도 올라가요.</p>' +
      '<form class="form" id="album-form" novalidate style="margin-top:14px">' +
      '<label class="field"><span class="field__label">사진</span>' +
      '<input class="field__input field__file" type="file" accept="image/jpeg,image/png,image/webp" id="album-file">' +
      '</label>' +
      '<label class="field"><span class="field__label">글 <span class="field__opt">(선택)</span></span>' +
      '<textarea class="field__input field__textarea" id="album-caption" maxlength="300" rows="4" placeholder="남기고 싶은 말이 있으면 적어 주세요. 안 적어도 올라가요."></textarea>' +
      '<span class="field__count" id="album-count" aria-live="polite">0 / 300</span></label>' +
      '<p class="form__error" id="album-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">연못에 남기기</button>' +
      '</form>');

    var form = $('#album-form');
    var captionEl = $('#album-caption');
    var countEl = $('#album-count');
    var LIMIT = 300;
    captionEl.addEventListener('input', function () {
      countEl.textContent = captionEl.value.length + ' / ' + LIMIT;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fileInput = $('#album-file');
      var caption = captionEl.value.trim();
      var errEl = $('#album-error');
      var file = fileInput.files && fileInput.files[0];

      if (!file) {
        errEl.textContent = '사진을 골라 주세요.';
        errEl.hidden = false;
        return;
      }
      if (caption.length > LIMIT) {
        errEl.textContent = '글은 ' + LIMIT + '자까지 쓸 수 있어요.';
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;

      var btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = '사진을 줄이는 중…';

      DB.compressPhoto(file).then(function (photo) {
        btn.textContent = '연못에 남기는 중…';
        return DB.createAlbumPost(albumTitleFor(caption), photo.dataUrl, caption, photo.mime).then(function (created) {
          if (created && created.id) { S.albumImages[created.id] = photo.dataUrl; }
          return created;
        });
      }).then(function () {
        closeModal();
        toast('사진을 남겼어요 🪷');
        return DB.listAlbum(12).then(function (rows) {
          S.album = (rows || []).map(mapAlbum);
          renderAlbum();
        });
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '연못에 남기기';
        var msg = errorMessage(err);
        // 서버가 아직 글 없는 사진을 받지 않을 때(제목 필수 스키마) — 화면에서는 글로 안내합니다.
        if (!caption && msg.indexOf('제목') !== -1) {
          msg = '지금은 글을 한 줄이라도 적어야 사진이 올라가요. 서버 준비가 끝나면 글 없이도 올라가요.';
        }
        errEl.textContent = msg;
        errEl.hidden = false;
      });
    });
  }

  /* ============================================================
     문파원
     ============================================================ */
  function refreshMembers() {
    if (!isLive()) { renderMembers(); return; }
    var job = isAdmin() ? loadAdminMembers() : DB.listMembers().then(function (rows) {
      S.members = (rows || []).map(function (m) { return mapMember(m, false); });
    });
    job.then(renderMembers).catch(function (err) {
      toast(errorMessage(err));
      renderMembers();
    });
  }

  function renderMembers() {
    var admin = isAdmin();
    var all = S.members.slice();
    var online = all.filter(function (m) { return m.online; }).length;
    var activeCount = all.filter(function (m) { return m.status === 'active'; }).length;

    var html = '<header class="screen__head">' +
      '<p class="kicker">문파원</p>' +
      '<h2 class="screen__title">함께 있는 사람들</h2>' +
      '<p class="screen__sub">' + fmtNum(activeCount) + '명의 문파원이 연못을 지키고 있어요</p>' +
      '</header>';

    html += '<div class="member-stats">' +
      '<div class="stat"><strong>' + fmtNum(activeCount) + '</strong><span>전체 문파원</span></div>' +
      '<div class="stat"><strong>' + fmtNum(online) + '</strong><span>지금 접속</span></div>' +
      '<div class="stat"><strong>+' + fmtNum(S.clan ? S.clan.new_members_7d : 0) + '</strong><span>이번 주 새 식구</span></div>' +
      '</div>';

    html += '<div class="member-tools">' +
      '<div class="search">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.6 15.6 20 20" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>' +
      '<input type="search" id="member-search" placeholder="닉네임으로 찾기" aria-label="문파원 닉네임 검색" value="' + esc(S.query) + '">' +
      '</div></div>';

    var filters = isLive()
      ? [['all', '전체'], ['online', '접속 중'], ['offline', '조용한 문파원']]
      : [['all', '전체'], ['on', '접속 중'], ['away', '자리 비움']];
    if (admin) { filters = filters.concat([['kicked', '내보냄'], ['banned', '차단']]); }

    html += '<div class="filters" role="group" aria-label="접속 상태 필터" style="margin-left:0;margin-right:0;padding-left:0;padding-right:0">';
    filters.forEach(function (pair) {
      html += '<button type="button" class="chip' + (S.memberFilter === pair[0] ? ' is-active' : '') +
        '" data-mfilter="' + pair[0] + '" aria-pressed="' + (S.memberFilter === pair[0]) + '">' + pair[1] + '</button>';
    });
    html += '</div>';

    var q = S.query.trim().toLowerCase();
    var rows = all.filter(function (m) {
      if (isLive() && m.status !== 'active' && S.memberFilter !== 'kicked' && S.memberFilter !== 'banned') { return false; }
      if (S.memberFilter !== 'all' && m.filterKey !== S.memberFilter && !(S.memberFilter === 'offline' && m.filterKey === 'off') && !(S.memberFilter === 'away' && m.filterKey === 'off')) { return false; }
      if (q && m.nickname.toLowerCase().indexOf(q) === -1) { return false; }
      return true;
    });

    html += '<div class="member-list">';
    if (!S.ready && isLive()) {
      html += '<div class="empty">문파원을 불러오는 중이에요…</div>';
    } else if (!rows.length) {
      html += '<div class="empty">조건에 맞는 문파원이 없어요.</div>';
    }
    rows.forEach(function (m) {
      var statusLabel = m.statusLabel || (m.online ? '접속 중' : '자리 비움');
      var metaRight = (m.online && m.status === 'active') ? '' : m.lastLabel;
      var joined = joinedLabel(m.joined_at);
      var statusClass = m.online ? 'on' : 'off';
      var tools = '';

      if (admin && !m.me) {
        if (m.status === 'active') {
          tools = '<div class="member__tools">' +
            '<button type="button" class="tool" data-role="' + esc(m.id) + '" data-next="' + (m.role === 'officer' ? 'member' : 'officer') + '">' +
            (m.role === 'officer' ? '문파원으로' : '운영진으로') + '</button>' +
            '<button type="button" class="tool" data-kick="' + esc(m.id) + '">내보내기</button>' +
            '<button type="button" class="tool tool--danger" data-ban="' + esc(m.id) + '">차단</button>' +
            '</div>';
        } else {
          tools = '<div class="member__tools">' +
            '<button type="button" class="tool" data-restore="' + esc(m.id) + '">다시 들이기</button>' +
            '</div>';
        }
      }

      html += '<article class="member' + (m.me ? ' member--me' : '') + (admin ? ' member--admin' : '') + '">' +
        avatarSpan('member__avatar', m.nickname, m.avatar,
          '<span class="status status--' + statusClass + '"></span>') +
        '<div class="member__info">' +
        '<div class="member__name"><span>' + esc(m.nickname) + '</span>' +
        (m.me ? '<span class="member__me-tag">나</span>' : '') +
        '<span class="role ' + (m.roleClass || '') + '">' + esc(m.roleLabel || '문파원') + '</span></div>' +
        '<div class="member__meta"><span>' + esc(statusLabel) + '</span>' +
        (metaRight ? '<span class="sep">·</span><span>' + esc(metaRight) + '</span>' : '') +
        (joined ? '<span class="sep">·</span><span class="member__joined">' + esc(joined) + '</span>' : '') +
        '</div>' +
        '</div>' +
        '<div class="member__level">' + (m.level ? 'Lv.' + m.level : 'Lv.–') + '<span>연못 등급</span></div>' +
        tools +
        '</article>';
    });
    html += '</div>';

    html += '<p class="section__note">' + (isLive()
      ? '연못 등급은 문파 안에서 정한 숫자예요. 접속 상태는 마지막으로 인사한 시각을 기준으로 보여 줍니다.'
      : '접속 상태와 등급은 체험용 예시 데이터예요.') + '</p>';

    $('#members-body').innerHTML = html;

    $$('[data-mfilter]', $('#members-body')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.memberFilter = btn.getAttribute('data-mfilter');
        renderMembers();
      });
    });

    var search = $('#member-search');
    if (search) {
      search.addEventListener('input', function () {
        S.query = search.value;
        var pos = search.selectionStart;
        renderMembers();
        var next = $('#member-search');
        if (next) {
          next.focus();
          try { next.setSelectionRange(pos, pos); } catch (e) { /* noop */ }
        }
      });
    }

    if (admin) {
      $$('[data-role]', $('#members-body')).forEach(function (btn) {
        btn.addEventListener('click', function () {
          changeRole(btn.getAttribute('data-role'), btn.getAttribute('data-next'));
        });
      });
      $$('[data-kick]', $('#members-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmMemberAction('kick', btn.getAttribute('data-kick')); });
      });
      $$('[data-ban]', $('#members-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { confirmMemberAction('ban', btn.getAttribute('data-ban')); });
      });
      $$('[data-restore]', $('#members-body')).forEach(function (btn) {
        btn.addEventListener('click', function () { restoreMember(btn.getAttribute('data-restore')); });
      });
    }
  }

  function memberById(id) {
    return S.members.filter(function (m) { return m.id === id; })[0] || null;
  }

  function changeRole(id, nextRole) {
    var m = memberById(id);
    if (!m) { return; }
    DB.admin.setRole(id, nextRole).then(function () {
      toast(m.nickname + ' 님을 ' + (nextRole === 'officer' ? '운영진' : '문파원') + '으로 바꿨어요.');
      refreshMembers();
    }).catch(function (err) { toast(errorMessage(err)); });
  }

  function restoreMember(id) {
    var m = memberById(id);
    DB.admin.restore(id).then(function () {
      toast((m ? m.nickname + ' 님을' : '문파원을') + ' 다시 들였어요.');
      refreshMembers();
    }).catch(function (err) { toast(errorMessage(err)); });
  }

  function confirmMemberAction(kind, id) {
    var m = memberById(id);
    var name = m ? m.nickname : '문파원';
    var isBan = kind === 'ban';
    openModal(modalTitle(name + ' 님을 ' + (isBan ? '차단할까요?' : '내보낼까요?')) +
      '<p class="lightbox__meta">' + (isBan
        ? '차단하면 같은 닉네임으로 다시 가입할 수 없어요. 되돌리려면 다시 들이면 됩니다.'
        : '내보내면 바로 로그아웃되고 다시 들어올 수 없어요. 같은 닉네임은 다시 쓸 수 없습니다.') + '</p>' +
      '<label class="field" style="margin-top:12px"><span class="field__label">이유 (선택 · 본인에게는 보이지 않아요)</span>' +
      '<input class="field__input" type="text" id="member-reason" maxlength="200" placeholder="예) 오랫동안 함께하지 못했어요"></label>' +
      '<p class="form__error" id="member-error" role="alert" hidden></p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="btn btn--primary" id="member-ok">' + (isBan ? '차단하기' : '내보내기') + '</button>' +
      '<button type="button" class="btn btn--ghost" data-close="1">그대로 두기</button>' +
      '</div>');

    $('#member-ok').addEventListener('click', function () {
      var btn = this;
      var reason = $('#member-reason').value.trim();
      btn.disabled = true;
      var job = isBan ? DB.admin.ban(id, reason) : DB.admin.kick(id, reason);
      job.then(function () {
        closeModal();
        toast(name + ' 님을 ' + (isBan ? '차단했어요.' : '내보냈어요.'));
        refreshMembers();
      }).catch(function (err) {
        btn.disabled = false;
        var errEl = $('#member-error');
        errEl.textContent = errorMessage(err);
        errEl.hidden = false;
      });
    });
  }

  /* ============================================================
     관리자: 공지 · 문파컨텐츠 · 쿠폰
     ============================================================ */
  function confirmDeleteNotice(id) {
    var n = S.notices.filter(function (x) { return x.id === id; })[0];
    confirmAction('공지를 지울까요?', '“' + (n ? n.title : '공지') + '”이 바로 내려가요. 되돌릴 수 없습니다.', '지우기', function () {
      return DB.admin.deleteNotice(id).then(function () {
        S.notices = S.notices.filter(function (x) { return x.id !== id; });
        S.noticeRows = (S.noticeRows || []).filter(function (x) { return x.id !== id; });
        renderHome();
        toast('공지를 지웠어요.');
      });
    });
  }

  function toggleNoticePin(id, pinned) {
    var row = null;
    (S.noticeRows || []).forEach(function (x) { if (x.id === id) { row = x; } });
    if (!row) { return; }
    row.pinned = !pinned;
    DB.rpc('admin_pin_notice', { p_token: DB.token(), p_notice_id: id, p_pinned: !pinned }).then(function () {
      S.notices = (S.noticeRows || []).map(mapNotice);
      renderHome();
      toast(!pinned ? '공지를 위로 고정했어요.' : '고정을 풀었어요.');
    }).catch(function (err) { toast(errorMessage(err)); });
  }

  function confirmDeleteEvent(id) {
    var ev = S.events.filter(function (x) { return x.id === id; })[0];
    confirmAction('문파컨텐츠를 지울까요?', '“' + (ev ? ev.title : '문파컨텐츠') + '”가 목록에서 사라져요.', '지우기', function () {
      return DB.admin.deleteEvent(id).then(function () {
        S.events = S.events.filter(function (x) { return x.id !== id; });
        renderHome();
        toast('문파컨텐츠를 지웠어요.');
      });
    });
  }

  function confirmDeleteCoupon(id) {
    var c = S.coupons.filter(function (x) { return x.id === id; })[0];
    confirmAction('쿠폰을 지울까요?', '“' + (c ? c.code : '쿠폰') + '”이 더 이상 보이지 않아요.', '지우기', function () {
      return DB.admin.deleteCoupon(id).then(function () {
        S.coupons = S.coupons.filter(function (x) { return x.id !== id; });
        renderHome();
        toast('쿠폰을 지웠어요.');
      });
    });
  }

  function confirmDeleteMessage(id) {
    confirmAction('이 메시지를 지울까요?', '지운 메시지는 내용이 바로 비워져 문파원 모두에게서 사라져요.', '지우기', function () {
      return DB.admin.deleteChatMessage(Number(id)).then(function () {
        S.chat = S.chat.filter(function (m) { return String(m.id) !== String(id); });
        renderChat();
        toast('메시지를 지웠어요.');
      });
    });
  }

  function confirmDeleteAlbum(id) {
    var item = findAlbumItem(id);
    var isMine = item && item.author_id && item.author_id === myId();
    var adminDeletingOther = isAdmin() && !isMine;
    confirmAction('이 사진을 지울까요?', '사진과 설명이 모두 사라지고 되돌릴 수 없어요.', '지우기', function () {
      var job = adminDeletingOther ? DB.admin.deleteAlbumPost(id) : DB.deleteOwnAlbumPost(id);
      return job.then(function () {
        S.album = S.album.filter(function (a) { return a.id !== id; });
        delete S.albumImages[id];
        closeModal();
        renderAlbum();
        toast('사진을 지웠어요.');
      });
    });
  }

  function confirmAction(title, text, okLabel, onOk) {
    openModal(modalTitle(title) +
      '<p class="lightbox__meta">' + esc(text) + '</p>' +
      '<p class="form__error" id="confirm-error" role="alert" hidden></p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="btn btn--primary" id="confirm-ok">' + esc(okLabel) + '</button>' +
      '<button type="button" class="btn btn--ghost" data-close="1">그대로 두기</button>' +
      '</div>');

    $('#confirm-ok').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      Promise.resolve(onOk()).then(function () {
        closeModal();
      }).catch(function (err) {
        btn.disabled = false;
        var errEl = $('#confirm-error');
        if (!errEl) {
          toast(errorMessage(err));
          return;
        }
        errEl.textContent = errorMessage(err);
        errEl.hidden = false;
      });
    });
  }

  /** 공지 쓰기 · 수정 — notice 를 넘기면 기존 값이 채워진 수정 창이 열립니다 */
  function openNoticeForm(notice) {
    var editing = !!notice;
    openModal(modalTitle(editing ? '공지 수정' : '공지 쓰기') +
      '<form class="form" id="notice-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">제목</span>' +
      '<input class="field__input" type="text" id="notice-title" maxlength="60" placeholder="예) 연꽃 등불 축제 단체 참가 신청" value="' + esc(notice ? notice.title : '') + '"></label>' +
      '<label class="field"><span class="field__label">내용</span>' +
      '<textarea class="field__input field__textarea" id="notice-body" rows="6" maxlength="4000" placeholder="문파원에게 전할 이야기를 적어 주세요">' + esc(notice ? notice.body : '') + '</textarea></label>' +
      '<div class="form__row">' +
      '<label class="field"><span class="field__label">태그</span>' +
      '<input class="field__input" type="text" id="notice-tag" maxlength="10" value="' + esc(notice ? (notice.tag || '공지') : '공지') + '"></label>' +
      '<label class="check"><input type="checkbox" id="notice-pinned"' + (notice && notice.pinned ? ' checked' : '') + '> 위에 고정</label>' +
      '</div>' +
      '<p class="form__error" id="notice-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">' + (editing ? '공지 고치기' : '공지 올리기') + '</button>' +
      '</form>');

    $('#notice-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#notice-title').value.trim();
      var body = $('#notice-body').value.trim();
      var tag = $('#notice-tag').value.trim() || '공지';
      var pinned = $('#notice-pinned').checked;
      var errEl = $('#notice-error');
      if (!title || !body) {
        errEl.textContent = '제목과 내용을 모두 적어 주세요.';
        errEl.hidden = false;
        return;
      }
      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      var job;
      if (!isLive()) {
        S.notices = S.notices.map(function (x) {
          return x.id === notice.id
            ? Object.assign({}, x, { title: title, body: body, tag: tag, pinned: pinned })
            : x;
        });
        job = Promise.resolve();
      } else if (editing) {
        job = DB.admin.updateNotice(notice.id, title, body, tag, pinned);
      } else {
        job = DB.admin.createNotice(title, body, tag, pinned);
      }

      job.then(function () {
        closeModal();
        toast(editing ? '공지를 고쳤어요.' : '공지를 올렸어요.');
        if (!isLive()) { renderHome(); return; }
        return reloadClanContent().then(function () { renderHome(); });
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = editErrorHint(err);
        errEl.hidden = false;
      });
    });
  }

  function mapEvents(rows) {
    return (rows || []).map(function (ev) {
      return {
        id: ev.id, title: ev.title, place: ev.place || '', tag: ev.tag || '모임',
        note: ev.note || '', starts_at: ev.starts_at, ends_at: ev.ends_at,
        repeat_weekly: !!ev.repeat_weekly,
        repeat_weekdays: ev.repeat_weekly ? repeatDays(ev.repeat_weekdays) : []
      };
    }).sort(function (a, b) { return eventMoment(a) - eventMoment(b); });
  }

  /** 폼이 만든 값 → 카드·목록이 쓰는 모양 (체험 모드에서 서버 없이 바로 반영) */
  function eventFromPayload(payload, id) {
    return {
      id: id, title: payload.title, place: payload.place || '', tag: payload.tag || '모임',
      note: payload.note || '', starts_at: payload.startsAt, ends_at: null,
      repeat_weekly: !!payload.repeatWeekly,
      repeat_weekdays: payload.repeatWeekly ? repeatDays(payload.repeatWeekdays) : []
    };
  }

  /** 문파컨텐츠 추가 · 수정 — event 를 넘기면 기존 값(한 번/매주·요일·시간)이 채워진 창이 열립니다 */
  function openEventForm(event) {
    var editing = !!event;
    var value = editing ? toLocalInput(event.starts_at) : '';
    if (!value) {
      var now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      value = toLocalInput(now.toISOString());
    }
    var base = new Date(value);
    if (isNaN(base.getTime())) { base = new Date(); }
    var picked = editing ? repeatDays(event.repeat_weekdays) : [];
    var weekly = editing && !!event.repeat_weekly && picked.length > 0;
    var timeValue = pad(base.getHours()) + ':' + pad(base.getMinutes());

    /* 요일 칩 — 화면에는 월 … 일 순서, 값은 0=일 … 6=토 (DB 와 같습니다) */
    var chips = '';
    [1, 2, 3, 4, 5, 6, 0].forEach(function (d) {
      var on = picked.indexOf(d) !== -1;
      chips += '<button type="button" class="daychip' + (on ? ' is-on' : '') + '" data-day="' + d + '"' +
        ' aria-pressed="' + (on ? 'true' : 'false') + '">' + WEEKDAYS[d] + '</button>';
    });

    openModal(modalTitle(editing ? '문파컨텐츠 수정' : '문파컨텐츠 추가') +
      '<form class="form" id="event-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">문파컨텐츠 이름</span>' +
      '<input class="field__input" type="text" id="event-title" maxlength="60" placeholder="예) 주간 보스 원정" value="' + esc(event ? event.title : '') + '"></label>' +
      '<div class="seg seg--repeat" role="tablist" aria-label="반복 설정" id="event-repeat">' +
      '<button type="button" class="seg__btn' + (weekly ? '' : ' is-active') + '" role="tab" aria-selected="' + (weekly ? 'false' : 'true') + '" id="event-repeat-off" data-repeat="off" aria-controls="event-once">한 번만</button>' +
      '<button type="button" class="seg__btn' + (weekly ? ' is-active' : '') + '" role="tab" aria-selected="' + (weekly ? 'true' : 'false') + '" id="event-repeat-on" data-repeat="on" aria-controls="event-weekly">매주 반복</button>' +
      '</div>' +
      '<label class="field" id="event-once"' + (weekly ? ' hidden' : '') + '><span class="field__label">날짜와 시간</span>' +
      '<input class="field__input" type="datetime-local" id="event-start" value="' + value + '"></label>' +
      '<div class="field" id="event-weekly"' + (weekly ? '' : ' hidden') + '>' +
      '<span class="field__label">반복할 요일 (여러 개 고를 수 있어요)</span>' +
      '<div class="daychips" id="event-days" role="group" aria-label="반복할 요일">' + chips + '</div>' +
      '<label class="field field--time"><span class="field__label">시작 시간</span>' +
      '<input class="field__input field__input--time" type="time" id="event-time" value="' + timeValue + '" step="300"></label>' +
      '</div>' +
      '<label class="field"><span class="field__label">모이는 곳</span>' +
      '<input class="field__input" type="text" id="event-place" maxlength="60" placeholder="예) 연못 입구 · 3구역" value="' + esc(event ? event.place : '') + '"></label>' +
      '<div class="form__row">' +
      '<label class="field"><span class="field__label">태그</span>' +
      '<input class="field__input" type="text" id="event-tag" maxlength="10" value="' + esc(event ? (event.tag || '모임') : '모임') + '"></label>' +
      '<label class="field"><span class="field__label">메모 (선택)</span>' +
      '<input class="field__input" type="text" id="event-note" maxlength="200" placeholder="예) 21:20까지 모여주세요" value="' + esc(event ? event.note : '') + '"></label>' +
      '</div>' +
      '<p class="form__error" id="event-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">' + (editing ? '문파컨텐츠 고치기' : '문파컨텐츠 남기기') + '</button>' +
      '</form>');

    var form = $('#event-form');
    var errEl = $('#event-error');
    var onceBox = $('#event-once');
    var weeklyBox = $('#event-weekly');
    var mode = weekly ? 'on' : 'off';

    function pickedDays() {
      return $$('#event-days .daychip').filter(function (chip) {
        return chip.classList.contains('is-on');
      }).map(function (chip) { return Number(chip.getAttribute('data-day')); })
        .sort(function (a, b) { return a - b; });
    }

    function setMode(next) {
      if (next === mode) { return; }
      /* 한 번만 ↔ 매주 반복 — 고른 시간이 사라지지 않게 서로 넘겨 줍니다 */
      if (next === 'on') {
        var once = new Date($('#event-start').value);
        if (!isNaN(once.getTime())) {
          $('#event-time').value = pad(once.getHours()) + ':' + pad(once.getMinutes());
        }
        if (!pickedDays().length) { $('#event-time').value = $('#event-time').value || '21:00'; }
      } else {
        var parts = String($('#event-time').value || '').split(':');
        var hh = Number(parts[0]);
        var mm = Number(parts[1]);
        if (parts.length < 2 || isNaN(hh) || isNaN(mm)) { hh = 21; mm = 0; }
        var days = pickedDays();
        $('#event-start').value = toLocalInput(nextWeeklyFrom(days.length ? days : [1], hh, mm).toISOString());
      }
      mode = next;
      $$('#event-repeat [data-repeat]').forEach(function (btn) {
        var on = btn.getAttribute('data-repeat') === next;
        if (on) { btn.classList.add('is-active'); } else { btn.classList.remove('is-active'); }
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      onceBox.hidden = next === 'on';
      weeklyBox.hidden = next !== 'on';
      errEl.hidden = true;
    }

    $$('#event-repeat [data-repeat]').forEach(function (btn) {
      btn.addEventListener('click', function () { setMode(btn.getAttribute('data-repeat')); });
    });

    $$('#event-days .daychip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var on = chip.classList.toggle('is-on');
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        errEl.hidden = true;
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#event-title').value.trim();
      var weeklyOn = mode === 'on';
      var days = pickedDays();
      if (!title) {
        errEl.textContent = '문파컨텐츠 이름을 적어 주세요.';
        errEl.hidden = false;
        return;
      }
      var start = null;
      if (weeklyOn) {
        if (!days.length) {
          errEl.textContent = '매주 반복은 요일을 하나 이상 골라 주세요.';
          errEl.hidden = false;
          return;
        }
        var parts = String($('#event-time').value || '').split(':');
        var hh = Number(parts[0]);
        var mm = Number(parts[1]);
        if (parts.length < 2 || parts[0] === '' || parts[1] === '' || isNaN(hh) || isNaN(mm)) {
          errEl.textContent = '매주 반복할 시작 시간을 정해 주세요.';
          errEl.hidden = false;
          return;
        }
        start = nextWeeklyFrom(days, hh, mm);
      } else {
        var startRaw = $('#event-start').value;
        if (!startRaw) {
          errEl.textContent = '문파컨텐츠 이름과 날짜·시간을 정해 주세요.';
          errEl.hidden = false;
          return;
        }
        start = new Date(startRaw);
        if (isNaN(start.getTime())) {
          errEl.textContent = '날짜와 시간을 다시 확인해 주세요.';
          errEl.hidden = false;
          return;
        }
      }
      var btn = $('button[type="submit"]', form);
      btn.disabled = true;

      var payload = {
        title: title,
        startsAt: start.toISOString(),
        place: $('#event-place').value.trim(),
        tag: $('#event-tag').value.trim() || '모임',
        note: $('#event-note').value.trim(),
        repeatWeekly: weeklyOn,
        repeatWeekdays: weeklyOn ? days : []
      };

      if (!isLive()) {
        if (editing) {
          S.events = mapEvents(S.events.map(function (ev) {
            return ev.id === event.id ? eventFromPayload(payload, ev.id) : ev;
          }));
        } else {
          S.events = mapEvents(S.events.concat([eventFromPayload(payload, 'e' + Date.now())]));
        }
        closeModal();
        toast(editing ? '문파컨텐츠를 고쳤어요.' : '문파컨텐츠를 남겼어요.');
        renderHome();
        return;
      }

      S.eventPending = true;
      var job = editing ? DB.admin.updateEvent(event.id, payload) : DB.admin.createEvent(payload);
      job.then(function () {
        S.eventPending = false;
        closeModal();
        toast(editing ? '문파컨텐츠를 고쳤어요.' : '문파컨텐츠를 남겼어요.');
        return DB.listEvents().then(function (rows) { S.events = mapEvents(rows); });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = editErrorHint(err);
        errEl.hidden = false;
      });
    });
  }

  function mapCoupons(rows) {
    return (rows || []).map(function (c) {
      return { id: c.id, code: c.code, title: c.title, reward: c.reward, expires_on: c.expires_on, tone: c.tone || 'lotus' };
    });
  }

  /** 쿠폰 만들기 · 수정 — coupon 을 넘기면 코드·유효기간이 채워진 수정 창이 열립니다 */
  function openCouponForm(coupon) {
    var editing = !!coupon;
    openModal(modalTitle(editing ? '쿠폰 수정' : '쿠폰 만들기') +
      '<form class="form" id="coupon-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">쿠폰 코드</span>' +
      '<input class="field__input" type="text" id="coupon-code" maxlength="24" placeholder="한글·영문·숫자 3~24자 (예: 연꽃2026)" autocapitalize="characters" value="' + esc(coupon ? coupon.code : '') + '"></label>' +
      '<label class="field"><span class="field__label">유효기간 (선택 · 비우면 기한 없음)</span>' +
      '<input class="field__input" type="date" id="coupon-expires" value="' + esc(couponDateValue(coupon)) + '"></label>' +
      '<p class="form__error" id="coupon-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">' + (editing ? '쿠폰 고치기' : '쿠폰 올리기') + '</button>' +
      '</form>');

    $('#coupon-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('#coupon-code').value.trim().toUpperCase();
      var expiresOn = $('#coupon-expires').value || null;
      var errEl = $('#coupon-error');
      if (!/^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$/.test(code)) {
        errEl.textContent = '쿠폰 코드는 한글·영문·숫자·-·_ 3~24자로 정해 주세요.';
        errEl.hidden = false;
        return;
      }
      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      if (!isLive()) {
        S.coupons = S.coupons.map(function (c) {
          return c.id === coupon.id
            ? Object.assign({}, c, { code: code, expires_on: expiresOn, until: null })
            : c;
        });
        closeModal();
        toast('쿠폰을 고쳤어요.');
        renderHome();
        return;
      }

      var job = editing
        ? DB.updateCoupon(coupon.id, { code: code, expiresOn: expiresOn })
        : DB.admin.createCoupon({
          code: code,
          title: COUPON_BLANK,
          reward: COUPON_BLANK,
          expiresOn: expiresOn,
          tone: 'lotus'
        });

      job.then(function () {
        closeModal();
        toast(editing ? '쿠폰을 고쳤어요.' : '쿠폰을 올렸어요.');
        return DB.listCoupons().then(function (rows) { S.coupons = mapCoupons(rows); });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = editErrorHint(err);
        errEl.hidden = false;
      });
    });
  }

  /* ============================================================
     공략 — 유튜브 영상
     ============================================================ */
  function youtubeId(value) {
    var text = String(value || '').trim();
    if (!text) { return null; }
    if (/^[A-Za-z0-9_-]{11}$/.test(text)) { return text; }
    var m = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  /** 공략 영상 추가 · 수정 — guide 를 넘기면 제목·주소가 채워진 수정 창이 열립니다 */
  function openGuideForm(guide) {
    var editing = !!guide;
    // 체험 모드의 예시 카드는 유튜브 주소가 없습니다 — 주소 없이 제목만 고칠 수 있게 둡니다.
    var sampleOnly = editing && !isLive() && !guide.youtube_url;
    openModal(modalTitle(editing ? '공략 수정' : '공략 영상 추가') +
      '<p class="lightbox__meta">유튜브 주소를 붙여 넣으면 썸네일과 함께 홈 <b>공략</b>에 2×2로 보여요.</p>' +
      '<form class="form" id="guide-form" novalidate style="margin-top:14px">' +
      '<label class="field"><span class="field__label">유튜브 주소</span>' +
      '<input class="field__input" type="text" id="guide-url" inputmode="url" autocomplete="off" placeholder="https://youtu.be/… 또는 youtube.com/watch?v=…" value="' + esc(guide ? (guide.youtube_url || '') : '') + '"></label>' +
      '<div class="guide-preview" id="guide-preview" hidden></div>' +
      '<label class="field"><span class="field__label">제목</span>' +
      '<input class="field__input" type="text" id="guide-title" maxlength="80" placeholder="예) 물그림자 2페이즈 물기둥 피하기" value="' + esc(guide ? guide.title : '') + '"></label>' +
      '<p class="form__error" id="guide-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">' + (editing ? '공략 고치기' : '공략에 올리기') + '</button>' +
      '</form>');

    var urlInput = $('#guide-url');
    var preview = $('#guide-preview');

    var paint = function () {
      var vid = youtubeId(urlInput.value);
      if (!vid) {
        preview.hidden = true;
        preview.innerHTML = '';
        return;
      }
      preview.hidden = false;
      preview.innerHTML = '<span class="guide-preview__thumb">' +
        '<img src="' + esc('https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg') + '" alt="" loading="lazy">' +
        '<span class="guide__play" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" focusable="false"><path d="M9 6.4 18.6 12 9 17.6z" fill="currentColor"/></svg></span></span>' +
        '<span class="guide-preview__text">영상 ID <b>' + esc(vid) + '</b><br>이 영상으로 올라가요</span>';
    };

    urlInput.addEventListener('input', paint);
    urlInput.addEventListener('paste', function () { window.setTimeout(paint, 0); });
    paint();

    $('#guide-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#guide-title').value.trim();
      var url = urlInput.value.trim();
      var vid = youtubeId(url);
      var errEl = $('#guide-error');

      if (!vid && !sampleOnly) {
        errEl.textContent = '유튜브 주소를 확인해 주세요. youtu.be/… 또는 youtube.com/watch?v=… 를 붙여 넣어 주세요.';
        errEl.hidden = false;
        return;
      }
      if (!title) {
        errEl.textContent = '제목을 적어 주세요.';
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;

      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      if (!isLive()) {
        S.guides = S.guides.map(function (g) {
          if (g.id !== guide.id) { return g; }
          return Object.assign({}, g, {
            title: title,
            video_id: vid || null,
            youtube_url: vid ? 'https://www.youtube.com/watch?v=' + vid : null
          });
        });
        closeModal();
        toast('공략을 고쳤어요.');
        renderHome();
        return;
      }

      var job = editing ? DB.updateGuide(guide.id, title, url) : DB.createGuide(title, url);
      job.then(function () {
        closeModal();
        toast(editing ? '공략을 고쳤어요.' : '공략 영상을 올렸어요');
        return DB.listGuides().then(function (rows) { S.guides = (rows || []).map(mapGuide); });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = editErrorHint(err);
        errEl.hidden = false;
      });
    });
  }

  function confirmDeleteGuide(id) {
    var guide = S.guides.filter(function (g) { return g.id === id; })[0];
    confirmAction('공략을 지울까요?',
      (guide ? '“' + guide.title + '” 을(를) 홈 공략에서 내립니다. 영상 자체는 유튜브에 그대로 있어요.' : '홈 공략에서 내립니다.'),
      '공략 지우기',
      function () {
        return DB.deleteGuide(id).then(function () {
          S.guides = S.guides.filter(function (g) { return g.id !== id; });
          renderHome();
          toast('공략을 지웠어요.');
        });
      });
  }

  /* ============================================================
     문파원 자리비움 — 로그인한 문파원 누구나 등록 · 삭제는 운영진만
     ============================================================ */
  function reloadAbsences() {
    return DB.listAbsences().then(function (rows) {
      S.absences = (rows || []).map(mapAbsence);
    });
  }

  /** 자리비움 알리기 — 본인은 누구나, 다른 문파원 대신은 운영진(문주·부문주)만 */
  function absenceTargetOptions() {
    return S.members.filter(function (m) {
      return m && m.id && m.id !== myId() && m.status === 'active';
    });
  }

  function openAbsenceForm() {
    var today = dayKey(new Date());
    var proxyOk = canProxyAbsence();
    var targetHtml = '';

    if (proxyOk) {
      targetHtml =
        '<label class="field"><span class="field__label">대상 문파원</span>' +
        '<select class="field__input field__select" id="absence-target">' +
        '<option value="">나 (' + esc(myNick()) + ')</option>' +
        absenceTargetOptions().map(function (m) {
          return '<option value="' + esc(m.id) + '">' + esc(m.nickname) + '</option>';
        }).join('') +
        '<option value="__manual">직접 입력 (아직 사이트 미가입)</option>' +
        '</select>' +
        '<span class="field__hint">다른 문파원 대신 올리면 카드에 그 문파원 이름으로 보여요.</span></label>' +
        '<label class="field" id="absence-name-field" hidden><span class="field__label">대상 이름</span>' +
        '<input class="field__input" type="text" id="absence-target-name" maxlength="20" ' +
        'placeholder="예) 새벽이" autocomplete="off">' +
        '<span class="field__hint">아직 가입하지 않은 문파원은 이름을 직접 적어 주세요(2~20자).</span></label>';
    }

    openModal(modalTitle('자리비움 알리기') +
      '<form class="form" id="absence-form" novalidate style="margin-top:12px">' +
      targetHtml +
      '<div class="form__row">' +
      '<label class="field"><span class="field__label">시작일</span>' +
      '<input class="field__input" type="date" id="absence-start" min="' + today + '" value="' + today + '"></label>' +
      '<label class="field"><span class="field__label">종료일</span>' +
      '<input class="field__input" type="date" id="absence-end" min="' + today + '" value="' + today + '"></label>' +
      '</div>' +
      '<label class="field"><span class="field__label">이유</span>' +
      '<input class="field__input" type="text" id="absence-reason" maxlength="60" placeholder="예) 해외출장, 시험기간 등"></label>' +
      '<p class="form__error" id="absence-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">자리비움 등록</button>' +
      '</form>');

    var targetSel = $('#absence-target');
    var nameField = $('#absence-name-field');
    if (targetSel && nameField) {
      targetSel.addEventListener('change', function () {
        var manual = targetSel.value === '__manual';
        nameField.hidden = !manual;
        if (manual) { $('#absence-target-name').focus(); }
        else { $('#absence-target-name').value = ''; }
      });
    }

    $('#absence-start').addEventListener('change', function () {
      var start = $('#absence-start').value || today;
      var end = $('#absence-end');
      end.min = start;
      if (!end.value || end.value < start) { end.value = start; }
    });

    $('#absence-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var start = $('#absence-start').value;
      var end = $('#absence-end').value;
      var reason = $('#absence-reason').value.trim();
      var errEl = $('#absence-error');
      var payload = { startDate: start, endDate: end, reason: reason };
      var targetName = '';

      if (!start || !end) {
        errEl.textContent = '시작일과 종료일을 정해 주세요.';
        errEl.hidden = false;
        return;
      }
      if (start < today) {
        errEl.textContent = '시작일은 오늘보다 빠를 수 없어요.';
        errEl.hidden = false;
        return;
      }
      if (end < start) {
        errEl.textContent = '종료일은 시작일과 같거나 뒤여야 해요.';
        errEl.hidden = false;
        return;
      }
      if (!reason || reason.length > 60) {
        errEl.textContent = '이유를 1~60자로 적어 주세요.';
        errEl.hidden = false;
        return;
      }

      if (targetSel) {
        if (targetSel.value === '__manual') {
          targetName = ($('#absence-target-name').value || '').trim();
          if (targetName.length < 2 || targetName.length > 20) {
            errEl.textContent = '대상 이름은 2~20자로 적어 주세요.';
            errEl.hidden = false;
            $('#absence-target-name').focus();
            return;
          }
          payload.targetName = targetName;
        } else if (targetSel.value) {
          payload.targetMemberId = targetSel.value;
        }
      }

      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      DB.createAbsence(payload).then(function () {
        closeModal();
        if (payload.targetName) { toast('“' + payload.targetName + '” 님의 자리비움을 대신 알렸어요.'); }
        else if (payload.targetMemberId) {
          var hit = S.members.filter(function (m) { return m.id === payload.targetMemberId; })[0];
          toast('“' + (hit ? hit.nickname : '문파원') + '” 님의 자리비움을 대신 알렸어요.');
        } else { toast('자리비움을 알렸어요.'); }
        return reloadAbsences();
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        var msg = errorMessage(err);
        // 아직 v4 마이그레이션 전인 서버라면(대리 등록 인자를 모름) 알아보기 쉽게 알려 줍니다
        if ((payload.targetName || payload.targetMemberId) &&
            (String(err && err.code) === 'PGRST202' || msg.indexOf('Could not find') !== -1)) {
          msg = '지금은 내 자리비움만 등록할 수 있어요. 서버에 v4 마이그레이션(supabase/migration-v4.sql)을 먼저 적용해 주세요.';
        }
        errEl.textContent = msg;
        errEl.hidden = false;
      });
    });
  }

  function confirmDeleteAbsence(id) {
    var item = S.absences.filter(function (a) { return a.id === id; })[0];
    confirmAction('자리비움을 지울까요?',
      (item
        ? '“' + item.nickname + '” 님의 자리비움(' + shortDate(item.start_date) + ' ~ ' + shortDate(item.end_date) + ')을 홈에서 내립니다.'
        : '홈에서 내립니다.'),
      '지우기',
      function () {
        return DB.deleteAbsence(id).then(function () {
          S.absences = S.absences.filter(function (a) { return a.id !== id; });
          renderHome();
          toast('자리비움을 지웠어요.');
        });
      });
  }

  /* ============================================================
     관리자: 초대 코드
     ============================================================ */
  function openInviteModal() {
    openModal(modalTitle('문파 관리') + '<p class="lightbox__meta">초대 코드를 불러오는 중이에요…</p>');

    DB.admin.getSettings().then(function (settings) {
      S.adminSettings = settings;
      var updated = settings.invite_code_updated_at ? dateLabel(settings.invite_code_updated_at) : '';
      openModal(modalTitle('문파 관리') +
        '<div class="privacy" style="margin-top:0">' +
        '<p><b>' + esc(settings.clan_name) + '</b> · 정원 ' + fmtNum(settings.member_capacity) + '명</p>' +
        '<p>문파원 ' + fmtNum(settings.member_count) + '명 · 내보냄 ' + fmtNum(settings.kicked_count) + '명 · 차단 ' + fmtNum(settings.banned_count) + '명</p>' +
        '</div>' +
        '<div class="invite">' +
        '<span class="invite__label">지금 초대 코드</span>' +
        '<div class="invite__code"><b id="invite-code-text">' + esc(settings.invite_code) + '</b>' +
        '<button type="button" class="coupon__copy" id="invite-copy">복사</button></div>' +
        (updated ? '<p class="invite__meta">' + esc(updated) + '에 바뀌었어요. 대소문자 구분 없이 입력해도 됩니다.</p>' : '<p class="invite__meta">대소문자 구분 없이 입력해도 됩니다.</p>') +
        '</div>' +
        '<form class="form" id="invite-form" novalidate style="margin-top:14px">' +
        '<label class="field"><span class="field__label">새 초대 코드</span>' +
        '<input class="field__input" type="text" id="invite-new" maxlength="20" placeholder="한글·영문·숫자 4~20자" autocapitalize="characters"></label>' +
        '<p class="form__error" id="invite-error" role="alert" hidden></p>' +
        '<button type="submit" class="btn btn--primary">초대 코드 바꾸기</button>' +
        '</form>' +
        '<p class="section__note">코드를 바꾸면 이전 코드로는 가입할 수 없어요. 이미 들어온 문파원은 그대로 남습니다.</p>');

      var copyBtn = $('#invite-copy');
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(settings.invite_code).then(function () {
            toast('초대 코드를 복사했어요: ' + settings.invite_code);
          }, function () { fallbackCopy(settings.invite_code, function () { toast('초대 코드: ' + settings.invite_code); }); });
        } else {
          fallbackCopy(settings.invite_code, function () { toast('초대 코드: ' + settings.invite_code); });
        }
      });

      $('#invite-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var next = $('#invite-new').value.trim();
        var errEl = $('#invite-error');
        if (next.length < 4 || next.length > 20) {
          errEl.textContent = '초대 코드는 4~20자로 정해 주세요.';
          errEl.hidden = false;
          return;
        }
        var btn = $('button[type="submit"]', this);
        btn.disabled = true;
        DB.admin.updateInviteCode(next).then(function (res) {
          toast('초대 코드를 ' + res.invite_code + ' 로 바꿨어요.');
          var text = $('#invite-code-text');
          if (text) { text.textContent = res.invite_code; }
          $('#invite-new').value = '';
          btn.disabled = false;
        }).catch(function (err) {
          btn.disabled = false;
          errEl.textContent = errorMessage(err);
          errEl.hidden = false;
        });
      });
    }).catch(function (err) {
      openModal(modalTitle('문파 관리') +
        '<p class="lightbox__meta">' + esc(errorMessage(err)) + '</p>' +
        '<div class="lightbox__actions"><button type="button" class="btn btn--ghost" data-close="1">닫기</button></div>');
    });
  }

  /* ============================================================
     문주 도구: 전체 데이터 백업 (JSON)
     ------------------------------------------------------------
     · 내정보 → 문주 도구 → “📦 전체 데이터 백업 받기 (JSON)” — 문주에게만 보입니다.
       (체험 모드에서는 예시 데이터로 같은 버튼을 눌러 볼 수 있어요)
     · 화면 목록은 최근 30건까지만 읽지만, 백업은 공지 · 문파컨텐츠 전체와
       채팅 · 앨범을 p_before 로 끝까지 나눠 받아 모읍니다 — 지금 있는 조회 API 만 씁니다.
       (SQL 마이그레이션 없음 · 사용자가 실행할 것 없음)
     · PIN 해시 같은 인증 비밀값은 서버가 내려주지도 않고, 혹시 섞여 와도 withoutSecrets 가 지웁니다.
     ============================================================ */
  var BACKUP_KEY = 'lastBackup';
  var BACKUP_APP = '연못';
  var BACKUP_VERSION = '0.3';
  var BACKUP_CHAT_PAGE = 100;    // list_chat_messages 한 번에 받는 상한
  var BACKUP_ALBUM_PAGE = 30;    // list_album_posts 한 번에 받는 상한
  var BACKUP_MAX_PAGES = 40;     // 안전장치 — 채팅 4,000줄 · 앨범 1,200장까지
  var BACKUP_SECRET_KEY = /^(pin|pin_hash|pin_salt|hashed_pin|password|passwd|pwd|secret|token|api_key|.*_hash|.*_token|.*_secret)$/i;

  /** 백업에 담지 않을 열쇠 — 인증 비밀값(pin · hash · token …)은 모양이 어떻든 지웁니다. */
  function withoutSecrets(value) {
    if (Object.prototype.toString.call(value) === '[object Array]') {
      return value.map(withoutSecrets);
    }
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (BACKUP_SECRET_KEY.test(key)) { return; }
        out[key] = withoutSecrets(value[key]);
      });
      return out;
    }
    return value;
  }

  function backupBytes(size) {
    if (!size) { return '0KB'; }
    if (size < 1024 * 1024) { return Math.max(1, Math.round(size / 1024)) + 'KB'; }
    return (size / (1024 * 1024)).toFixed(1) + 'MB';
  }

  function backupFileName() {
    return 'yeonmot-backup-' + dayKey(new Date()) + '.json';
  }

  function backupSummary(data) {
    return {
      members: data.members.length,
      notices: data.notices.length,
      events: data.events.length,
      coupons: data.coupons.length,
      guides: data.guides.length,
      absences: data.absences.length,
      album: data.album.length,
      album_images: data.album.filter(function (p) { return !!p.image; }).length,
      chat: data.chat.length
    };
  }

  /** 마지막 백업 시각 + 복구 안내 한 줄 */
  function backupNoteHtml() {
    var last = store.get(BACKUP_KEY, null);
    var when = last && last.at ? (dateLabel(last.at) + ' ' + timeLabel(last.at)) : '';
    var head = when
      ? '<b>마지막 백업:</b> ' + esc(when) + ' · ' + esc(backupBytes(last.bytes)) +
        (last.file ? ' <span class="backup__file">' + esc(last.file) + '</span>' : '') + '<br>'
      : '아직 백업 파일을 만든 적이 없어요.<br>';
    return '<p class="backup__note" id="backup-note">' + head +
      '새 프로젝트에서 복구할 때 이 파일을 사용해요.</p>';
  }

  function backupRowHtml(desc) {
    return '<button type="button" class="row row--action" id="admin-backup-row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M4 8.5h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M3.4 4.5h17.2v4H3.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M12 11v5.4M9.9 14.2l2.1 2.2 2.1-2.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>' +
      '<span class="row__text"><span class="row__label">📦 전체 데이터 백업 받기 (JSON)</span>' +
      '<span class="row__desc">' + esc(desc) + '</span></span>' +
      '<span class="row__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" focusable="false">' +
      '<path d="M12 5v9M9 11.6l3 3 3-3M5 18.5h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></span>' +
      '</button>' + backupNoteHtml();
  }

  /** p_before 로 나눠 받기 — 짧은 쪽이 오거나 새 항목이 없으면(서버가 커서를 무시해도) 멈춥니다. */
  function pageThrough(fetchPage, pageSize, cursorOf, keyOf) {
    var rows = [];
    var seen = {};
    var before = null;
    var pages = 0;

    function step() {
      return fetchPage(pageSize, before).then(function (page) {
        var list = page || [];
        var fresh = list.filter(function (row) {
          var key = String(keyOf(row));
          if (seen[key]) { return false; }
          seen[key] = true;
          return true;
        });
        if (!fresh.length) { return { rows: rows, truncated: false }; }
        rows = rows.concat(fresh);
        pages += 1;
        var next = cursorOf(fresh);
        if (next === null || next === undefined || next === before || list.length < pageSize) {
          return { rows: rows, truncated: false };
        }
        if (pages >= BACKUP_MAX_PAGES) { return { rows: rows, truncated: true }; }
        before = next;
        return step();
      });
    }
    return step();
  }

  /** 앨범 사진은 글과 따로 받아 data URL 그대로 담습니다 — 복구할 때 사진까지 살아나도록. */
  function fillAlbumImages(items) {
    var failed = 0;
    function step(i) {
      if (i >= items.length) { return Promise.resolve(failed); }
      return DB.albumImage(items[i].id).then(function (res) {
        items[i].image = (res && res.data_url) || null;
        if (res && res.mime) { items[i].image_mime = res.mime; }
      }, function () {
        items[i].image = null;
        failed += 1;
      }).then(function () { return step(i + 1); });
    }
    return step(0);
  }

  function collectTrialBackup() {
    return {
      settings: S.clan ? {
        clan_name: S.clan.name,
        clan_motto: S.clan.motto,
        member_capacity: S.clan.capacity,
        member_count: S.clan.member_count,
        level: S.clan.level,
        mode: 'trial'
      } : null,
      members: S.members.map(function (m) {
        return {
          id: m.id, nickname: m.nickname, role: m.role, level: m.level,
          status: m.status, joined_at: m.joined_at || null, avatar: m.avatar || null
        };
      }),
      notices: S.notices.map(function (n) {
        return {
          id: n.id, title: n.title, body: n.body, tag: n.tag,
          pinned: !!n.pinned, author: n.author, created_at: n.created_at
        };
      }),
      events: S.events.map(function (ev) {
        return {
          id: ev.id, title: ev.title, place: ev.place, tag: ev.tag, note: ev.note,
          starts_at: ev.starts_at, ends_at: ev.ends_at || null,
          repeat_weekly: !!ev.repeat_weekly, repeat_weekdays: ev.repeat_weekdays || []
        };
      }),
      coupons: S.coupons.map(function (c) {
        return {
          id: c.id, code: c.code, title: c.title, reward: c.reward,
          expires_on: c.expires_on || c.until || null, tone: c.tone || null
        };
      }),
      guides: S.guides.map(function (g) {
        return {
          id: g.id, title: g.title, youtube_url: g.youtube_url || null,
          video_id: g.video_id || null, kind: g.kind || null, created_at: g.created_at || null
        };
      }),
      absences: S.absences.map(function (a) {
        return {
          id: a.id, member_id: a.member_id || null, nickname: a.nickname,
          target_name: a.target_name || null, is_proxy: !!a.is_proxy,
          start_date: a.start_date, end_date: a.end_date, reason: a.reason
        };
      }),
      album: S.album.map(function (a) {
        return {
          id: a.id, title: a.title, caption: a.caption, author: a.author,
          kind: a.kind || null, likes: a.likes || 0, created_at: a.created_at, image: null
        };
      }),
      chat: S.chat.map(function (m) {
        return {
          id: m.id, nickname: m.nickname, kind: m.kind, body: m.body, created_at: m.created_at
        };
      })
    };
  }

  function collectLiveBackup() {
    var data = {
      settings: null, members: [], notices: [], events: [],
      coupons: [], guides: [], absences: [], album: [], chat: []
    };

    return Promise.all([
      DB.admin.getSettings().then(function (settings) {
        /* 초대 코드는 빼고 챙깁니다 — 문파에 드는 사람을 정하는 인증값이라
         * 파일이 남에게 돌아가면 막을 수 없습니다. 복구할 때는 새 코드를 정하면 됩니다. */
        data.settings = settings ? {
          clan_name: settings.clan_name,
          clan_motto: settings.clan_motto,
          member_capacity: settings.member_capacity,
          member_count: settings.member_count,
          kicked_count: settings.kicked_count,
          banned_count: settings.banned_count
        } : null;
      }),
      DB.admin.listMembers().then(function (rows) { data.members = rows || []; }),
      DB.backup.notices().then(function (rows) { data.notices = rows || []; }),
      DB.backup.events().then(function (rows) { data.events = rows || []; }),
      DB.listCoupons().then(function (rows) { data.coupons = rows || []; }),
      DB.listGuides().then(function (rows) { data.guides = rows || []; }),
      DB.listAbsences().then(function (rows) { data.absences = rows || []; })
    ]).then(function () {
      return Promise.all([
        pageThrough(function (limit, before) { return DB.listChat(limit, before); }, BACKUP_CHAT_PAGE,
          function (list) {
            var ids = list.map(function (m) { return Number(m.id); })
              .filter(function (n) { return !isNaN(n); });
            return ids.length ? Math.min.apply(null, ids) : null;
          },
          function (m) { return m.id; }),
        pageThrough(function (limit, before) { return DB.listAlbum(limit, before); }, BACKUP_ALBUM_PAGE,
          function (list) { return list.length ? list[list.length - 1].created_at : null; },
          function (p) { return p.id; })
      ]);
    }).then(function (paged) {
      data.chat = paged[0].rows.sort(function (a, b) { return Number(a.id) - Number(b.id); });
      data.album = paged[1].rows;
      return fillAlbumImages(data.album).then(function (failed) {
        return {
          data: data,
          note: failed ? '사진 ' + failed + '장은 서버에서 받지 못해 빈 채로 담았어요.' : ''
        };
      });
    });
  }

  function collectBackup() {
    return isLive() ? collectLiveBackup() : Promise.resolve({ data: collectTrialBackup(), note: '' });
  }

  /** Blob → 파일 내려받기 (다운로드 폴더로 바로 저장) */
  function downloadFile(name, text) {
    var blob = new window.Blob([text], { type: 'application/json;charset=utf-8' });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      if (link.parentNode) { link.parentNode.removeChild(link); }
      window.URL.revokeObjectURL(url);
    }, 4000);
    return blob.size;
  }

  function saveBackup() {
    var btn = $('#admin-backup-row');
    if (!btn || btn.getAttribute('aria-busy') === 'true') { return; }
    var label = btn.querySelector('.row__label');
    var original = label ? label.textContent : '';
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('disabled', 'disabled');
    if (label) { label.textContent = '백업 파일을 모으는 중…'; }

    collectBackup().then(function (result) {
      var payload = {
        exported_at: new Date().toISOString(),
        app: BACKUP_APP,
        version: BACKUP_VERSION,
        summary: backupSummary(result.data),
        data: withoutSecrets(result.data)
      };
      var name = backupFileName();
      var size = downloadFile(name, JSON.stringify(payload, null, 2));
      store.set(BACKUP_KEY, { at: payload.exported_at, file: name, bytes: size, summary: payload.summary });

      var note = $('#backup-note');
      if (note) { note.outerHTML = backupNoteHtml(); }

      var s = payload.summary;
      toast('백업 파일을 저장했어요 (공지 ' + fmtNum(s.notices) + '건 · 문파컨텐츠 ' + fmtNum(s.events) +
        '건 · 앨범 ' + fmtNum(s.album) + '장 · 채팅 ' + fmtNum(s.chat) + '줄)');
      if (result.note) { window.setTimeout(function () { toast(result.note); }, 3000); }
    }).catch(function (err) {
      toast('백업 파일을 만들지 못했어요. ' + errorMessage(err));
    }).then(function () {
      btn.removeAttribute('aria-busy');
      btn.removeAttribute('disabled');
      if (label) { label.textContent = original; }
    });
  }

  /* ============================================================
     내정보
     ============================================================ */
  function renderMe() {
    if (!S.me && !S.user) { return; }
    var settings = store.get('settings', { theme: 'pond', notify: true });
    var name = S.me ? S.me.nickname : (S.user ? S.user.nick : '연못손님');
    var guest = !isLive();
    var roleLabel = S.me ? (ROLE_LABEL[S.me.role] || '문파원') : '체험';
    var roleClass = S.me ? (ROLE_CLASS[S.me.role] || '') : 'role--elite';
    var since = S.me && S.me.joined_at ? S.me.joined_at : (S.user ? S.user.since : new Date().toISOString());
    var sinceText = dateLabel(since);
    var wave = (S.me && S.me.wave) || { today_done: false, streak: 0, total: 0 };
    var level = S.me && S.me.level ? S.me.level : 0;
    var admin = isAdmin();

    var html = '<header class="screen__head">' +
      '<p class="kicker">내정보</p>' +
      '<h2 class="screen__title">나의 연못</h2>' +
      '<p class="screen__sub">' + (guest ? '체험 모드로 둘러보고 있어요' : '닉네임과 문파 생활을 이곳에서 확인해요') + '</p>' +
      '</header>';

    html += '<section class="profile">' +
      '<div class="profile__top">' +
      avatarSpan('profile__avatar', name, myAvatarValue()) +
      '<div><div class="profile__name"><strong>' + esc(name) + '</strong>' +
      '<span class="role ' + roleClass + '">' + esc(roleLabel) + '</span></div>' +
      '<p class="profile__meta"><span>' + (guest ? '둘러보는 중' : '연못 문파원') + '</span><span class="sep">·</span><span>' + esc(sinceText) + '부터</span></p>' +
      '</div></div>' +
      '<div class="profile__level">' +
      '<div class="profile__level-head"><span>오늘의 물결 <b>' + (wave.today_done ? '남겼어요' : '아직이에요') + '</b></span>' +
      '<span>' + (wave.streak ? wave.streak + '일 연속 · ' : '') + '모두 ' + fmtNum(wave.total) + '번</span></div>' +
      '<div class="progress"><div class="progress__bar" style="width:' + Math.min(100, Math.max(4, (wave.total || 0) * 4)) + '%"></div></div>' +
      '<p class="profile__hint">연못 등급 Lv.' + (level || '–') + '</p>' +
      '</div></section>';

    /* 프로필 그림 — 연못 일러스트 9종 · 내 사진 · 기본 글자 */
    var currentAvatar = myAvatarValue();
    var presetNow = presetName(currentAvatar);
    var photoNow = isImageAvatar(currentAvatar);

    html += '<div class="menu-card avatar-card" id="avatar-card">' +
      '<h3 class="menu-card__title">프로필 그림</h3>' +
      '<div class="avatar-card__head">' +
      avatarSpan('avatar-card__preview', name, currentAvatar) +
      '<div class="avatar-card__text">' +
      '<p class="avatar-card__now" id="avatar-now">' +
      (presetNow ? '연못 그림 · ' + esc(ART.avatarLabel[presetNow] || presetNow)
        : photoNow ? '내 사진' : '기본 글자') + '</p>' +
      '<p class="avatar-card__hint">' +
      (guest ? '체험 모드에서는 이 기기에만 저장돼요.' : '고르면 문파원 모두에게 이 그림이 보여요.') +
      '</p></div></div>' +
      '<div class="avatar-presets" role="group" aria-label="연못 그림 고르기">' +
      ART.avatarKinds.map(function (kind) {
        var on = presetNow === kind;
        return '<button type="button" class="avatar-pick' + (on ? ' is-active' : '') + '" data-preset="' + kind +
          '" aria-pressed="' + on + '" aria-label="' + esc(ART.avatarLabel[kind]) + ' 그림">' +
          ART.avatar(kind) + '<span>' + esc(ART.avatarLabel[kind]) + '</span></button>';
      }).join('') +
      '</div>' +
      '<div class="avatar-actions">' +
      '<button type="button" class="btn btn--ghost btn--small" id="avatar-upload">내 사진 올리기</button>' +
      '<button type="button" class="btn btn--quiet btn--small" id="avatar-reset"' + (currentAvatar ? '' : ' disabled') + '>기본 글자로</button>' +
      '<input type="file" id="avatar-file" accept="image/*" hidden aria-label="프로필 사진 고르기">' +
      '</div>' +
      '<p class="section__note" id="avatar-note">사진은 가운데를 정사각형으로 잘라 128×128 · 10~25KB 로 줄여서 올라가요.</p>' +
      '</div>';

    if (admin) {
      html += '<div class="menu-card">' +
        '<h3 class="menu-card__title">문주 도구</h3>' +
        '<button type="button" class="row row--action" id="admin-invite-row">' +
        '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15.5 8.5a4 4 0 1 0-5.6 5.7l-2 2H5v2H3v2h4l2.4-2.4a4 4 0 0 0 5.5-5.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '<span class="row__text"><span class="row__label">초대 코드 확인 · 변경</span>' +
        '<span class="row__desc">새 문파원을 들일 때 알려 줄 코드예요</span></span>' +
        '<span class="row__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '</button>' +
        '<div class="row"><span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 19c0-3 2.5-4.6 5.5-4.6S15 16 15 19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M18 8v6M15 11h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>' +
        '<span class="row__text"><span class="row__label">지금 문파원 ' + fmtNum(S.clan ? S.clan.member_count : 0) + '명</span>' +
        '<span class="row__desc">문파원 탭에서 직위 · 내보내기 · 차단을 할 수 있어요</span></span></div>' +
        backupRowHtml('공지 · 문파컨텐츠 · 쿠폰 · 공략 · 자리비움 · 앨범 · 채팅 · 문파 설정을 한 파일로') +
        '</div>';
    } else if (guest) {
      /* 체험 모드 — 같은 버튼을 예시 데이터로 눌러 볼 수 있습니다 (서버로 가지 않아요) */
      html += '<div class="menu-card">' +
        '<h3 class="menu-card__title">데이터 백업</h3>' +
        backupRowHtml('체험 데이터로 만드는 예시 파일이에요 (이 기기에서만)') +
        '</div>';
    }

    /* 🔗 외부 체험 링크 — 문주·운영진(그리고 체험 모드)만 */
    if (canManageGuestLinks()) { html += guestLinksCardHtml(); }

    html += '<div class="menu-card" id="install-card">' + installCardHtml() + '</div>';

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
      (isLive()
        ? '<p>닉네임과 PIN 만 문파 서버에 보내요. 이름 · 전화번호 · 이메일 · 주소는 받지 않습니다.</p>' +
          '<p>PIN 은 되돌릴 수 없는 암호(해시)로만 저장되고, 로그인 확인에만 쓰여요. 다섯 번 틀리면 잠시 잠깁니다.</p>' +
          '<p>화면 설정 같은 기기 기록은 이 기기의 저장 공간에만 남아요.</p>'
        : '<p>체험 모드에서는 닉네임과 기록이 이 기기의 저장 공간에만 남고 서버로 보내지 않아요.</p>' +
          '<p>PIN 은 확인용으로만 쓰고 어디에도 저장하지 않습니다.</p>') +
      '</div>';

    html += '<div class="me-actions">' +
      '<button type="button" class="btn btn--quiet" id="logout-btn">로그아웃</button>' +
      '<button type="button" class="btn btn--quiet" id="reset-btn">기록 지우기</button>' +
      '</div>';

    html += '<p class="version">연못 · v0.3' + (isLive() ? ' · 실제 문파' : ' · 체험') + '</p>';

    $('#me-body').innerHTML = html;

    var inviteRow = $('#admin-invite-row');
    if (inviteRow) { inviteRow.addEventListener('click', openInviteModal); }

    var backupRow = $('#admin-backup-row');
    if (backupRow) { backupRow.addEventListener('click', saveBackup); }

    if (canManageGuestLinks()) { bindGuestLinksCard(); }

    bindAvatarCard();

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
      toast(on ? '알림을 켜 둘게요' : '알림을 꺼 두었어요');
    });

    $('#rules-row').addEventListener('click', showRules);
    bindInstallRow();

    $('#logout-btn').addEventListener('click', function () {
      openModal(modalTitle('연못을 잠시 떠날까요?') +
        '<p class="lightbox__meta">' + (isLive()
          ? '이 기기에서만 로그아웃돼요. 다시 닉네임과 PIN 으로 들어올 수 있습니다.'
          : '언제든 다시 돌아오실 수 있어요.') + '</p>' +
        '<div class="lightbox__actions">' +
        '<button type="button" class="btn btn--primary" id="confirm-logout">로그아웃</button>' +
        '<button type="button" class="btn btn--ghost" data-close="1">머무르기</button>' +
        '</div>');
      $('#confirm-logout').addEventListener('click', logout);
    });

    $('#reset-btn').addEventListener('click', function () {
      openModal(modalTitle('이 기기의 기록을 지울까요?') +
        '<p class="lightbox__meta">' + (isLive()
          ? '이 기기에서 로그아웃되고 화면 설정도 지워집니다. 문파에 남긴 글과 사진은 그대로 있어요.'
          : '대화, 출석, 좋아요, 닉네임이 모두 지워집니다. 되돌릴 수 없어요.') + '</p>' +
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
        if (isLive()) { DB.stopRealtime(); }
        S.chat = [];
        S.likes = {};
        S.attendance = null;
        S.user = null;
        S.me = null;
        S.clan = null;
        S.ready = false;
        S.mode = 'trial';
        document.documentElement.removeAttribute('data-theme');
        showAuth();
        toast('이 기기의 기록을 지웠어요.');
      });
    });
  }

  /* ============================================================
     프로필 그림 바꾸기
     ============================================================ */
  function setAvatarLocal(value) {
    if (S.me) { S.me.avatar = value; }
    if (S.user) { S.user.avatar = value; }
    S.members.forEach(function (m) { if (m.me) { m.avatar = value; } });
  }

  function refreshAvatarViews() {
    if (S.noticeRows) { S.notices = (S.noticeRows || []).map(mapNotice); }
    renderHome();
    renderChat();
    renderAlbum();
    renderMembers();
    renderMe();
  }

  /** avatar = 'preset:lotus' | data:image/… | null(기본 글자) */
  function applyAvatar(avatar) {
    var value = avatar || null;
    var previous = myAvatarValue();

    setAvatarLocal(value);
    if (!isLive()) {
      store.set('avatar', value);
      refreshAvatarViews();
      toast(value ? '프로필 그림을 바꿨어요' : '기본 글자로 돌려놓았어요');
      return Promise.resolve({ ok: true });
    }

    refreshAvatarViews();
    return DB.updateMyAvatar(value).then(function (res) {
      toast(value ? '프로필 그림을 바꿨어요' : '기본 글자로 돌려놓았어요');
      return res;
    }).catch(function (err) {
      setAvatarLocal(previous);
      refreshAvatarViews();
      toast(errorMessage(err));
    });
  }

  function bindAvatarCard() {
    var host = $('#me-body');
    if (!host) { return; }

    $$('[data-preset]', host).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-preset');
        if (presetName(myAvatarValue()) === kind) { return; }
        btn.classList.add('is-busy');
        applyAvatar('preset:' + kind).then(function () { btn.classList.remove('is-busy'); });
      });
    });

    var fileInput = $('#avatar-file');
    var upload = $('#avatar-upload');
    if (upload && fileInput) {
      upload.addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) { return; }
        var note = $('#avatar-note');
        upload.disabled = true;
        if (note) { note.textContent = '사진을 정사각형으로 줄이는 중이에요…'; }
        DB.compressAvatar(file).then(function (photo) {
          return applyAvatar(photo.dataUrl);
        }).catch(function (err) {
          toast(errorMessage(err));
        }).then(function () {
          fileInput.value = '';
          var again = $('#avatar-upload');
          if (again) { again.disabled = false; }
          var fresh = $('#avatar-note');
          if (fresh) { fresh.textContent = '사진은 가운데를 정사각형으로 잘라 128×128 · 10~25KB 로 줄여서 올라가요.'; }
        });
      });
    }

    var reset = $('#avatar-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        if (!myAvatarValue()) { return; }
        applyAvatar(null);
      });
    }
  }

  function showRules() {
    openModal(modalTitle('문파 생활 안내') +
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

  /* ============================================================
     PWA 설치 — 환경에 맞춰 딱 필요한 안내만
     ============================================================ */
  var INSTALL_MSG_INAPP = '카톡 안에서는 설치가 안 돼요 · 오른쪽 아래 ⋮(또는 ↗) → ‘다른 브라우저로 열기’를 눌러주세요';

  /* 이미 앱(standalone)으로 실행 중인가 */
  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) { return true; }
    } catch (e) { /* noop */ }
    return !!(window.navigator && window.navigator.standalone);
  }

  /* 카톡 · 네이버 · 인스타그램 같은 앱 안의 브라우저인가 */
  function isInAppBrowser() {
    var ua = (window.navigator && window.navigator.userAgent) || '';
    return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|WhatsApp|Twitter/i.test(ua);
  }

  /* 지금 화면에서 할 수 있는 일: standalone | inapp | ready | guide */
  function installEnv() {
    if (isStandalone()) { return 'standalone'; }
    if (isInAppBrowser()) { return 'inapp'; }
    if (S.installEvent) { return 'ready'; }
    return 'guide';
  }

  /* 기기에 맞는 설치 순서 — 딱 2~3줄 */
  function deviceKind() {
    var ua = (window.navigator && window.navigator.userAgent) || '';
    var touchMac = window.navigator && window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    if (/iPhone|iPad|iPod/i.test(ua) || touchMac) { return 'ios'; }
    if (/SamsungBrowser/i.test(ua)) { return 'samsung'; }
    if (/Android/i.test(ua)) { return 'chrome'; }
    return 'desktop';
  }

  var INSTALL_GUIDE = {
    inapp: {
      device: '카톡 · 네이버 · 인스타그램 같은 앱 안',
      steps: [
        '오른쪽 아래 ⋮ (아이폰은 ↗)를 눌러요',
        '“다른 브라우저로 열기”를 골라요',
        '열린 브라우저에서 다시 설치를 눌러요'
      ],
      note: '앱 안의 브라우저에서는 설치 창이 뜨지 않아요.'
    },
    ios: {
      device: '아이폰 · 사파리',
      steps: [
        '아래쪽 공유 버튼(네모에 화살표)을 눌러요',
        '목록에서 “홈 화면에 추가”를 골라요',
        '오른쪽 위 “추가”를 누르면 끝이에요'
      ],
      note: '사파리에서 한 번만 추가하면 앱처럼 열려요.'
    },
    samsung: {
      device: '삼성 인터넷',
      steps: [
        '오른쪽 아래 ☰(메뉴)를 눌러요',
        '“홈 화면에 추가”를 골라요',
        '“추가”를 누르면 끝이에요'
      ],
      note: '설치하면 주소창 없이 전체 화면으로 열려요.'
    },
    chrome: {
      device: '안드로이드 · 크롬',
      steps: [
        '오른쪽 위 ⋮를 눌러요',
        '“앱 설치” 또는 “홈 화면에 추가”를 골라요',
        '“설치”를 누르면 홈 화면에 생겨요'
      ],
      note: '설치 창이 이미 떴다 닫혔다면, 이 순서로 다시 할 수 있어요.'
    },
    desktop: {
      device: '이 브라우저',
      steps: [
        '주소창 오른쪽의 설치 아이콘을 눌러요',
        '“설치”를 골라요',
        '연못이 앱 창으로 열려요'
      ],
      note: '아이폰은 사파리의 공유 버튼으로 추가해요.'
    }
  };

  function installGuideHtml(kind) {
    var g = INSTALL_GUIDE[kind] || INSTALL_GUIDE[deviceKind()] || INSTALL_GUIDE.desktop;
    var steps = g.steps.map(function (step, i) {
      return '<li><span class="install-guide__n">' + (i + 1) + '</span><span>' + esc(step) + '</span></li>';
    }).join('');
    return modalTitle('홈 화면에 추가하는 방법') +
      '<p class="install-guide__device">' + esc(g.device) + '</p>' +
      '<ol class="install-guide__steps" id="install-steps">' + steps + '</ol>' +
      (g.note ? '<p class="lightbox__meta">' + esc(g.note) + '</p>' : '') +
      '<div class="lightbox__actions"><button type="button" class="btn btn--ghost" data-close="1">알겠어요</button></div>';
  }

  function openInstallGuide() {
    openModal(installGuideHtml(installEnv() === 'inapp' ? 'inapp' : deviceKind()));
  }

  /* 바로 설치 — 브라우저 설치 창을 그대로 띄운다 */
  function runInstallPrompt() {
    var ev = S.installEvent;
    if (!ev || typeof ev.prompt !== 'function') {
      openInstallGuide();
      return;
    }
    try { ev.prompt(); } catch (e) { /* noop */ }
    S.installEvent = null;
    var choice = ev.userChoice;
    if (choice && typeof choice.then === 'function') {
      choice.then(function (result) {
        toast(result && result.outcome === 'accepted' ? '홈 화면에 추가하고 있어요 📲' : '언제든 다시 설치할 수 있어요');
      }, function () { /* noop */ });
    } else {
      toast('홈 화면에 추가 창을 열었어요 📲');
    }
    refreshInstall();
  }

  var INSTALL_CHEVRON = '<span class="row__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  var INSTALL_ICON = '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

  /* 내정보 → 앱으로 쓰기 */
  function installCardHtml() {
    var env = installEnv();
    var head = '<h3 class="menu-card__title">앱으로 쓰기</h3>';

    if (env === 'standalone') {
      return head +
        '<div class="row" id="install-row" data-install-state="standalone">' + INSTALL_ICON +
        '<span class="row__text"><span class="row__label">홈 화면에 추가</span>' +
        '<span class="row__desc" id="install-desc">이미 앱으로 열려 있어요</span></span>' +
        '<span class="badge badge--jade">앱으로 실행 중</span></div>';
    }

    if (env === 'ready') {
      return head +
        '<button type="button" class="row row--action" id="install-row" data-install-state="ready">' + INSTALL_ICON +
        '<span class="row__text"><span class="row__label">📲 앱으로 바로 설치</span>' +
        '<span class="row__desc" id="install-desc">지금 눌러서 홈 화면에 추가할 수 있어요</span></span>' +
        INSTALL_CHEVRON + '</button>';
    }

    var inapp = env === 'inapp';
    return head +
      '<button type="button" class="row row--action" id="install-row" data-install-state="' + env + '">' + INSTALL_ICON +
      '<span class="row__text"><span class="row__label">' + (inapp ? '다른 브라우저로 열어 설치' : '홈 화면에 추가') + '</span>' +
      '<span class="row__desc" id="install-desc">' + (inapp
        ? '카톡 안에서는 설치가 안 돼요 · 눌러서 방법 보기'
        : '눌러서 기기에 맞는 순서 보기') + '</span></span>' +
      INSTALL_CHEVRON + '</button>';
  }

  function bindInstallRow() {
    var row = $('#install-row');
    if (!row) { return; }
    row.addEventListener('click', function () {
      var state = row.getAttribute('data-install-state');
      if (state === 'ready') { runInstallPrompt(); return; }
      if (state === 'standalone') { return; }
      openInstallGuide();
    });
  }

  /* 로그인 화면 · 홈 상단 배너 */
  function installBannerHtml(where) {
    var env = installEnv();
    if (env === 'standalone') { return ''; }

    if (env === 'inapp') {
      if (S.installHidden && S.installHidden.inapp) { return ''; }
      return '<div class="install-banner__inner">' +
        '<span class="install-banner__icon" aria-hidden="true">📲</span>' +
        '<p class="install-banner__text">' + esc(INSTALL_MSG_INAPP) + '</p>' +
        (where === 'home' ? '<button type="button" class="install-banner__x" data-install-close="inapp" aria-label="안내 닫기">✕</button>' : '') +
        '</div>';
    }

    if (env === 'ready') {
      if (S.installHidden && S.installHidden.ready) { return ''; }
      return '<div class="install-banner__inner install-banner__inner--cta">' +
        '<p class="install-banner__text"><b>연못을 홈 화면에 추가해 보세요</b><span>주소창 없이 앱처럼 열려요</span></p>' +
        '<button type="button" class="btn btn--primary install-banner__go" data-install-go="1">📲 앱으로 바로 설치</button>' +
        (where === 'home' ? '<button type="button" class="install-banner__x" data-install-close="ready" aria-label="안내 닫기">✕</button>' : '') +
        '</div>';
    }

    /* 일반 브라우저 — 설치 창이 자동으로 뜨지 않을 때 */
    if (where !== 'auth') { return ''; }
    return '<button type="button" class="install-banner__link" data-install-guide="1">📲 홈 화면에 추가해서 앱처럼 쓰기 · 방법 보기</button>';
  }

  function fillInstallBanner(host, where) {
    if (!host) { return; }
    host.innerHTML = installBannerHtml(where);
    host.hidden = !host.innerHTML;
    if (host.hidden) { return; }
    var close = host.querySelector('[data-install-close]');
    if (close) {
      close.addEventListener('click', function () {
        S.installHidden[close.getAttribute('data-install-close')] = true;
        store.set('installHidden', S.installHidden);
        refreshInstall();
      });
    }
    var go = host.querySelector('[data-install-go]');
    if (go) { go.addEventListener('click', runInstallPrompt); }
    var guide = host.querySelector('[data-install-guide]');
    if (guide) { guide.addEventListener('click', openInstallGuide); }
  }

  function renderInstallBanners() {
    fillInstallBanner($('#auth-install'), 'auth');
    fillInstallBanner($('#home-install'), 'home');
  }

  /* 설치 상태가 바뀔 때 — 배너와 내정보 카드를 함께 갱신 */
  function refreshInstall() {
    renderInstallBanners();
    var card = $('#install-card');
    if (card) {
      card.innerHTML = installCardHtml();
      bindInstallRow();
    }
  }

  function bindInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.installEvent = e;
      refreshInstall();
    });
    window.addEventListener('appinstalled', function () {
      S.installEvent = null;
      S.installHidden = { inapp: true, ready: true };
      store.set('installHidden', S.installHidden);
      refreshInstall();
      toast('연못을 홈 화면에 추가했어요 📲');
    });
  }

  /* ============================================================
     전역 이벤트
     ============================================================ */
  /* ============================================================
     🍡 경단만들기 (미니게임)
     ============================================================ */
  /** 상단 헤더의 🍡 미니게임 버튼 → 경단만들기를 엽니다.
   *  실제 문파에서는 점수 저장·랭킹을 Supabase로, 체험 모드에서는 이 기기 최고 점수만 씁니다. */
  function openGyeongdan() {
    var G = window.YM_GYEONGDAN;
    if (!G) {
      toast('경단만들기를 불러오지 못했어요. 새로고침해 주세요.');
      return;
    }
    var options = {
      live: isLive(),
      nickname: myNick(),
      onToast: toast,
      /* 랭킹 아바타 — 프로필 그림(preset:...)은 SVG, 사진(data:image/...)은 <img> 로 그립니다.
         그림이 없으면 빈 문자열을 돌려주고 경단만들기가 닉네임 첫 글자를 그립니다. */
      avatarHtml: function (name, avatar) {
        return (presetName(avatar) || isImageAvatar(avatar)) ? avatarSpan('gd-rank__avatar', name, avatar) : '';
      }
    };
    if (isLive()) {
      options.submitScore = function (score, tier) { return DB.submitGyeongdanScore(score, tier); };
      options.listRanking = function () { return DB.listGyeongdanRanking(20); };
    }
    G.open(options);
  }

  /* ============================================================
     🐾 신수팡 (미니게임)
     ============================================================ */
  /** 상단 헤더의 🐾 신수팡 버튼 → 신수팡을 엽니다.
   *  경단만들기와 같은 방식으로 점수 저장·랭킹을 Supabase로, 체험 모드에서는 이 기기 최고 점수만 씁니다. */
  function openSinsupang() {
    var G = window.YM_SINSUPANG;
    if (!G) {
      toast('신수팡을 불러오지 못했어요. 새로고침해 주세요.');
      return;
    }
    var options = {
      live: isLive(),
      nickname: myNick(),
      onToast: toast,
      /* 랭킹 아바타 — 프로필 그림(preset:...)은 SVG, 사진(data:image/...)은 <img> 로 그립니다.
         그림이 없으면 빈 문자열을 돌려주고 신수팡이 닉네임 첫 글자를 그립니다. */
      avatarHtml: function (name, avatar) {
        return (presetName(avatar) || isImageAvatar(avatar)) ? avatarSpan('gd-rank__avatar', name, avatar) : '';
      }
    };
    if (isLive()) {
      options.submitScore = function (score, combo) { return DB.submitSinsupangScore(score, combo); };
      options.listRanking = function () { return DB.listSinsupangRanking(20); };
    }
    G.open(options);
  }

  /* ============================================================
     🫧 신수모아 (미니게임)
     ============================================================ */
  /** 🎮 미니게임 메뉴의 🫧 신수모아 → 신수모아를 엽니다.
   *  경단만들기·신수팡과 같은 방식으로 점수 저장·랭킹을 Supabase로, 체험 모드에서는 이 기기 최고 점수만 씁니다. */
  function openSinsumoa() {
    var G = window.YM_SINSUMOA;
    if (!G) {
      toast('신수모아를 불러오지 못했어요. 새로고침해 주세요.');
      return;
    }
    var options = {
      live: isLive(),
      nickname: myNick(),
      onToast: toast,
      /* 랭킹 아바타 — 프로필 그림(preset:...)은 SVG, 사진(data:image/...)은 <img> 로 그립니다. */
      avatarHtml: function (name, avatar) {
        return (presetName(avatar) || isImageAvatar(avatar)) ? avatarSpan('gd-rank__avatar', name, avatar) : '';
      }
    };
    if (isLive()) {
      options.submitScore = function (score, combo) { return DB.submitSinsumoaScore(score, combo); };
      options.listRanking = function () { return DB.listSinsumoaRanking(20); };
    }
    G.open(options);
  }

  /* ============================================================
     🦆 연못 생존기 (미니게임)
     ============================================================ */
  /** 🎮 미니게임 메뉴의 🦆 연못 생존기 → 도깨비불을 피하는 닷지 게임을 엽니다.
   *  점수는 생존 시간(센티초 정수, 4285 = 42.85초)으로 저장하고 랭킹판에는 초로 보여 줍니다. */
  function openSurvival() {
    var G = window.YM_SURVIVAL;
    if (!G) {
      toast('연못 생존기를 불러오지 못했어요. 새로고침해 주세요.');
      return;
    }
    var options = {
      live: isLive(),
      nickname: myNick(),
      onToast: toast,
      /* 랭킹 아바타 — 프로필 그림(preset:...)은 SVG, 사진(data:image/...)은 <img> 로 그립니다. */
      avatarHtml: function (name, avatar) {
        return (presetName(avatar) || isImageAvatar(avatar)) ? avatarSpan('gd-rank__avatar', name, avatar) : '';
      }
    };
    if (isLive()) {
      options.submitScore = function (score) { return DB.submitSurvivalScore(score); };
      options.listRanking = function () { return DB.listSurvivalRanking(20); };
    }
    G.open(options);
  }

  /* ============================================================
     🎮 미니게임 고르기 메뉴 (경단만들기 · 신수팡 · 신수모아 · 연못 생존기)
     ============================================================ */
  var gameMenuOpen = false;

  function setGameMenu(open) {
    var menu = $('#game-menu');
    var btn = $('#game-btn');
    if (!menu || !btn) { return; }
    gameMenuOpen = !!open;
    menu.hidden = !gameMenuOpen;
    btn.setAttribute('aria-expanded', gameMenuOpen ? 'true' : 'false');
  }

  function closeGameMenu() { setGameMenu(false); }

  function openGamePick(which) {
    closeGameMenu();
    if (which === 'gyeongdan') { openGyeongdan(); return; }
    if (which === 'sinsupang') { openSinsupang(); return; }
    if (which === 'sinsumoa') { openSinsumoa(); return; }
    if (which === 'survival') { openSurvival(); return; }
  }

  function bindGameMenu() {
    var btn = $('#game-btn');
    var menu = $('#game-menu');
    /* 🛍️ 포인트 샵 · 🏠 마이홈 — v49에서는 준비 중 안내만 */
    ['#shop-btn', '#myhome-btn'].forEach(function (sel) {
      var b = $(sel);
      if (b) { b.addEventListener('click', function (e) { e.stopPropagation(); soonNotice(); }); }
    });
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        setGameMenu(!gameMenuOpen);
      });
    }
    if (menu) {
      menu.addEventListener('click', function (e) {
        var item = e.target && e.target.closest ? e.target.closest('[data-game]') : null;
        if (!item) { return; }
        openGamePick(item.getAttribute('data-game'));
      });
    }
    document.addEventListener('click', function (e) {
      if (!gameMenuOpen) { return; }
      var t = e.target;
      if (t && t.closest && (t.closest('#game-menu') || t.closest('#game-btn'))) { return; }
      closeGameMenu();
    });
  }

  function bindGlobal() {
    $('#modal').addEventListener('click', function (e) {
      var target = e.target;
      var closer = target && target.closest ? target.closest('[data-close]') : null;
      if (closer) { closeModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (V.open) { closeViewer(); return; }
        if (gameMenuOpen) { closeGameMenu(); return; }
        closeModal();
      }
    });
    bindGameMenu();
  }

  /* ============================================================
     🔗 외부 체험 링크 (게스트 · ?guest=TOKEN)
     ------------------------------------------------------------
     · 링크를 연 사람에게는 문파 화면을 아예 그리지 않습니다.
       (로그인·공지·채팅·앨범·문파원·문파 랭킹·초대 코드 모두 보이지 않고, 서버로도 묻지 않습니다)
     · 미니게임 4종과 '게스트 전용 랭킹'만 보여 줍니다.
     · 유효기간이 지나도 하던 놀이를 강제로 끊지 않습니다 — 타이머 글자만 '체험 시간이 끝났어요'로
       바뀌고, 새로 열거나 새로고침하면 그때 만료 안내가 뜹니다.
     ============================================================ */

  var GUEST_GAMES = [
    { key: 'gyeongdan', mark: '🍡', name: '경단만들기', desc: '경단을 쌓아 합치는 11단계' },
    { key: 'sinsupang', mark: '🐾', name: '신수팡', desc: '세 개를 맞추는 60초 퍼즐' },
    { key: 'sinsumoa', mark: '🫧', name: '신수모아', desc: '네 개 이상 모아 터뜨리는 60초 퍼즐' },
    { key: 'survival', mark: '🦆', name: '연못 생존기', desc: '도깨비불을 피하는 한 번의 목숨' }
  ];
  var GUEST_GAME_LABEL = { all: '전체 4종', gyeongdan: '경단만들기', sinsupang: '신수팡', sinsumoa: '신수모아', survival: '연못 생존기' };
  var GUEST_MINUTES = [10, 30, 60, 1440];
  var GUEST_MINUTE_LABEL = { 10: '10분', 30: '30분', 60: '1시간', 1440: '24시간' };

  var guest = null;                       /* { token, game, expiresAt, demo, timer } */
  var glPick = { game: 'all', minutes: 10 };
  var glTickTimer = null;
  var GUEST_NICK_DEFAULT = '';

  function guestTokenFromUrl() {
    var search = String(window.location.search || '');
    if (search.indexOf('guest=') === -1) { return null; }
    var token = null;
    try { token = new URLSearchParams(search).get('guest'); } catch (e) { token = null; }
    if (!token) { return null; }
    token = String(token).trim();
    return /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : null;
  }

  function guestLinkUrl(token) {
    var base = String(window.location.href || '').split('#')[0].split('?')[0];
    return base + '?guest=' + encodeURIComponent(token);
  }

  function formatGuestRemain(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var day = Math.floor(sec / 86400); sec -= day * 86400;
    var hour = Math.floor(sec / 3600); sec -= hour * 3600;
    var min = Math.floor(sec / 60); var rest = sec - min * 60;
    if (day > 0) { return day + '일 ' + hour + '시간'; }
    if (hour > 0) { return hour + '시간 ' + min + '분'; }
    if (min > 0) { return rest > 0 ? min + '분 ' + pad(rest) + '초' : min + '분'; }
    return rest + '초';
  }

  /* ---------- 체험 모드에서 만든 '연습용' 링크 (이 기기에만) ---------- */
  function demoGuestLinks() {
    var list = store.get('guestLinks', null);
    return Array.isArray(list) ? list : [];
  }
  function saveDemoGuestLinks(list) { store.set('guestLinks', list); }
  function demoGuestFind(token) {
    var found = null;
    demoGuestLinks().forEach(function (row) {
      if (row && row.token === token) { found = row; }
    });
    return found || null;
  }
  function demoToken() {
    var bytes = new Uint8Array(16);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < 16; i++) { bytes[i] = Math.floor(Math.random() * 256); }
    }
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------- 게스트 이름 (게스트 랭킹에 올릴 이름 · 이 기기에만) ---------- */
  function guestNickname() {
    var nick = store.get('guestNick', GUEST_NICK_DEFAULT);
    return String(nick || '').trim().slice(0, 12);
  }
  function setGuestNickname(nick) {
    store.set('guestNick', String(nick || '').trim().slice(0, 12));
  }

  function askGuestNickname() {
    return new Promise(function (resolve) {
      openModal(modalTitle('체험 랭킹에 올릴 이름') +
        '<p class="lightbox__meta">1~12자 · 이 이름으로 <b>게스트 랭킹</b>에 올라요. 연못 문파 랭킹과는 따로 쌓여요.</p>' +
        '<label class="field" style="margin-top:12px"><span class="field__label">이름</span>' +
        '<input class="field__input" id="gl-ask-nick" type="text" maxlength="12" placeholder="예: 연꽃손님" enterkeyhint="done"></label>' +
        '<div class="lightbox__actions">' +
        '<button type="button" class="btn btn--primary" id="gl-ask-ok">이 이름으로 올리기</button>' +
        '<button type="button" class="btn btn--ghost" id="gl-ask-cancel">그만두기</button>' +
        '</div>');
      var input = $('#gl-ask-nick');
      var finish = function (value) {
        closeModal();
        if (value) {
          setGuestNickname(value);
          var shown = $('#guest-nick');
          if (shown) { shown.value = value; }
        }
        resolve(value);
      };
      var ok = $('#gl-ask-ok');
      var cancel = $('#gl-ask-cancel');
      if (ok) {
        ok.addEventListener('click', function () {
          var value = String((input && input.value) || '').trim().slice(0, 12);
          if (!value) { if (input) { input.focus(); } return; }
          finish(value);
        });
      }
      if (cancel) { cancel.addEventListener('click', function () { finish(''); }); }
      if (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); if (ok) { ok.click(); } }
        });
        window.setTimeout(function () { input.focus(); }, 60);
      }
    });
  }

  /* ---------- 게스트 점수 · 게스트 랭킹 ---------- */
  function guestMetaOf(gameKey, extra) {
    if (typeof extra === 'number') {
      return gameKey === 'gyeongdan' ? { tier: extra } : { combo: extra };
    }
    return (extra && typeof extra === 'object') ? extra : {};
  }

  function demoGuestScores(gameKey) {
    var all = store.get('guestScores', null) || {};
    return Array.isArray(all[gameKey]) ? all[gameKey] : [];
  }
  function demoGuestSubmit(gameKey, nick, score, meta) {
    var all = store.get('guestScores', null) || {};
    var rows = Array.isArray(all[gameKey]) ? all[gameKey] : [];
    var mine = null;
    rows.forEach(function (row) { if (row.nickname.toLowerCase() === nick.toLowerCase()) { mine = row; } });
    var isNew = false;
    if (!mine) {
      rows.push({ nickname: nick, score: score, meta: meta, at: Date.now() });
      isNew = score > 0;
    } else if (score > mine.score) {
      mine.score = score; mine.meta = meta; mine.at = Date.now(); isNew = true;
    }
    all[gameKey] = rows;
    store.set('guestScores', all);
    var best = 0;
    rows.forEach(function (row) { if (row.nickname.toLowerCase() === nick.toLowerCase()) { best = row.score; } });
    var rank = 1;
    rows.forEach(function (row) { if (row.score > best) { rank += 1; } });
    return { ok: true, nickname: nick, score: best, best_score: best, is_new_best: isNew, rank: rank };
  }
  function demoGuestRanking(gameKey) {
    var rows = demoGuestScores(gameKey).slice();
    rows.sort(function (a, b) {
      if (b.score !== a.score) { return b.score - a.score; }
      return (a.at || 0) - (b.at || 0);
    });
    return rows.slice(0, 20).map(function (row, index) {
      return { rank: index + 1, nickname: row.nickname, score: row.score, meta: row.meta || {}, created_at: new Date(row.at || Date.now()).toISOString() };
    });
  }

  function guestSubmitScore(gameKey, score, extra) {
    if (!guest || !guest.token) { return Promise.reject(new Error('체험 링크가 닫혔어요. 새 링크를 받아 주세요.')); }
    var send = function (nick) {
      if (!nick) { return Promise.reject(new Error('이름을 적지 않아 랭킹에 올리지 않았어요.')); }
      var meta = guestMetaOf(gameKey, extra);
      if (guest.demo) { return Promise.resolve(demoGuestSubmit(gameKey, nick, Math.floor(score), meta)); }
      return DB.guest.submitScore(guest.token, gameKey, nick, Math.floor(score), meta).then(function (res) {
        return res || null;
      });
    };
    var nick = guestNickname();
    return nick ? send(nick) : askGuestNickname().then(send);
  }

  function guestRanking(gameKey) {
    if (!guest || !guest.token) { return Promise.reject(new Error('체험 링크가 닫혔어요. 새 링크를 받아 주세요.')); }
    if (guest.demo) { return Promise.resolve(demoGuestRanking(gameKey)); }
    return DB.guest.ranking(guest.token, gameKey, 20).then(function (rows) {
      return Array.isArray(rows) ? rows : [];
    });
  }

  /* ---------- 게스트 화면 ---------- */
  function showGuestView() {
    $('#auth-view').hidden = true;
    $('#main-view').hidden = true;
    var view = $('#guest-view');
    if (view) { view.hidden = false; }
  }

  function renderGuestLoading() {
    var host = $('#guest-body');
    if (!host) { return; }
    host.innerHTML = '<div class="guest__card guest__card--loading">' +
      '<div class="guest__mark">' + ART.mark(44) + '</div>' +
      '<p class="guest__loading">체험 링크를 확인하는 중이에요…</p></div>';
  }

  function renderGuestClosed(reason) {
    var host = $('#guest-body');
    if (!host) { return; }
    var hint = {
      expired: '링크를 보내 준 분께 새 링크를 부탁해 주세요.',
      revoked: '이 링크는 더 이상 쓸 수 없어요 · 새 링크를 부탁해 주세요.',
      invalid: '주소가 잘못되었거나 지워진 링크예요.',
      error: '연결을 확인한 뒤 이 주소로 다시 열어 주세요.'
    }[reason] || '주소가 잘못되었거나 지워진 링크예요.';
    host.innerHTML = '<div class="guest__card guest__card--closed">' +
      '<div class="guest__mark">' + ART.mark(44) + '</div>' +
      '<p class="kicker">도깨비의 세계</p>' +
      '<h1 class="guest__title">체험 링크를 열 수 없어요</h1>' +
      '<p class="guest__closed-line">이 체험 링크는 기간이 만료되었거나<br>사용할 수 없어요.</p>' +
      '<p class="guest__closed-hint">' + hint + '</p>' +
      '</div>';
  }

  function guestGameCardsHtml(allowed) {
    var keys = allowed === 'all' ? GUEST_GAMES.map(function (g) { return g.key; }) : [allowed];
    var solo = keys.length === 1;
    return GUEST_GAMES.filter(function (g) { return keys.indexOf(g.key) !== -1; }).map(function (g) {
      return '<button type="button" class="guest-game' + (solo ? ' guest-game--solo' : '') + '" data-guest-game="' + g.key + '">' +
        '<span class="guest-game__mark" aria-hidden="true">' + g.mark + '</span>' +
        '<span class="guest-game__body"><b>' + esc(g.name) + '</b><em>' + esc(g.desc) + '</em></span>' +
        '<span class="guest-game__play">' + (solo ? '바로 시작' : '시작') + '</span>' +
        '</button>';
    }).join('');
  }

  function renderGuestHome() {
    var host = $('#guest-body');
    if (!host || !guest) { return; }
    var nick = guestNickname();
    host.innerHTML = '<div class="guest__card">' +
      '<div class="guest__mark">' + ART.mark(44) + '</div>' +
      '<p class="kicker">도깨비의 세계</p>' +
      '<h1 class="guest__title">연못 미니게임 체험</h1>' +
      '<p class="guest__sub">문파원이 아닌 분께 잠깐 열어 둔 놀이터예요</p>' +
      '<div class="guest__timer" id="guest-timer" role="timer" aria-live="off">' +
      '<span class="guest__timer-dot" aria-hidden="true"></span>' +
      '<span id="guest-remain">체험 시간을 확인하는 중이에요…</span></div>' +
      '<div class="guest__nick">' +
      '<label class="guest__nick-label" for="guest-nick">체험 랭킹에 올릴 이름</label>' +
      '<input class="guest__nick-input" id="guest-nick" type="text" maxlength="12" placeholder="예: 연꽃손님" value="' + esc(nick) + '" autocomplete="off" enterkeyhint="done">' +
      '<p class="guest__nick-hint">이 이름으로 <b>게스트 전용 랭킹</b>에 올라요 · 연못 문파 랭킹과는 따로 쌓여요</p>' +
      '</div>' +
      '<div class="guest__games">' + guestGameCardsHtml(guest.game) + '</div>' +
      '<p class="guest__note">연못 문파의 공지·채팅·앨범·문파원·문파 랭킹은 보이지 않아요. 놀이 기록은 이 기기에만 임시로 남습니다.</p>' +
      '</div>';

    var input = $('#guest-nick');
    if (input) {
      input.addEventListener('change', function () { setGuestNickname(input.value); });
      input.addEventListener('blur', function () { setGuestNickname(input.value); });
    }
    $$('#guest-body [data-guest-game]').forEach(function (btn) {
      btn.addEventListener('click', function () { openGuestGame(btn.getAttribute('data-guest-game')); });
    });
    tickGuestTimer();
  }

  function tickGuestTimer() {
    var label = $('#guest-remain');
    if (!guest || !label) { return; }
    var wrap = $('#guest-timer');
    var left = guest.expiresAt - Date.now();
    if (left > 0) {
      label.textContent = '체험 종료까지 ' + formatGuestRemain(left) + ' 남음';
      if (wrap) { wrap.classList.remove('is-over'); }
    } else {
      label.textContent = '체험 시간이 끝났어요 · 하던 놀이는 이어서 할 수 있어요';
      if (wrap) { wrap.classList.add('is-over'); }
    }
  }

  function startGuestTimer() {
    if (guest && guest.timer) { window.clearInterval(guest.timer); }
    if (!guest) { return; }
    guest.timer = window.setInterval(tickGuestTimer, 1000);
    tickGuestTimer();
  }

  function openGuestSession(token, game, remainMs, demo) {
    guest = {
      token: token,
      game: (game === 'gyeongdan' || game === 'sinsupang' || game === 'sinsumoa' || game === 'survival') ? game : 'all',
      expiresAt: Date.now() + Math.max(0, Number(remainMs) || 0),
      demo: !!demo,
      timer: null
    };
    renderGuestHome();
    startGuestTimer();
  }

  function startGuest(token) {
    S.mode = 'guest';
    document.title = '연못 · 미니게임 체험';
    showGuestView();
    renderGuestLoading();

    var demo = demoGuestFind(token);
    var verified = (DB && DB.guest && typeof DB.guest.verify === 'function')
      ? DB.guest.verify(token)
      : Promise.reject(new Error('연결 없음'));

    verified.then(function (res) {
      if (res && res.valid === true) {
        openGuestSession(token, res.game, Math.max(1, Number(res.remaining_seconds) || 1) * 1000, false);
        return;
      }
      if (demo) {
        openGuestSession(token, demo.game, Math.max(0, Number(demo.expiresAt) - Date.now()), true);
        return;
      }
      renderGuestClosed(res && res.reason);
    }, function () {
      if (demo) {
        openGuestSession(token, demo.game, Math.max(0, Number(demo.expiresAt) - Date.now()), true);
        return;
      }
      renderGuestClosed('error');
    });
  }

  function guestGameOptions(gameKey) {
    return {
      live: false,
      guestMode: true,
      nickname: guestNickname(),
      onToast: toast,
      avatarHtml: function () { return ''; },
      submitGuestScore: function (score, extra) { return guestSubmitScore(gameKey, score, extra); },
      listGuestRanking: function () { return guestRanking(gameKey); }
    };
  }

  function openGuestGame(gameKey) {
    if (!guest || !guest.token) { return; }
    if (guest.game !== 'all' && guest.game !== gameKey) { return; }
    if (gameKey === 'gyeongdan') {
      var G = window.YM_GYEONGDAN;
      if (!G) { toast('경단만들기를 불러오지 못했어요. 새로고침해 주세요.'); return; }
      G.open(guestGameOptions('gyeongdan'));
      return;
    }
    if (gameKey === 'sinsupang') {
      var P = window.YM_SINSUPANG;
      if (!P) { toast('신수팡을 불러오지 못했어요. 새로고침해 주세요.'); return; }
      P.open(guestGameOptions('sinsupang'));
      return;
    }
    if (gameKey === 'sinsumoa') {
      var M = window.YM_SINSUMOA;
      if (!M) { toast('신수모아를 불러오지 못했어요. 새로고침해 주세요.'); return; }
      M.open(guestGameOptions('sinsumoa'));
      return;
    }
    if (gameKey === 'survival') {
      var V = window.YM_SURVIVAL;
      if (!V) { toast('연못 생존기를 불러오지 못했어요. 새로고침해 주세요.'); return; }
      V.open(guestGameOptions('survival'));
    }
  }

  /* ---------- 문주·운영진: 체험 링크 만들기 (내정보) ---------- */
  function canManageGuestLinks() {
    if (S.mode === 'guest') { return false; }
    if (!isLive()) { return true; }   /* 체험 모드 — 이 기기에서만 연습 */
    return !!(S.me && (S.me.role === 'admin' || S.me.role === 'officer'));
  }

  function guestLinksCardHtml() {
    var demo = !isLive();
    var gameChips = ['all', 'survival', 'sinsumoa', 'sinsupang', 'gyeongdan'].map(function (key) {
      var on = glPick.game === key;
      return '<button type="button" class="chip' + (on ? ' is-active' : '') + '" data-gl-game="' + key +
        '" aria-pressed="' + on + '">' + esc(GUEST_GAME_LABEL[key]) + '</button>';
    }).join('');
    var minChips = GUEST_MINUTES.map(function (min) {
      var on = glPick.minutes === min;
      return '<button type="button" class="chip' + (on ? ' is-active' : '') + '" data-gl-min="' + min +
        '" aria-pressed="' + on + '">' + esc(GUEST_MINUTE_LABEL[min]) + '</button>';
    }).join('');
    return '<div class="menu-card guest-links" id="guest-links-card">' +
      '<h3 class="menu-card__title">🔗 외부 체험 링크</h3>' +
      '<div class="guest-links__body">' +
      '<p class="guest-links__lead">문파원이 아닌 분께 <b>미니게임만</b> 보여 주는 기간제한 링크예요. 공지·채팅·앨범·문파원·문파 랭킹은 링크로도 보이지 않아요.</p>' +
      '<div class="guest-links__field"><span class="guest-links__label">게임</span>' +
      '<div class="guest-links__chips" id="gl-games" role="group" aria-label="체험할 게임">' + gameChips + '</div></div>' +
      '<div class="guest-links__field"><span class="guest-links__label">기간</span>' +
      '<div class="guest-links__chips" id="gl-minutes" role="group" aria-label="링크 유효기간">' + minChips + '</div></div>' +
      '<button type="button" class="btn btn--primary btn--small guest-links__make" id="gl-make">링크 만들고 복사</button>' +
      (demo ? '<p class="guest-links__demo">체험 모드예요 · 이 기기에서만 만들어 보고 열어 볼 수 있어요.</p>' : '') +
      '<div class="guest-links__list" id="gl-list"><p class="guest-links__empty">아직 만든 링크가 없어요</p></div>' +
      '</div></div>';
  }

  function updateGuestLinkBadges() {
    $$('#gl-list .gl-item').forEach(function (item) {
      var badge = $('[data-gl-remain]', item);
      if (!badge || item.getAttribute('data-gl-dead') === '1') { return; }
      var until = Number(item.getAttribute('data-until') || 0);
      var left = until - Date.now();
      if (left > 0) {
        badge.textContent = formatGuestRemain(left) + ' 남음';
        badge.classList.remove('is-over');
        item.classList.remove('is-over');
      } else {
        badge.textContent = '만료됨';
        badge.classList.add('is-over');
        item.classList.add('is-over');
        var stop = $('[data-gl-revoke]', item);
        if (stop) {
          var delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn--quiet btn--small';
          delBtn.setAttribute('data-gl-del', '');
          delBtn.textContent = '삭제';
          stop.parentNode.replaceChild(delBtn, stop);
        }
      }
    });
  }

  function renderGuestLinkItems(rows) {
    var box = $('#gl-list');
    if (!box) { return; }
    if (!rows.length) {
      box.innerHTML = '<p class="guest-links__empty">아직 만든 링크가 없어요</p>';
      return;
    }
    box.innerHTML = rows.map(function (row) {
      var until = row.expires_at ? Date.parse(row.expires_at) : Number(row.expiresAt || 0);
      if (!until || isNaN(until)) { until = 0; }
      var dead = !!row.revoked || until <= Date.now();
      var url = guestLinkUrl(row.token);
      return '<div class="gl-item' + (dead ? ' is-over' : '') + '" data-gl-id="' + esc(row.id) +
        '" data-gl-token="' + esc(row.token) + '" data-until="' + until + '"' +
        (dead ? ' data-gl-dead="1"' : '') + '>' +
        '<div class="gl-item__top"><b class="gl-item__game">' + esc(GUEST_GAME_LABEL[row.game] || row.game) + '</b>' +
        '<span class="gl-item__badge' + (dead ? ' is-over' : '') + '" data-gl-remain>' +
        (dead ? '만료됨' : '확인 중') + '</span></div>' +
        '<p class="gl-item__url">' + esc(url) + '</p>' +
        '<div class="gl-item__acts">' +
        '<button type="button" class="btn btn--ghost btn--small" data-gl-copy>링크 복사</button>' +
        (dead
          ? '<button type="button" class="btn btn--quiet btn--small" data-gl-del>삭제</button>'
          : '<button type="button" class="btn btn--quiet btn--small" data-gl-revoke>만료시키기</button>') +
        '</div></div>';
    }).join('');
    updateGuestLinkBadges();
  }

  /** 체험 링크 기능이 아직 서버에 없을 때(PGRST202)는 실행할 SQL 파일을 알려 줍니다. */
  function guestLinkErrorMessage(err) {
    var code = String((err && err.code) || '');
    var msg = String((err && err.message) || '');
    if (code === 'PGRST202' || msg.indexOf('Could not find the function') !== -1
        || msg.indexOf('이 기능이 아직') !== -1) {
      return '서버에 체험 링크 기능이 아직 준비되지 않았어요 · supabase/migration-guest-links.sql 을 실행해 주세요.';
    }
    return errorMessage(err);
  }

  function refreshGuestLinkList() {
    var box = $('#gl-list');
    if (!box) { return; }
    if (!isLive()) { renderGuestLinkItems(demoGuestLinks()); return; }
    box.innerHTML = '<p class="guest-links__empty">링크를 불러오는 중이에요…</p>';
    DB.guest.list().then(function (rows) {
      renderGuestLinkItems(Array.isArray(rows) ? rows : []);
    }, function (err) {
      box.innerHTML = '<p class="guest-links__empty">' + esc(guestLinkErrorMessage(err)) + '</p>';
    });
  }

  function copyText(text) {
    return new Promise(function (resolve) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(fallbackCopyText(text)); });
        return;
      }
      resolve(fallbackCopyText(text));
    });
  }
  function fallbackCopyText(text) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(area);
      return !!ok;
    } catch (e) { return false; }
  }

  function showGuestLinkModal(url, minutes) {
    openModal(modalTitle('체험 링크가 만들어졌어요') +
      '<p class="lightbox__meta">' + esc(GUEST_MINUTE_LABEL[minutes] || '') + ' 동안 열려 있어요 · 링크를 길게 눌러 복사해 보내 주세요.</p>' +
      '<p class="gl-modal__url" id="gl-modal-url">' + esc(url) + '</p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="btn btn--primary" id="gl-modal-copy">복사</button>' +
      '<button type="button" class="btn btn--ghost" data-close="1">닫기</button></div>');
    var btn = $('#gl-modal-copy');
    if (btn) {
      btn.addEventListener('click', function () {
        copyText(url).then(function (ok) {
          toast(ok ? '체험 링크를 복사했어요' : '길게 눌러 복사해 주세요');
        });
      });
    }
  }

  function createGuestLink() {
    var btn = $('#gl-make');
    if (!btn || btn.getAttribute('aria-busy') === 'true') { return; }
    var label = btn.textContent;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '링크 만드는 중…';
    var done = function () {
      btn.removeAttribute('aria-busy');
      btn.textContent = label;
    };

    if (!isLive()) {
      var token = demoToken();
      var list = demoGuestLinks();
      list.unshift({
        id: token.slice(0, 8), token: token, game: glPick.game, minutes: glPick.minutes,
        createdAt: Date.now(), expiresAt: Date.now() + glPick.minutes * 60000, revoked: false
      });
      saveDemoGuestLinks(list);
      done();
      refreshGuestLinkList();
      copyText(guestLinkUrl(token)).then(function (ok) {
        if (!ok) { showGuestLinkModal(guestLinkUrl(token), glPick.minutes); }
        else { toast('체험 링크를 만들었어요 · ' + GUEST_MINUTE_LABEL[glPick.minutes] + ' 동안 열려요'); }
      });
      return;
    }

    DB.guest.create(glPick.game, glPick.minutes).then(function (res) {
      done();
      refreshGuestLinkList();
      var url = guestLinkUrl(res.token);
      copyText(url).then(function (ok) {
        if (!ok) { showGuestLinkModal(url, glPick.minutes); }
        else { toast('체험 링크를 만들었어요 · ' + GUEST_MINUTE_LABEL[glPick.minutes] + ' 동안 열려요 · 복사했어요'); }
      });
    }, function (err) {
      done();
      toast(guestLinkErrorMessage(err));
    });
  }

  function revokeGuestLink(id, token) {
    openModal(modalTitle('이 링크를 지금부터 못 쓰게 할까요?') +
      '<p class="lightbox__meta">기간이 남아 있어도 바로 닫혀요. 이미 들어와 놀고 있는 사람의 화면은 그대로 이어져요.</p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="btn btn--primary" id="gl-revoke-ok">만료시키기</button>' +
      '<button type="button" class="btn btn--ghost" data-close="1">그대로 두기</button></div>');
    var ok = $('#gl-revoke-ok');
    if (!ok) { return; }
    ok.addEventListener('click', function () {
      ok.setAttribute('disabled', 'disabled');
      if (!isLive()) {
        var list = demoGuestLinks();
        list.forEach(function (row) { if (row.id === id || row.token === token) { row.revoked = true; } });
        saveDemoGuestLinks(list);
        closeModal();
        refreshGuestLinkList();
        toast('체험 링크를 만료시켰어요');
        return;
      }
      DB.guest.revoke(id).then(function () {
        closeModal();
        refreshGuestLinkList();
        toast('체험 링크를 만료시켰어요');
      }, function (err) {
        ok.removeAttribute('disabled');
        toast(guestLinkErrorMessage(err));
      });
    });
  }

  function deleteGuestLink(id) {
    openModal(modalTitle('만료된 링크를 목록에서 지울까요?') +
      '<p class="lightbox__meta">링크만 지워지고 게스트 랭킹 기록은 그대로 남아요. 한 번 지우면 되돌릴 수 없어요.</p>' +
      '<div class="lightbox__actions">' +
      '<button type="button" class="btn btn--primary" id="gl-del-ok">삭제하기</button>' +
      '<button type="button" class="btn btn--ghost" data-close="1">그대로 두기</button></div>');
    var ok = $('#gl-del-ok');
    if (!ok) { return; }
    ok.addEventListener('click', function () {
      ok.setAttribute('disabled', 'disabled');
      if (!isLive()) {
        var list = demoGuestLinks().filter(function (row) { return row.id !== id; });
        saveDemoGuestLinks(list);
        closeModal();
        refreshGuestLinkList();
        toast('만료된 체험 링크를 지웠어요');
        return;
      }
      DB.guest.del(id).then(function () {
        closeModal();
        refreshGuestLinkList();
        toast('만료된 체험 링크를 지웠어요');
      }, function (err) {
        ok.removeAttribute('disabled');
        closeModal();
        toast(guestLinkDeleteErrorMessage(err));
      });
    });
  }

  /** v63 삭제 RPC가 아직 서버에 없을 때(PGRST202)는 실행할 SQL 파일을 알려 줍니다. */
  function guestLinkDeleteErrorMessage(err) {
    var code = String((err && err.code) || '');
    var msg = String((err && err.message) || '');
    if (code === 'PGRST202' || msg.indexOf('Could not find the function') !== -1) {
      return '서버에 링크 삭제 기능이 아직 준비되지 않았어요 · supabase/migration-v63-delete-guest-link.sql 을 실행해 주세요.';
    }
    return guestLinkErrorMessage(err);
  }

  function bindGuestLinksCard() {
    if (!$('#guest-links-card')) { return; }

    var gameChips = $$('#gl-games .chip');
    gameChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        glPick.game = chip.getAttribute('data-gl-game') || 'all';
        gameChips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', String(on));
        });
      });
    });

    var minChips = $$('#gl-minutes .chip');
    minChips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        glPick.minutes = Number(chip.getAttribute('data-gl-min')) || 10;
        minChips.forEach(function (c) {
          var on = c === chip;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', String(on));
        });
      });
    });

    var make = $('#gl-make');
    if (make) { make.addEventListener('click', createGuestLink); }

    var list = $('#gl-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var target = e.target && e.target.closest ? e.target.closest('[data-gl-copy], [data-gl-revoke], [data-gl-del]') : null;
        if (!target) { return; }
        var item = target.closest('.gl-item');
        if (!item) { return; }
        var token = item.getAttribute('data-gl-token') || '';
        var id = item.getAttribute('data-gl-id') || '';
        if (target.hasAttribute('data-gl-copy')) {
          copyText(guestLinkUrl(token)).then(function (ok) {
            toast(ok ? '체험 링크를 복사했어요' : '길게 눌러 복사해 주세요');
          });
          return;
        }
        if (target.hasAttribute('data-gl-del')) {
          deleteGuestLink(id);
          return;
        }
        revokeGuestLink(id, token);
      });
    }

    window.clearInterval(glTickTimer);
    glTickTimer = window.setInterval(updateGuestLinkBadges, 1000);
    refreshGuestLinkList();
  }

  /* v64 — 상단 「🌸 연못」 누르면 최신 버전 캐시까지 받아 새로고침 (로그인 세션 localStorage 는 그대로) */
  function bindAppRefresh() {
    var btn = $('#refresh-app-btn');
    if (!btn) { return; }
    var clearYeonmotCaches = function () {
      if (!('caches' in window)) { return Promise.resolve(); }
      return caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) {
          if (key.indexOf('yeonmot-munpa-') === 0) { return caches.delete(key); }
          return null;
        }));
      });
    };
    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-busy') === 'true') { return; }
      btn.setAttribute('aria-busy', 'true');
      toast('최신 버전을 확인하고 있어요…');
      var reload = function () { location.reload(); };
      var finish = function () {
        /* 오프라인이면 캐시를 지우지 않고 그대로 새로고침 (설치된 앱이 깨지지 않게) */
        if (navigator.onLine === false) { reload(); return; }
        clearYeonmotCaches().then(reload, reload);
      };
      if (!('serviceWorker' in navigator)) { finish(); return; }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) { finish(); return; }
        reg.update().then(function () {
          if (reg.waiting) { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); }
          finish();
        }, finish);
      }, finish);
    });
  }

  if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is optional */ });
    });
  }

  bindInstall();
  bindAppRefresh();
  renderInstallBanners();

  document.addEventListener('DOMContentLoaded', init);
})();
