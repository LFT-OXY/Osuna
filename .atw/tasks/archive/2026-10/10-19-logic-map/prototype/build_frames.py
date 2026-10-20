# PROTOTYPE — 可删除。逻辑图三个风格方向的静态首屏生成脚本，只用于第一段选方向。
# 外壳（左侧栏、主区域文档、右边栏标签栏和面板头）三张共用；图本身各写各的。
from pathlib import Path

OUT = Path(__file__).parent

ICON = {
    "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "diff": '<circle cx="5" cy="6" r="3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/><path d="m15 9-3-3 3-3"/><circle cx="19" cy="18" r="3"/><path d="M12 18H7a2 2 0 0 1-2-2V9"/><path d="m9 15 3 3-3 3"/>',
    "history": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    "map": '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    "down": '<path d="m6 9 6 6 6-6"/>',
    "right": '<path d="m9 18 6-6-6-6"/>',
    "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "minus": '<path d="M5 12h14"/>',
    "fit": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    "file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    "x": '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "panel": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
}


def icon(name, size=16, cls=""):
    return (
        f'<svg class="ic {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
        f'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{ICON[name]}</svg>'
    )


BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1280px;height:900px;overflow:hidden}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",sans-serif;font-size:14px;color:#27272a;background:#fcfcfc;display:flex;-webkit-font-smoothing:antialiased}
.ic{flex:none;display:block}
.muted{color:#71717b}
/* 左侧栏 */
.app-side{width:240px;background:#fafafa;border-right:1px solid #e4e4e7;display:flex;flex-direction:column;padding:10px 8px;gap:2px}
.app-side .top{display:flex;align-items:center;justify-content:space-between;height:28px;padding:0 6px;margin-bottom:10px;color:#71717b}
.app-side .proj{font-size:12px;font-weight:500;color:#71717b;padding:6px 8px}
.app-side .row{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:8px;font-size:14px;color:#71717b}
.app-side .row.sel{background:#ececed;color:#27272a}
.dot{width:6px;height:6px;border-radius:50%;background:#a1a1aa;flex:none}
.ring{width:10px;height:10px;border-radius:50%;border:1.5px solid #268ae0;border-right-color:transparent;flex:none}
/* 主区域 */
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.tabs{height:38px;display:flex;align-items:stretch;border-bottom:1px solid #e4e4e7;background:#fcfcfc}
.tab{display:flex;align-items:center;gap:8px;padding:0 14px;font-size:13px;color:#71717b;border-right:1px solid #e4e4e7}
.tab.on{background:#fff;color:#27272a}
.brand{width:12px;height:12px;border-radius:3px;background:#d97757;flex:none}
.doc{flex:1;background:#fff;overflow:hidden;padding:28px 0}
.doc .inner{max-width:600px;margin:0 auto;padding:0 32px}
.doc .path{font-size:12px;color:#71717b;margin-bottom:18px}
.doc h1{font-size:22px;font-weight:600;margin-bottom:12px;line-height:1.35}
.doc h2{font-size:16px;font-weight:600;margin:22px 0 8px}
.doc p,.doc li{font-size:15px;line-height:1.7;color:#3b3b40}
.doc ul{padding-left:20px}
.doc li{margin:2px 0}
/* 右边栏 */
.side{width:320px;border-left:1px solid #e4e4e7;background:#fcfcfc;display:flex;flex-direction:column}
.side-tabs{height:38px;display:flex;align-items:center;gap:2px;padding:0 6px;border-bottom:1px solid #e4e4e7}
.stab{display:flex;align-items:center;gap:5px;height:26px;padding:0 7px;border-radius:8px;font-size:13px;color:#71717b;white-space:nowrap}
.stab.on{background:#ececed;color:#27272a}
.stab .ic{width:14px;height:14px}
.side-tabs .grow{flex:1}
.phead{display:flex;align-items:center;justify-content:space-between;height:40px;padding:0 8px 0 10px}
.picker{display:flex;align-items:center;gap:4px;height:26px;padding:0 6px;border-radius:8px;font-size:13px;font-weight:500;color:#27272a}
.crumb{display:flex;align-items:center;gap:2px;height:26px;padding:0 16px;font-size:12px;color:#71717b}
.crumb b{font-weight:400;color:#27272a}
.canvas{position:relative;flex:1;overflow:hidden}
.zoom{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:2px;height:28px;padding:0 4px;background:#fff;border:1px solid #e4e4e7;border-radius:8px;font-size:12px;color:#71717b}
.zoom .ic{width:14px;height:14px;margin:0 4px}
.zoom span{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.flag{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 6px;border-radius:5px;background:#7b5d391f;color:#7b5d39;font-size:11px;white-space:nowrap;flex:none}
.flag:before{content:"";width:5px;height:5px;border-radius:50%;background:#b37824}
"""

CHROME = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>{title}</title>
<style>{base}{css}</style></head><body>
<aside class="app-side">
  <div class="top"><span style="font-weight:500;color:#27272a;font-size:14px">Osuna</span>{i_search}</div>
  <div class="proj">My-Osuna</div>
  <div class="row sel"><span class="ring"></span>用户登录逻辑</div>
  <div class="row"><span class="dot"></span>修复终端闪烁</div>
  <div class="row"><span class="dot"></span>main</div>
  <div class="proj" style="margin-top:12px">paseo-website</div>
  <div class="row"><span class="dot"></span>main</div>
</aside>
<main class="main">
  <div class="tabs">
    <div class="tab"><span class="brand"></span>设计登录流程</div>
    <div class="tab on">{i_file}锁定账户 30 分钟.md {i_x}</div>
  </div>
  <div class="doc"><div class="inner">
    <div class="path">docs/logic-maps/user-login/lock-account.md</div>
    <h1>锁定账户 30 分钟</h1>
    <p>同一账户连续输错密码满 5 次，账户锁定 30 分钟。锁定期间的登录请求直接返回“账户已锁定”，不再校验密码。</p>
    <h2>规则</h2>
    <ul>
      <li>失败次数按账户计，不按设备或 IP 计。</li>
      <li>从第 5 次失败那一刻开始计时，到期自动解除，不需要人工操作。</li>
      <li>解除后失败次数清零。</li>
    </ul>
    <h2>之后去哪</h2>
    <ul><li>回到“留在登录页”，提示还要等多久。</li></ul>
    <h2>验收</h2>
    <ul>
      <li>连续输错 5 次后，第 6 次输入正确密码，仍提示账户已锁定。</li>
      <li>30 分钟后输入正确密码，可以正常登录。</li>
    </ul>
  </div></div>
</main>
<aside class="side">
  <div class="side-tabs">
    <div class="stab">{i_folder}文件</div>
    <div class="stab">{i_diff}更改</div>
    <div class="stab">{i_history}会话历史</div>
    <div class="stab on">{i_map}逻辑图</div>
  </div>
  <div class="phead"><div class="picker">用户登录{i_down}</div><span class="muted" style="font-size:12px">13 个节点</span></div>
  <div class="crumb">用户登录{i_right}<b>密码登录</b></div>
  <div class="canvas">{map}
    <div class="zoom">{i_minus}<span>{zoom}</span>{i_plus}{i_fit}</div>
  </div>
</aside>
</body></html>"""


def frame(title, css, map_html, zoom):
    return CHROME.format(
        title=title,
        base=BASE_CSS,
        css=css,
        map=map_html,
        zoom=zoom,
        i_search=icon("search", 15),
        i_file=icon("file", 14),
        i_x=icon("x", 13, "muted"),
        i_folder=icon("folder"),
        i_diff=icon("diff"),
        i_history=icon("history"),
        i_map=icon("map"),
        i_down=icon("down", 14, "muted"),
        i_right=icon("right", 12),
        i_minus=icon("minus"),
        i_plus=icon("plus"),
        i_fit=icon("fit"),
    )


RED = "#9d433b"
GRAY = "#a1a1aa"
BLUE = "#1b4ed8"

# ---------------------------------------------------------------- A 卡片画布
A_CSS = """
.canvas{background-color:#fcfcfc;background-image:radial-gradient(#e4e4e7 1px,transparent 1px);background-size:14px 14px}
.stage{position:absolute;left:12px;top:14px;width:448px;height:600px;transform:scale(.66);transform-origin:0 0}
.stage>svg{position:absolute;left:0;top:0;overflow:visible}
.card .t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.card{position:absolute;width:128px;height:40px;background:#fff;border:1px solid #e4e4e7;border-radius:10px;display:flex;align-items:center;gap:7px;padding:0 10px;font-size:14px;white-space:nowrap;box-shadow:0 1px 2px #0000000a}
.card .k{width:18px;height:18px;border-radius:5px;background:#f4f4f5;color:#71717b;display:grid;place-items:center;flex:none}
.card .k svg{width:12px;height:12px}
.card.term{height:36px;border-radius:18px;background:#f4f4f5;border-color:#e4e4e7;justify-content:center;color:#3b3b40}
.card.fail{border-color:#9d433b55}
.card.fail .k{background:#9d433b1f;color:#9d433b}
.card.sel{border:1.5px solid #1b4ed8;box-shadow:0 0 0 4px #1b4ed824}
.card.sub{box-shadow:3px 3px 0 -1px #fff,3px 3px 0 0 #d4d4d8}
.card.sub .chev{margin-left:auto;color:#71717b}
.card .flag{position:absolute;right:-8px;top:-10px}
.card.dec{height:72px;flex-direction:column;align-items:stretch;padding:0;gap:0}
.dec .h{height:40px;display:flex;align-items:center;gap:7px;padding:0 10px}
.dec .k{background:#27272a;color:#fff}
.dec .strip{display:flex;height:31px;border-top:1px solid #f0f0f1}
.dec .seg{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:#71717b;position:relative}
.dec .seg+.seg{border-left:1px solid #f0f0f1}
.dec .seg.bad{color:#9d433b}
.dec .seg:after{content:"";position:absolute;bottom:-4px;left:50%;margin-left:-3.5px;width:7px;height:7px;border-radius:50%;background:#fff;border:1.5px solid #a1a1aa}
.dec .seg.bad:after{border-color:#9d433b}
"""

DIAMOND = '<svg viewBox="0 0 12 12"><path d="M6 1 11 6 6 11 1 6Z" fill="currentColor"/></svg>'
STEP = '<svg viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="2" fill="currentColor"/></svg>'
LAYERS = '<svg viewBox="0 0 12 12"><rect x="1.5" y="3.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 1.5h5a1.5 1.5 0 0 1 1.5 1.5v5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
CHEV = icon("right", 14, "chev")


def a_card(x, y, title, kind="step", extra=""):
    if kind == "term":
        return f'<div class="card term" style="left:{x}px;top:{y}px">{title}</div>'
    k = LAYERS if kind == "sub" else STEP
    cls = {"step": "", "fail": "fail", "sub": "sub", "sel": "fail sel"}[kind]
    tail = CHEV if kind == "sub" else ""
    return f'<div class="card {cls}" style="left:{x}px;top:{y}px"><span class="k">{k}</span><span class="t">{title}</span>{tail}{extra}</div>'


def a_dec(x, y, title, segs):
    s = "".join(f'<div class="seg {"bad" if bad else ""}">{t}</div>' for t, bad in segs)
    return f'<div class="card dec" style="left:{x}px;top:{y}px"><div class="h"><span class="k">{DIAMOND}</span>{title}</div><div class="strip">{s}</div></div>'


def a_map():
    edges = [
        ("M64 36 L64 64", GRAY),
        ("M32 136 C32 156 64 152 64 172", GRAY),
        ("M96 136 C96 160 368 148 368 172", RED),
        ("M32 244 C32 264 64 264 64 284", GRAY),
        ("M96 244 C96 268 216 260 216 284", RED),
        ("M64 324 L64 352", GRAY),
        ("M64 392 L64 420", GRAY),
        ("M64 460 L64 488", GRAY),
        ("M216 324 L216 352", RED),
        ("M184 424 C184 444 216 444 216 464", RED),
        ("M248 424 C248 444 368 440 368 464", RED),
        ("M216 504 C216 532 292 528 292 556", RED),
        ("M368 504 C368 532 292 528 292 556", RED),
        ("M368 212 C368 236 440 230 440 256 L440 548 C440 568 410 574 357 574", RED),
    ]
    marks = (
        f'<marker id="ag" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{GRAY}"/></marker>'
        f'<marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{RED}"/></marker>'
    )
    paths = "".join(
        f'<path d="{d}" fill="none" stroke="{c}" stroke-width="1.5" marker-end="url(#{"ar" if c == RED else "ag"})"/>'
        for d, c in edges
    )
    svg = f'<svg width="448" height="600"><defs>{marks}</defs>{paths}</svg>'
    nodes = [
        a_card(0, 0, "提交账号和密码", "term"),
        a_dec(0, 64, "账户状态", [("正常", False), ("已锁定", True)]),
        a_card(304, 172, "提示账户已锁定", "fail"),
        a_dec(0, 172, "校验密码", [("正确", False), ("错误", True)]),
        a_card(0, 284, "清零失败次数"),
        a_card(0, 352, "二次验证", "sub"),
        a_card(0, 420, "签发登录会话", extra='<span class="flag">未指向文档</span>'),
        a_card(0, 488, "进入首页", "term"),
        a_card(152, 284, "失败次数 +1", "fail"),
        a_dec(152, 352, "满 5 次？", [("未满", True), ("已满", True)]),
        a_card(152, 464, "提示密码错误", "fail"),
        a_card(304, 464, "锁定账户 30 分钟", "sel"),
        a_card(228, 556, "留在登录页", "term"),
    ]
    return f'<div class="stage">{svg}{"".join(nodes)}</div>'


# ---------------------------------------------------------------- B 分支轨道
B_CSS = """
.list{position:absolute;left:8px;right:8px;top:4px}
.list>svg{position:absolute;left:0;top:0;overflow:visible}
.r{position:relative;height:36px;display:flex;align-items:center;gap:8px;padding:0 10px 0 72px;border-radius:8px;font-size:14px;white-space:nowrap}
.r .t{overflow:hidden;text-overflow:ellipsis}
.r.dim .t{color:#3b3b40}
.r.sel{background:#1b4ed814}
.r.sel .t{color:#1b4ed8}
.c{height:18px;line-height:18px;padding:0 6px;border-radius:5px;font-size:11px;background:#f4f4f5;color:#71717b;flex:none}
.c.bad{background:#9d433b1a;color:#9d433b}
.r .chev{margin-left:auto;color:#71717b}
.r .flag{margin-left:auto}
.r.end .t{color:#71717b}
"""

B_ROWS = [
    # (车道 x, 记号, 标题, 条件, 条件是否失败, 额外类)
    (16, "start", "提交账号和密码", None, False, ""),
    (16, "dec", "账户状态", None, False, ""),
    (16, "dec", "校验密码", "正常", False, ""),
    (16, "step", "清零失败次数", "正确", False, ""),
    (16, "sub", "二次验证", None, False, ""),
    (16, "step", "签发登录会话", None, False, "flag"),
    (16, "end", "进入首页", None, False, "end"),
    (48, "fail", "提示账户已锁定", "已锁定", True, ""),
    (32, "fail", "失败次数 +1", "错误", True, ""),
    (32, "faildec", "满 5 次？", None, False, ""),
    (32, "fail", "提示密码错误", "未满", True, ""),
    (16, "sel", "锁定账户 30 分钟", "已满", True, "sel"),
    (32, "end", "留在登录页", None, False, "end"),
]


def b_mark(x, y, kind):
    if kind == "start":
        return f'<circle cx="{x}" cy="{y}" r="5" fill="#fcfcfc" stroke="#71717b" stroke-width="1.75"/>'
    if kind == "end":
        return f'<circle cx="{x}" cy="{y}" r="5.5" fill="#fcfcfc" stroke="#71717b" stroke-width="1.5"/><circle cx="{x}" cy="{y}" r="2.5" fill="#71717b"/>'
    if kind in ("dec", "faildec"):
        c = RED if kind == "faildec" else "#3b3b40"
        return f'<path d="M{x} {y-6} L{x+6} {y} L{x} {y+6} L{x-6} {y}Z" fill="{c}"/>'
    if kind == "sub":
        return f'<circle cx="{x}" cy="{y}" r="6" fill="#fcfcfc" stroke="#3b3b40" stroke-width="1.5"/><circle cx="{x}" cy="{y}" r="2.75" fill="#3b3b40"/>'
    if kind == "fail":
        return f'<circle cx="{x}" cy="{y}" r="4" fill="{RED}"/>'
    if kind == "sel":
        return f'<circle cx="{x}" cy="{y}" r="7" fill="#1b4ed824"/><circle cx="{x}" cy="{y}" r="4" fill="{BLUE}"/>'
    return f'<circle cx="{x}" cy="{y}" r="4" fill="#3b3b40"/>'


def b_map():
    cy = lambda r: 18 + r * 36  # noqa: E731
    lines = [
        (f"M16 {cy(0)} L16 {cy(6)}", GRAY),
        (f"M16 {cy(1)} C16 {cy(1)+18} 48 {cy(1)+10} 48 {cy(1)+30} L48 {cy(12)-28} C48 {cy(12)-12} 32 {cy(12)-16} 32 {cy(12)}", RED),
        (f"M16 {cy(2)} C16 {cy(2)+18} 32 {cy(2)+10} 32 {cy(2)+30} L32 {cy(12)}", RED),
        (f"M32 {cy(9)} C32 {cy(9)+18} 16 {cy(9)+10} 16 {cy(9)+30} L16 {cy(12)-28} C16 {cy(12)-12} 32 {cy(12)-16} 32 {cy(12)}", RED),
    ]
    svg_lines = "".join(
        f'<path d="{d}" fill="none" stroke="{c}" stroke-width="{1.5 if c == RED else 2}" stroke-opacity="{0.75 if c == RED else 1}"/>'
        for d, c in lines
    )
    marks = "".join(b_mark(x, cy(i), k) for i, (x, k, *_rest) in enumerate(B_ROWS))
    svg = f'<svg width="80" height="{cy(12)+20}">{svg_lines}{marks}</svg>'
    rows = []
    for _x, kind, title, cond, bad, extra in B_ROWS:
        chip = f'<span class="c {"bad" if bad else ""}">{cond}</span>' if cond else ""
        tail = ""
        if kind == "sub":
            tail = CHEV
        if extra == "flag":
            tail = '<span class="flag">未指向文档</span>'
        cls = extra if extra in ("sel", "end") else ""
        rows.append(f'<div class="r {cls}">{chip}<span class="t">{title}</span>{tail}</div>')
    return f'<div class="list">{svg}{"".join(rows)}</div>'


# ---------------------------------------------------------------- C 分叉块
C_CSS = """
.stage{position:absolute;left:12px;top:12px;width:400px;transform:scale(.74);transform-origin:0 0}
.col{display:flex;flex-direction:column;align-items:stretch;min-width:0}
.blk{border:1px solid #d4d4d8;background:#fff;border-radius:4px;padding:8px 10px;font-size:14px;line-height:1.3;display:flex;align-items:center;gap:6px;min-width:0}
.blk.term{border-radius:18px;justify-content:center;background:#f4f4f5;border-color:#e4e4e7;color:#3b3b40}
.blk.sel{border:1.5px solid #1b4ed8;box-shadow:0 0 0 3px #1b4ed824}
.blk .chev{margin-left:auto;color:#71717b}
.blk.wrap{flex-wrap:wrap}
.arr{height:14px;display:flex;justify-content:center}
.arr:before{content:"";width:1.5px;background:#a1a1aa}
.fork{border:1px solid #d4d4d8;border-radius:4px;background:#fff;overflow:hidden}
.fork>.q{display:flex;align-items:center;gap:6px;padding:7px 10px;font-weight:500;font-size:14px;background:#f4f4f5;border-bottom:1px solid #d4d4d8}
.fork>.q svg{width:11px;height:11px}
.fork>.cols{display:flex;align-items:stretch}
.fork>.cols>.br{display:flex;flex-direction:column;padding:0 6px 8px;min-width:0}
.fork>.cols>.br+.br{border-left:1px solid #d4d4d8}
.br>.lab{font-size:12px;color:#71717b;padding:6px 2px 6px;text-align:center}
.br.bad{background:#9d433b0d}
.br.bad>.lab{color:#9d433b}
.br.bad>.col>.arr:before{background:#9d433b99}
"""


def c_blk(t, cls=""):
    return f'<div class="blk {cls}">{t}</div>'


def c_col(*items):
    out = []
    for i, it in enumerate(items):
        if i:
            out.append('<div class="arr"></div>')
        out.append(it)
    return f'<div class="col">{"".join(out)}</div>'


def c_fork(q, branches):
    bs = "".join(
        f'<div class="br {"bad" if bad else ""}" style="flex:{flex}"><div class="lab">{lab}</div>{body}</div>'
        for lab, bad, flex, body in branches
    )
    return f'<div class="fork"><div class="q">{DIAMOND}{q}</div><div class="cols">{bs}</div></div>'


def c_map():
    full = c_fork(
        "满 5 次？",
        [
            ("未满", True, 1, c_col(c_blk("提示密码错误"), c_blk("留在登录页", "term"))),
            ("已满", True, 1, c_col(c_blk("锁定账户 30 分钟", "sel"), c_blk("留在登录页", "term"))),
        ],
    )
    pw = c_fork(
        "校验密码",
        [
            (
                "正确",
                False,
                1,
                c_col(
                    c_blk("清零失败次数"),
                    c_blk(f"二次验证{CHEV}"),
                    c_blk('签发登录会话<span class="flag">未指向文档</span>', "wrap"),
                    c_blk("进入首页", "term"),
                ),
            ),
            ("错误", True, 1.35, c_col(c_blk("失败次数 +1"), full)),
        ],
    )
    top = c_fork(
        "账户状态",
        [
            ("正常", False, 2.7, c_col(pw)),
            ("已锁定", True, 1, c_col(c_blk("提示账户已锁定"), c_blk("留在登录页", "term"))),
        ],
    )
    return f'<div class="stage">{c_col(c_blk("提交账号和密码", "term"), top)}</div>'


# ---------------------------------------------------------------- D 贴近 Dify / Coze
# 照搬两家的外观：无边框白卡 + 柔和阴影、按种类上色的圆角图标块、判断卡片内一行一个分支并在右缘出口、
# Coze 的靛紫连线带箭头、Dify 的灰底点阵画布和蓝色选中描边。不受项目配色规定约束。
D_IND = "#4d53e8"
D_RED = "#f04438"
D_CSS = """
.canvas{background-color:#f2f4f7;background-image:radial-gradient(#d0d5dd 1px,transparent 1px);background-size:14px 14px}
.stage{position:absolute;left:12px;top:14px;width:516px;height:712px;transform:scale(.574);transform-origin:0 0}
.stage>svg{position:absolute;left:0;top:0;overflow:visible}
.dc{position:absolute;width:150px;background:#fff;border-radius:12px;box-shadow:0 1px 2px #1018280f,0 1px 3px #1018281a;padding:10px 12px;font-size:14px;color:#101828}
.dc .h{display:flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap}
.dc .h .t{overflow:hidden;text-overflow:ellipsis}
.ico{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;color:#fff;flex:none}
.ico svg{width:14px;height:14px}
.dc.sel{box-shadow:0 0 0 2px #2970ff,0 4px 8px #1018281a}
.dc .rows{margin-top:8px;display:flex;flex-direction:column;gap:6px}
.dc .rw{position:relative;display:flex;align-items:center;gap:6px;font-size:11px;color:#98a2b3}
.dc .rw .lb{width:30px;flex:none}
.dc .rw .pill{flex:1;height:24px;line-height:24px;padding:0 8px;border-radius:6px;background:#f2f4f7;color:#344054;font-size:12px}
.dc .rw:after{content:"";position:absolute;right:-17px;top:50%;margin-top:-5px;width:10px;height:10px;border-radius:50%;background:#4d53e8;border:2px solid #fff;box-shadow:0 0 0 1px #4d53e833}
.dc .rw.bad:after{background:#f04438}
.dc .rw.bad .pill{color:#d92d20}
.dc .tag{display:inline-block;margin-top:8px;height:18px;line-height:18px;padding:0 6px;border-radius:5px;font-size:10px;font-weight:600;letter-spacing:.3px}
.tag.sub{background:#fef0c7;color:#b54708}
.tag.flagd{background:#fffaeb;color:#b54708;border:1px solid #fedf89}
.dc .chev{margin-left:auto;color:#98a2b3}
"""

D_GLYPH = {
    "home": '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z" fill="currentColor"/>',
    "split": '<path d="M6 3v6a4 4 0 0 0 4 4h8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="m15 9 4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 9v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    "step": '<path d="M5 6h14M5 12h14M5 18h9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    "alert": '<path d="M12 4 2.5 20h19Z" fill="currentColor"/><path d="M12 10v4M12 17v.5" stroke="#f04438" stroke-width="2.2" stroke-linecap="round"/>',
    "loop": '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M18 3v4h-4M6 21v-4h4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    "flag": '<path d="M5 21V4h11l-2 4 2 4H5" fill="currentColor"/>',
}
D_COLOR = {"home": "#2970ff", "split": "#06aed4", "step": "#6172f3", "alert": "#f04438", "loop": "#f79009", "flag": "#2970ff"}


def d_ico(g):
    return f'<span class="ico" style="background:{D_COLOR[g]}"><svg viewBox="0 0 24 24">{D_GLYPH[g]}</svg></span>'


def d_card(x, y, title, g="step", extra="", cls=""):
    chev = icon("right", 14, "chev") if g == "loop" else ""
    return f'<div class="dc {cls}" style="left:{x}px;top:{y}px"><div class="h">{d_ico(g)}<span class="t">{title}</span>{chev}</div>{extra}</div>'


def d_dec(x, y, title, rows):
    rs = "".join(
        f'<div class="rw {"bad" if bad else ""}"><span class="lb">{lb}</span><span class="pill">{cond}</span></div>'
        for lb, cond, bad in rows
    )
    return f'<div class="dc" style="left:{x}px;top:{y}px"><div class="h">{d_ico("split")}{title}</div><div class="rows">{rs}</div></div>'


def d_map():
    # 普通卡片 44 高；判断卡片 108 高，两行分支的出口在右缘 y = top + 59 / top + 89
    edges = [
        ("M75 44 L75 76", D_IND),
        ("M164 135 C161 135 161 140 161 150 L161 230 C161 236 158 238 154 238", D_IND),
        ("M167 165 C300 165 419 180 419 216", D_RED),
        ("M164 275 C161 275 161 280 161 290 L161 370 C161 376 158 378 154 378", D_IND),
        ("M167 305 C210 305 247 320 247 356", D_RED),
        ("M75 400 L75 432", D_IND),
        ("M75 502 L75 534", D_IND),
        ("M75 604 L75 636", D_IND),
        ("M247 400 L247 432", D_RED),
        ("M336 491 C333 491 333 496 333 506 L333 586 C333 592 330 594 326 594", D_RED),
        ("M339 521 C390 521 419 536 419 572", D_RED),
        ("M247 616 C247 640 333 636 333 660", D_RED),
        ("M419 616 C419 640 333 636 333 660", D_RED),
        ("M494 238 C508 238 510 250 510 262 L510 670 C510 682 500 682 412 682", D_RED),
    ]
    mk = (
        f'<marker id="di" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{D_IND}"/></marker>'
        f'<marker id="dr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{D_RED}"/></marker>'
    )
    paths = "".join(
        f'<path d="{d}" fill="none" stroke="{c}" stroke-width="2" marker-end="url(#{"dr" if c == D_RED else "di"})"/>' for d, c in edges
    )
    svg = f'<svg width="516" height="712"><defs>{mk}</defs>{paths}</svg>'
    nodes = [
        d_card(0, 0, "提交账号和密码", "home"),
        d_dec(0, 76, "账户状态", [("如果", "正常", False), ("否则", "已锁定", True)]),
        d_card(344, 216, "提示账户已锁定", "alert"),
        d_dec(0, 216, "校验密码", [("如果", "正确", False), ("否则", "错误", True)]),
        d_card(0, 356, "清零失败次数"),
        d_card(0, 432, "二次验证", "loop", '<span class="tag sub">子图 · 4 个节点</span>'),
        d_card(0, 534, "签发登录会话", "step", '<span class="tag flagd">未指向文档</span>'),
        d_card(0, 636, "进入首页", "flag"),
        d_card(172, 356, "失败次数 +1", "alert"),
        d_dec(172, 432, "满 5 次？", [("如果", "未满", True), ("否则", "已满", True)]),
        d_card(172, 572, "提示密码错误", "alert"),
        d_card(344, 572, "锁定账户 30 分钟", "alert", cls="sel"),
        d_card(258, 660, "留在登录页", "flag"),
    ]
    return f'<div class="stage">{svg}{"".join(nodes)}</div>'


# ---------------------------------------------------------------- E 贴近 archify
# 照搬 archify：浅青渐变底 + 网格、虚线分区（主流程 / EX 失败处理）、按类别着色的半透明底卡片与同色粗描边和光晕、
# 等宽字体标题加小号说明行、虚线连线带箭头、条件写在线中段的白底小标签、底部图例。
E_CSS = """
.canvas{background:linear-gradient(180deg,#f7fbfc,#eaf6f8);}
.canvas:before{content:"";position:absolute;inset:0;background-image:linear-gradient(#d8eaee66 1px,transparent 1px),linear-gradient(90deg,#d8eaee66 1px,transparent 1px);background-size:20px 20px}
.stage{position:absolute;left:10px;top:12px;width:524px;height:690px;transform:scale(.567);transform-origin:0 0;font-family:"JetBrains Mono",ui-monospace,Menlo,"PingFang SC",monospace}
.stage>svg{position:absolute;left:0;top:0;overflow:visible}
.band{position:absolute;border:1.5px dashed #8fb3bd;border-radius:10px;background:#ffffff59}
.band.ex{border-color:#d0496b;background:#fdf2f566}
.band .bl{position:absolute;left:12px;top:8px;font-size:12px;color:#6b8a94;letter-spacing:.3px}
.band.ex .bl{color:#c23d5f}
.en{position:absolute;height:50px;border:2px solid;border-radius:7px;padding:6px 10px;display:flex;flex-direction:column;justify-content:center;align-items:center;white-space:nowrap}
.en b{font-size:14px;font-weight:700;color:#14303a;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.en i{font-style:normal;font-size:10.5px;color:#5d7680;margin-top:2px}
.en.teal{background:#d9f1ec;border-color:#1a9e8f;box-shadow:0 0 14px #1a9e8f40}
.en.cyan{background:#dcf2f7;border-color:#2aa0b8;box-shadow:0 0 14px #2aa0b840}
.en.gray{background:#e3e9ec;border-color:#6b7f8f;box-shadow:0 0 12px #6b7f8f33}
.en.red{background:#fbe4ea;border-color:#d0496b;box-shadow:0 0 14px #d0496b40}
.en.orange{background:#fdeedd;border-color:#d0803a;box-shadow:0 0 14px #d0803a40}
.en.purple{background:#ece8fb;border-color:#7b68d8;box-shadow:0 0 14px #7b68d840}
.en.sel{outline:2px solid #1b4ed8;outline-offset:3px}
.en .fl{position:absolute;right:-6px;top:-10px;font-size:9px;color:#b45309;background:#fff7e6;border:1px solid #f0c98a;border-radius:3px;padding:0 3px;line-height:13px}
.elab{position:absolute;transform:translate(-50%,-50%);background:#fff;border:1px solid;border-radius:4px;padding:1px 6px;font-size:11px;white-space:nowrap}
.elab.ok{color:#1a7f73;border-color:#9fd6cd}
.elab.bad{color:#c23d5f;border-color:#efb3c3}
.legend{position:absolute;left:0;top:630px;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:11px;color:#4b6670;width:520px}
.legend span{display:flex;align-items:center;gap:5px}
.legend em{width:16px;height:10px;border:1.5px solid;border-radius:3px}
"""


def e_node(x, y, w, title, sub, color, extra="", cls=""):
    return f'<div class="en {color} {cls}" style="left:{x}px;top:{y}px;width:{w}px"><b>{title}</b><i>{sub}</i>{extra}</div>'


def e_lab(x, y, t, bad):
    return f'<div class="elab {"bad" if bad else "ok"}" style="left:{x}px;top:{y}px">{t}</div>'


def e_map():
    T, R = "#1a9e8f", "#d0496b"
    edges = [
        ("M98 90 L98 124", T),
        ("M98 174 L98 232", T),
        ("M178 149 L366 149", R),
        ("M98 282 L98 340", T),
        ("M178 257 L236 257", R),
        ("M98 390 L98 416", T),
        ("M98 466 L98 492", T),
        ("M98 542 L98 568", T),
        ("M301 282 L301 340", R),
        ("M301 390 L301 448", R),
        ("M366 365 C430 365 436 400 436 448", R),
        ("M301 498 C301 530 366 520 366 546", R),
        ("M436 498 C436 530 366 520 366 546", R),
        ("M496 149 C512 149 514 160 514 172 L514 560 C514 570 506 571 433 571", R),
    ]
    mk = (
        f'<marker id="et" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{T}"/></marker>'
        f'<marker id="er" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8Z" fill="{R}"/></marker>'
    )
    paths = "".join(
        f'<path d="{d}" fill="none" stroke="{c}" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#{"er" if c == R else "et"})"/>' for d, c in edges
    )
    svg = f'<svg width="524" height="690"><defs>{mk}</defs>{paths}</svg>'
    bands = (
        '<div class="band" style="left:0;top:0;width:198px;height:616px"><span class="bl">01 / 主流程</span></div>'
        '<div class="band ex" style="left:214px;top:0;width:308px;height:616px"><span class="bl">EX / 失败处理</span></div>'
    )
    nodes = [
        e_node(18, 40, 160, "提交账号和密码", "开始", "cyan"),
        e_node(18, 124, 160, "账户状态", "判断 · 2 条分支", "teal"),
        e_node(366, 124, 130, "提示账户已锁定", "步骤", "red"),
        e_node(18, 232, 160, "校验密码", "判断 · 2 条分支", "teal"),
        e_node(236, 232, 130, "失败次数 +1", "步骤", "red"),
        e_node(18, 340, 160, "清零失败次数", "步骤", "teal"),
        e_node(236, 340, 130, "满 5 次？", "判断 · 2 条分支", "red"),
        e_node(18, 416, 160, "二次验证  ›", "子图 · 4 个节点", "purple"),
        e_node(18, 492, 160, "签发登录会话", "步骤", "teal", '<span class="fl">未指向文档</span>'),
        e_node(18, 568, 160, "进入首页", "结束", "gray"),
        e_node(236, 448, 130, "提示密码错误", "步骤", "orange"),
        e_node(371, 448, 130, "锁定账户 30 分钟", "步骤", "red", cls="sel"),
        e_node(300, 546, 133, "留在登录页", "结束", "gray"),
    ]
    labels = [
        e_lab(98, 203, "正常", False),
        e_lab(272, 149, "已锁定", True),
        e_lab(98, 311, "正确", False),
        e_lab(207, 257, "错误", True),
        e_lab(301, 419, "未满", True),
        e_lab(430, 395, "已满", True),
    ]
    legend = (
        '<div class="legend">'
        '<span><em style="border-color:#2aa0b8;background:#dcf2f7"></em>开始</span>'
        '<span><em style="border-color:#1a9e8f;background:#d9f1ec"></em>主流程</span>'
        '<span><em style="border-color:#d0496b;background:#fbe4ea"></em>失败</span>'
        '<span><em style="border-color:#d0803a;background:#fdeedd"></em>提示</span>'
        '<span><em style="border-color:#7b68d8;background:#ece8fb"></em>子图</span>'
        '<span><em style="border-color:#6b7f8f;background:#e3e9ec"></em>结束</span>'
        "</div>"
    )
    return f'<div class="stage">{bands}{svg}{"".join(nodes)}{"".join(labels)}{legend}</div>'


FILES = {
    "direction-a.html": ("A 卡片画布", A_CSS, a_map(), "66%"),
    "direction-b.html": ("B 分支轨道", B_CSS, b_map(), "100%"),
    "direction-c.html": ("C 分叉块", C_CSS, c_map(), "74%"),
    "direction-d.html": ("D 贴近 Dify / Coze", D_CSS, d_map(), "57%"),
    "direction-e.html": ("E 贴近 archify", E_CSS, e_map(), "57%"),
}

for name, (title, css, m, z) in FILES.items():
    (OUT / name).write_text(frame(title, css, m, z), encoding="utf-8")
    print("wrote", OUT / name)
