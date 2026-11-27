/* 연못 서비스 워커 — 오프라인에서도 연못이 열리도록 */
var CACHE_NAME = 'yeonmot-munpa-v52';
var CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/art.js',
  './js/db.js',
  './js/gyeongdan.js',
  './js/sinsupang.js',
  './js/sinsumoa.js',
  './js/survival.js',
  './js/dosul-data.js',
  './js/dosul-calc.js',
  './js/dosul-icons.js',
  './js/dosul-ui.js',
  './js/vendor/supabase.js',
  './js/app.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './assets/gyeongdan/tier-1.png',
  './assets/gyeongdan/tier-2.png',
  './assets/gyeongdan/tier-3.png',
  './assets/gyeongdan/tier-4.png',
  './assets/gyeongdan/tier-5.png',
  './assets/gyeongdan/tier-6.png',
  './assets/gyeongdan/tier-7.png',
  './assets/gyeongdan/tier-8.png',
  './assets/gyeongdan/tier-9.png',
  './assets/gyeongdan/tier-10.png',
  './assets/gyeongdan/tier-11.png',
  /* 홈 마이홈 카드 그림 (v49) */
  './assets/img/myhome-starter.webp',
  /* 도술 아이콘 106개 — 도술 계산기 8칸·고르기·결과 표 */
  './assets/dosul/1010010.webp',
  './assets/dosul/1010011.webp',
  './assets/dosul/1010012.webp',
  './assets/dosul/1010020.webp',
  './assets/dosul/1010030.webp',
  './assets/dosul/1010040.webp',
  './assets/dosul/1010050.webp',
  './assets/dosul/1010060.webp',
  './assets/dosul/1010070.webp',
  './assets/dosul/1010080.webp',
  './assets/dosul/1020010.webp',
  './assets/dosul/1020011.webp',
  './assets/dosul/1020012.webp',
  './assets/dosul/1020013.webp',
  './assets/dosul/1020020.webp',
  './assets/dosul/1020030.webp',
  './assets/dosul/1020040.webp',
  './assets/dosul/1020050.webp',
  './assets/dosul/1020060.webp',
  './assets/dosul/1020070.webp',
  './assets/dosul/1020080.webp',
  './assets/dosul/1030010.webp',
  './assets/dosul/1030020.webp',
  './assets/dosul/1030030.webp',
  './assets/dosul/1030040.webp',
  './assets/dosul/1030050.webp',
  './assets/dosul/1030060.webp',
  './assets/dosul/1030070.webp',
  './assets/dosul/1030080.webp',
  './assets/dosul/1040010.webp',
  './assets/dosul/1040011.webp',
  './assets/dosul/1040012.webp',
  './assets/dosul/1040013.webp',
  './assets/dosul/1040020.webp',
  './assets/dosul/1040030.webp',
  './assets/dosul/1040040.webp',
  './assets/dosul/1040050.webp',
  './assets/dosul/1040060.webp',
  './assets/dosul/1040070.webp',
  './assets/dosul/1040080.webp',
  './assets/dosul/1050010.webp',
  './assets/dosul/1050020.webp',
  './assets/dosul/1050030.webp',
  './assets/dosul/1050040.webp',
  './assets/dosul/1050050.webp',
  './assets/dosul/1050060.webp',
  './assets/dosul/1050070.webp',
  './assets/dosul/1070010.webp',
  './assets/dosul/1070011.webp',
  './assets/dosul/1070012.webp',
  './assets/dosul/1070013.webp',
  './assets/dosul/1070014.webp',
  './assets/dosul/1070020.webp',
  './assets/dosul/1070030.webp',
  './assets/dosul/1070040.webp',
  './assets/dosul/1070041.webp',
  './assets/dosul/1070042.webp',
  './assets/dosul/1070050.webp',
  './assets/dosul/1070051.webp',
  './assets/dosul/1070060.webp',
  './assets/dosul/1080010.webp',
  './assets/dosul/1080020.webp',
  './assets/dosul/1080030.webp',
  './assets/dosul/1080040.webp',
  './assets/dosul/1080050.webp',
  './assets/dosul/1080060.webp',
  './assets/dosul/1080080.webp',
  './assets/dosul/1090010.webp',
  './assets/dosul/1090020.webp',
  './assets/dosul/1090021.webp',
  './assets/dosul/1090030.webp',
  './assets/dosul/1090040.webp',
  './assets/dosul/1090050.webp',
  './assets/dosul/1090060.webp',
  './assets/dosul/1090070.webp',
  './assets/dosul/1100010.webp',
  './assets/dosul/1100020.webp',
  './assets/dosul/1100030.webp',
  './assets/dosul/1100040.webp',
  './assets/dosul/1100050.webp',
  './assets/dosul/1100051.webp',
  './assets/dosul/1100060.webp',
  './assets/dosul/1100070.webp',
  './assets/dosul/1110010.webp',
  './assets/dosul/1110020.webp',
  './assets/dosul/1110030.webp',
  './assets/dosul/1110040.webp',
  './assets/dosul/1110050.webp',
  './assets/dosul/1110060.webp',
  './assets/dosul/1110070.webp',
  './assets/dosul/1120010.webp',
  './assets/dosul/1120020.webp',
  './assets/dosul/1120030.webp',
  './assets/dosul/1120040.webp',
  './assets/dosul/1120050.webp',
  './assets/dosul/1120060.webp',
  './assets/dosul/1120070.webp',
  './assets/dosul/1130010.webp',
  './assets/dosul/1130020.webp',
  './assets/dosul/1130030.webp',
  './assets/dosul/1130040.webp',
  './assets/dosul/1130050.webp',
  './assets/dosul/1130060.webp',
  './assets/dosul/1130070.webp',
  './assets/dosul/1130080.webp',
  './assets/dosul/1130090.webp',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) { return caches.delete(key); }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') { return; }

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) { return; }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(function (cached) {
      if (cached) { return cached; }
      return fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return caches.match('./');
      });
    })
  );
});
