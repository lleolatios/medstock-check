/* 效期登打 - 離線快取 (Service Worker)
 * 只處理兩件事:
 *   1. 登打頁面本身:有網路 → 一律拿最新版並存一份;沒網路或太慢 → 用手機裡存的那份
 *   2. 掃描元件 (html5-qrcode):存一次之後直接用手機裡的
 * 其餘請求 (送資料到 Google 試算表等) 完全不經手。
 */
var CACHE = 'medstock-v1';
var LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(LIBS.map(function (u) { return c.add(u).catch(function () {}); }));
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('medstock-') === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function offlinePage() {
  return new Response(
    '<!DOCTYPE html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<div style="font-family:sans-serif;text-align:center;padding:48px 20px;font-size:17px;line-height:1.7">' +
    '目前沒有網路,而且這支手機還沒存過登打頁面。<br>請到有網路的地方先開啟一次。</div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** 頁面:網路優先;3.5 秒內沒回應或失敗,就用手機裡存的 */
function pageFirstNetwork(req) {
  var u = new URL(req.url);
  var key = u.origin + u.pathname;          // 不含 ?s=…,各門市共用同一份頁面
  return caches.open(CACHE).then(function (cache) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(res) { if (!settled) { settled = true; resolve(res); } }
      var timer = setTimeout(function () {
        cache.match(key).then(function (hit) { if (hit) done(hit); });
      }, 3500);
      fetch(req).then(function (res) {
        clearTimeout(timer);
        if (res && res.ok) cache.put(key, res.clone());
        done(res);
      }).catch(function () {
        clearTimeout(timer);
        cache.match(key).then(function (hit) { done(hit || offlinePage()); });
      });
    });
  });
}

/** 掃描元件:手機裡有就直接用,沒有才下載並存起來 */
function libFirstCache(req) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req.url, { mode: 'cors' }).then(function (res) {
        if (res && res.ok) cache.put(req.url, res.clone());
        return res;
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (req.mode === 'navigate' && u.origin === self.location.origin) {
    e.respondWith(pageFirstNetwork(req));
  } else if (LIBS.indexOf(u.href) !== -1) {
    e.respondWith(libFirstCache(req));
  }
});
