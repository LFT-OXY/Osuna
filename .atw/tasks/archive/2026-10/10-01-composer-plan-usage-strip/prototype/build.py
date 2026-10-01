# PROTOTYPE — 可删除。生成套餐用量窄栏 + 上下文弹层的三个方向小样（单文件 HTML，无脚本）。
# 用法：python3 build.py   → 写出 a.html / b.html / c.html
# 颜色全部取自 Dracula 主题 token（packages/app/src/styles/theme.ts），不新增色值。
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ICONS = REPO / "packages/app/src/components/icons"

# ---------- token（Dracula 暗色） ----------
T = {
    "s0": "#282a36",
    "s1": "#2e303e",
    "s2": "#343746",
    "s3": "#44475a",
    "fg": "#f8f8f2",
    "muted": "#a9adc6",
    "xmuted": "#6272a4",
    "border": "#363948",
    "borderAccent": "#44475a",
    "borderComposer": "rgba(248,248,242,0.09)",
    "ok": "#6cb17b",
    "warning": "#c09664",
    "danger": "#d8847b",
}


def tone(pct):
    if pct > 90:
        return "danger"
    if pct >= 70:
        return "warning"
    return "ok"


def icon_path(name):
    src = (ICONS / f"{name}-icon.tsx").read_text()
    return re.search(r'<Path d="([^"]+)"', src).group(1)


PROVIDER_PATH = {"claude": icon_path("claude"), "codex": icon_path("codex")}


def provider_icon(pid, size=12, color=None):
    color = color or T["muted"]
    return (
        f'<svg class="pi" width="{size}" height="{size}" viewBox="0 0 24 24" fill="{color}" '
        f'fill-rule="evenodd"><path d="{PROVIDER_PATH[pid]}"/></svg>'
    )


LUCIDE = {
    "plus": '<path d="M5 12h14"/><path d="M12 5v14"/>',
    "mic": '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    "wave": '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "branch": '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    "chev": '<path d="m6 9 6 6 6-6"/>',
}


def lucide(name, size=16, color=None, sw=2):
    color = color or T["muted"]
    return (
        f'<svg class="li" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{color}" '
        f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{LUCIDE[name]}</svg>'
    )


def ring(pct, color, size=12, stroke=1.75, track=None):
    track = track or T["s3"]
    c = size / 2
    r = (size - stroke) / 2
    circ = 2 * math.pi * r
    off = circ - max(0, min(100, pct)) / 100 * circ
    prog = (
        f'<circle cx="{c}" cy="{c}" r="{r:.3f}" fill="none" stroke="{color}" stroke-width="{stroke}" '
        f'stroke-linecap="round" stroke-dasharray="{circ:.3f}" stroke-dashoffset="{off:.3f}"/>'
        if pct > 0
        else ""
    )
    return (
        f'<svg class="ring" width="{size}" height="{size}" viewBox="0 0 {size} {size}" style="transform:rotate(-90deg)">'
        f'<circle cx="{c}" cy="{c}" r="{r:.3f}" fill="none" stroke="{track}" stroke-width="{stroke}"/>{prog}</svg>'
    )


# ---------- 模拟数据 ----------
# (短名, 完整名, 用量%, 重置时长, 用完时长)
CLAUDE_OK = [
    ("5h", "Session", 0, "4h", None),
    ("周", "Weekly", 45, "4d", None),
    ("Fable", "Weekly · Fable", 0, "4d", None),
]
CLAUDE_HOT = [
    ("5h", "Session", 82, None, "1h"),
    ("周", "Weekly", 93, "2d", None),
    ("Fable", "Weekly · Fable", 71, "2d", None),
]
CODEX = [
    ("5h", "Session", 12, "3h", None),
    ("周", "Weekly", 64, "5d", None),
    ("审查", "Code review", 0, "6d", None),
]


