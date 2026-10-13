# -*- coding: utf-8 -*-
"""把 odoo_work/认证备考/Odoo19 下的题库 markdown 编译成 bank.js / bank.json。"""
import re, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

MCQ_FILES = [
    ("02-模拟题-Accounting+Inventory.md", "模拟题 01 · 会计+库存", "基础"),
    ("20-模拟题-MRP+Sales+Purchase.md", "模拟题 02 · 制造+销售+采购", "基础"),
    ("26-硬题版-会计-20题.md", "硬题版 · 会计", "进阶"),
    ("27-硬题版-库存-20题.md", "硬题版 · 库存", "进阶"),
    ("34-模拟题-会计案例与分录-20题.md", "模拟题 03 · 会计案例与分录", "进阶"),
]
SHORT_FILES = [
    ("23-简答题-会计+销售+CRM+库存.md", "简答题", "复述"),
    ("24-针对性题目-项目+工时+服务计费.md", "针对性 · 项目/工时/服务计费", "复述"),
    ("35-简答题-会计案例与权限-12题.md", "简答题 · 会计案例/权限", "复述"),
]

MODULE_RULES = [
    (r"accounting|会计", "会计"),
    (r"inventory|库存", "库存"),
    (r"manufactur|mrp|制造", "制造"),
    (r"purchase|采购", "采购"),
    (r"sales|销售", "销售"),
    (r"crm", "CRM"),
    (r"project|项目", "项目"),
    (r"timesheet|工时", "工时"),
    (r"服务", "服务计费"),
]

TUTORIAL_RULES = [
    (r"italy|意大利|electronic_invoicing", "22-意大利本地化-会计.md"),
    (r"finance/accounting|accounting", "01-Accounting.md"),
    (r"inventory", "03-Inventory.md"),
    (r"manufactur|mrp", "04-MRP.md"),
    (r"purchase|vendors", "06-Purchase.md"),
    (r"sales|quotation|pricelist", "05-Sales.md"),
    (r"crm", "07-CRM.md"),
    (r"project", "08-Project.md"),
    (r"timesheet", "09-Timesheet.md"),
    (r"ecommerce|e-commerce", "10-eCommerce.md"),
    (r"website", "11-Website.md"),
    (r"point_of_sale|pos", "12-POS.md"),
    (r"spreadsheet", "13-Spreadsheet.md"),
    (r"employee|hr", "14-HR.md"),
    (r"survey", "15-Survey.md"),
    (r"marketing|mailing|social", "16-Marketing.md"),
    (r"knowledge", "17-Knowledge.md"),
    (r"studio", "18-Studio.md"),
    (r"\bai\b|artificial", "19-AI.md"),
]

MODULE_TUTORIAL = {
    "会计": "01-Accounting.md", "库存": "03-Inventory.md", "制造": "04-MRP.md",
    "销售": "05-Sales.md", "采购": "06-Purchase.md", "CRM": "07-CRM.md",
    "项目": "08-Project.md", "工时": "09-Timesheet.md", "服务计费": "05-Sales.md",
}

def tutorial_of(q):
    """题目 → 对应教程文件。优先认 出处 里直接写出的 .md 文件名。"""
    blob = " ".join([q.get("source") or "", q.get("part") or "", q.get("set") or ""])
    for m in re.findall(r"(\d\d-[^`\s，；]+\.md)", blob):
        return m
    low = blob.lower()
    for pat, f in TUTORIAL_RULES:
        if re.search(pat, low):
            return f
    return MODULE_TUTORIAL.get(q.get("module", ""), "")

def module_of(title, fallback="通用"):
    t = (title or "").lower()
    for pat, name in MODULE_RULES:
        if re.search(pat, t):
            return name
    return fallback

def clean(s):
    return s.replace("\u200b", "").strip()

def parse_mcq(path, setname, level):
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    lines = text.split("\n")
    starts = []
    part = ""
    cur_module = "通用"
    for i, ln in enumerate(lines):
        if re.match(r"^#{1,2}(?!#)\s+\S", ln):
            m = re.match(r"^#{1,2}\s*(?:Part\s+[A-Z]｜)?\s*(.+)$", ln)
            if m and not ln.startswith("####"):
                part = clean(m.group(1))
                got = module_of(part, "")
                if got:
                    cur_module = got
        if re.match(r"^\*\*Q\d+\.\*\*", ln) or re.match(r"^###\s*Q\d+\s*$", ln):
            starts.append((i, part, cur_module))
    out = []
    for n, (i, cur_part, cur_mod) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        block = lines[i:end]
        head = block[0]
        m = re.match(r"^\*\*Q(\d+)\.\*\*\s*(.*)$", head)
        if m:
            num, stem = m.group(1), clean(m.group(2))
            stem_en, stem_zh = "", stem
        else:
            num = re.match(r"^###\s*Q(\d+)", head).group(1)
            stem_en = stem_zh = ""
            for ln in block[1:]:
                if ln.startswith("**EN**"):
                    stem_en = clean(re.sub(r"^\*\*EN\*\*[:：]\s*", "", ln))
                elif ln.startswith("**中**"):
                    stem_zh = clean(re.sub(r"^\*\*中\*\*[:：]\s*", "", ln))
                elif ln.startswith("- ") and stem_zh:
                    break
        opts, ans, src, exp = [], "", "", []
        for k, ln in enumerate(block):
            mo = re.match(r"^-\s*([A-D])[\.、]\s*(.+)$", ln)
            if mo:
                zh = None
                if k + 1 < len(block) and re.match(r"^ {4}\S", block[k + 1]):
                    zh = clean(block[k + 1])
                item = {"key": mo.group(1), "text": clean(mo.group(2))}
                if zh:
                    item["zh"] = zh
                opts.append(item)
                continue
            if ln.startswith(">"):
                body = clean(ln.lstrip(">").strip())
                ma = re.match(r"^\*\*答案[:：]?\s*([A-D])\*\*", body)
                if ma and not ans:
                    ans = ma.group(1)
                    tail = re.sub(r"^\*\*答案[:：]?\s*[A-D]\*\*", "", body)
                    tail = tail.replace("｜", "").strip()
                    if tail:
                        src = clean(re.sub(r"^出处[:：]?\s*", "", tail)).strip("`")
                    continue
                ms = re.match(r"^\*\*出处[:：]?\*\*[:：]?\s*(.+)$", body)
                if ms:
                    src = clean(ms.group(1))
                    continue
                exp.append(body)
        out.append({
            "id": f"{path.split('-')[0]}-{int(num):03d}",
            "type": "mcq", "set": setname, "level": level,
            "module": cur_mod, "part": cur_part,
            "file": path, "num": int(num),
            "stem_en": stem_en, "stem_zh": stem_zh,
            "options": opts, "answer": ans,
            "explain": "\n".join(exp), "source": src,
        })
    return out

