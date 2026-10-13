/* Odoo 19 认证训练器 —— 离线缓存 Service Worker
   只有通过 http(s) 打开时才会注册；file:// 下浏览器不支持 SW，会安静跳过。
   改了 app.js / bank.js / tutorials.js 之后，把 VERSION 改一下即可让手机拉到新版。 */
const VERSION = "odoo19-trainer-v2";
const ASSETS = [
  "./", "./index.html", "./app.css", "./app.js",
  "./bank.js", "./tutorials.js", "./mermaid.min.js",
  "./manifest.webmanifest", "./icon-180.png", "./icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(ASSETS.map(a => c.add(a).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 跨域请求（如直连 AI API）不接管
  if (req.mode === "navigate") {
    e.respondWith((async () => (await caches.match("./index.html")) || fetch(req))());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) { const c = await caches.open(VERSION); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      return (await caches.match("./index.html")) || Response.error();
    }
  })());
});