def trailing_short(w):
    _, _, _, reset, runs = w
    if runs:
        return f'<span class="runs">{runs}后用完</span>'
    return f'<span class="dim">{reset}</span>'


def trailing_full(w):
    _, _, _, reset, runs = w
    if runs:
        return f'<span class="runs">{runs} 后用完</span>'
    return f'<span class="dim">{reset} 后重置</span>'


# ---------- 共用外壳 ----------
BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:%(s0)s}
body{font-family:-apple-system,"SF Pro Text","PingFang SC","Helvetica Neue",system-ui,sans-serif;color:%(fg)s;
  -webkit-font-smoothing:antialiased;font-size:14px;line-height:20px;padding:28px;min-height:900px}
.num{font-variant-numeric:tabular-nums}
.dim{color:%(muted)s}
.runs{color:%(danger)s}
.ring,.pi,.li{flex-shrink:0;display:block}
.board{display:flex;gap:28px;align-items:flex-start}
.col{display:flex;flex-direction:column;gap:22px}
.cap{font-size:11px;line-height:15px;color:%(xmuted)s;margin-bottom:6px;letter-spacing:.02em}
/* composer */
.composer{display:flex;flex-direction:column}
.input{background:%(s2)s;border:1px solid %(borderComposer)s;border-radius:22px;padding:14px 14px 10px 18px;
  display:flex;flex-direction:column;gap:14px}
.draft{font-size:15px;line-height:22px;color:%(fg)s}
.toolbar{display:flex;align-items:center;justify-content:flex-end;gap:4px;height:28px}
.tb{width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:999px}
.meter{display:flex;align-items:center;gap:4px;height:28px;padding:0 4px;font-size:12px;color:%(muted)s}
.strip{display:flex;align-items:center;gap:12px;height:28px;margin:0 24px;padding:0 12px;background:%(s2)s;
  border:1px solid %(borderComposer)s;border-top:0;border-radius:0 0 14px 14px;overflow:hidden;
  font-size:12px;line-height:16px;color:%(muted)s;white-space:nowrap}
.si{display:flex;align-items:center;gap:4px;flex-shrink:0}
.branch{min-width:0;flex-shrink:1;overflow:hidden}
.branch .bn{overflow:hidden;text-overflow:ellipsis}
.spacer{flex-grow:1}
/* 浮层外壳 */
.pop{background:%(s1)s;border:1px solid %(borderAccent)s;border-radius:12px;padding:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.35),0 2px 6px rgba(0,0,0,.25);font-size:12px;line-height:16px}
""" % T


def composer(strip_html, width, draft, branch="hopeful-walrus", kind="工作树"):
    return f"""
<div class="composer" style="width:{width}px">
  <div class="input">
    <div class="draft">{draft}</div>
    <div class="toolbar">
      <div class="tb">{lucide("plus", 18)}</div>
      <div class="meter">{ring(5.2, T["muted"], 14, 2)}<span class="num">51.8K / 1.0M</span></div>
      <div class="tb">{lucide("mic", 17)}</div>
      <div class="tb">{lucide("wave", 17)}</div>
    </div>
  </div>
  <div class="strip">
    <div class="si">{lucide("folder", 12)}<span>{kind}</span></div>
    <div class="si branch">{lucide("branch", 12)}<span class="bn">{branch}</span>{lucide("chev", 12)}</div>
    <div class="spacer"></div>
    {strip_html}
  </div>