def parse_short(path, setname, level):
    text = open(os.path.join(ROOT, path), encoding="utf-8").read()
    lines = text.split("\n")
    starts, section = [], ""
    for i, ln in enumerate(lines):
        if re.match(r"^##\s+", ln) and not ln.startswith("###"):
            section = clean(re.sub(r"^##\s*(?:[一二三四五六七八九十]+、)?\s*", "", ln))
            section = re.sub(r"（\d+\s*题）", "", section).strip()
        if re.match(r"^###\s+", ln):
            starts.append((i, section))
    out = []
    for n, (i, sec) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        block = lines[i:end]
        title = clean(re.sub(r"^###\s*", "", block[0]))
        title = re.sub(r"^(题|会|销|客|库)\s*\d+\.\s*", "", title).strip()
        if not title or re.match(r"^[一二三四五六七八九十]+、", title):
            continue
        body = "\n".join(block[1:])
        pts = []
        for ln in block[1:]:
            m = re.match(r"^-\s+(.+)$", ln)
            if m:
                pts.append(clean(m.group(1)))
        src = ""
        ms = re.search(r"^>\s*出处[:：]\s*(.+)$", body, re.M)
        if ms:
            src = clean(ms.group(1))
        detail = re.sub(r"^\*\*得分点\*\*\s*$", "", body, flags=re.M).strip()
        qno = int(re.search(r"\d+", block[0]).group())
        out.append({
            "id": "%s-s%03d" % (path.split("-")[0], qno),
            "type": "short", "set": setname, "level": level,
            "module": module_of(sec, module_of(title, "通用")),
            "part": sec, "file": path,
            "stem_zh": title, "stem_en": "",
            "points": pts, "detail": detail, "source": src,
        })
    return out

def main():
    qs = []
    for f, s, l in MCQ_FILES:
        try:
            got = parse_mcq(f, s, l)
        except Exception as e:
            print("!! 解析失败", f, e); got = []
        qs += got
        print(f"{f:46s} 选择题 {len(got):3d}")
    sh = []
    for f, s, l in SHORT_FILES:
        try:
            got = parse_short(f, s, l)
        except Exception as e:
            print("!! 解析失败", f, e); got = []
        sh += got
        print(f"{f:46s} 简答题 {len(got):3d}")
    # 保证题目 id 全局唯一（同一文件里 Part A/Part B 各自从 Q1 编号会产生重复 id，
    # 而 app.js 用 id 作为练习统计/错题本的键）
    used = set()
    for q in qs + sh:
        base = q["id"]
        if base in used:
            n = 2
            while f"{base}-{n}" in used:
                n += 1
            q["id"] = f"{base}-{n}"
        used.add(q["id"])

    bad = [q for q in qs if not q["answer"] or len(q["options"]) < 2]
    for q in qs + sh:
        q["tutorial"] = tutorial_of(q)
    no_tut = [q["id"] for q in qs if not q["tutorial"]]
    print("缺教程映射的选择题：", len(no_tut), no_tut[:10])
    print("\n异常题（缺答案或选项<2）：", len(bad), [q["id"] for q in bad][:20])
    from collections import Counter
    print("模块分布：", dict(Counter(q["module"] for q in qs)))
    print("答案分布：", dict(Counter(q["answer"] for q in qs)))
    print("题库合计：选择题", len(qs), "简答题", len(sh))
    bank = {"generated": "local", "mcq": qs, "short": sh}
    with open(os.path.join(HERE, "bank.json"), "w", encoding="utf-8") as fh:
        json.dump(bank, fh, ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, "bank.js"), "w", encoding="utf-8") as fh:
        fh.write("window.BANK=" + json.dumps(bank, ensure_ascii=False) + ";")
    print("已写出 bank.json / bank.js")

if __name__ == "__main__":
    main()
