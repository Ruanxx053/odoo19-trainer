# -*- coding: utf-8 -*-
"""把教程 markdown 打包成 tutorials.js（供本地页面直接读取，免 fetch）。

两个来源：

1. **备考目录**：含 `42-速记手册.md` 的那个目录（即 `认证备考/Odoo19/`），
   Odoo 19 认证备考的 48 篇，文件名保持原样、不分组前缀。
2. **本地学习库**：默认 `/Volumes/win/ODOO学习(3)`（可用环境变量 `ODOO_LIB_DIR` 覆盖），
   Odoo 16/18 的「业务学习 / 实施指南 / 技术开发」51 篇，递归收集、按阶段分组，
   文件名扁平化为 `A01-` / `B01-` / `C01-` 前缀（原路径记在 `path` 字段里显示）。

另外把文档之间的相对 `.md` 链接改写成应用内跳转 `#doc=<文件名>`，
否则在 App 里点「延伸阅读」会变成死链（App 是单文档阅读，没有目录结构）。

源文件只放本地，不进版本库；本脚本只产出 `tutorials.js`。
"""
import json, os, re, sys
from urllib.parse import quote

HERE = os.path.dirname(os.path.abspath(__file__))

# 含「42-速记手册.md」的备考目录：脚本所在目录、其上一级、以及工作区里的那份
LEGACY_CANDIDATES = [
    HERE,
    os.path.dirname(HERE),
    "/Volumes/win/code/odoo_work/认证备考/Odoo19",
]
# 本地学习库根目录（源文件只放本地，不入库）
LIB_CANDIDATES = [
    os.environ.get("ODOO_LIB_DIR", ""),
    "/Volumes/win/ODOO学习(3)",
]
# 学习库的三个阶段 → (目录名, 分组名, 文件名前缀)
STAGES = [
    ("01-业务学习", "业务学习", "A"),
    ("02-实施指南", "实施指南", "B"),
    ("03-技术开发", "技术开发", "C"),
]
SKIP = {"README.md"}
# 备考目录里的过程性文件（日报等）不上架
SKIP_PREFIX = ("学习日报",)
LIB_GROUPS = {"学习库总览", "业务学习", "实施指南", "技术开发"}

LINK_RE = re.compile(r"\]\(([^)\s]+)\)")


def find_dir(candidates, marker):
    for c in candidates:
        if c and os.path.exists(os.path.join(c, marker)):
            return c
    return ""


def title_of(text, fallback):
    for ln in text.split("\n"):
        if ln.startswith("# "):
            return ln[2:].strip()
    return fallback


def legacy_group(name):
    """备考目录沿用原有分组规则（避免老文档的分组发生变化）。"""
    if "速记手册" in name:
        return "速记手册"
    if re.match(r"^\d\d-", name):
        return "备考教程" if int(name[:2], 10) <= 19 else "题库 / 规范 / 清单"
    return "其他"


def md_files(root):
    """递归收集 markdown（跳过 ._ / . 开头的杂物与 README）。"""
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(".md") or fn.startswith("._") or fn in SKIP:
                continue
            out.append(os.path.join(dirpath, fn))
    return sorted(out)


def collect_legacy(root):
    items = []
    for name in sorted(os.listdir(root)):
        if (not name.endswith(".md") or name in SKIP
                or name.startswith("._") or name.startswith(SKIP_PREFIX)):
            continue
        text = open(os.path.join(root, name), encoding="utf-8").read()
        items.append({
            "file": name, "path": name, "group": legacy_group(name),
            "title": title_of(text, name[:-3]), "size": len(text), "text": text,
        })
    pathmap = {it["file"]: it["file"] for it in items}
    return items, pathmap