</div>"""


STATES = [
    ("Claude · 余量充足", "claude", CLAUDE_OK, 3, None, "hopeful-walrus"),
    ("Claude · 紧张：5h 会在重置前用完，周额度 93%", "claude", CLAUDE_HOT, 3, None, "hopeful-walrus"),
    ("Codex Agent", "codex", CODEX, 3, None, "hopeful-walrus"),
    ("窄窗口 · 长分支名先截断，再从末尾隐藏窗口", "claude", CLAUDE_HOT, 1, 420, "feature/plan-usage-strip-with-a-very-long-name"),
]
DRAFTS = [
    "把套餐用量挪到输入框下方，悬停能看到完整卡片",
    "周额度快用完了，先把剩下的测试跑完",
    "检查一下 review 窗口的数据是不是对的",
    "窄一点也要能看到最紧张的那项",
]


def composers(strip_fn, wide=640):
    out = []
    for (cap, pid, windows, n, width, branch), draft in zip(STATES, DRAFTS):
        out.append(
            f'<div><div class="cap">{cap}</div>{composer(strip_fn(pid, windows[:n]), width or wide, draft, branch)}</div>'
        )
    return "\n".join(out)


def page(title, css, body):
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>{BASE_CSS}{css}</style></head><body>{body}</body></html>"""


SESSION = [
    ("Token", "↑26 ↓4.0K"),
    ("估算成本", "$0.40"),
    ("轮次", "4"),
    ("Agent 运行", "1m"),
    ("会话跨度", "3m 32s"),
]

# =====================================================================
# 方向 A：随行文字 —— 窄栏是一行安静的文字流；弹层是「仪表头 + 统一键值行」
# =====================================================================
A_CSS = """
.pu{display:flex;align-items:center;gap:12px;flex-shrink:0}
.pu .w{display:flex;align-items:center;gap:4px}
.pu .w b{font-weight:400;color:%(fg)s}
.a-pop{width:262px;display:flex;flex-direction:column}
.a-sec{display:flex;flex-direction:column;gap:6px}
.a-sec+.a-sec{border-top:1px solid %(border)s;margin-top:12px;padding-top:12px}
.a-head{display:flex;align-items:baseline;justify-content:space-between}
.a-title{font-size:13px;line-height:18px;font-weight:500;color:%(fg)s}
.a-big{font-size:13px;line-height:18px;color:%(fg)s}
.a-bar{height:4px;border-radius:2px;background:%(s3)s;overflow:hidden;margin:2px 0}
.a-bar i{display:block;height:4px;border-radius:2px}
.a-row{display:flex;justify-content:space-between;gap:12px;color:%(muted)s}
.a-row .v{color:%(fg)s}
.a-label{font-size:11px;line-height:15px;color:%(xmuted)s;font-weight:500;letter-spacing:.04em}
.a-card-head{display:flex;align-items:center;gap:6px}
.badge{font-size:11px;line-height:15px;padding:1px 6px;border-radius:999px;background:%(s3)s;color:%(muted)s}
.a-win{display:flex;flex-direction:column;gap:4px}
.a-win .top{display:flex;justify-content:space-between;gap:8px}
.a-foot{color:%(xmuted)s;font-size:11px;line-height:15px}
""" % T


def a_strip(pid, windows):
    items = "".join(
        f'<span class="w">{ring(w[2], T[tone(w[2])])}<span>{w[0]}</span><b class="num">{w[2]}%</b>'
        f'<span class="dim">·</span>{trailing_short(w)}</span>'
        for w in windows
    )
    return f'<div class="pu">{provider_icon(pid)}{items}</div>'


def a_context():
    rows = "".join(f'<div class="a-row"><span>{k}</span><span class="v num">{v}</span></div>' for k, v in SESSION)
    return f"""
<div class="a-sec">
  <div class="a-head"><span class="a-title">上下文窗口</span><span class="a-big num">5%</span></div>
  <div class="a-bar"><i style="width:5.2%;background:{T["muted"]}"></i></div>
  <div class="a-row"><span class="num">51.8K / 1.0M tokens</span><span class="num">估算成本 $0.52</span></div>
</div>
<div class="a-sec">
  <div class="a-label">本会话合计</div>
  {rows}
</div>"""


