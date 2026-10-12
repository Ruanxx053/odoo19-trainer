# -*- coding: utf-8 -*-
"""把同目录下的教程 markdown 打包成 tutorials.js（供本地页面直接读取，免 fetch）。"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SKIP = {"README.md"}

def title_of(text, fallback):
    for ln in text.split("\n"):
        if ln.startswith("# "):
            return ln[2:].strip()
    return fallback

items = []
for name in sorted(os.listdir(ROOT)):
    if not name.endswith(".md") or name in SKIP or name.startswith("._"):
        continue
    p = os.path.join(ROOT, name)
    text = open(p, encoding="utf-8").read()
    items.append({
        "file": name,
        "title": title_of(text, name.replace(".md", "")),
        "size": len(text),
        "text": text,
    })
order = {f: i for i, f in enumerate(
    ["00-业务全景串讲.md"] + [f"{i:02d}-" for i in range(1, 20)])}
items.sort(key=lambda it: (it["file"] == "00-业务全景串讲.md") and -1 or int(it["file"][:2]))
with open(os.path.join(HERE, "tutorials.js"), "w", encoding="utf-8") as fh:
    fh.write("window.TUTORIALS=" + json.dumps(items, ensure_ascii=False) + ";")
print("教程打包完成：", len(items), "篇，合计", sum(i["size"] for i in items), "字符")
for it in items:
    print("  ", it["file"], "—", it["title"][:40])
