/* Odoo 19 认证训练器 —— 本地单页应用，无依赖、无网络 */
(function () {
  "use strict";
  const BANK = window.BANK || { mcq: [], short: [] };
  const TUT = window.TUTORIALS || [];
  const MCQ = BANK.mcq, SHORT = BANK.short;
  const LSKEY = "odoo19_trainer_v1";
  const APP_VER = "v6";

  /* ---------- 状态 ---------- */
  const DEF = { records: {}, sessions: [], settings: { shuffle: true, showEn: true, api: { base: "", key: "", model: "gpt-4o-mini" } } };
  let S = load();
  function load() {
    try { const r = JSON.parse(localStorage.getItem(LSKEY)); if (r && r.records) return Object.assign(structuredClone(DEF), r); } catch (e) {}
    return structuredClone(DEF);
  }
  function save() { try { localStorage.setItem(LSKEY, JSON.stringify(S)); } catch (e) { toast("⚠️ 本地存储写入失败：浏览器可能禁用了存储"); } }
  function rec(id) {
    if (!S.records[id]) S.records[id] = { seen: 0, right: 0, wrong: 0, fav: false, mastered: false, ms: 0, lastWrong: 0, lastSeen: 0 };
    return S.records[id];
  }

  /* ---------- 工具 ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function copy(text) {
    const done = () => toast("已复制到剪贴板");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败，请手动全选复制"); }
      document.body.removeChild(ta);
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  function fmtTime(ms) { const s = Math.round(ms / 1000); return s < 60 ? s + " 秒" : Math.floor(s / 60) + " 分" + (s % 60) + " 秒"; }
  function shuffleArr(a) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }

  const MODULES = ["会计", "库存", "制造", "销售", "采购"];
  const SETS = Array.from(new Set(MCQ.map(q => q.set)));
  const ALL_IDS = MCQ.map(q => q.id);
  const byId = {}; MCQ.concat(SHORT).forEach(q => (byId[q.id] = q));

  /* ---------- Markdown 渲染（够用就好） ---------- */
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, (m, a) => "<code>" + a + "</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
    s = s.replace(/(^|[\s(（])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s;
  }
  function mdToHtml(md) {
    const L = String(md).replace(/\r\n?/g, "\n").split("\n");
    let out = [], i = 0;
    const listBuf = [];
    function flushList() {
      if (!listBuf.length) return;
      let html = "", depth = 0;
      listBuf.forEach(it => {
        while (depth < it.d) { html += "<ul>"; depth++; }
        while (depth > it.d) { html += "</ul>"; depth--; }
        html += "<li>" + inline(it.t) + "</li>";
      });
      while (depth > 0) { html += "</ul>"; depth--; }
      out.push(html); listBuf.length = 0;
    }
    while (i < L.length) {
      const ln = L[i];
      let m = ln.match(/^```(\w*)\s*$/);
      if (m) {
        const lang = (m[1] || "").toLowerCase(); i++; const buf = [];
        while (i < L.length && !/^```\s*$/.test(L[i])) { buf.push(L[i]); i++; }
        i++;
        if (lang === "mermaid") out.push('<div class="mermaid">' + esc(buf.join("\n")) + "</div>");
        else out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
        continue;
      }
      if (/^\s*$/.test(ln)) { flushList(); i++; continue; }
      if (/^<[a-zA-Z\/!]/.test(ln.trim())) { flushList(); out.push(ln); i++; continue; }
      m = ln.match(/^(#{1,6})\s+(.*)$/);
      if (m) { flushList(); const n = m[1].length; out.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">"); i++; continue; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { flushList(); out.push("<hr>"); i++; continue; }
      if (/^\s*>\s?/.test(ln)) {
        flushList(); const buf = [];
        while (i < L.length && /^\s*>\s?/.test(L[i])) { buf.push(L[i].replace(/^\s*>\s?/, "")); i++; }
        out.push("<blockquote>" + buf.map(x => inline(x)).join("<br>") + "</blockquote>"); continue;
      }
      if (/^\s*\|/.test(ln) && i + 1 < L.length && /^\s*\|[\s:\-|]+\|\s*$/.test(L[i + 1])) {
        flushList();
        const rows = [];
        while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++; }
        const cells = r => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
        let html = "<table><thead><tr>" + cells(rows[0]).map(c => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        rows.slice(2).forEach(r => { html += "<tr>" + cells(r).map(c => "<td>" + inline(c) + "</td>").join("") + "</tr>"; });
        out.push(html + "</tbody></table>"); continue;
      }
      m = ln.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (m) {
        const indent = m[1].replace(/\t/g, "  ").length;
        listBuf.push({ d: indent >= 2 ? 1 : 0, t: m[3] }); i++; continue;
      }
      flushList();
      const buf = [];
      while (i < L.length && !/^\s*$/.test(L[i]) && !/^```/.test(L[i]) && !/^#{1,6}\s/.test(L[i]) && !/^\s*>/.test(L[i]) && !/^\s*\|/.test(L[i]) && !/^(\s*)([-*+]|\d+[.)])\s+/.test(L[i]) && !/^<[a-zA-Z\/!]/.test(L[i].trim())) { buf.push(L[i]); i++; }
      out.push("<p>" + buf.map(x => inline(x)).join("<br>") + "</p>");
    }
    flushList();
    return out.join("\n");
  }
  function renderMermaid(root) {
    if (!window.mermaid) return;
    $$(".mermaid", root).forEach(d => { if (!d.dataset.done) { d.dataset.done = "1"; d.dataset.src = d.textContent; } });
    try {
      window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose" });
      window.mermaid.run({ nodes: $$(".mermaid", root) });
    } catch (e) { /* 渲染失败就保留源码 */ }
  }

  /* ---------- 路由 ---------- */
  const TABS = [["home", "首页"], ["practice", "练习"], ["exam", "模拟考"], ["wrong", "错题本"], ["stats", "统计"], ["docs", "教程"]];
  let route = "home";
  function go(r, param) {
    closeZoom();
    route = r; if (param) window.__param = param;
    $$("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.r === r));
    $("#view").className = "view" + (r === "docs" ? " wide" : "");
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    const o0 = overall();
    if ($("#hdrMeta")) $("#hdrMeta").textContent = "已练 " + o0.seen + "/" + o0.total + " · 正确率 " + pct(o0.right, o0.right + o0.wrong) + "% · 待攻错题 " + Object.keys(S.records).filter(function (k) { return S.records[k].wrong && !S.records[k].mastered; }).length + " · " + APP_VER;
    const v = $("#view");
    if (route === "home") v.innerHTML = viewHome();
    else if (route === "practice") v.innerHTML = viewPractice();
    else if (route === "exam") v.innerHTML = viewExam();
    else if (route === "wrong") v.innerHTML = viewWrong();
    else if (route === "stats") v.innerHTML = viewStats();
    else v.innerHTML = viewDocs();
    if (route === "docs") renderMermaid(v);
    if (route === "practice" && P.state === "answering") bindPractice(null);
    mount();
    if (route === "exam" && E.running) tickClock();
  }
  function mount() { $$("[data-act]").forEach(el => el.addEventListener("click", onAct)); }
  function tickClock() {
    if (!E.running) return;
    const t = $("#e-clock"); if (!t) return;
    const left = Math.max(0, E.endAt - Date.now()), sec = Math.floor(left / 1000);
    t.textContent = "⏱ " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + (left < 5 * 60000 ? " ⚠️" : "");
  }
  function onAct(e) {
    const el = e.currentTarget, act = el.dataset.act, val = el.dataset.val;
    const map = {
      "go": () => go(val),
      "start-practice": () => startPractice(), "pick": () => pickOption(val),
      "next": () => nextQ(), "prev": () => prevQ(), "skip": () => nextQ(),
      "fav": () => { const r = rec(cur().id); r.fav = !r.fav; save(); render(); },
      "mastered": () => { const r = rec(cur().id); r.mastered = !r.mastered; save(); if (P.filter === "wrong") nextQ(); else render(); },
      "start-exam": () => startExam(), "exam-goto": () => { E.idx = +val; render(); },
      "exam-submit": () => submitExam(),
      "start-wrong": () => startPractice("wrong"),
      "exam-wrong": () => startPractice("wrong"),
      "copy-ai": () => { const t = aiPrompt(); const box = $("#ai-out"); if (box) box.value = t; copy(t); },
      "ai-run": () => runAI(),
      "doc": () => openDoc(val),
      "doc-jump": () => openSource(val, el.dataset.alt),
      "reset": () => { if (confirm("确定清空全部作答记录、错题本和统计吗？此操作不可撤销。")) { S.records = {}; S.sessions = []; save(); toast("已重置"); go("home"); } },
      "export": () => copy(JSON.stringify(S, null, 1)),
      "export-file": () => exportFile(),
      "import": () => importData(),
      "retry-round-wrong": () => retryRoundWrong(),
      "pick-exam": () => { E.answers[E.list[E.idx].id] = val; render(); },
      "exam-next": () => { E.idx = Math.min(E.list.length - 1, E.idx + 1); render(); },
      "exam-prev": () => { E.idx = Math.max(0, E.idx - 1); render(); },
      "exam-clear": () => { delete E.answers[E.list[E.idx].id]; render(); },
      "exam-mark": () => { const id = E.list[E.idx].id; E.marks[id] = !E.marks[id]; render(); },
      "exam-again": () => { E.showReport = false; E.list = []; E.answers = {}; E.marks = {}; render(); },
      "exam-full": () => { $("#e-n").value = 120; $("#e-min").value = 90; startExam(); },
      "master-known": () => { const r = rec(val); r.mastered = true; save(); render(); },
      "doc-hit": () => { const h = DOC_HITS[+val]; if (h) openDocAt(h.file, h.kw); },
    };
    if (map[act]) map[act]();
  }

  /* ---------- 首页 ---------- */
  function overall() {
    let seen = 0, right = 0, wrong = 0, fav = 0, mastered = 0;
    MCQ.forEach(q => { const r = S.records[q.id]; if (!r) return; if (r.seen) seen++; right += r.right; wrong += r.wrong; if (r.fav) fav++; if (r.mastered) mastered++; });
    return { seen, right, wrong, fav, mastered, total: MCQ.length };
  }
  function viewHome() {
    const o = overall();
    const weak = weakRanking().slice(0, 4);
    const days = Math.max(1, Math.ceil((o.total - o.seen) / 40));
    return `
    <div class="card">
      <h1>Odoo 19 功能认证 · 训练器</h1>
      <p class="muted small">题库 ${o.total} 道选择题 + ${SHORT.length} 道简答题，全部来自本目录的备考文档；数据只存在你本机浏览器里。</p>
      <div class="grid c4" style="margin-top:14px">
        <div class="stat"><div class="n">${o.seen}/${o.total}</div><div class="l">已练题目</div></div>
        <div class="stat"><div class="n">${pct(o.right, o.right + o.wrong)}%</div><div class="l">正确率（${o.right} 对 / ${o.wrong} 错）</div></div>
        <div class="stat"><div class="n">${Object.keys(S.records).filter(k => S.records[k].wrong && !S.records[k].mastered).length}</div><div class="l">待攻错题</div></div>
        <div class="stat"><div class="n">${o.fav}</div><div class="l">收藏题</div></div>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn primary" data-act="go" data-val="practice">开始练习</button>
        <button class="btn" data-act="go" data-val="exam">模拟考试</button>
        <button class="btn" data-act="start-wrong">只练错题</button>
        <button class="btn" data-act="go" data-val="docs">看教程</button>
      </div>
      <p class="muted small" style="margin-top:10px">按每天 40 道算，铺完一遍约需 <b>${days}</b> 天；考前建议把错题本清空。</p>
    </div>
    <div class="card">
      <h2>薄弱点 Top ${weak.length}</h2>
      ${weak.length ? weak.map(w => `
        <div class="row between" style="margin:8px 0">
          <div><b>${esc(w.key)}</b> <span class="pill">${w.wrong} 次错 · ${w.seen} 次作答</span></div>
          <div class="small muted">正确率 ${w.acc}%</div>
        </div>
        <div class="bar ${w.acc >= 70 ? "ok" : "bad"}"><i style="width:${w.acc}%"></i></div>`).join("") : '<p class="muted">还没有数据，先去做几道题。</p>'}
    </div>`;
  }

  /* ---------- 练习 ---------- */
  const P = { queue: [], idx: 0, state: "answering", chosen: null, filter: "all", started: 0, right: 0, wrong: 0, roundWrong: [], summary: null };
  function cur() { return P.queue[P.idx] || null; }
  function buildQueue() {
    let list = MCQ.slice();
    const mods = $$(".p-mod:checked").map(e => e.value);
    list = list.filter(q => mods.includes(q.module));
    const only = $("#p-scope") ? $("#p-scope").value : "all";
    if (only === "unseen") list = list.filter(q => !(S.records[q.id] && S.records[q.id].seen));
    if (only === "wrong") list = list.filter(q => S.records[q.id] && S.records[q.id].wrong && !S.records[q.id].mastered);
    if (only === "fav") list = list.filter(q => S.records[q.id] && S.records[q.id].fav);
    const lvls = $$(".p-lvl:checked").map(e => e.value);
    if (lvls.length) list = list.filter(q => lvls.includes(q.level));
    return S.settings.shuffle ? shuffleArr(list) : list;
  }
  function startPractice(forceFilter) {
    if (forceFilter) P.filter = forceFilter;
    P.queue = buildQueue(); P.idx = 0; P.state = "answering"; P.chosen = null;
    P.started = Date.now(); P.right = 0; P.wrong = 0; P.roundWrong = []; P.summary = null;
    if (!P.queue.length) { toast("这个范围里没有题，换个条件试试"); return; }
    if (route !== "practice") go("practice"); else render();
    toast("开始：" + P.queue.length + " 道题");
  }
  function nextQ() {
    if (P.idx < P.queue.length - 1) { P.idx++; P.state = "answering"; P.chosen = null; render(); return; }
    P.summary = { total: P.queue.length, right: P.right, wrong: P.wrong, wrongIds: P.roundWrong.slice() };
    P.queue = []; P.idx = 0; P.state = "answering"; P.chosen = null;
    toast("这一轮做完了 🎉");
    if (route !== "practice") go("practice"); else render();
  }
  function retryRoundWrong() {
    if (!P.summary || !P.summary.wrongIds.length) { toast("本轮没有错题"); return; }
    P.queue = P.summary.wrongIds.map(function (id) { return byId[id]; }).filter(Boolean);
    P.idx = 0; P.state = "answering"; P.chosen = null;
    P.right = 0; P.wrong = 0; P.roundWrong = []; P.summary = null; P.started = Date.now();
    render(); toast("复习本轮错题：" + P.queue.length + " 道");
  }
  function prevQ() { if (P.idx > 0) { P.idx--; P.state = "answering"; P.chosen = null; render(); } }
  function pickOption(k) {
    const q = cur(); if (!q || P.state !== "answering") return;
    const r = rec(q.id);
    const cost = Date.now() - (P.started || Date.now());
    r.seen++; r.ms += Math.max(0, cost); r.lastSeen = Date.now();
    if (k === q.answer) { r.right++; r.streak = (r.streak || 0) + 1; }
    else { r.wrong++; r.streak = 0; r.lastWrong = Date.now(); if (P.roundWrong.indexOf(q.id) < 0) P.roundWrong.push(q.id); }
    if (k === q.answer) P.right++; else P.wrong++;
    save();
    P.state = "answered"; P.chosen = k; P.started = Date.now();
    render();
  }
  function bindPractice() { P.started = P.started || Date.now(); }
  function viewPractice() {
    if (!P.queue.length && P.summary) return roundSummaryHtml();
    if (!P.queue.length) {
      const cnt = {}; MODULES.forEach(m => cnt[m] = MCQ.filter(q => q.module === m).length);
      return `
      <div class="card">
        <h1>练习设置</h1>
        <p class="muted small">题库：${MCQ.length} 道（基础 ${MCQ.filter(q => q.level === "基础").length} / 进阶 ${MCQ.filter(q => q.level === "进阶").length}）</p>
        <h3>模块</h3>
        <div class="row">${MODULES.map(m => `<label class="chk"><input type="checkbox" class="p-mod" value="${m}" checked> ${m} <span class="muted small">(${cnt[m]})</span></label>`).join("")}</div>
        <h3>难度</h3>
        <div class="row"><label class="chk"><input type="checkbox" class="p-lvl" value="基础" checked> 基础（模拟题）</label>
        <label class="chk"><input type="checkbox" class="p-lvl" value="进阶" checked> 进阶（硬题版）</label></div>
        <h3>范围</h3>
        <div class="row">
          <select id="p-scope">
            <option value="all">全部题目</option>
            <option value="unseen">只做没做过的</option>
            <option value="wrong">只做错题本里未掌握的</option>
            <option value="fav">只做收藏题</option>
          </select>
          <label class="chk"><input type="checkbox" id="p-shuffle" ${S.settings.shuffle ? "checked" : ""}> 随机顺序</label>
          <button class="btn primary" data-act="start-practice">开始</button>
        </div>
        <p class="muted small" style="margin-top:14px">快捷键：<span class="kbd">1</span>–<span class="kbd">4</span> 选答案 · <span class="kbd">Enter</span> 下一题 · <span class="kbd">F</span> 收藏</p>
      </div>`;
    }
    const q = cur();
    const r = rec(q.id);
    const answered = P.state === "answered";
    return `
    <div class="card">
      <div class="row between">
        <div class="row">
          <span class="pill brand">${esc(q.module)}</span>
          <span class="pill">${esc(q.set)}</span>
          <span class="pill">${esc(q.level)}</span>
          ${r.wrong ? `<span class="pill bad">错过 ${r.wrong} 次</span>` : ""}
        </div>
        <div class="small muted">第 ${P.idx + 1} / ${P.queue.length} 题 ｜ 本轮 <b style="color:var(--ok)">${P.right}</b> 对 / <b style="color:var(--bad)">${P.wrong}</b> 错</div>
      </div>
      <div class="progress"><i style="width:${((P.idx + (answered ? 1 : 0)) / P.queue.length) * 100}%"></i></div>
      <div class="qstem">
        ${q.stem_en ? `<p class="en">${inline(q.stem_en)}</p>` : ""}
        <p class="zh">${inline(q.stem_zh)}</p>
      </div>
      <div class="opts">
        ${q.options.map(o => {
          let cls = "opt";
          if (answered) {
            if (o.key === q.answer) cls += " right";
            if (o.key === P.chosen && P.chosen !== q.answer) cls += " wrong";
          } else if (o.key === P.chosen) cls += " picked";
          return `<button class="${cls}" ${answered ? "disabled" : ""} data-act="pick" data-val="${o.key}">
            <span class="k">${o.key}</span>
            <span><span class="en">${inline(o.text)}</span>${o.zh ? `<span class="zh">${inline(o.zh)}</span>` : ""}</span>
          </button>`;
        }).join("")}
      </div>
      ${answered ? feedbackHtml(q, P.chosen) : ""}
      <div class="row between" style="margin-top:18px">
        <div class="row">
          <button class="btn" data-act="prev" ${P.idx === 0 ? "disabled" : ""}>上一题</button>
          <button class="btn" data-act="next">${P.idx === P.queue.length - 1 ? "完成本轮" : "下一题"}</button>
          ${!answered ? `<button class="btn ghost" data-act="skip">跳过</button>` : ""}
        </div>
        <div class="row">
          <button class="btn ${r.fav ? "primary" : ""}" data-act="fav">${r.fav ? "★ 已收藏" : "☆ 收藏"}</button>
          <button class="btn" data-act="mastered">${r.mastered ? "✅ 已掌握" : "标记已掌握"}</button>
        </div>
      </div>
    </div>`;
  }
  function optionText(q, key) {
    const o = q.options.find(x => x.key === key);
    if (!o) return "";
    return inline(o.text) + (o.zh ? `<span class="zh">${inline(o.zh)}</span>` : "");
  }
  function roundSummaryHtml() {
    const s = P.summary, acc = pct(s.right, s.right + s.wrong);
    return `
    <div class="card">
      <h1>本轮完成 🎉</h1>
      <div class="grid c4" style="margin-top:12px">
        <div class="stat"><div class="n">${s.total}</div><div class="l">本轮题数</div></div>
        <div class="stat"><div class="n">${s.right}</div><div class="l">答对</div></div>
        <div class="stat"><div class="n">${s.wrong}</div><div class="l">答错</div></div>
        <div class="stat"><div class="n">${acc}%</div><div class="l">本轮正确率</div></div>
      </div>
      <div class="row" style="margin-top:16px">
        <button class="btn primary" data-act="start-practice">再来一轮</button>
        ${s.wrongIds.length ? `<button class="btn" data-act="retry-round-wrong">复习本轮错题（${s.wrongIds.length}）</button>` : ""}
        <button class="btn" data-act="go" data-val="stats">看统计</button>
        <button class="btn" data-act="go" data-val="wrong">错题本</button>
      </div>
      ${s.wrongIds.length ? '<p class="muted small" style="margin-top:10px">本轮错题已自动收进错题本，建议今天就过一遍「复习本轮错题」。</p>' : '<p class="muted small" style="margin-top:10px">全对，漂亮。</p>'}
    </div>`;
  }
  function feedbackHtml(q, chosen) {
    const ok = chosen === q.answer;
    return `
    ${ok
      ? `<div class="fb ok"><h4>✅ 答案正确</h4><div class="val">${optionText(q, q.answer)}</div></div>`
      : `<div class="fb bad"><h4>❌ 答案不正确。请查看解释和资源以了解更多信息。</h4>
           <div class="val">正确答案：${q.answer} · ${optionText(q, q.answer)}</div></div>
         <div class="fb bad"><h4>你的答案</h4><div class="val">${chosen} · ${optionText(q, chosen)}</div></div>`}
    <div class="explain">${mdToHtml(q.explain || "")}
      <p class="small"><span class="tag">出处</span> ${esc(q.source || "—")}</p>
      ${q.tutorial ? `<button class="btn" data-act="doc-jump" data-val="${esc(q.tutorial || "")}" data-alt="${esc(q.source || "")}">📖 打开对应教程</button>` : ""}
    </div>`;
  }

  /* ---------- 模拟考 ---------- */
  const E = { list: [], idx: 0, answers: {}, marks: {}, endAt: 0, running: false, timer: null, showReport: false };
  function startExam() {
    const n = +$("#e-n").value, mins = +$("#e-min").value;
    const mods = $$(".e-mod:checked").map(e => e.value);
    let pool = MCQ.filter(q => mods.includes(q.module));
    if ($("#e-level").value === "进阶") pool = pool.filter(q => q.level === "进阶");
    if ($("#e-level").value === "基础") pool = pool.filter(q => q.level === "基础");
    if (pool.length < n) { toast("题量不足，已按 " + pool.length + " 道出卷"); }
    E.list = shuffleArr(pool).slice(0, Math.min(n, pool.length));
    E.idx = 0; E.answers = {}; E.marks = {}; E.running = true; E.showReport = false;
    E.endAt = Date.now() + mins * 60000;
    clearInterval(E.timer);
    E.timer = setInterval(() => {
      if (!E.running) return;
      tickClock();
      if (E.endAt - Date.now() <= 0) { clearInterval(E.timer); toast("时间到，自动交卷"); submitExam(); }
    }, 1000);
    render();
  }
  function submitExam() {
    E.running = false; E.showReport = true; clearInterval(E.timer);
    let right = 0, wrong = 0, blank = 0;
    const detail = [];
    E.list.forEach(q => {
      const a = E.answers[q.id];
      const r = rec(q.id);
      r.seen++; r.lastSeen = Date.now();
      if (!a) { blank++; }
      else if (a === q.answer) { right++; r.right++; }
      else { wrong++; r.wrong++; r.lastWrong = Date.now(); }
      detail.push({ id: q.id, picked: a || "" });
    });
    const score = right - 0.5 * wrong;
    const sess = { type: "exam", at: Date.now(), total: E.list.length, right: right, wrong: wrong, blank: blank, score: score, pass: score >= E.list.length * 0.7, detail: detail };
    S.sessions.push(sess); save();
    render();
  }
  function viewExam() {
    if (E.showReport) return examReport();
    if (!E.running) {
      const cnt = {}; MODULES.forEach(m => cnt[m] = MCQ.filter(q => q.module === m).length);
      const last = S.sessions.filter(s => s.type === "exam").slice(-5).reverse();
      return `
      <div class="card">
        <h1>模拟考试</h1>
        <p class="muted small">真实规格：120 题 / 90 分钟 / 答对 +1、答错 −0.5、空答 0 / 及格 70%。答错会倒扣，没把握的题宁可空着。</p>
        <div class="row" style="margin-top:12px">
          <label>题量 <input type="number" id="e-n" value="40" min="5" max="${MCQ.length}" style="width:90px"></label>
          <label>时长（分钟） <input type="number" id="e-min" value="30" min="5" style="width:90px"></label>
          <label>难度
            <select id="e-level"><option value="all">不限</option><option value="基础">基础</option><option value="进阶">进阶</option></select>
          </label>
        </div>
        <h3>模块</h3>
        <div class="row">${MODULES.map(m => `<label class="chk"><input type="checkbox" class="e-mod" value="${m}" checked> ${m}</label>`).join("")}</div>
        <div class="row" style="margin-top:16px"><button class="btn primary" data-act="start-exam">开始考试</button>
        <button class="btn" data-act="exam-full">全真模考 120 题 / 90 分钟</button></div>
      </div>
      ${last.length ? `<div class="card"><h2>历史成绩</h2><table class="tb"><tr><th>时间</th><th>得分</th><th>对/错/空</th><th>结果</th></tr>
        ${last.map(s => `<tr><td>${new Date(s.at).toLocaleString()}</td><td><b>${s.score}</b> / ${s.total}</td><td>${s.right} / ${s.wrong} / ${s.blank}</td><td>${s.pass ? '<span class="pill ok">及格</span>' : '<span class="pill bad">未及格</span>'}</td></tr>`).join("")}
      </table></div>` : ""}`;
    }
    if (!E.running) return examReport();
    const q = E.list[E.idx], picked = E.answers[q.id];
    return `
    <div class="card">
      <div class="row between">
        <div class="row"><span class="pill brand">模拟考</span><span class="pill">${esc(q.module)}</span>
          <span class="small muted">第 ${E.idx + 1} / ${E.list.length} 题</span></div>
        <div class="row"><b id="e-clock" class="small">⏱ --:--</b>
          <button class="btn primary" data-act="exam-submit">交卷</button></div>
      </div>
      <div class="progress"><i style="width:${((E.idx + 1) / E.list.length) * 100}%"></i></div>
      <div class="qstem">
        ${q.stem_en ? `<p class="en">${inline(q.stem_en)}</p>` : ""}
        <p class="zh">${inline(q.stem_zh)}</p>
      </div>
      <div class="opts">
        ${q.options.map(o => `<button class="opt ${picked === o.key ? "picked" : ""}" data-act="pick-exam" data-val="${o.key}">
          <span class="k">${o.key}</span><span><span class="en">${inline(o.text)}</span>${o.zh ? `<span class="zh">${inline(o.zh)}</span>` : ""}</span></button>`).join("")}
      </div>
      <div class="row between" style="margin-top:16px">
        <div class="row">
          <button class="btn" data-act="exam-prev" ${E.idx === 0 ? "disabled" : ""}>上一题</button>
          <button class="btn" data-act="exam-next">${E.idx === E.list.length - 1 ? "最后一题" : "下一题"}</button>
          <button class="btn ghost" data-act="exam-clear">清除本题</button>
        </div>
        <label class="chk"><input type="checkbox" data-act="exam-mark" ${E.marks[q.id] ? "checked" : ""}> 标记待复查</label>
      </div>
      <h3 style="margin-top:22px">答题卡 <span class="small muted">（绿色=已答，黄条=已标记）</span></h3>
      <div class="sheet">${E.list.map((x, i) => `<button class="${E.answers[x.id] ? "done" : ""} ${E.marks[x.id] ? "mark" : ""} ${i === E.idx ? "cur" : ""}" data-act="exam-goto" data-val="${i}">${i + 1}</button>`).join("")}</div>
    </div>`;
  }
  function examReport() {
    const s = S.sessions.filter(x => x.type === "exam").slice(-1)[0];
    if (!s) return '<div class="card">没有考试记录</div>';
    const rows = MODULES.map(m => {
      const ids = E.list.filter(q => q.module === m).map(q => q.id);
      if (!ids.length) return null;
      let r = 0, w = 0, b = 0;
      ids.forEach(id => { const a = E.answers[id]; const q = byId[id]; if (!a) b++; else if (a === q.answer) r++; else w++; });
      return `<tr><td>${m}</td><td>${ids.length}</td><td>${r}</td><td>${w}</td><td>${b}</td><td>${pct(r, ids.length)}%</td></tr>`;
    }).filter(Boolean).join("");
    const wrongs = E.list.filter(q => E.answers[q.id] && E.answers[q.id] !== q.answer);
    return `
    <div class="card">
      <h1>${s.pass ? "✅ 及格" : "❌ 未及格"} · 得分 ${s.score} / ${s.total}</h1>
      <div class="grid c4" style="margin-top:12px">
        <div class="stat"><div class="n">${s.right}</div><div class="l">答对（每题 +1）</div></div>
        <div class="stat"><div class="n">${s.wrong}</div><div class="l">答错（每题 −0.5）</div></div>
        <div class="stat"><div class="n">${s.blank}</div><div class="l">未答（不扣分）</div></div>
        <div class="stat"><div class="n">${s.total * 0.7}</div><div class="l">及格线</div></div>
      </div>
      <h2>分模块表现</h2>
      <table class="tb"><tr><th>模块</th><th>题数</th><th>对</th><th>错</th><th>空</th><th>正确率</th></tr>${rows}</table>
      <h2>错题（${wrongs.length} 道，已存入错题本）</h2>
      ${wrongs.map(q => `<div class="wrongitem"><div class="t">${inline(q.stem_zh).slice(0, 120)}</div>
        <div class="small">你选 <span class="pill bad">${E.answers[q.id]}</span> ｜ 正确 <span class="pill ok">${q.answer}</span> ｜ 出处 ${esc(q.source || "")}</div></div>`).join("") || '<p class="muted">没有错题，漂亮。</p>'}
      <div class="row" style="margin-top:16px">
        <button class="btn primary" data-act="exam-wrong">立即复习这些错题</button>
        <button class="btn" data-act="go" data-val="wrong">打开错题本</button>
        <button class="btn" data-act="exam-again">再考一次</button>
      </div>
    </div>`;
  }

  /* ---------- 错题本 ---------- */
  function wrongList() {
    return MCQ.filter(q => { const r = S.records[q.id]; return r && r.wrong > 0 && !r.mastered; })
      .sort((a, b) => (S.records[b.id].wrong - S.records[a.id].wrong));
  }
  function viewWrong() {
    const list = wrongList();
    const mastered = MCQ.filter(q => { const r = S.records[q.id]; return r && r.wrong > 0 && r.mastered; });
    if (!list.length) return `<div class="card"><h1>错题本</h1><p class="muted">错题本是空的。做错的题会自动收进来，标记"已掌握"后会移出。</p>
      ${mastered.length ? `<p class="small muted">已掌握 ${mastered.length} 道。</p>` : ""}
      <button class="btn primary" data-act="go" data-val="practice" style="margin-top:12px">去做题</button></div>`;
    const groups = {};
    list.forEach(q => (groups[q.module] = groups[q.module] || []).push(q));
    return `
    <div class="card">
      <div class="row between"><h1>错题本 · ${list.length} 道</h1>
        <div class="row"><button class="btn primary" data-act="start-wrong">开始复习错题</button>
        <button class="btn" data-act="go" data-val="stats">看薄弱点分析</button></div></div>
      <p class="muted small">按错得次数从多到少排列。复习时选对一次不会自动移出，需要你确认"已掌握"。</p>
      ${Object.entries(groups).map(([m, qs]) => `
        <h2>${m} <span class="small muted">${qs.length} 道</span></h2>
        ${qs.map(q => { const r = S.records[q.id]; return `
          <div class="wrongitem">
            <div class="t">${inline(q.stem_zh).slice(0, 140)}</div>
            <div class="row between">
              <div class="small">正确 <span class="pill ok">${q.answer}</span> · 错 ${r.wrong} 次 · 最近 ${r.lastWrong ? new Date(r.lastWrong).toLocaleDateString() : "—"} · <span class="muted">${esc(q.source || "")}</span></div>
              <div class="row">
                <button class="btn" data-act="doc-jump" data-val="${esc(q.tutorial || "")}" data-alt="${esc(q.source || "")}">看教程</button>
                <button class="btn" data-act="master-known" data-val="${q.id}">已掌握</button>
              </div>
            </div>
          </div>`; }).join("")}`).join("")}
    </div>`;
  }

  /* ---------- 统计 / AI ---------- */
  function weakRanking() {
    const m = {};
    MCQ.forEach(q => {
      const r = S.records[q.id]; if (!r || (!r.seen && !r.wrong)) return;
      const k = q.module + " · " + (q.part || q.set);
      m[k] = m[k] || { key: k, seen: 0, right: 0, wrong: 0 };
      m[k].seen += r.right + r.wrong; m[k].right += r.right; m[k].wrong += r.wrong;
    });
    return Object.values(m).map(x => Object.assign(x, { acc: pct(x.right, x.seen) }))
      .filter(x => x.wrong > 0)
      .sort((a, b) => (b.wrong - a.wrong) || (a.acc - b.acc));
  }
  function viewStats() {
    const o = overall();
    const byMod = MODULES.map(m => {
      const qs = MCQ.filter(q => q.module === m);
      let seen = 0, right = 0, wrong = 0;
      qs.forEach(q => { const r = S.records[q.id]; if (!r) return; if (r.right + r.wrong) seen++; right += r.right; wrong += r.wrong; });
      return { m: m, total: qs.length, seen: seen, right: right, wrong: wrong, acc: pct(right, right + wrong) };
    });
    const weak = weakRanking().slice(0, 12);
    const exams = S.sessions.filter(s => s.type === "exam").slice(-5).reverse();
    return `
    <div class="card">
      <h1>统计与薄弱点</h1>
      <div class="grid c4" style="margin-top:12px">
        <div class="stat"><div class="n">${o.seen}/${o.total}</div><div class="l">做过</div></div>
        <div class="stat"><div class="n">${pct(o.right, o.right + o.wrong)}%</div><div class="l">总正确率</div></div>
        <div class="stat"><div class="n">${o.wrong}</div><div class="l">累计错答</div></div>
        <div class="stat"><div class="n">${S.sessions.filter(s => s.type === "exam").length}</div><div class="l">模拟考次数</div></div>
      </div>
      <h2>分模块</h2>
      <table class="tb"><tr><th>模块</th><th>题量</th><th>做过</th><th>对</th><th>错</th><th>正确率</th><th style="width:160px">进度</th></tr>
      ${byMod.map(x => `<tr><td>${x.m}</td><td>${x.total}</td><td>${x.seen}</td><td>${x.right}</td><td>${x.wrong}</td>
        <td>${x.acc}%</td><td><div class="bar ${x.acc >= 70 ? "ok" : "bad"}"><i style="width:${x.acc}%"></i></div></td></tr>`).join("")}
      </table>
      <h2>薄弱考点（按错答次数排序）</h2>
      ${weak.length ? `<table class="tb"><tr><th>考点</th><th>作答</th><th>错</th><th>正确率</th></tr>
        ${weak.map(w => `<tr><td>${esc(w.key)}</td><td>${w.seen}</td><td>${w.wrong}</td><td>${w.acc}%</td></tr>`).join("")}</table>` : '<p class="muted">先做点题才有分析。</p>'}
      ${exams.length ? `<h2>最近的模拟考</h2><table class="tb"><tr><th>时间</th><th>得分</th><th>对/错/空</th><th>结果</th></tr>
        ${exams.map(s => `<tr><td>${new Date(s.at).toLocaleString()}</td><td>${s.score}/${s.total}</td><td>${s.right}/${s.wrong}/${s.blank}</td><td>${s.pass ? "及格" : "未及格"}</td></tr>`).join("")}</table>` : ""}
    </div>
    <div class="card">
      <h2>AI 薄弱点分析</h2>
      <p class="muted small">点下面按钮生成一份分析材料（含你的统计 + 错得最多的题 + 对应教程），复制后粘给我（或任何 AI）就能得到针对性的补弱计划和讲解。也可以用下面的"直连 API"直接出结果。</p>
      <div class="row"><button class="btn primary" data-act="copy-ai">① 生成并复制分析材料</button>
      <button class="btn" data-act="ai-run">② 直连 API 分析</button></div>
      <textarea id="ai-out" placeholder="点上面的按钮，分析材料会出现在这里，可手动全选复制。"></textarea>
      <details style="margin-top:12px"><summary class="muted small">直连 API 设置（可选，OpenAI 兼容接口）</summary>
        <div class="row" style="margin-top:10px">
          <input type="text" id="api-base" placeholder="Base URL，如 https://api.openai.com/v1" value="${esc(S.settings.api.base)}" style="min-width:280px">
          <input type="password" id="api-key" placeholder="API Key" value="${esc(S.settings.api.key)}">
          <input type="text" id="api-model" placeholder="模型名" value="${esc(S.settings.api.model)}">
        </div>
        <p class="muted small">用 file:// 打开时，浏览器可能因 CORS 拦截请求；若失败，请用"生成并复制"，把材料发给我。</p>
      </details>
      <div id="ai-result"></div>
    </div>
    <div class="card">
      <h2>数据</h2>
      <p class="muted small">换设备（电脑 ↔ 手机）时：在旧设备点 <b>导出为文件</b>（手机上会存进"文件"App），在新设备点 <b>导入学习数据</b> 选中该文件即可。导入会覆盖当前设备的记录。</p>
      <div class="row"><button class="btn" data-act="export-file">导出为文件（.json）</button>
      <button class="btn" data-act="import">导入学习数据</button>
      <button class="btn" data-act="export">复制为 JSON 文本</button>
      <button class="btn" data-act="reset">清空所有记录</button></div>
    </div>`;
  }
  function aiPrompt() {
    const o = overall();
    const weak = weakRanking().slice(0, 12);
    const wrongs = MCQ.filter(q => { const r = S.records[q.id]; return r && r.wrong > 0 && !r.mastered; })
      .sort((a, b) => S.records[b.id].wrong - S.records[a.id].wrong).slice(0, 15);
    const exams = S.sessions.filter(s => s.type === "exam").slice(-5);
    const lines = [];
    lines.push("我在备考 Odoo 19 Functional Certification（120 题 / 90 分钟 / 答对 +1、答错 −0.5、空 0 / 及格 70%）。下面是我的练习数据，请帮我做薄弱点分析。");
    lines.push("\n【总体】已练 %d/%d 题，累计对 %d、错 %d，总正确率 %d%。".replace("%d", o.seen).replace("%d", o.total).replace("%d", o.right).replace("%d", o.wrong).replace("%d", pct(o.right, o.right + o.wrong)));
    lines.push("\n【分模块正确率】");
    MODULES.forEach(m => {
      const qs = MCQ.filter(q => q.module === m);
      let r = 0, w = 0; qs.forEach(q => { const x = S.records[q.id]; if (x) { r += x.right; w += x.wrong; } });
      if (r + w) lines.push("- " + m + "：" + pct(r, r + w) + "%（对 " + r + " / 错 " + w + "，题库 " + qs.length + " 题）");
    });
    if (weak.length) { lines.push("\n【错得最多的考点】"); weak.forEach(w => lines.push("- " + w.key + "：错 " + w.wrong + " 次，正确率 " + w.acc + "%")); }
    if (exams.length) { lines.push("\n【模拟考】"); exams.forEach(s => lines.push("- " + new Date(s.at).toLocaleString() + "：得分 " + s.score + "/" + s.total + "（对 " + s.right + " / 错 " + s.wrong + " / 空 " + s.blank + "）")); }
    if (wrongs.length) {
      lines.push("\n【错题样本（最多 15 道，含正确答案与出处）】");
      wrongs.forEach((q, i) => {
        lines.push((i + 1) + ". [" + q.module + "｜" + q.source + "] " + (q.stem_en || "") + " " + q.stem_zh.replace(/\*\*/g, ""));
        lines.push("   - 正确答案：" + q.answer + "；我错了 " + S.records[q.id].wrong + " 次；对应教程文件：" + (q.tutorial || "—"));
      });
    }
    lines.push("\n【我要你做的】");
    lines.push("1) 按优先级列出 5 个最该补的薄弱点，每个说明为什么危险（在考试里会以什么形式出现）。");
    lines.push("2) 对每个薄弱点给出一条 3 句话以内的判定口诀，并指出最容易被混淆的错误选项长什么样。");
    lines.push("3) 给一个 3 天冲刺计划（每天 60–90 分钟），并指明该读本目录里的哪几篇教程。");
    lines.push("4) 出 6 道针对我最弱考点的判断题（只给题干与选项，答案另附）。");
    return lines.join("\n");
  }
  function exportFile() {
    try {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "odoo19-trainer-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("已导出为文件");
    } catch (e) { toast("导出失败：" + e.message); }
  }
  function importData() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const d = JSON.parse(String(fr.result));
          if (!d || typeof d !== "object" || !d.records) throw new Error("这不是本工具导出的数据文件");
          if (!confirm("导入会覆盖当前设备上的练习记录，确定继续吗？")) return;
          S = Object.assign(structuredClone(DEF), d);
          if (!S.settings) S.settings = structuredClone(DEF.settings);
          if (!S.settings.api) S.settings.api = structuredClone(DEF.settings.api);
          save(); toast("导入成功"); go("home");
        } catch (e) { alert("导入失败：" + e.message); }
      };
      fr.readAsText(f);
    };
    inp.click();
  }
  function runAI() {
    const out = $("#ai-out"); out.value = aiPrompt();
    const base = ($("#api-base").value || "").trim().replace(/\/$/, "");
    const key = ($("#api-key").value || "").trim();
    const model = ($("#api-model").value || "").trim();
    S.settings.api = { base: base, key: key, model: model }; save();
    if (!base || !key) { toast("请在设置里填 Base URL 和 Key；或直接用上面的「生成并复制」"); return; }
    const box = $("#ai-result");
    box.innerHTML = '<p class="muted">正在请求…</p>';
    fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
      body: JSON.stringify({ model: model || "gpt-4o-mini", messages: [{ role: "user", content: out.value }] })
    }).then(r => r.json()).then(j => {
      const txt = j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : JSON.stringify(j).slice(0, 800);
      box.innerHTML = '<h3>AI 分析</h3><div class="explain">' + mdToHtml(txt) + "</div>";
    }).catch(e => {
      box.innerHTML = '<p class="fb bad">请求失败（多半是 CORS 或 Key/地址不对）：' + esc(String(e && e.message || e)) + '<br>可以改用「生成并复制」，把材料贴给我分析。</p>';
    });
  }

  /* ---------- 教程 ---------- */
  let curDoc = TUT.length ? TUT[0].file : "";
  function openDoc(file) { curDoc = file; go("docs"); setTimeout(() => { const el = $(".md h1, .md h2"); if (el) el.scrollIntoView(); }, 30); }
  function openSource(file, src) {
    let f = (file && TUT.some(t => t.file === file)) ? file : "";
    for (const m of String(f || src || "").matchAll(/(\d\d-[^`\s，；]+\.md)/g)) { if (!f) { f = m[1]; } break; }
    if (!f) {
      const low = String(src || file || "").toLowerCase();
      const rules = [["italy|italian|意大利", "22-意大利本地化-会计.md"], ["finance/accounting|accounting", "01-Accounting.md"], ["inventory", "03-Inventory.md"], ["manufactur|mrp", "04-MRP.md"], ["purchase", "06-Purchase.md"], ["sales|quotation", "05-Sales.md"], ["crm", "07-CRM.md"], ["project", "08-Project.md"], ["timesheet", "09-Timesheet.md"], ["ecommerce", "10-eCommerce.md"], ["website", "11-Website.md"], ["pos|point_of_sale", "12-POS.md"], ["spreadsheet", "13-Spreadsheet.md"], ["employee|hr", "14-HR.md"], ["survey", "15-Survey.md"], ["marketing", "16-Marketing.md"], ["knowledge", "17-Knowledge.md"], ["studio", "18-Studio.md"], ["\\bai\\b", "19-AI.md"]];
      for (const [pat, file] of rules) { if (new RegExp(pat).test(low)) { f = file; break; } }
    }
    if (!f || !TUT.some(t => t.file === f)) { toast("没有找到对应教程文件"); return; }
    curDoc = f; go("docs");
    const kw = String(src || file || "").split("/").filter(Boolean).pop().replace(/\.html$/, "").replace(/[（(].*?[)）]/g, "");
    [80, 700].forEach(delay => setTimeout(() => highlightDoc(kw), delay));
  }
  /* 去掉空格、下划线、连字符再比较，避免 "pricelist" 匹配不上 "Price Lists" */
  function normKw(s) { return String(s == null ? "" : s).toLowerCase().replace(/[\s_\-·:：，,。.、()（）\[\]\/\\.]+/g, ""); }
  const KW_STOP = { html: 1, http: 1, https: 1, odoo: 1, docs: 1, doc: 1, com: 1, www: 1, index: 1, en: 1, us: 1, applications: 1, enterprise: 1, community: 1, master: 1, page: 1 };
  function kwTokens(s) {
    const out = new Set();
    String(s == null ? "" : s).toLowerCase().split(/[^a-z0-9]+/).forEach(t => {
      if (t.length < 4 || KW_STOP[t]) return;
      out.add(t);
      if (t.endsWith("s")) out.add(t.slice(0, -1));
    });
    return Array.from(out);
  }
  function highlightDoc(kw) {
    const root = $(".md"); if (!root) return;
    const prev = $(".md .hl"); if (prev) prev.classList.remove("hl");
    const list = kwTokens(kw);
    const nodes = $$(".md h1, .md h2, .md h3, .md h4, .md p, .md li, .md td, .md th", root)
      .filter(n => n.textContent.trim().length > 2);
    let hit = null, best = 0, bestLen = Infinity;
    nodes.forEach(n => {
      const t = normKw(n.textContent), len = t.length;
      let sc = 0; list.forEach(w => { if (t.includes(w)) sc += w.length * w.length; });
      if (sc > best || (sc === best && sc > 0 && len < bestLen)) { best = sc; bestLen = len; hit = n; }
    });
    if (!hit) hit = nodes.find(n => n.tagName === "H2");
    if (!hit) return;
    try { hit.scrollIntoView({ block: "center" }); } catch (e) {}
    hit.classList.add("hl");
  }
  function viewDocs() {
    const cur = TUT.find(t => t.file === curDoc) || TUT[0];
    const kind = f => /^\d\d-/.test(f) ? (parseInt(f, 10) <= 19 ? "备考教程" : "题库 / 规范 / 清单") : "其他";
    const groups = { "备考教程": [], "题库 / 规范 / 清单": [], "其他": [] };
    TUT.forEach(t => groups[kind(t.file)].push(t));
    return `
    <div class="docs">
      <div class="doclist card">
        <input type="text" id="doc-filter" placeholder="搜索教程内容…" style="width:100%" oninput="window.__filterDoc(this.value)">
        <div id="doc-hits" class="small muted" style="margin:6px 4px"></div>
        ${Object.entries(groups).map(([g, items]) => items.length ? `<div class="grp">${g}</div>` + items.map(t => `<button class="${t.file === curDoc ? "on" : ""}" data-act="doc" data-val="${esc(t.file)}">${esc(t.title.slice(0, 34))}</button>`).join("") : "").join("")}
      </div>
      <div class="card">
        <div class="row between">
          <div class="small muted">${esc(cur.file)}</div>
          <button class="btn" data-act="doc" data-val="${esc(curDoc)}" onclick="document.querySelector('.docs .card:last-child').scrollIntoView()">回到顶部</button>
        </div>
        <div class="md" id="doc-body">${mdToHtml(cur.text)}</div>
      </div>
    </div>`;
  }
  var DOC_HITS = [];
  window.__filterDoc = function (kw) {
    kw = (kw || "").trim().toLowerCase();
    const box = $("#doc-hits");
    if (!kw) { box.textContent = ""; DOC_HITS = []; return; }
    DOC_HITS = TUT.map(t => {
      const low = t.text.toLowerCase();
      return low.indexOf(kw) < 0 ? null : { file: t.file, title: t.title, kw: kw, n: low.split(kw).length - 1 };
    }).filter(Boolean).sort((a, b) => b.n - a.n).slice(0, 20);
    box.innerHTML = DOC_HITS.length
      ? DOC_HITS.map((h, i) => '<button class="doc-hit" data-act="doc-hit" data-val="' + i + '">' + esc(h.title.slice(0, 30)) + ' <span class="pill">' + h.n + '</span></button>').join("")
      : "没有命中";
  };
  function openDocAt(file, kw) {
    curDoc = file; go("docs");
    setTimeout(() => {
      const nodes = $$(".md p, .md li, .md h2, .md h3, .md td");
      const hit = nodes.find(n => n.textContent.toLowerCase().indexOf(String(kw).toLowerCase()) >= 0);
      if (hit) { hit.scrollIntoView({ block: "center" }); hit.classList.add("hl"); }
    }, 80);
  }

  /* ---------- 图放大（点 Mermaid 图 → 全屏，可缩放 / 平移） ---------- */
  var zoomK = 2;
  var ZOOM_STEPS = [0.6, 0.8, 1, 1.5, 2, 3, 4, 6, 8];

  function closeZoom() {
    var bg = document.getElementById("zoomBg");
    if (bg) bg.remove();
    document.body.classList.remove("zoom-open");
  }
  function zoomApply() {
    var inner = document.getElementById("zoomInner"), pct = document.getElementById("zoomPct");
    if (inner) inner.style.width = (zoomK * 100) + "%";
    if (pct) pct.textContent = Math.round(zoomK * 100) + "%";
  }
  function zoomSet(k) { zoomK = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], k)); zoomApply(); }
  function zoomStep(dir) {
    var i = 0;
    for (var j = 0; j < ZOOM_STEPS.length; j++) { if (ZOOM_STEPS[j] <= zoomK + 0.001) i = j; }
    zoomSet(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))]);
  }
  function zoomOpenFrom(m) {
    var svg = m.querySelector("svg");
    if (!svg) return;                       /* 渲染失败时保留源码，不弹层 */
    closeZoom();
    var bg = document.createElement("div");
    bg.className = "zoom-bg"; bg.id = "zoomBg";
    bg.innerHTML =
      '<div class="zoom-bar">' +
        '<button class="zbtn" data-z="-">−</button>' +
        '<span class="zoom-pct" id="zoomPct">200%</span>' +
        '<button class="zbtn" data-z="+">＋</button>' +
        '<button class="zbtn" data-z="1">适应</button>' +
        '<button class="zbtn close" data-z="x">✕ 关闭</button>' +
      '</div>' +
      '<div class="zoom-scroll"><div class="zoom-inner" id="zoomInner"></div></div>';
    var clone = svg.cloneNode(true);
    clone.removeAttribute("style");
    clone.setAttribute("style", "max-width:none;width:100%;height:auto;display:block");
    bg.querySelector("#zoomInner").appendChild(clone);
    document.body.appendChild(bg);
    document.body.classList.add("zoom-open");
    zoomK = 2; zoomApply();

    var dx = 0, dy = 0, moved = false;
    bg.addEventListener("pointerdown", function (e) { dx = e.clientX; dy = e.clientY; moved = false; });
    bg.addEventListener("pointermove", function (e) {
      if (Math.abs(e.clientX - dx) > 8 || Math.abs(e.clientY - dy) > 8) moved = true;
    });
    bg.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-z]");
      if (b) {
        var v = b.getAttribute("data-z");
        if (v === "x") return closeZoom();
        if (v === "1") return zoomSet(1);
        return zoomStep(v === "+" ? 1 : -1);
      }
      if (moved) return;                                     /* 刚才是拖动/平移，别关 */
      if (!(e.target.closest && e.target.closest(".zoom-inner"))) closeZoom();
    });
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("#zoomBg")) return;
    var m = t.closest(".mermaid");
    if (m) zoomOpenFrom(m);
  });

  /* ---------- 键盘 ---------- */
  document.addEventListener("keydown", function (e) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""))) return;
    if (e.key === "Escape") { closeZoom(); return; }
    if (route === "practice" && P.queue.length) {
      if (/^[1-4]$/.test(e.key)) { const k = "ABCD"[+e.key - 1]; if (P.state === "answering") pickOption(k); }
      else if (e.key === "Enter") nextQ();
      else if (e.key.toLowerCase() === "f") { const r = rec(cur().id); r.fav = !r.fav; save(); render(); }
    } else if (route === "exam" && E.running) {
      if (/^[1-4]$/.test(e.key)) { E.answers[E.list[E.idx].id] = "ABCD"[+e.key - 1]; render(); }
      else if (e.key === "ArrowRight") { E.idx = Math.min(E.list.length - 1, E.idx + 1); render(); }
      else if (e.key === "ArrowLeft") { E.idx = Math.max(0, E.idx - 1); render(); }
    }
  });

  /* ---------- 启动 ---------- */
  function init() {
    $("#tabs").innerHTML = TABS.map(t => `<button data-r="${t[0]}" data-act="go" data-val="${t[0]}">${t[1]}</button>`).join("");
    const o = overall();
    $("#hdrMeta").textContent = `已练 ${o.seen}/${o.total} · 正确率 ${pct(o.right, o.right + o.wrong)}% · ${APP_VER}`;
    if (window.__mermaidMissing) console.warn("mermaid.min.js 未找到，时序图将显示为代码");
    go("home");
    document.addEventListener("change", function (e) {
      if (e.target.id === "p-shuffle") { S.settings.shuffle = e.target.checked; save(); }
    });
  }
  init();
})();