def a_card(pid="claude", name="Claude", plan="Max 20x", windows=CLAUDE_OK):
    wins = "".join(
        f"""<div class="a-win"><div class="top"><span class="dim">{w[1]}</span>
<span class="num">{w[2]}% <span class="dim">·</span> {trailing_full(w)}</span></div>
<div class="a-bar"><i style="width:{w[2]}%;background:{T[tone(w[2])]}"></i></div></div>"""
        for w in windows
    )
    return f"""
<div class="a-sec">
  <div class="a-card-head">{provider_icon(pid, 14)}<span class="a-title">{name}</span><span class="badge">{plan}</span>
    <span class="spacer"></span><span class="a-foot">更新于 2 分钟前</span></div>
  {wins}
  <div class="a-row"><span>Extra usage</span><span class="v">Disabled</span></div>
</div>"""


def build_a():
    body = f"""
<div class="board">
  <div class="col">{composers(a_strip)}</div>
  <div class="col">
    <div><div class="cap">上下文弹层 · 桌面（套餐部分已移走）</div><div class="pop a-pop">{a_context()}</div></div>
    <div><div class="cap">悬停窄栏套餐区 → 套餐用量卡片</div><div class="pop a-pop">{a_card()}</div></div>
  </div>
  <div class="col">
    <div><div class="cap">上下文弹层 · 手机（没有窄栏，保留套餐）</div><div class="pop a-pop">{a_context()}{a_card()}</div></div>
  </div>
</div>"""
    return page("A 随行文字", A_CSS, body)


# =====================================================================
# 方向 B：胶囊组 —— 每个窗口一颗内嵌胶囊；弹层以大圆环开场，会话数据用指标格
# =====================================================================
B_CSS = """
.pu{display:flex;align-items:center;gap:6px;flex-shrink:0}
.chip{display:flex;align-items:center;gap:5px;height:20px;padding:0 8px 0 5px;border-radius:999px;background:%(s1)s;
  border:1px solid %(border)s}
.chip b{font-weight:400;color:%(fg)s}
.chip.hot{border-color:rgba(216,132,123,.45)}
.b-pop{width:262px;display:flex;flex-direction:column;gap:12px}
.b-hero{display:flex;align-items:center;gap:12px}
.b-ring{position:relative;width:48px;height:48px;flex-shrink:0}
.b-ring .ring{position:absolute;inset:0}
.b-ring span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:%(fg)s}
.b-meta{display:flex;flex-direction:column;gap:2px;min-width:0}
.b-k{font-size:11px;line-height:15px;color:%(xmuted)s;font-weight:500;letter-spacing:.04em}
.b-v{font-size:15px;line-height:22px;color:%(fg)s}
.b-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.b-tile{background:%(s2)s;border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;gap:2px}
.b-tile .k{font-size:11px;line-height:15px;color:%(muted)s}
.b-tile .v{font-size:13px;line-height:18px;color:%(fg)s}
.b-tile.wide{grid-column:1 / -1;flex-direction:row;justify-content:space-between;align-items:center}
.b-sep{height:1px;background:%(border)s;margin:0 -12px}
.b-card-head{display:flex;align-items:center;gap:6px}
.b-title{font-size:13px;line-height:18px;font-weight:500}
.badge{font-size:11px;line-height:15px;padding:1px 6px;border-radius:999px;background:%(s3)s;color:%(muted)s}
.b-win{display:flex;align-items:center;gap:10px}
.b-win .txt{flex:1;display:flex;flex-direction:column;min-width:0}
.b-win .pct{font-size:15px;line-height:22px;color:%(fg)s}
.b-row{display:flex;justify-content:space-between;color:%(muted)s}
.b-row .v{color:%(fg)s}
.b-foot{color:%(xmuted)s;font-size:11px;line-height:15px}
""" % T


def b_strip(pid, windows):
    chips = "".join(
        f'<span class="chip{" hot" if w[4] or w[2] > 90 else ""}">{ring(w[2], T[tone(w[2])])}<span>{w[0]}</span>'
        f'<b class="num">{w[2]}%</b>{trailing_short(w)}</span>'
        for w in windows
    )
    return f'<div class="pu">{provider_icon(pid)}{chips}</div>'


