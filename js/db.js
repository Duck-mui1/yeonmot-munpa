/* 연못 — Supabase 연결 계층
 *
 *  · 앱에 필요한 모든 서버 호출(RPC · 조회 · 실시간 구독)을 이 파일 하나에 모았습니다.
 *  · 공개용(publishable) 키만 씁니다. 개인 식별 정보는 서버에 보내지 않습니다.
 *    (닉네임 · PIN → PIN 은 서버에서 bcrypt 해시로만 저장)
 *  · 화면 코드는 YM_DB 의 메서드만 부르고, 오류는 message 가 한국어인 Error 로 올라옵니다.
 *
 *  설정 바꾸기: 아래 SUPABASE_URL · SUPABASE_KEY 만 바꾸면 됩니다.
 */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://cwkyvpummgwelylcaayy.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_UqsgxOOkRAmkL3tAqNQUdw_IfC5A9t2';

  // 테스트 · 다른 프로젝트로 옮길 때: <script>window.YM_SUPABASE = {url, key}</script> 를 먼저 두면 그 값이 우선합니다.
  var override = window.YM_SUPABASE || {};
  var BASE = String(override.url || SUPABASE_URL).replace(/\/+$/, '');
  var KEY = override.key || SUPABASE_KEY;

  var TIMEOUT = 20000;

  function failure(message, cause) {
    var err = new Error(message);
    if (cause) { err.cause = cause; }
    return err;
  }

  function request(path, options) {
    var opts = options || {};
    var controller = null;
    var timer = null;
    if (typeof window.AbortController === 'function') {
      controller = new window.AbortController();
      timer = window.setTimeout(function () { controller.abort(); }, TIMEOUT);
    }

    var headers = {
      'apikey': KEY,
      'Authorization': 'Bearer ' + KEY,
      'Accept': 'application/json'
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.prefer) { headers['Prefer'] = opts.prefer; }

    return window.fetch(BASE + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) { window.clearTimeout(timer); }
      return res.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (e) { data = null; }
        }
        if (!res.ok) {
          var message = data && (data.message || data.error_description || data.msg);
          if (!message) {
            message = res.status === 404
              ? '서버에 문파 자료가 아직 준비되지 않았어요. 관리자에게 알려 주세요.'
              : '연못과 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
          }
          if (res.status === 404 && data && data.code === 'PGRST202') {
            message = '서버에 이 기능이 아직 준비되지 않았어요. supabase/schema.sql 을 실행해 주세요.';
          }
          var err = failure(message);
          err.code = (data && data.code) || String(res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function (err) {
      if (timer) { window.clearTimeout(timer); }
      if (err && err.name === 'AbortError') {
        throw failure('연못이 조용해서 응답이 없어요. 잠시 뒤 다시 시도해 주세요.', err);
      }
      throw failure('인터넷 연결을 확인해 주세요.', err);
    });
  }

  /* ---------------- RPC ---------------- */
  function rpc(name, args) {
    return request('/rest/v1/rpc/' + name, { method: 'POST', body: args || {} });
  }

  /* ---------------- 공개 테이블 읽기 ----------------
   * notices / events 는 Realtime 구독 때문에 anon 읽기가 열려 있는 공개 내용입니다.
   * (개인정보 없음 — schema.sql 의 RLS 설계 참고)
   */
  function select(table, query, options) {
    var qs = query ? '?' + query : '';
    return request('/rest/v1/' + table + qs, { method: 'GET', prefer: options && options.prefer });
  }

  /* ---------------- 세션 보관 ---------------- */
  var SESSION_KEY = 'ym.live.session';

  function readSession() {
    try {
      var raw = window.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSession(session) {
    try {
      if (session) { window.localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
      else { window.localStorage.removeItem(SESSION_KEY); }
    } catch (e) { /* 저장 못 해도 이번 방문은 계속 */ }
  }
  function token() {
    var s = readSession();
    return s && s.token ? s.token : null;
  }
  function session() { return readSession(); }

  function withToken(promiseFactory) {
    var t = token();
    if (!t) { return Promise.reject(failure('로그인이 필요해요. 다시 로그인해 주세요.')); }
    return promiseFactory(t);
  }

  /* ---------------- 실시간 구독 ---------------- */
  var client = null;
  var channel = null;

  function ensureClient() {
    if (client) { return client; }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') { return null; }
    try {
      client = window.supabase.createClient(BASE, KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } catch (e) {
      client = null;
    }
    return client;
  }

  var realtimeHandlers = null;
  var realtimeTries = 0;

  /**
   * 실시간 구독 시작.
   *  handlers = { onChat(payload), onClanChange(), onStatus(status) }
   *    payload = { eventType: 'INSERT'|'UPDATE'|'DELETE', new, old } (supabase-js 형식)
   *  → { ok: true }  또는  { ok: false, reason }
   */
  function startRealtime(handlers) {
    stopRealtime();
    realtimeHandlers = handlers || {};
    var c = ensureClient();
    if (!c) { return { ok: false, reason: 'realtime-unavailable' }; }

    try {
      channel = c.channel('yeonmot-clan-' + Date.now().toString(36));
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        function (payload) {
          if (realtimeHandlers && realtimeHandlers.onChat && payload) {
            realtimeHandlers.onChat(payload);
          }
        });
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'notices' },
        function () { if (realtimeHandlers && realtimeHandlers.onClanChange) { realtimeHandlers.onClanChange(); } });
      channel.on('postgres_changes',
        { event: '*', schema: 'public', table: 'events' },
        function () { if (realtimeHandlers && realtimeHandlers.onClanChange) { realtimeHandlers.onClanChange(); } });

      channel.subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          realtimeTries += 1;
          if (realtimeHandlers && realtimeHandlers.onStatus) {
            realtimeHandlers.onStatus(realtimeTries > 2 ? 'down' : 'retrying');
          }
        } else if (status === 'SUBSCRIBED') {
          realtimeTries = 0;
          if (realtimeHandlers && realtimeHandlers.onStatus) { realtimeHandlers.onStatus('live'); }
        }
      });
      return { ok: true };
    } catch (e) {
      channel = null;
      return { ok: false, reason: 'realtime-error' };
    }
  }

  function stopRealtime() {
    if (channel && client) {
      try { client.removeChannel ? client.removeChannel(channel) : channel.unsubscribe(); } catch (e) { /* noop */ }
    }
    channel = null;
    realtimeHandlers = null;
  }

  /* ---------------- 앨범 사진 압축 ----------------
   * 서버는 data URL 1,130,000자 · 원본 800KB 이하만 받습니다.
   * 긴 변 1280px, JPEG 품질을 0.82 → 0.5 로 낮춰가며 한도를 맞춥니다.
   */
  var MAX_DATA_URL = 1080000;   // 여유를 둔 상한
  var MAX_SIDE = 1280;

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new window.FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(failure('사진을 읽지 못했어요. 다시 골라 주세요.')); };
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new window.Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(failure('이 사진은 열 수 없어요. 다른 사진으로 해 보세요.')); };
      img.src = src;
    });
  }

  function drawToDataUrl(img, maxSide, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) { throw failure('사진 크기를 알 수 없어요.'); }
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#061e21';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /** 사진 파일 → { dataUrl, mime, bytes } (서버 한도에 맞춰 줄입니다) */
  function compressPhoto(file) {
    if (!file) { return Promise.reject(failure('사진을 골라 주세요.')); }
    if (file.type && ['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
      return Promise.reject(failure('JPEG · PNG · WebP 사진만 올릴 수 있어요.'));
    }
    return readAsDataUrl(file).then(function (raw) {
      return loadImage(raw).then(function (img) {
        var quality = 0.82;
        var side = MAX_SIDE;
        var dataUrl = drawToDataUrl(img, side, quality);

        while (dataUrl.length > MAX_DATA_URL && quality > 0.5) {
          quality -= 0.08;
          dataUrl = drawToDataUrl(img, side, quality);
        }
        while (dataUrl.length > MAX_DATA_URL && side > 480) {
          side = Math.round(side * 0.75);
          dataUrl = drawToDataUrl(img, side, 0.7);
        }
        if (dataUrl.length > MAX_DATA_URL) {
          throw failure('사진이 너무 커요. 조금 작은 사진으로 올려 주세요.');
        }
        var bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
        return { dataUrl: dataUrl, mime: 'image/jpeg', bytes: bytes };
      });
    }, function (err) {
      // 이미지가 아니라 읽기 실패 → 위 메시지 그대로
      throw err;
    });
  }

  /* ---------------- 프로필 그림 압축 -------------
   * 서버는 avatar 65,000자 이하만 받습니다. 128×128 정사각형 JPEG 로
   * 가운데를 잘라(cover) 10~25KB 정도로 줄입니다.
   */
  var AVATAR_MAX_DATA_URL = 32000;   // ≈ 24KB 원본
  var AVATAR_SIDE = 128;

  function drawSquare(img, side, quality) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) { throw failure('사진 크기를 알 수 없어요.'); }
    var s = Math.min(w, h);
    var sx = Math.round((w - s) / 2);
    var sy = Math.round((h - s) / 2);
    var canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#06282a';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, sx, sy, s, s, 0, 0, side, side);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /** 프로필 사진 파일 → { dataUrl, mime, bytes } (128×128 정사각형 · 10~25KB) */
  function compressAvatar(file) {
    if (!file) { return Promise.reject(failure('사진을 골라 주세요.')); }
    if (file.type && file.type.indexOf('image/') !== 0) {
      return Promise.reject(failure('사진 파일만 올릴 수 있어요.'));
    }
    return readAsDataUrl(file).then(function (raw) {
      return loadImage(raw).then(function (img) {
        var side = AVATAR_SIDE;
        var quality = 0.8;
        var dataUrl = drawSquare(img, side, quality);

        while (dataUrl.length > AVATAR_MAX_DATA_URL && quality > 0.46) {
          quality -= 0.09;
          dataUrl = drawSquare(img, side, quality);
        }
        while (dataUrl.length > AVATAR_MAX_DATA_URL && side > 64) {
          side = Math.round(side * 0.8);
          dataUrl = drawSquare(img, side, 0.62);
        }
        if (dataUrl.length > AVATAR_MAX_DATA_URL) {
          throw failure('사진이 너무 커요. 다른 사진으로 해 보세요.');
        }
        var bytes = Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
        return { dataUrl: dataUrl, mime: 'image/jpeg', bytes: bytes };
      });
    });
  }

  window.YM_DB = {
    url: BASE,
    key: KEY,
    configured: !!(BASE && KEY),
    rpc: rpc,
    select: select,
    token: token,
    session: session,
    setSession: writeSession,
    clearSession: function () { writeSession(null); },
    withToken: withToken,
    compressPhoto: compressPhoto,
    compressAvatar: compressAvatar,
    startRealtime: startRealtime,
    stopRealtime: stopRealtime,

    /* --- 가입 · 로그인 --- */
    register: function (nickname, pin, inviteCode) {
      return rpc('register_member', { p_nickname: nickname, p_pin: pin, p_invite_code: inviteCode })
        .then(function (data) {
          writeSession({ token: data.token, member: data.member, at: Date.now() });
          return data;
        });
    },
    login: function (nickname, pin) {
      return rpc('login_member', { p_nickname: nickname, p_pin: pin })
        .then(function (data) {
          // schema.sql 의 login_member 는 PIN 오입력 횟수를 남기려고 예외 대신 { ok:false, code, message } 를 돌려줍니다.
          if (!data || data.ok === false) {
            var err = failure((data && data.message) || '닉네임 또는 PIN이 맞지 않아요.');
            err.code = (data && data.code) || '28P01';
            throw err;
          }
          writeSession({ token: data.token, member: data.member, at: Date.now() });
          return data;
        });
    },
    logout: function () {
      var t = token();
      if (!t) { return Promise.resolve({ ok: true }); }
      return rpc('logout_member', { p_token: t }).catch(function () { return { ok: true }; })
        .then(function (res) { writeSession(null); return res; });
    },
    profile: function () {
      return withToken(function (t) { return rpc('my_profile', { p_token: t }); });
    },
    /** 프로필 그림 바꾸기 — 'preset:lotus' · data:image/… · null(기본 글자) */
    updateMyAvatar: function (avatar) {
      return withToken(function (t) {
        return rpc('update_my_avatar', { p_token: t, p_avatar: avatar || null });
      });
    },

    /* --- 문파 --- */
    overview: function () {
      return withToken(function (t) { return rpc('clan_overview', { p_token: t }); });
    },
    markAttendance: function () {
      return withToken(function (t) { return rpc('mark_attendance', { p_token: t }); });
    },

    /* --- 채팅 --- */
    listChat: function (limit, before) {
      return withToken(function (t) {
        return rpc('list_chat_messages', { p_token: t, p_limit: limit || 50, p_before: before || null });
      });
    },
    postChat: function (body) {
      return withToken(function (t) { return rpc('post_chat_message', { p_token: t, p_body: body }); });
    },

    /* --- 앨범 --- */
    listAlbum: function (limit, before) {
      return withToken(function (t) {
        return rpc('list_album_posts', { p_token: t, p_limit: limit || 12, p_before: before || null });
      });
    },
    albumImage: function (postId) {
      return withToken(function (t) { return rpc('get_album_image', { p_token: t, p_post_id: postId }); });
    },
    createAlbumPost: function (title, dataUrl, caption, mime) {
      return withToken(function (t) {
        return rpc('create_album_post', {
          p_token: t, p_title: title, p_image_data: dataUrl,
          p_caption: caption || '', p_image_mime: mime || 'image/jpeg'
        });
      });
    },
    toggleAlbumLike: function (postId) {
      return withToken(function (t) { return rpc('toggle_album_like', { p_token: t, p_post_id: postId }); });
    },
    deleteOwnAlbumPost: function (postId) {
      return withToken(function (t) { return rpc('delete_own_album_post', { p_token: t, p_post_id: postId }); });
    },
    /** 앨범 글 고치기 — 올린 본인 또는 운영진(서버가 확인). 사진은 그대로, 글만 바뀝니다. */
    updateAlbumPostText: function (postId, caption) {
      return withToken(function (t) {
        return rpc('update_album_post_text', { p_token: t, p_post_id: postId, p_caption: caption || '' });
      });
    },

    /* --- 쿠폰 --- */
    listCoupons: function () {
      return withToken(function (t) { return rpc('list_coupons', { p_token: t }); });
    },
    /** 쿠폰 수정 — 문주만(만들기·지우기와 같은 권한). 코드·유효기간만 바뀝니다. */
    updateCoupon: function (couponId, payload) {
      return withToken(function (t) {
        return rpc('update_coupon', {
          p_token: t,
          p_coupon_id: couponId,
          p_code: payload.code,
          p_expires_on: payload.expiresOn || null
        });
      });
    },

    /* --- 공략 (유튜브 영상) ---
     *  올리기: 로그인한 문파원 누구나 · 삭제: 올린 본인 또는 운영진(서버가 확인)
     */
    listGuides: function () {
      return withToken(function (t) { return rpc('list_guides', { p_token: t }); });
    },
    createGuide: function (title, youtubeUrl) {
      return withToken(function (t) {
        return rpc('create_guide', { p_token: t, p_title: title, p_youtube_url: youtubeUrl });
      });
    },
    deleteGuide: function (guideId) {
      return withToken(function (t) { return rpc('delete_guide', { p_token: t, p_guide_id: guideId }); });
    },
    /** 공략 수정 — 올린 본인 또는 운영진(서버가 확인). 제목·유튜브 주소를 바꿉니다. */
    updateGuide: function (guideId, title, youtubeUrl) {
      return withToken(function (t) {
        return rpc('update_guide', {
          p_token: t, p_guide_id: guideId, p_title: title, p_youtube_url: youtubeUrl
        });
      });
    },

    /* --- 문파원 자리비움 ---
     *  등록: 본인은 로그인한 문파원 누구나 · 다른 문파원 대신은 운영진(문주·부문주)만(서버가 확인)
     *  삭제: 운영진(문주·운영진)만(서버가 확인)
     *  시작일은 한국 시간 오늘 이후, 종료일은 시작일과 같거나 뒤.
     *  · payload.targetMemberId — 가입한 문파원을 골라 대신 올릴 때
     *  · payload.targetName      — 아직 가입하지 않은 문파원의 이름을 직접 적을 때
     *  둘 다 없으면 예전과 같은 본인 등록입니다(서버 v4 부터 두 인자를 받습니다).
     */
    listAbsences: function () {
      return withToken(function (t) { return rpc('list_absences', { p_token: t }); });
    },
    createAbsence: function (payload) {
      return withToken(function (t) {
        var body = {
          p_token: t,
          p_start_date: payload.startDate,
          p_end_date: payload.endDate,
          p_reason: payload.reason
        };
        if (payload.targetMemberId) { body.p_target_member_id = payload.targetMemberId; }
        if (payload.targetName) { body.p_target_name = payload.targetName; }
        return rpc('create_absence', body);
      });
    },
    deleteAbsence: function (absenceId) {
      return withToken(function (t) { return rpc('delete_absence', { p_token: t, p_absence_id: absenceId }); });
    },

    /* --- 문파원 --- */
    listMembers: function () {
      return select('public_members', 'select=id,nickname,member_role,member_level,joined_at,last_seen_at&order=joined_at.asc');
    },

    /* --- 공지 · 문파컨텐츠 (공개 읽기) --- */
    listNotices: function () {
      return select('notices',
        'select=id,title,body,tag,pinned,author_id,created_at&deleted_at=is.null&order=pinned.desc,created_at.desc&limit=30');
    },
    listEvents: function () {
      var base = 'select=id,title,place,tag,note,starts_at,ends_at,created_by';
      var order = '&deleted_at=is.null&order=starts_at.asc&limit=30';
      return select('events', base + ',repeat_weekly,repeat_weekdays' + order).catch(function (err) {
        /* 마이그레이션 전 서버 — 새 칸이 없으면 예전 칸만으로 읽어 목록이 비지 않게 합니다 */
        var msg = String((err && err.message) || '');
        if (String(err && err.code) === '42703' || msg.indexOf('repeat_weekly') !== -1) {
          return select('events', base + order);
        }
        throw err;
      });
    },

    /* --- 백업용 전체 조회 (문주 도구의 “전체 데이터 백업”)
     *  화면 목록은 공지 · 문파컨텐츠를 30건까지만 읽지만, 백업은 빠짐없이 모아야 합니다.
     *  공지 · 일정은 Realtime 때문에 열려 있는 공개 테이블이라 넉넉한 limit 으로 바로 읽습니다
     *  (새 SQL 없이 지금 있는 규약만 씁니다 — DB 마이그레이션 필요 없음).
     *  채팅 · 앨범은 RPC 한 번에 100건 · 30건까지만 주므로 화면에서 p_before 로 나눠 받습니다.
     */
    backup: {
      /** 공지 전체 — 오래된 것부터 */
      notices: function (limit) {
        return select('notices',
          'select=id,title,body,tag,pinned,author_id,created_at&deleted_at=is.null&order=created_at.asc&limit=' +
          (limit || 1000));
      },
      /** 문파컨텐츠 전체 — 매주 반복 칸이 없는(마이그레이션 전) 서버면 예전 칸만으로 */
      events: function (limit) {
        var base = 'select=id,title,place,tag,note,starts_at,ends_at,created_by';
        var order = '&deleted_at=is.null&order=starts_at.asc&limit=' + (limit || 1000);
        return select('events', base + ',repeat_weekly,repeat_weekdays' + order).catch(function (err) {
          var msg = String((err && err.message) || '');
          if (String(err && err.code) === '42703' || msg.indexOf('repeat_weekly') !== -1) {
            return select('events', base + order);
          }
          throw err;
        });
      }
    },

    /* --- 🍡 경단만들기 ---
     *  점수는 한 사람당 최고 기록만 남깁니다(서버가 더 높은 점수일 때만 갱신).
     *  마이그레이션 전(PGRST202)에는 게임은 이 기기 최고 점수로 그대로 돌고, 랭킹 탭에만 안내가 나옵니다.
     */
    submitGyeongdanScore: function (score, maxTier) {
      return withToken(function (t) {
        return rpc('submit_gyeongdan_score', {
          p_token: t,
          p_score: Math.max(0, Math.floor(Number(score) || 0)),
          p_max_tier: Math.max(1, Math.floor(Number(maxTier) || 1))
        });
      });
    },
    listGyeongdanRanking: function (limit) {
      return withToken(function (t) {
        return rpc('list_gyeongdan_ranking', { p_token: t, p_limit: limit || 20 });
      });
    },

    /* --- 🐾 신수팡 ---
     *  경단만들기와 같은 구조 — 한 사람당 최고 기록만 남기고, 서버가 더 높은 점수일 때만 갱신합니다.
     *  마이그레이션 전(PGRST202)에는 게임은 이 기기 최고 점수로 그대로 돌고, 랭킹 탭에만 안내가 나옵니다.
     */
    submitSinsupangScore: function (score, combo) {
      return withToken(function (t) {
        return rpc('submit_sinsupang_score', {
          p_token: t,
          p_score: Math.max(0, Math.floor(Number(score) || 0)),
          p_combo: Math.max(0, Math.floor(Number(combo) || 0))
        });
      });
    },
    listSinsupangRanking: function (limit) {
      return withToken(function (t) {
        return rpc('list_sinsupang_ranking', { p_token: t, p_limit: limit || 20 });
      });
    },

    /* --- ⚔️ 도술 계산기 · 문파 공유 조합 ---
     *  마이그레이션(supabase/migration-dosul.sql) 전에는 PGRST202 가 올라옵니다.
     *  화면은 그때 이 기기(localStorage)에만 저장하고 '아직 준비되지 않았어요' 라고 알려 줍니다.
     */
    saveDosulBuild: function (build) {
      return withToken(function (t) {
        return rpc('save_dosul_build', {
          p_token: t,
          p_title: String((build && build.title) || '').slice(0, 40),
          p_memo: String((build && build.memo) || '').slice(0, 200),
          p_slots: (build && build.slots) || [],
          p_config: (build && build.config) || {},
          p_idle_pct: Number((build && build.idlePct) || 0),
          p_dps: Number((build && build.dps) || 0)
        });
      });
    },
    listDosulBuilds: function (limit) {
      return withToken(function (t) {
        return rpc('list_dosul_builds', { p_token: t, p_limit: limit || 40 });
      });
    },
    deleteDosulBuild: function (buildId) {
      return withToken(function (t) {
        return rpc('delete_dosul_build', { p_token: t, p_build_id: buildId });
      });
    },

    /* --- 관리자(문주) --- */
    admin: {
      getSettings: function () {
        return withToken(function (t) { return rpc('admin_get_settings', { p_token: t }); });
      },
      updateInviteCode: function (code) {
        return withToken(function (t) { return rpc('admin_update_invite_code', { p_token: t, p_new_code: code }); });
      },
      listMembers: function () {
        return withToken(function (t) { return rpc('admin_list_members', { p_token: t }); });
      },
      kick: function (memberId, reason) {
        return withToken(function (t) {
          return rpc('admin_kick_member', { p_token: t, p_member_id: memberId, p_reason: reason || null });
        });
      },
      ban: function (memberId, reason) {
        return withToken(function (t) {
          return rpc('admin_ban_member', { p_token: t, p_member_id: memberId, p_reason: reason || null });
        });
      },
      restore: function (memberId) {
        return withToken(function (t) { return rpc('admin_restore_member', { p_token: t, p_member_id: memberId }); });
      },
      setRole: function (memberId, role) {
        return withToken(function (t) {
          return rpc('admin_set_role', { p_token: t, p_member_id: memberId, p_role: role });
        });
      },
      createNotice: function (title, body, tag, pinned) {
        return withToken(function (t) {
          return rpc('admin_create_notice', {
            p_token: t, p_title: title, p_body: body,
            p_tag: tag || '공지', p_pinned: !!pinned
          });
        });
      },
      deleteNotice: function (noticeId) {
        return withToken(function (t) { return rpc('admin_delete_notice', { p_token: t, p_notice_id: noticeId }); });
      },
      updateNotice: function (noticeId, title, body, tag, pinned) {
        return withToken(function (t) {
          return rpc('admin_update_notice', {
            p_token: t, p_notice_id: noticeId, p_title: title, p_body: body,
            p_tag: tag || '공지', p_pinned: !!pinned
          });
        });
      },
      createEvent: function (payload) {
        return withToken(function (t) {
          return rpc('admin_create_event', {
            p_token: t,
            p_title: payload.title,
            p_starts_at: payload.startsAt,
            p_place: payload.place || '',
            p_tag: payload.tag || '모임',
            p_note: payload.note || '',
            p_ends_at: payload.endsAt || null,
            p_repeat_weekly: !!payload.repeatWeekly,
            p_repeat_weekdays: payload.repeatWeekly ? (payload.repeatWeekdays || []) : []
          });
        });
      },
      deleteEvent: function (eventId) {
        return withToken(function (t) { return rpc('admin_delete_event', { p_token: t, p_event_id: eventId }); });
      },
      updateEvent: function (eventId, payload) {
        return withToken(function (t) {
          return rpc('admin_update_event', {
            p_token: t,
            p_event_id: eventId,
            p_title: payload.title,
            p_starts_at: payload.startsAt,
            p_place: payload.place === undefined ? null : payload.place,
            p_tag: payload.tag || null,
            p_note: payload.note === undefined ? null : payload.note,
            p_ends_at: payload.endsAt || null,
            p_repeat_weekly: !!payload.repeatWeekly,
            p_repeat_weekdays: payload.repeatWeekly ? (payload.repeatWeekdays || []) : []
          });
        });
      },
      createCoupon: function (payload) {
        return withToken(function (t) {
          return rpc('admin_create_coupon', {
            p_token: t,
            p_code: payload.code,
            p_title: payload.title,
            p_reward: payload.reward,
            p_expires_on: payload.expiresOn || null,
            p_tone: payload.tone || 'lotus'
          });
        });
      },
      deleteCoupon: function (couponId) {
        return withToken(function (t) { return rpc('admin_delete_coupon', { p_token: t, p_coupon_id: couponId }); });
      },
      deleteChatMessage: function (messageId) {
        return withToken(function (t) {
          return rpc('admin_delete_chat_message', { p_token: t, p_message_id: messageId });
        });
      },
      deleteAlbumPost: function (postId) {
        return withToken(function (t) { return rpc('admin_delete_album_post', { p_token: t, p_post_id: postId }); });
      }
    }
  };
})();