def collect_library(root):
    """学习库：递归收集，扁平化命名（A01-原文件名.md），并用原相对路径建链接映射。"""
    items, pathmap, used = [], {}, set()

    def flat_name(code, idx, rel):
        base = os.path.basename(rel)
        name = "%s%02d-%s" % (code, idx, base)
        n = 2
        while name in used:
            name = "%s%02d-%d-%s" % (code, idx, n, base)
            n += 1
        used.add(name)
        return name

    for stage_dir, group, code in STAGES:
        base = os.path.join(root, stage_dir)
        if not os.path.isdir(base):
            continue
        for i, p in enumerate(md_files(base), 1):
            rel = os.path.relpath(p, root)
            name = flat_name(code, i, rel)
            text = open(p, encoding="utf-8").read()
            items.append({
                "file": name, "path": rel, "group": group,
                "title": title_of(text, os.path.basename(rel)[:-3]),
                "size": len(text), "text": text,
            })
            pathmap[os.path.normpath(rel)] = name

    readme = os.path.join(root, "README.md")
    if os.path.exists(readme):
        text = open(readme, encoding="utf-8").read()
        name = flat_name("L", 0, "README.md")
        items.append({
            "file": name, "path": "README.md", "group": "学习库总览",
            "title": title_of(text, "学习库总目录"), "size": len(text), "text": text,
        })
        pathmap["README.md"] = name
    return items, pathmap


def rewrite_links(text, rel_path, pathmap, all_files):
    """相对 .md 链接 → 应用内跳转 #doc=<文件名>；解析不到就原样保留（当作外链）。"""
    doc_dir = os.path.dirname(rel_path)
    hit = miss = 0

    def sub(m):
        nonlocal hit, miss
        target = m.group(1)
        if target.startswith(("http://", "https://", "#", "mailto:")):
            return m.group(0)
        bare = target.split("#")[0]
        if not bare.endswith(".md"):
            return m.group(0)
        for key in (os.path.normpath(os.path.join(doc_dir, bare)), os.path.basename(bare)):
            name = pathmap.get(key)
            if name and name in all_files:
                hit += 1
                return "](#doc=%s)" % quote(name, safe="")
        miss += 1
        return m.group(0)

    return LINK_RE.sub(sub, text), hit, miss


def main():
    legacy_root = find_dir(LEGACY_CANDIDATES, "42-速记手册.md")
    if not legacy_root:
        sys.exit("找不到备考目录（需要含 42-速记手册.md 的目录），可先 cd 到 认证备考/Odoo19/学习工具/")
    lib_root = find_dir(LIB_CANDIDATES, "01-业务学习")

    legacy, legacy_map = collect_legacy(legacy_root)
    if lib_root:
        lib, lib_map = collect_library(lib_root)
    else:
        lib, lib_map = [], {}
        print("!! 未找到本地学习库（默认 /Volumes/win/ODOO学习(3)，可用 ODOO_LIB_DIR 指定），只打包备考教程")

    items = legacy + lib
    pmap_of = {id(it): (lib_map if it.get("group") in LIB_GROUPS else legacy_map) for it in items}
    all_files = {it["file"] for it in items}

    total_hit = total_miss = 0
    for it in items:
        it["text"], h, m = rewrite_links(it["text"], it["path"], pmap_of[id(it)], all_files)
        total_hit += h
        total_miss += m

    with open(os.path.join(HERE, "tutorials.js"), "w", encoding="utf-8") as fh:
        fh.write("window.TUTORIALS=" + json.dumps(items, ensure_ascii=False) + ";")

    from collections import Counter
    print("备考目录：", legacy_root, "→", len(legacy), "篇")
    print("学习库：  ", lib_root or "(未找到)", "→", len(lib), "篇")
    print("内部链接改写：命中", total_hit, "条；未解析", total_miss, "条")
    print("教程打包完成：", len(items), "篇，合计", sum(i["size"] for i in items), "字符")
    for g, n in Counter(i["group"] for i in items).items():
        print("   ", g, n, "篇")


if __name__ == "__main__":
    main()