def b_context():
    tiles = "".join(
        f'<div class="b-tile"><span class="k">{k}</span><span class="v num">{v}</span></div>' for k, v in SESSION[:4]
    )
    k, v = SESSION[4]
    tiles += f'<div class="b-tile wide"><span class="k">{k}</span><span class="v num">{v}</span></div>'
    return f"""
<div class="b-hero">
  <div class="b-ring">{ring(5.2, T["muted"], 48, 4)}<span class="num">5%</span></div>
  <div class="b-meta"><span class="b-k">上下文窗口</span><span class="b-v num">51.8K / 1.0M</span>
    <span class="dim num">估算成本 $0.52</span></div>
</div>
<div class="b-k">本会话合计</div>
<div class="b-grid">{tiles}</div>"""


def b_card(pid="claude", name="Claude", plan="Max 20x", windows=CLAUDE_OK):
    wins = "".join(
        f"""<div class="b-win">{ring(w[2], T[tone(w[2])], 28, 3)}<div class="txt"><span class="dim">{w[1]}</span>
<span>{trailing_full(w)}</span></div><span class="pct num">{w[2]}%</span></div>"""
        for w in windows
    )
    return f"""
<div class="b-card-head">{provider_icon(pid, 14)}<span class="b-title">{name}</span><span class="badge">{plan}</span>
  <span class="spacer"></span><span class="b-foot">更新于 2 分钟前</span></div>
{wins}
<div class="b-row"><span>Extra usage</span><span class="v">Disabled</span></div>"""


def build_b():
    body = f"""
<div class="board">
  <div class="col">{composers(b_strip)}</div>
  <div class="col">
    <div><div class="cap">上下文弹层 · 桌面（套餐部分已移走）</div><div class="pop b-pop">{b_context()}</div></div>
    <div><div class="cap">悬停窄栏套餐区 → 套餐用量卡片</div><div class="pop b-pop">{b_card()}</div></div>
  </div>
  <div class="col">
    <div><div class="cap">上下文弹层 · 手机（没有窄栏，保留套餐）</div><div class="pop b-pop">{b_context()}<div class="b-sep"></div>{b_card()}</div></div>
  </div>
</div>"""
    return page("B 胶囊组", B_CSS, body)


# =====================================================================
# 方向 C：分段仪表 —— 窄栏是一整块分段控件，带套餐名；弹层是宽版两栏 + 表格式窗口
# =====================================================================
C_CSS = """
.seg{display:flex;align-items:stretch;height:20px;border:1px solid %(borderComposer)s;border-radius:6px;overflow:hidden;flex-shrink:0;
  background:%(s1)s}
.seg>span{display:flex;align-items:center;gap:5px;padding:0 8px}
.seg>span+span{border-left:1px solid %(border)s}
.seg .plan{color:%(muted)s;gap:5px}
.seg b{font-weight:400;color:%(fg)s}
.c-pop{display:flex;flex-direction:column;gap:12px}
.c-two{display:flex;gap:0}
.c-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.c-two>.c-col{flex:1}
.c-two>.c-col+.c-col{border-left:1px solid %(border)s;margin-left:14px;padding-left:14px}
.c-k{font-size:11px;line-height:15px;color:%(xmuted)s;font-weight:500;letter-spacing:.04em}
.c-hero{font-size:24px;line-height:30px;font-weight:300;color:%(fg)s}
.c-hero small{font-size:13px;color:%(muted)s;font-weight:400;margin-left:6px}
.c-bar{height:4px;border-radius:2px;background:%(s3)s;overflow:hidden}
.c-bar i{display:block;height:4px;border-radius:2px}
.c-row{display:flex;justify-content:space-between;gap:12px;color:%(muted)s}
.c-row .v{color:%(fg)s}
.c-card-head{display:flex;align-items:center;gap:6px}
.c-title{font-size:13px;line-height:18px;font-weight:500}
.badge{font-size:11px;line-height:15px;padding:1px 6px;border-radius:999px;background:%(s3)s;color:%(muted)s}
.c-table{display:grid;grid-template-columns:auto 1fr auto auto;column-gap:10px;row-gap:9px;align-items:center}
.c-table .name{color:%(muted)s;white-space:nowrap}
.c-table .pct{color:%(fg)s;text-align:right}
.c-table .rst{text-align:right;white-space:nowrap}
.c-foot{color:%(xmuted)s;font-size:11px;line-height:15px}
.c-sep{height:1px;background:%(border)s;margin:0 -12px}
""" % T


