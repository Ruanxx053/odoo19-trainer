/* Odoo 19 认证训练器 —— 离线缓存 Service Worker
   只有通过 http(s) 打开时才会注册；file:// 下浏览器不支持 SW，会安静跳过。
   改了 app.js / bank.js / tutorials.js 之后，把 VERSION 改一下即可让手机拉到新版。 */
const VERSION = "odoo19-trainer-v6";
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
    const stale = keys.filter(k => k !== VERSION);
    await Promise.all(stale.map(k => caches.delete(k)));
    await self.clients.claim();
    // 若是"从旧版升级上来"（而不是首次安装），把已打开的页面强制刷一次，
    // 否则页面跑的还是旧的 app.js —— 这正是"电脑上点不开图"的原因。
    if (stale.length) {
      const cls = await self.clients.matchAll({ type: "window" });
      cls.forEach(c => { try { c.navigate(c.url); } catch (err) {} });
    }
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 跨域请求（如直连 AI API）不接管

  // 应用外壳（会随改版变化）：网络优先，失败才回退缓存 → 以后改版刷新即生效
  const SHELL = ["/index.html", "/app.js", "/app.css", "/bank.js", "/tutorials.js", "/"];
  const path = (url.pathname.replace(/^.*\/odoo19-trainer/, "") || "/");
  const isShell = req.mode === "navigate" || SHELL.indexOf(path) >= 0;
  if (isShell) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-cache" });   // 304 时复用缓存，变了就拿新的
        if (res && res.ok) { const c = await caches.open(VERSION); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        return (await caches.match(req)) || (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  // 其余（mermaid、图标）：缓存优先，省流量、可离线
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
