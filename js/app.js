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
    firstSendNoted: false,
    realtime: 'off',
    busy: false,
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
  var AVATAR_PRESETS = ['lotus', 'koi', 'frog', 'firefly', 'moon', 'leaf', 'turtle', 'lantern'];

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
  function nextWeekday(dow, hour, minute) {
    var now = new Date();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    var diff = (dow - target.getDay() + 7) % 7;
    if (diff === 0 && target.getTime() <= now.getTime()) { diff = 7; }
    target.setDate(target.getDate() + diff);
    return target;
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

  /* ============================================================
     체험 모드 데이터
     ============================================================ */
  function trialEventDate(ev) {
    if (ev.type === 'weekly') { return nextWeekday(ev.weekday, ev.hour, ev.minute); }
    var d = addDays(ev.days || 0);
    d.setHours(ev.hour, ev.minute, 0, 0);
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

    S.events = D.events.map(function (ev, i) {
      return {
        id: 'e' + i,
        title: ev.title,
        place: ev.place,
        tag: ev.tag,
        note: ev.note,
        starts_at: trialEventDate(ev).toISOString(),
        ends_at: null
      };
    }).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

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
        joined_at: null,
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
        caption: '',
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
      title: p.title,
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
          S.events = (rows || []).map(function (e) {
            return {
              id: e.id, title: e.title, place: e.place || '', tag: e.tag || '모임',
              note: e.note || '', starts_at: e.starts_at, ends_at: e.ends_at
            };
          });
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

  /** 공지 · 일정은 공개 테이블에서 읽고, 작성자 닉네임은 문파원 목록으로 맞춥니다. */
  function reloadClanContent() {
    return Promise.all([
      DB.listGuides().then(function (rows) { S.guides = (rows || []).map(mapGuide); }, function () {}),
      DB.listNotices().then(function (rows) { S.noticeRows = rows || []; }, function () {}),
      DB.listEvents().then(function (rows) {
        S.events = (rows || []).map(function (e) {
          return {
            id: e.id, title: e.title, place: e.place || '', tag: e.tag || '모임',
            note: e.note || '', starts_at: e.starts_at, ends_at: e.ends_at
          };
        });
      }, function () {})
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
            '<p>· 홈에서 공지 · 일정 · 쿠폰을 만들고 지울 수 있어요.</p>' +
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
  function renderHome() {
    if (!S.ready || !S.clan) {
      $('#home-body').innerHTML = '<div class="empty">연못을 불러오는 중이에요…</div>';
      return;
    }

    var clan = S.clan;
    var wave = (S.me && S.me.wave) || { today_done: false, streak: 0, total: 0 };
    var admin = isAdmin();
    var html = '';

    html += '<header class="screen__head">' +
      '<p class="kicker">도깨비의 세계' + (isLive() ? ' · 문파' : ' · 체험') + '</p>' +
      '<h2 class="screen__title">' + esc(clan.name || '연못') + '</h2>' +
      '<p class="screen__sub">' + esc(clan.motto || '') + '</p>' +
      '</header>';

    html += '<section class="hero" aria-label="연못 배너">' + ART.hero() +
      '<div class="hero__pills">' +
      (clan.level ? '<span class="pill pill--gold">문파 레벨 ' + esc(clan.level) + '</span>' : '') +
      '<span class="pill">문파원 ' + fmtNum(clan.member_count) + ' / ' + fmtNum(clan.capacity) + '</span>' +
      '</div>' +
      '<div class="hero__overlay">' +
      '<div class="hero__caption"><strong>' + esc(clan.name || '연못') + '</strong><span>오늘도 고요한 연못에 물결을 남겨요</span></div>' +
      '<button type="button" class="wave-btn' + (wave.today_done ? ' is-done' : '') + '" id="wave-btn"' +
      (wave.today_done ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      '<span class="wave-btn__ring" aria-hidden="true"></span>' +
      '<span id="wave-label">' + waveLabel(wave) + '</span>' +
      '</button>' +
      '</div></section>';

    html += '<div class="stats">' +
      '<div class="stat"><strong>' + fmtNum(clan.today_waves) + '</strong><span>오늘의 물결</span></div>' +
      '<div class="stat"><strong>' + fmtNum(clan.week_waves) + '</strong><span>이번 주 출석</span></div>' +
      '<div class="stat"><strong>+' + fmtNum(clan.new_members_7d) + '</strong><span>새 문파원</span></div>' +
      '</div>';

    /* 공지 */
    html += '<section class="section" aria-labelledby="home-notice-title">' +
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
        (admin ? '<div class="item-tools"><button type="button" class="tool" data-pin="' + esc(n.id) + '" data-pinned="' + (n.pinned ? '1' : '0') + '">' +
          (n.pinned ? '고정 해제' : '고정') + '</button>' +
          '<button type="button" class="tool tool--danger" data-del-notice="' + esc(n.id) + '">삭제</button></div>' : '') +
        '</article>';
    });
    html += '</section>';

    /* 일정 */
    html += '<section class="section" aria-labelledby="home-event-title">' +
      '<div class="section__head"><h3 class="section__title" id="home-event-title">모임 일정</h3>' +
      '<span class="section__hadd">' + (admin ? '<button type="button" class="tool tool--add" data-add="event">+ 일정 추가</button>' : '') +
      '<span class="section__more">다가오는 일정</span></span></div>';

    if (!S.events.length) {
      html += '<div class="empty">아직 잡힌 일정이 없어요.' + (admin ? ' 위의 <b>+ 일정 추가</b>로 첫 모임을 잡아 보세요.' : '') + '</div>';
    } else {
      html += '<div class="events">';
      S.events.forEach(function (ev) {
        var date = new Date(ev.starts_at);
        var dd = ddayOf(date);
        html += '<article class="event">' +
          '<div class="event__main">' +
          '<div class="event__date"><span class="event__d">' + date.getDate() + '</span>' +
          '<span class="event__m">' + (date.getMonth() + 1) + '월 · ' + WEEKDAYS[date.getDay()] + '</span></div>' +
          '<div class="event__info"><div class="event__title">' + esc(ev.title) + '</div>' +
          '<div class="event__meta"><span>' + timeLabel(ev.starts_at) + '</span><span>·</span><span>' + esc(ev.place || '장소 미정') + '</span></div>' +
          (ev.note ? '<div class="event__meta"><span>' + esc(ev.note) + '</span></div>' : '') +
          '</div>' +
          '<span class="event__dday' + (dd === '오늘' || dd === '내일' ? ' is-soon' : '') + '">' + dd + '</span>' +
          '</div>' +
          (admin ? '<div class="item-tools"><button type="button" class="tool tool--danger" data-del-event="' + esc(ev.id) + '">일정 삭제</button></div>' : '') +
          '</article>';
      });
      html += '</div>';
    }
    html += '</section>';

    /* 쿠폰 */
    html += '<section class="section" aria-labelledby="home-coupon-title">' +
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
          (admin ? '<div class="item-tools"><button type="button" class="tool tool--danger" data-del-coupon="' + esc(c.id) + '">쿠폰 삭제</button></div>' : '') +
          '</article>';
      });
      html += '</div>';
      if (!isLive()) { html += '<p class="section__note">체험 모드의 예시 쿠폰이에요. 실제 게임에서 쓰이는 코드가 아닙니다.</p>'; }
    }
    html += '</section>';

    /* 공략 — 유튜브 영상 2×2 */
    html += '<section class="section" aria-labelledby="home-guide-title">' +
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

    /* 문파원 자리비움 — 잠시 연못을 비우는 문파원 알림 */
    html += '<section class="section" aria-labelledby="home-absence-title">' +
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
        ? '<p>연못 문파원이 함께 쓰는 공간이에요. 공지 · 일정 · 쿠폰은 문주가, 채팅 · 앨범 · 공략 · 자리비움은 문파원 모두가 채웁니다.</p>' +
          '<p>이름 · 전화번호 · 이메일은 받지 않아요. 닉네임과 PIN 만 쓰고, PIN 은 되돌릴 수 없는 암호로만 저장돼요.</p>'
        : '<p>연못을 위한 작은 커뮤니티 앱의 체험 모드예요. 공지 · 일정 · 쿠폰 · 공략 · 자리비움 · 앨범 · 대화는 예시로 채워져 있습니다.</p>' +
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
      var art = ready
        ? '<img class="shot__img" src="' + esc(img) + '" alt="' + esc(item.title) + '" loading="lazy">'
        : ((item.image_mime && img !== 'failed')
          ? '<span class="shot__loading">사진을 불러오는 중…</span>'
          : ART.scene(item.kind || 'moon'));
      var canDelete = admin || (isLive() && item.author_id && item.author_id === myId());
      var authorAvatar = memberAvatarById(item.author_id) || item.author_avatar;
      html += '<div class="shot" role="button" tabindex="0" data-shot="' + esc(item.id) + '" aria-label="' + esc(item.title) + ' 크게 보기">' +
        '<span class="shot__art">' + art + '</span>' +
        (relDayLabel(item.created_at) === relDayLabel(new Date()) ? '<span class="shot__new">NEW</span>' : '') +
        (canDelete ? '<button type="button" class="shot__del" data-del-album="' + esc(item.id) + '" aria-label="사진 지우기">×</button>' : '') +
        '<span class="shot__meta">' +
        '<span class="shot__title">' + esc(item.title) + '</span>' +
        '<span class="shot__sub">' + '<span class="shot__author">' + avatarSpan('avatar--xs', item.author, authorAvatar) + '<span>' + esc(item.author) + '</span></span>' +
        '<span class="shot__like" data-like-count="' + esc(item.id) + '">' +
        heartSvg(item.liked) + ' ' + item.likes + '</span></span>' +
        '</span></div>';
    });
    html += '</div>';

    html += '<div class="section"><button type="button" class="btn btn--ghost" id="upload-btn">사진 올리기</button>' +
      '<p class="section__note">' + (isLive()
        ? '사진은 긴 변 1,280px · 800KB 이하로 자동으로 줄여서 올라가요. 하루 10장까지 올릴 수 있습니다.'
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
          img.innerHTML = '<img class="shot__img" src="' + esc(res.data_url) + '" alt="' + esc(item.title) + '" loading="lazy">';
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

  function openLightbox(id) {
    var item = findAlbumItem(id);
    if (!item) { return; }
    var image = S.albumImages[item.id];
    var art = (image && image !== 'loading' && image !== 'failed')
      ? '<img class="shot__img" src="' + esc(image) + '" alt="' + esc(item.title) + '">'
      : (item.image_mime && image !== 'failed' ? '<span class="shot__loading">사진을 불러오는 중…</span>' : ART.scene(item.kind || 'moon'));

    var canDelete = isAdmin() || (isLive() && item.author_id && item.author_id === myId());

    var html = '<div class="lightbox">' +
      '<div class="lightbox__art">' + art + '</div>' +
      modalTitle(item.title) +
      '<p class="lightbox__meta">' + esc(item.author) + ' · ' + relDayLabel(item.created_at) + ' · 문파앨범</p>' +
      (item.caption ? '<p class="lightbox__caption">' + esc(item.caption) + '</p>' : '') +
      '<div class="lightbox__actions">' +
      '<button type="button" class="like-btn" id="like-btn" aria-pressed="' + item.liked + '">' +
      heartSvg(item.liked) + '<span id="like-text">물결 ' + item.likes + '</span></button>' +
      '<span class="section__more">마음이 닿으면 한 번 눌러주세요</span>' +
      '</div>' +
      (canDelete ? '<div class="item-tools" style="justify-content:flex-start;margin-top:12px"><button type="button" class="tool tool--danger" id="album-del">이 사진 지우기</button></div>' : '') +
      '</div>';
    openModal(html);

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
  }

  function openAlbumForm() {
    openModal(modalTitle('사진 올리기') +
      '<p class="lightbox__meta">스크린샷이나 연못에서 찍은 장면을 남겨 보세요.</p>' +
      '<form class="form" id="album-form" novalidate style="margin-top:14px">' +
      '<label class="field"><span class="field__label">사진</span>' +
      '<input class="field__input field__file" type="file" accept="image/jpeg,image/png,image/webp" id="album-file">' +
      '</label>' +
      '<label class="field"><span class="field__label">제목</span>' +
      '<input class="field__input" type="text" id="album-title" maxlength="40" placeholder="예) 달빛 아래 연못"></label>' +
      '<label class="field"><span class="field__label">설명 (선택)</span>' +
      '<textarea class="field__input field__textarea" id="album-caption" maxlength="300" rows="3" placeholder="어떤 순간이었는지 적어 주세요"></textarea></label>' +
      '<p class="form__error" id="album-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">연못에 남기기</button>' +
      '</form>');

    var form = $('#album-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fileInput = $('#album-file');
      var title = $('#album-title').value.trim();
      var caption = $('#album-caption').value.trim();
      var errEl = $('#album-error');
      var file = fileInput.files && fileInput.files[0];

      var problem = '';
      if (!file) { problem = '사진을 골라 주세요.'; }
      else if (!title) { problem = '제목을 적어 주세요.'; }
      if (problem) {
        errEl.textContent = problem;
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;

      var btn = $('button[type="submit"]', form);
      btn.disabled = true;
      btn.textContent = '사진을 줄이는 중…';

      DB.compressPhoto(file).then(function (photo) {
        btn.textContent = '연못에 남기는 중…';
        return DB.createAlbumPost(title, photo.dataUrl, caption, photo.mime).then(function (created) {
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
        errEl.textContent = errorMessage(err);
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
        (metaRight ? '<span class="sep">·</span><span>' + esc(metaRight) + '</span>' : '') + '</div>' +
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
     관리자: 공지 · 일정 · 쿠폰
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
    confirmAction('일정을 지울까요?', '“' + (ev ? ev.title : '일정') + '”이 목록에서 사라져요.', '지우기', function () {
      return DB.admin.deleteEvent(id).then(function () {
        S.events = S.events.filter(function (x) { return x.id !== id; });
        renderHome();
        toast('일정을 지웠어요.');
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

  function openNoticeForm() {
    openModal(modalTitle('공지 쓰기') +
      '<form class="form" id="notice-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">제목</span>' +
      '<input class="field__input" type="text" id="notice-title" maxlength="60" placeholder="예) 연꽃 등불 축제 단체 참가 신청"></label>' +
      '<label class="field"><span class="field__label">내용</span>' +
      '<textarea class="field__input field__textarea" id="notice-body" rows="6" maxlength="4000" placeholder="문파원에게 전할 이야기를 적어 주세요"></textarea></label>' +
      '<div class="form__row">' +
      '<label class="field"><span class="field__label">태그</span>' +
      '<input class="field__input" type="text" id="notice-tag" maxlength="10" value="공지"></label>' +
      '<label class="check"><input type="checkbox" id="notice-pinned"> 위에 고정</label>' +
      '</div>' +
      '<p class="form__error" id="notice-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">공지 올리기</button>' +
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

      DB.admin.createNotice(title, body, tag, pinned).then(function () {
        closeModal();
        toast('공지를 올렸어요.');
        return reloadClanContent();
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = errorMessage(err);
        errEl.hidden = false;
      });
    });
  }

  function openEventForm() {
    var now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    var value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
      'T' + pad(now.getHours()) + ':' + pad(now.getMinutes());

    openModal(modalTitle('일정 잡기') +
      '<form class="form" id="event-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">일정 이름</span>' +
      '<input class="field__input" type="text" id="event-title" maxlength="60" placeholder="예) 주간 보스 원정"></label>' +
      '<label class="field"><span class="field__label">날짜와 시간</span>' +
      '<input class="field__input" type="datetime-local" id="event-start" value="' + value + '"></label>' +
      '<label class="field"><span class="field__label">모이는 곳</span>' +
      '<input class="field__input" type="text" id="event-place" maxlength="60" placeholder="예) 연못 입구 · 3구역"></label>' +
      '<div class="form__row">' +
      '<label class="field"><span class="field__label">태그</span>' +
      '<input class="field__input" type="text" id="event-tag" maxlength="10" value="모임"></label>' +
      '<label class="field"><span class="field__label">메모 (선택)</span>' +
      '<input class="field__input" type="text" id="event-note" maxlength="200" placeholder="예) 21:20까지 모여주세요"></label>' +
      '</div>' +
      '<p class="form__error" id="event-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">일정 올리기</button>' +
      '</form>');

    $('#event-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#event-title').value.trim();
      var startRaw = $('#event-start').value;
      var errEl = $('#event-error');
      if (!title || !startRaw) {
        errEl.textContent = '일정 이름과 날짜·시간을 정해 주세요.';
        errEl.hidden = false;
        return;
      }
      var start = new Date(startRaw);
      if (isNaN(start.getTime())) {
        errEl.textContent = '날짜와 시간을 다시 확인해 주세요.';
        errEl.hidden = false;
        return;
      }
      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      DB.admin.createEvent({
        title: title,
        startsAt: start.toISOString(),
        place: $('#event-place').value.trim(),
        tag: $('#event-tag').value.trim() || '모임',
        note: $('#event-note').value.trim()
      }).then(function () {
        closeModal();
        toast('일정을 올렸어요.');
        return DB.listEvents().then(function (rows) {
          S.events = (rows || []).map(function (ev) {
            return {
              id: ev.id, title: ev.title, place: ev.place || '', tag: ev.tag || '모임',
              note: ev.note || '', starts_at: ev.starts_at, ends_at: ev.ends_at
            };
          });
        });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = errorMessage(err);
        errEl.hidden = false;
      });
    });
  }

  function openCouponForm() {
    openModal(modalTitle('쿠폰 만들기') +
      '<form class="form" id="coupon-form" novalidate style="margin-top:12px">' +
      '<label class="field"><span class="field__label">쿠폰 코드</span>' +
      '<input class="field__input" type="text" id="coupon-code" maxlength="24" placeholder="한글·영문·숫자 3~24자 (예: 연꽃2026)" autocapitalize="characters"></label>' +
      '<label class="field"><span class="field__label">유효기간 (선택 · 비우면 기한 없음)</span>' +
      '<input class="field__input" type="date" id="coupon-expires"></label>' +
      '<p class="form__error" id="coupon-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">쿠폰 올리기</button>' +
      '</form>');

    $('#coupon-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('#coupon-code').value.trim().toUpperCase();
      var errEl = $('#coupon-error');
      if (!/^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_-]{2,23}$/.test(code)) {
        errEl.textContent = '쿠폰 코드는 한글·영문·숫자·-·_ 3~24자로 정해 주세요.';
        errEl.hidden = false;
        return;
      }
      var btn = $('button[type="submit"]', this);
      btn.disabled = true;

      DB.admin.createCoupon({
        code: code,
        title: COUPON_BLANK,
        reward: COUPON_BLANK,
        expiresOn: $('#coupon-expires').value || null,
        tone: 'lotus'
      }).then(function () {
        closeModal();
        toast('쿠폰을 올렸어요.');
        return DB.listCoupons().then(function (rows) {
          S.coupons = (rows || []).map(function (c) {
            return { id: c.id, code: c.code, title: c.title, reward: c.reward, expires_on: c.expires_on, tone: c.tone || 'lotus' };
          });
        });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = errorMessage(err);
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

  function openGuideForm() {
    openModal(modalTitle('공략 영상 추가') +
      '<p class="lightbox__meta">유튜브 주소를 붙여 넣으면 썸네일과 함께 홈 <b>공략</b>에 2×2로 보여요.</p>' +
      '<form class="form" id="guide-form" novalidate style="margin-top:14px">' +
      '<label class="field"><span class="field__label">유튜브 주소</span>' +
      '<input class="field__input" type="text" id="guide-url" inputmode="url" autocomplete="off" placeholder="https://youtu.be/… 또는 youtube.com/watch?v=…"></label>' +
      '<div class="guide-preview" id="guide-preview" hidden></div>' +
      '<label class="field"><span class="field__label">제목</span>' +
      '<input class="field__input" type="text" id="guide-title" maxlength="80" placeholder="예) 물그림자 2페이즈 물기둥 피하기"></label>' +
      '<p class="form__error" id="guide-error" role="alert" hidden></p>' +
      '<button type="submit" class="btn btn--primary">공략에 올리기</button>' +
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

      if (!vid) {
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

      DB.createGuide(title, url).then(function () {
        closeModal();
        toast('공략 영상을 올렸어요');
        return DB.listGuides().then(function (rows) { S.guides = (rows || []).map(mapGuide); });
      }).then(function () {
        renderHome();
      }).catch(function (err) {
        btn.disabled = false;
        errEl.textContent = errorMessage(err);
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

    /* 프로필 그림 — 연못 일러스트 8종 · 내 사진 · 기본 글자 */
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
        '</div>';
    }

    html += '<div class="menu-card">' +
      '<h3 class="menu-card__title">앱으로 쓰기</h3>' +
      '<button type="button" class="row row--action" id="install-row">' +
      '<span class="row__icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="row__text"><span class="row__label">홈 화면에 추가</span>' +
      '<span class="row__desc" id="install-desc">연못을 앱처럼 열 수 있어요</span></span>' +
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
    $('#install-row').addEventListener('click', function () {
      if (S.installEvent) {
        S.installEvent.prompt();
        S.installEvent = null;
        return;
      }
      var steps = $('#install-steps');
      var open = steps.classList.toggle('is-open');
      this.setAttribute('aria-expanded', String(open));
      $('#install-desc').textContent = open ? '아래 순서를 따라 눌러보세요' : '연못을 앱처럼 열 수 있어요';
    });

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
     PWA 설치
     ============================================================ */
  function bindInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      S.installEvent = e;
      var desc = $('#install-desc');
      if (desc) { desc.textContent = '지금 바로 앱으로 설치할 수 있어요'; }
    });
  }

  /* ============================================================
     전역 이벤트
     ============================================================ */
  function bindGlobal() {
    $('#modal').addEventListener('click', function (e) {
      var target = e.target;
      var closer = target && target.closest ? target.closest('[data-close]') : null;
      if (closer) { closeModal(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeModal(); }
    });
  }

  if ('serviceWorker' in navigator && window.location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* offline is optional */ });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