def c_strip(pid, windows):
    plan = "Max 20x" if pid == "claude" else "Pro"
    segs = "".join(
        f'<span>{ring(w[2], T[tone(w[2])])}<span>{w[0]}</span><b class="num">{w[2]}%</b>{trailing_short(w)}</span>'
        for w in windows
    )
    return f'<div class="seg"><span class="plan">{provider_icon(pid)}{plan}</span>{segs}</div>'


def c_context_cols():
    rows = "".join(f'<div class="c-row"><span>{k}</span><span class="v num">{v}</span></div>' for k, v in SESSION)
    left = f"""<div class="c-col"><span class="c-k">上下文窗口</span>
<span class="c-hero num">5%<small>已使用</small></span>
<div class="c-bar"><i style="width:5.2%;background:{T["muted"]}"></i></div>
<div class="c-row"><span>Tokens</span><span class="v num">51.8K / 1.0M</span></div>
<div class="c-row"><span>估算成本</span><span class="v num">$0.52</span></div></div>"""
    right = f'<div class="c-col"><span class="c-k">本会话合计</span>{rows}</div>'
    return left, right


def c_card(pid="claude", name="Claude", plan="Max 20x", windows=CLAUDE_OK):
    cells = "".join(
        f'<span class="name">{w[1]}</span><div class="c-bar"><i style="width:{w[2]}%;background:{T[tone(w[2])]}"></i></div>'
        f'<span class="pct num">{w[2]}%</span><span class="rst">{trailing_full(w)}</span>'
        for w in windows
    )
    return f"""
<div class="c-card-head">{provider_icon(pid, 14)}<span class="c-title">{name}</span><span class="badge">{plan}</span>
  <span class="spacer"></span><span class="c-foot">更新于 2 分钟前</span></div>
<div class="c-table">{cells}</div>
<div class="c-row"><span>Extra usage</span><span class="v">Disabled</span></div>"""


def build_c():
    left, right = c_context_cols()
    body = f"""
<div class="board">
  <div class="col">{composers(c_strip, 616)}</div>
  <div class="col" style="width:580px">
    <div><div class="cap">上下文弹层 · 桌面（宽版两栏，套餐部分已移走）</div>
      <div class="pop c-pop" style="width:440px"><div class="c-two">{left}{right}</div></div></div>
    <div style="display:flex;gap:28px;align-items:flex-start">
      <div><div class="cap">悬停窄栏 → 套餐用量卡片</div><div class="pop c-pop" style="width:300px">{c_card()}</div></div>
    </div>
    <div><div class="cap">上下文弹层 · 手机（单栏叠放，保留套餐）</div>
      <div class="pop c-pop" style="width:300px">{left}<div class="c-sep"></div>
      {right}<div class="c-sep"></div>{c_card()}</div></div>
  </div>
</div>"""
    return page("C 分段仪表", C_CSS, body)


if __name__ == "__main__":
    for name, fn in (("a", build_a), ("b", build_b), ("c", build_c)):
        (HERE / f"{name}.html").write_text(fn())
    print("ok")
