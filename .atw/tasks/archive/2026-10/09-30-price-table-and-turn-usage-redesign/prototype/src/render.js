// PROTOTYPE — 一次性原型，只回答「价格表与每轮用量面板应该长什么样」。不进仓库主线。
// 用法：?s=<画面>&t=light|dark&bare=1（原尺寸截图）；← → 切画面

// ───────── 画面清单 ─────────
const FRAMES = {
  settings: { w: 1440, h: 900, kind: "settings" },
  phone: { w: 390, h: 844, kind: "settings", phone: true },
  chat: { w: 1100, h: 560, kind: "chat" },
  chatPhone: { w: 390, h: 700, kind: "chat", phone: true },
};
const SCREENS = [
  { id: "P0", group: "价格表 · 现状", label: "现状", frame: "settings", v: "cur", note: "现在的实现：一张 7 列定宽表，横向滚动；无价格的行一进来就是 4 个 70 宽的输入框（可用文字宽 44）。" },
  { id: "PM0", group: "价格表 · 现状", label: "现状 · 手机", frame: "phone", v: "cur" },

  { id: "A1", group: "价格表 · 方案一 对齐表格", label: "默认", frame: "settings", v: "A" },
  { id: "A2", group: "价格表 · 方案一 对齐表格", label: "LiteLLM 展开 + 搜索", frame: "settings", v: "A", set: { liteOpen: true, query: "claude", forceHover: "claude-sonnet-4-5" } },
  { id: "A3", group: "价格表 · 方案一 对齐表格", label: "编辑已有 + 出错", frame: "settings", v: "A", set: { edit: ["deepseek-v3.2-exp"], errors: { "qwen3-coder-plus": "四列都要填数字。" }, drafts: { "qwen3-coder-plus": { input: "0.8", cachedInput: "", cacheWrite: "", output: "3.2" } } } },
  { id: "A4", group: "价格表 · 方案一 对齐表格", label: "自定义组为空", frame: "settings", v: "A", set: { allPriced: true } },
  { id: "AM", group: "价格表 · 方案一 对齐表格", label: "手机", frame: "phone", v: "A" },

  { id: "B1", group: "价格表 · 方案二 卡片", label: "默认", frame: "settings", v: "B" },
  { id: "B2", group: "价格表 · 方案二 卡片", label: "LiteLLM 展开 + 搜索", frame: "settings", v: "B", set: { liteOpen: true, query: "claude", forceHover: "claude-sonnet-4-5" } },
  { id: "B3", group: "价格表 · 方案二 卡片", label: "编辑已有 + 出错", frame: "settings", v: "B", set: { edit: ["deepseek-v3.2-exp"], errors: { "qwen3-coder-plus": "四列都要填数字。" }, drafts: { "qwen3-coder-plus": { input: "0.8", cachedInput: "", cacheWrite: "", output: "3.2" } } } },
  { id: "B4", group: "价格表 · 方案二 卡片", label: "自定义组为空", frame: "settings", v: "B", set: { allPriced: true } },
  { id: "BM", group: "价格表 · 方案二 卡片", label: "手机", frame: "phone", v: "B" },

  { id: "T0", group: "用量面板 · 现状", label: "两个模型", frame: "chat", v: "cur", turn: "multi", note: "现状 1:1 复刻：外框 max-width 280（含 padding 与边框），内层 min-width 280，内容向右溢出 18px；定位按外框 280 居中。" },
  { id: "T0b", group: "用量面板 · 现状", label: "单模型带推理", frame: "chat", v: "cur", turn: "single", note: "输出格拼上「（1.9K 推理）」后只撑宽这一行，表头与数据行的列对不上。" },

  { id: "U1", group: "用量面板 · 方案一 总览+明细", label: "两个模型", frame: "chat", v: "ov", turn: "multi" },
  { id: "U2", group: "用量面板 · 方案一 总览+明细", label: "单模型带推理", frame: "chat", v: "ov", turn: "single" },
  { id: "U3", group: "用量面板 · 方案一 总览+明细", label: "含无价格模型", frame: "chat", v: "ov", turn: "unpriced" },
  { id: "UM", group: "用量面板 · 方案一 总览+明细", label: "手机点按", frame: "chatPhone", v: "ov", turn: "multi" },

  { id: "V1", group: "用量面板 · 方案二 精修表格", label: "两个模型", frame: "chat", v: "tb", turn: "multi" },
  { id: "V2", group: "用量面板 · 方案二 精修表格", label: "单模型带推理", frame: "chat", v: "tb", turn: "single" },
  { id: "V3", group: "用量面板 · 方案二 精修表格", label: "含无价格模型", frame: "chat", v: "tb", turn: "unpriced" },
  { id: "VM", group: "用量面板 · 方案二 精修表格", label: "手机点按", frame: "chatPhone", v: "tb", turn: "multi", note: "窄屏（<720）隐藏「缓存」「推理」两列，推理并入输出格的小字。" },
];

const params = new URLSearchParams(location.search);
const S = {
  screen: params.get("s") || "A1",
  theme: params.get("t") || "light",
  bare: params.get("bare") === "1",
  tipOpen: true,
};

// ───────── 价格表状态 ─────────
const P = {};
function resetPrice(set = {}) {
  P.models = PRICE_MODELS_INITIAL.map((m) => ({ ...m, origin: m.priceSource, price: m.price && { ...m.price } }));
  if (set.allPriced) {
    P.models = P.models.filter((m) => m.priceSource === "table");
  }
  P.drafts = {};
  P.editing = new Set(set.edit || []);
  P.errors = { ...(set.errors || {}) };
  P.liteOpen = !!set.liteOpen;
  P.query = set.query || "";
  P.forceHover = set.forceHover || null;
  P.pinned = new Set(); // 从 LiteLLM 组点「自定义」后临时进入自定义组的模型
  for (const [m, d] of Object.entries(set.drafts || {})) P.drafts[m] = { ...d };
  for (const m of P.editing) {
    const row = P.models.find((x) => x.model === m);
    if (row && !P.drafts[m]) P.drafts[m] = draftOf(row.price);
  }
}
function applyScreen(id) {
  const sc = SCREENS.find((x) => x.id === id) || SCREENS[0];
  S.screen = sc.id;
  S.tipOpen = true;
  resetPrice(sc.set || {});
}
const screen = () => SCREENS.find((x) => x.id === S.screen) || SCREENS[0];

// ───────── 小工具 ─────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function icon(name, size = 16, extra = "") {
  const svg = ICONS[name];
  if (!svg) return `<span style="width:${size}px;height:${size}px;display:inline-block"></span>`;
  return svg.replace("<svg", `<svg width="${size}" height="${size}" ${extra}`);
}
function fmtPrice(v) {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  const t = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return t === "0" ? "<0.000001" : t;
}
function draftOf(price) {
  const d = {};
  for (const f of PRICE_FIELDS) d[f.field] = price ? fmtPrice(price[f.field]) : "";
  return d;
}
function parseDraft(d) {
  const out = {};
  for (const f of PRICE_FIELDS) {
    const t = (d?.[f.field] ?? "").trim();
    const v = Number(t);
    if (t === "" || !Number.isFinite(v) || v < 0) return null;
    out[f.field] = v;
  }
  return out;
}
const tok = (v) => {
  const r = Math.round(v);
  if (Math.abs(r) >= 1e9) return (r / 1e9).toFixed(1) + "B";
  if (Math.abs(r) >= 1e6) return (r / 1e6).toFixed(1) + "M";
  if (Math.abs(r) >= 1e3) return (r / 1e3).toFixed(1) + "K";
  return String(r);
};
const cost = (v) => (!Number.isFinite(v) || v <= 0 ? "$0.00" : v < 0.01 ? "$" + v.toFixed(4) : "$" + v.toFixed(2));
function dur(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return r ? `${m}m ${r}s` : `${m}m`;
}
const sw = (on, act) => `<div class="sw-wrap" data-act="${act}"><div class="sw ${on ? "on" : ""}"><i></i></div></div>`;

// 分组：自定义组 = 无价格 + 自定义价 + 临时从 LiteLLM 拉进来编辑的
function isCustomGroup(m) {
  return m.priceSource !== "table" || P.pinned.has(m.model);
}
function customRows() {
  const rows = P.models.filter(isCustomGroup);
  // 无价格在前，自定义在后
  return rows.sort((a, b) => (a.priceSource === null ? 0 : 1) - (b.priceSource === null ? 0 : 1));
}
function liteRows() {
  const q = P.query.trim().toLowerCase();
  return P.models.filter((m) => !isCustomGroup(m) && (!q || m.model.toLowerCase().includes(q)));
}
const liteTotal = () => P.models.filter((m) => !isCustomGroup(m)).length;
const isEditing = (m) => m.priceSource === null || P.editing.has(m.model);

// ───────── 设置页外壳（沿用上一个原型的 1:1 取值） ─────────
const APP_ITEMS = [
  ["settings", "通用"], ["palette", "外观"], ["panels-top-left", "Layout"], ["code-xml", "编辑器"], ["keyboard", "快捷键"],
  ["puzzle", "集成"], ["bell", "通知"], ["shield", "权限"], ["stethoscope", "诊断"], ["info", "关于"],
];
const HOST_ITEMS = [
  ["server", "概览"], ["folder-git-2", "项目"], ["network", "连接"], ["smartphone", "配对设备"], ["bot", "Agents"],
  ["sparkles", "元数据"], ["folder-git-2", "Workspaces"], ["boxes", "Providers"], ["gauge", "价格表"], ["square-terminal", "Terminals"], ["blocks", "插件"],
];
function settingsSidebar() {
  const item = ([ic, label], sel) =>
    `<div class="snav-item ${sel ? "sel" : ""}">${icon(ic, 16)}<span class="ellipsis">${label}</span></div>`;
  return `<nav class="snav">
    <div class="snav-chrome"><div class="traffic"><i></i><i></i><i></i></div></div>
    <div class="snav-back"><div class="rowmd">${icon("arrow-left", 14)}<span>返回</span></div></div>
    <div class="snav-scroll no-scrollbar">
      <div class="snav-list"><div class="snav-label">应用</div>${APP_ITEMS.map((x) => item(x, false)).join("")}</div>
      <div class="snav-list"><div class="snav-label">主机</div>
        <div class="snav-item snav-host"><span class="hdot"><i></i></span><span class="ellipsis">oxydeMacBook-Pro.local</span><span class="chev">${icon("chevron-down", 14)}</span></div>
        ${HOST_ITEMS.map((x) => item(x, x[1] === "价格表")).join("")}
      </div>
    </div>
  </nav>`;
}
function section({ title, count, trail = "", body, toggle, open, sub }) {
  const chev = toggle ? `<span class="chev-ic ${open ? "open" : ""}">${icon("chevron-right", 14)}</span>` : "";
  return `<section class="sec">
    <div class="sec-h"><div class="sec-title ${toggle ? "tog" : ""}" ${toggle ? `data-act="${toggle}"` : ""}>${chev}${title}${count != null ? `<span class="sec-count">${count}</span>` : ""}</div>${trail ? `<div class="sec-trail">${trail}</div>` : ""}</div>
    ${sub ? `<div class="sec-sub">${sub}</div>` : ""}
    <div class="sec-c">${body}</div>
  </section>`;
}
const LITE_SUB = "LiteLLM 快照，3 小时前更新 · 每百万 token 美元";
const liteControls = () =>
  `<div class="ctl"><span class="lbl">自动更新</span>${sw(true, "noop")}<button class="btn ghost" data-act="noop">${icon("refresh-cw", 14)}<span>立即刷新</span></button></div>`;

// ═════════ 现状价格表 ═════════
function currentPriceTable() {
  const controls = liteControls();
  const rows = PRICE_MODELS_INITIAL.map((m) => {
    const priced = m.priceSource !== null;
    const cells = PRICE_FIELDS.map((f) =>
      priced
        ? `<span class="c-price">${fmtPrice(m.price[f.field])}</span>`
        : `<span class="c-price"><div class="input" style="padding:3px 12px"><input value="" /></div></span>`,
    ).join("");
    const source = m.priceSource === "table" ? "LiteLLM" : m.priceSource === "override" ? "自定义" : "—";
    const act = priced
      ? `<button class="btn ghost">自定义价格</button>`
      : `<button class="btn default">保存</button>`;
    return `<div class="cur-block"><div class="cur-row">
      <div class="c-model"><span class="id">${esc(m.model)}</span>${priced ? "" : `<span class="badge warning cur-badge">无价格数据 · 估算 $0</span>`}</div>
      ${cells}<span class="c-source">${source}</span><div class="c-actions">${act}</div></div>
      <div class="cur-rowerr"></div></div>`;
  }).join("");
  const body = `<div class="card" style="overflow:hidden">
    <div class="cur-sub">每百万 token 美元 · LiteLLM 快照，3 小时前更新，${PRICE_MODELS_INITIAL.length} 个模型</div>
    <div class="cur-err" style="border:0"></div>
    <div class="cur-scroll scroll" style="border:0"><div class="cur-table">
      <div class="cur-hrow"><span class="c-model">模型</span>${PRICE_FIELDS.map((f) => `<span class="c-price">${f.label}</span>`).join("")}<span class="c-source">来源</span><span class="c-actions">操作</span></div>
      ${rows}
    </div></div>
  </div>`;
  return section({ title: "价格表", trail: controls, body });
}

// ═════════ 方案一：对齐表格 ═════════
function priceInput(m, f) {
  const d = P.drafts[m.model] || draftOf(null);
  const bad = P.errors[m.model] && (d[f.field] ?? "").trim() === "";
  return `<label class="pin ${bad ? "bad" : ""}"><span class="cur">$</span><input inputmode="decimal" placeholder="0.00" value="${esc(d[f.field] ?? "")}" data-draft="${esc(m.model)}" data-field="${f.field}" aria-label="${esc(m.model)} ${f.label}" /></label>`;
}
function statusLine(m) {
  if (P.errors[m.model]) return `<div class="st-line2 err">${icon("circle-alert", 12)}<span class="ellipsis">${esc(P.errors[m.model])}</span></div>`;
  if (m.priceSource === null) return `<div class="st-line2"><span class="dot amber"></span><span class="ellipsis">未定价 · 目前按 $0 估算</span></div>`;
  if (P.pinned.has(m.model) && m.priceSource === "table") return `<div class="st-line2"><span class="dot muted"></span><span class="ellipsis">正在覆盖 LiteLLM 价格</span></div>`;
  return `<div class="st-line2"><span class="dot accent"></span><span class="ellipsis">自定义价格${m.origin === "table" ? " · 覆盖 LiteLLM" : ""}</span></div>`;
}
function variantA() {
  const phone = FRAMES[screen().frame].phone;
  const rows = customRows();
  let customBody;
  if (rows.length === 0) {
    customBody = `<div class="card"><div class="ta-empty"><span class="ok">${icon("circle-check", 16)}</span><span>所有模型都有价格。LiteLLM 查不到价格的模型出现时，会列在这里等你填写。</span></div></div>`;
  } else {
    const head = `<div class="ta-grid ta-head"><span>模型</span>${PRICE_FIELDS.map((f) => `<span class="r">${f.label}</span>`).join("")}<span></span></div>`;
    const body = rows
      .map((m) => {
        const editing = isEditing(m);
        const cells = PRICE_FIELDS.map((f) =>
          editing ? priceInput(m, f) : `<span class="ta-val ${m.price[f.field] === 0 ? "zero" : ""}">${fmtPrice(m.price[f.field])}</span>`,
        ).join("");
        let act;
        if (editing) {
          const cancel = m.priceSource !== null ? `<button class="btn ghost" data-act="cancel" data-m="${esc(m.model)}">取消</button>` : "";
          act = `${cancel}<button class="btn default" data-act="save" data-m="${esc(m.model)}">保存</button>`;
        } else {
          act = `<button class="btn ghost square" title="编辑" data-act="edit" data-m="${esc(m.model)}">${icon("pencil", 14)}</button><button class="btn ghost square" title="移除自定义价格" data-act="remove" data-m="${esc(m.model)}">${icon("undo-2", 14)}</button>`;
        }
        return `<div class="ta-grid ta-row ${m.priceSource === null ? "hl" : ""}">
          <div class="ta-model"><span class="id ellipsis">${esc(m.model)}</span>${statusLine(m)}</div>
          ${cells}<div class="ta-act">${act}</div></div>`;
      })
      .join("");
    customBody = `<div class="card"><div class="ta-intro" style="border:0">LiteLLM 查不到价格的模型列在这里。按每百万 token 美元填写四列，0 表示免费。</div>${head}${body}</div>`;
  }
  const pending = rows.filter((m) => m.priceSource === null).length;
  const s1 = section({ title: "自定义价格", count: rows.length || null, body: customBody, trail: pending ? `<span class="pill warn"><span class="dot amber"></span>${pending} 个待填写</span>` : "" });

  const total = liteTotal();
  let liteBody;
  if (!P.liteOpen) {
    liteBody = `<div class="card"><div class="lt-toggle" data-act="lite"><span>${icon("chevron-right", 14)}</span><span class="grow">${total} 个模型由 LiteLLM 定价</span><span>展开</span></div></div>`;
  } else {
    const list = liteRows();
    const head = `<div class="ta-grid lt-grid ta-head" style="border-top:1px solid var(--row-border)"><span>模型</span>${phone ? "" : PRICE_FIELDS.map((f) => `<span class="r">${f.label}</span>`).join("")}<span></span></div>`;
    const rowsHtml = list.length
      ? list
          .map((m) => {
            const vals = phone
              ? ""
              : PRICE_FIELDS.map((f) => `<span class="ta-val ${m.price[f.field] === 0 ? "zero" : ""}">${fmtPrice(m.price[f.field])}</span>`).join("");
            const phoneVals = phone
              ? `<div class="st-line2 tnum">${PRICE_FIELDS.map((f) => `<span>${f.short} ${fmtPrice(m.price[f.field])}</span>`).join("<span>·</span>")}</div>`
              : "";
            return `<div class="ta-grid lt-grid lt-row ${P.forceHover === m.model ? "force" : ""}"><div class="ta-model"><span class="id ellipsis">${esc(m.model)}</span>${phoneVals}</div>${vals}<div class="ta-act"><button class="btn ghost xs hover-only" data-act="custom" data-m="${esc(m.model)}">自定义</button></div></div>`;
          })
          .join("")
      : `<div class="lt-none">没有名称包含「${esc(P.query)}」的模型。</div>`;
    liteBody = `<div class="card">
      <div class="lt-toggle" data-act="lite"><span style="display:flex;transform:rotate(90deg)">${icon("chevron-right", 14)}</span><span class="grow">${total} 个模型由 LiteLLM 定价</span><span>收起</span></div>
      <div class="lt-search">${icon("search", 14)}<input placeholder="搜索模型" value="${esc(P.query)}" data-act-input="query" /></div>
      ${head}${rowsHtml}</div>`;
  }
  const s2 = section({ title: "LiteLLM 价格", count: total, trail: phone ? "" : liteControls(), body: liteBody, sub: LITE_SUB });
  const phoneCtl = phone ? `<div class="card" style="margin-bottom:24px"><div class="row" style="min-height:48px"><span class="row-title">自动更新 LiteLLM 价格</span>${sw(true, "noop")}</div><div class="row" style="min-height:48px"><span class="row-title">立即刷新</span><button class="btn ghost square">${icon("refresh-cw", 14)}</button></div></div>` : "";
  return s1 + s2 + phoneCtl;
}

// ═════════ 方案二：卡片 ═════════
function variantB() {
  const phone = FRAMES[screen().frame].phone;
  const rows = customRows();
  let customBody;
  if (rows.length === 0) {
    customBody = `<div class="card"><div class="cb-empty"><span class="ok">${icon("check", 16)}</span><div class="t1">所有模型都有价格</div><div class="t2">LiteLLM 查不到价格的模型出现时，会在这里等你填写。</div></div></div>`;
  } else {
    customBody = `<div class="cb-list">${rows
      .map((m) => {
        const editing = isEditing(m);
        const pill =
          m.priceSource === null
            ? `<span class="pill warn"><span class="dot amber"></span>待定价</span>`
            : P.pinned.has(m.model) && m.priceSource === "table"
              ? `<span class="pill neutral">LiteLLM</span>`
              : `<span class="pill accent">自定义${m.origin === "table" ? " · 覆盖 LiteLLM" : ""}</span>`;
        const headActs = editing
          ? ""
          : `<button class="btn ghost square" title="编辑" data-act="edit" data-m="${esc(m.model)}">${icon("pencil", 14)}</button><button class="btn ghost" data-act="remove" data-m="${esc(m.model)}">${icon("undo-2", 14)}<span>移除</span></button>`;
        const fields = PRICE_FIELDS.map((f) => {
          const inner = editing
            ? priceInput(m, f).replace("</label>", `<span class="unit">/M</span></label>`)
            : `<div class="cb-read"><span class="cur">$</span>${fmtPrice(m.price[f.field])}<span class="unit">/M</span></div>`;
          return `<div class="cb-field"><label>${f.label}</label>${inner}</div>`;
        }).join("");
        const err = P.errors[m.model];
        const hint = err
          ? `<div class="hint err">${esc(err)}</div>`
          : `<div class="hint">${m.priceSource === null ? "保存前这个模型的用量按 $0 估算。四项都要填，0 表示免费。" : "四项都要填，0 表示免费。"}</div>`;
        const foot = editing
          ? `<div class="cb-foot">${hint}${m.priceSource !== null ? `<button class="btn ghost" data-act="cancel" data-m="${esc(m.model)}">取消</button>` : ""}<button class="btn default" data-act="save" data-m="${esc(m.model)}">保存价格</button></div>`
          : "";
        return `<div class="cb ${m.priceSource === null ? "pending" : ""}">
          <div class="cb-head"><span class="id ellipsis">${esc(m.model)}</span>${pill}<span class="grow"></span>${headActs}</div>
          <div class="cb-fields">${fields}</div>${foot}</div>`;
      })
      .join("")}</div>`;
  }
  const s1 = section({ title: "自定义价格", count: rows.length || null, body: customBody, sub: rows.length ? "LiteLLM 查不到价格的模型需要你来定价，单位是每百万 token 美元。" : "" });

  const total = liteTotal();
  let liteBody;
  if (!P.liteOpen) {
    liteBody = `<div class="card"><div class="lt-toggle" data-act="lite"><span>${icon("chevron-right", 14)}</span><span class="grow">${total} 个模型由 LiteLLM 定价</span><span>展开</span></div></div>`;
  } else {
    const list = liteRows();
    const rowsHtml = list.length
      ? list
          .map(
            (m) => `<div class="cl-row ${P.forceHover === m.model ? "force" : ""}"><span class="id ellipsis">${esc(m.model)}</span>
            <span class="cl-prices">${PRICE_FIELDS.map((f) => `<span><span class="k">${f.label}</span><span class="${m.price[f.field] === 0 ? "z" : ""}">${fmtPrice(m.price[f.field])}</span></span>`).join("")}</span>
            <button class="btn ghost xs hover-only" ${P.forceHover === m.model ? 'style="opacity:1"' : ""} data-act="custom" data-m="${esc(m.model)}">自定义</button></div>`,
          )
          .join("")
      : `<div class="lt-none">没有名称包含「${esc(P.query)}」的模型。</div>`;
    liteBody = `<div class="card">
      <div class="lt-toggle" data-act="lite"><span style="display:flex;transform:rotate(90deg)">${icon("chevron-right", 14)}</span><span class="grow">${total} 个模型由 LiteLLM 定价</span><span>收起</span></div>
      <div class="lt-search">${icon("search", 14)}<input placeholder="搜索模型" value="${esc(P.query)}" data-act-input="query" /></div>
      ${rowsHtml}</div>`;
  }
  const s2 = section({ title: "LiteLLM 价格", count: total, trail: phone ? "" : liteControls(), body: liteBody, sub: LITE_SUB });
  const phoneCtl = phone ? `<div class="card" style="margin-bottom:24px"><div class="row" style="min-height:48px"><span class="row-title">自动更新 LiteLLM 价格</span>${sw(true, "noop")}</div><div class="row" style="min-height:48px"><span class="row-title">立即刷新</span><button class="btn ghost square">${icon("refresh-cw", 14)}</button></div></div>` : "";
  return s1 + s2 + phoneCtl;
}

function settingsFrame() {
  const sc = screen();
  const f = FRAMES[sc.frame];
  const content = sc.v === "cur" ? currentPriceTable() : sc.v === "A" ? variantA() : variantB();
  if (f.phone) {
    return `<div class="app" style="flex-direction:column">
      <div class="bhdr"><span class="back">${icon("arrow-left", 20)}</span><span class="btitle">价格表</span></div>
      <div class="pscroll scroll"><div class="column" style="padding-top:8px">${content}</div></div></div>`;
  }
  return `<div class="app">${settingsSidebar()}<div class="pane">
    <div class="shdr"><div class="hbadge">${icon("gauge", 16)}</div><span class="stitle">价格表</span></div>
    <div class="pscroll scroll"><div class="column">${content}</div></div></div></div>`;
}

// ═════════ 每轮用量面板 ═════════
function totalsOf(turn) {
  const t = { input: 0, cache: 0, output: 0, reasoning: 0, cost: 0, priced: true };
  for (const r of turn.rows) {
    t.input += r.input; t.cache += r.cache; t.output += r.output; t.reasoning += r.reasoning; t.cost += r.cost;
    t.priced = t.priced && r.priced;
  }
  return t;
}
function tipCurrent(turn) {
  const t = totalsOf(turn);
  const cells = (a, cls = "") => {
    const out = a.reasoning > 0 ? `${tok(a.output)} （${tok(a.reasoning)} 推理）` : tok(a.output);
    return `<span class="n ${cls}">${tok(a.input)}</span><span class="n ${cls}">${tok(a.cache)}</span><span class="n ${cls}">${out}</span><span class="n ${cls}">${cost(a.cost)}</span>`;
  };
  const rows = turn.rows
    .map((r) => `<div class="r"><div class="m"><span class="nm">${esc(r.model)}</span>${r.priced ? "" : `<span class="amber">无价格数据</span>`}</div>${cells(r)}</div>`)
    .join("");
  const total = turn.rows.length >= 2 ? `<div class="r"><span class="m tot">合计</span>${cells(t, "tot")}</div>` : "";
  return `<div class="tip cur" data-tip><div class="tc">
    <div class="title">本轮用量</div>
    <div class="r"><span class="m h">模型</span><span class="n h">输入</span><span class="n h">缓存</span><span class="n h">输出</span><span class="n h">估算成本</span></div>
    ${rows}${total}
    <div class="dur"><span class="h" style="color:var(--muted)">耗时</span><span class="tnum">${dur(turn.durationMs)}</span></div>
    <div class="note">估算成本 · 按公开 API 价格计算</div></div></div>`;
}
function tipOverview(turn) {
  const t = totalsOf(turn);
  const stats = [["输入", tok(t.input)], ["缓存", tok(t.cache)], ["输出", tok(t.output)]];
  if (t.reasoning > 0) stats.push(["其中推理", tok(t.reasoning)]);
  const unpriced = turn.rows.filter((r) => !r.priced);
  let models;
  if (turn.rows.length === 1) {
    const r = turn.rows[0];
    models = `<div class="ov-sep"></div><div class="ov-single"><span class="k">模型</span><span class="ellipsis">${esc(r.model)}</span></div>`;
  } else {
    models = `<div class="ov-sep"></div><div class="ov-models"><div class="ov-mh">按模型</div>${turn.rows
      .map(
        (r) => `<div class="ov-m"><div class="l1"><span class="nm">${esc(r.model)}</span><span class="c ${r.priced ? "" : "none"}">${r.priced ? cost(r.cost) : "无价格"}</span></div>
        <div class="l2">↑${tok(r.input)} · 缓存 ${tok(r.cache)} · ↓${tok(r.output)}${r.reasoning ? `（推理 ${tok(r.reasoning)}）` : ""}</div></div>`,
      )
      .join("")}</div>`;
  }
  const warn = unpriced.length
    ? `<div class="warn"><span class="dot amber"></span><span>${unpriced.map((r) => esc(r.model)).join("、")} 没有价格数据，按 $0 计入。可在 设置 › 价格表 自定义。</span></div>`
    : "";
  return `<div class="tip ov" data-tip>
    <div class="ov-top">
      <div class="ov-h"><span>本轮用量</span><span class="dur">${icon("clock", 12)}${dur(turn.durationMs)}</span></div>
      <div class="ov-cost"><span class="v ${t.priced ? "" : "unp"}">${cost(t.cost)}</span><span class="k">估算成本</span></div>
      <div class="ov-stats">${stats.map(([k, v]) => `<div class="ov-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
    </div>
    ${models}
    <div class="ov-sep"></div>
    <div class="ov-foot">${warn}<span>估算成本 · 按公开 API 价格计算</span></div>
  </div>`;
}
function tipTable(turn, phone) {
  const t = totalsOf(turn);
  const showCache = !phone;
  const showReason = !phone && t.reasoning > 0;
  const cols = [phone ? "minmax(0, 1fr)" : "max-content", "auto"];
  if (showCache) cols.push("auto");
  cols.push("auto");
  if (showReason) cols.push("auto");
  cols.push("auto");
  const out = (a) => (phone && a.reasoning > 0 ? `${tok(a.output)}<span class="rz">（推理 ${tok(a.reasoning)}）</span>` : tok(a.output));
  const line = (name, a, cls = "", extra = "") => {
    const c = [`<span class="nm ${cls}">${name}${extra}</span>`, `<span class="num ${cls}">${tok(a.input)}</span>`];
    if (showCache) c.push(`<span class="num ${cls}">${tok(a.cache)}</span>`);
    c.push(`<span class="num ${cls}">${out(a)}</span>`);
    if (showReason) c.push(`<span class="num ${cls} ${cls ? "" : "rz"}">${a.reasoning ? tok(a.reasoning) : "—"}</span>`);
    c.push(`<span class="num ${cls} ${a.priced === false ? "none" : ""}">${a.priced === false ? "—" : cost(a.cost)}</span>`);
    return c.join("");
  };
  const hd = ["模型", "输入"];
  if (showCache) hd.push("缓存");
  hd.push("输出");
  if (showReason) hd.push("推理");
  hd.push("估算成本");
  const header = hd.map((h, i) => `<span class="hd ${i ? "num" : ""}">${h}</span>`).join("");
  const rows = turn.rows.map((r) => line(`<span>${esc(r.model)}</span>`, r, "", r.priced ? "" : `<span class="pill warn">无价格</span>`)).join("");
  const total = turn.rows.length >= 2 ? line("合计", t, "tt") : "";
  const unpriced = turn.rows.filter((r) => !r.priced);
  const warn = unpriced.length ? `<span class="warn">${unpriced.map((r) => esc(r.model)).join("、")} 没有价格数据，按 $0 计入。</span>` : "";
  return `<div class="tip tb" data-tip>
    <div class="tb-h"><span class="t">本轮用量</span><span class="d">耗时 ${dur(turn.durationMs)}</span></div>
    <div class="tb-g" style="grid-template-columns:${cols.join(" ")}">${header}${rows}${total}</div>
    <div class="tb-note">估算成本 · 按公开 API 价格计算${warn}</div>
  </div>`;
}
function chatFrame() {
  const sc = screen();
  const f = FRAMES[sc.frame];
  const turn = TURNS[sc.turn];
  const t = totalsOf(turn);
  const tip = !S.tipOpen ? "" : sc.v === "cur" ? tipCurrent(turn) : sc.v === "ov" ? tipOverview(turn) : tipTable(turn, f.phone);
  const segText = `· ↑${tok(t.input)} ↓${tok(t.output)} · `;
  return `<div class="chat">
    <div class="chat-top">${icon("message-square", 14)}<span>整理价格表的列宽</span></div>
    <div class="stream">
      <div class="umsg"><div class="bubble">把价格表的输入框对齐一下，顺便看看悬浮面板为什么是歪的。</div></div>
      <div class="amsg">
        <p>已经看过了。面板外框默认 <code>maxWidth</code> 是 280，内层又要求 <code>minWidth: 280</code>，再加上外框的内边距，内容会溢出边框。</p>
        <p>另外，带推理 token 的行把「（N 推理）」拼进了输出列，这一列只在那一行变宽，所以各行的列对不齐。</p>
      </div>
      <div class="tfoot">
        <span class="ic">${icon("copy", 14)}</span><span class="ic">${icon("split", 14)}</span>
        <span class="worked">已工作 ${dur(turn.durationMs)}</span>
        <span class="seg-wrap"><span class="useg ${S.tipOpen ? "on" : ""}" data-act="tip">${segText}<span class="${t.priced ? "" : "unp"}">${cost(t.cost)}</span></span>${tip}</span>
      </div>
    </div>
  </div>`;
}

// 浮层定位：与 tooltip.tsx 相同——在触发器上方 offset 8，水平居中，夹紧到窗口内 8px
function placeTip() {
  const frame = document.querySelector(".frame");
  const tipEl = document.querySelector("[data-tip]");
  const seg = document.querySelector(".useg");
  if (!frame || !tipEl || !seg) return;
  const scale = frame.getBoundingClientRect().width / frame.offsetWidth || 1;
  const fr = frame.getBoundingClientRect();
  const sr = seg.getBoundingClientRect();
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  const segX = (sr.left - fr.left) / scale, segY = (sr.top - fr.top) / scale, segW = sr.width / scale;
  let x = segX + (segW - tw) / 2;
  let y = segY - th - 8;
  x = Math.max(8, Math.min(frame.offsetWidth - tw - 8, x));
  y = Math.max(8, y);
  // tip 挂在 seg-wrap 里，换算成相对 seg-wrap 的坐标
  const wrap = tipEl.parentElement.getBoundingClientRect();
  tipEl.style.left = x - (wrap.left - fr.left) / scale + "px";
  tipEl.style.top = y - (wrap.top - fr.top) / scale + "px";
}

// ───────── 外壳 ─────────
function protoBar() {
  const groups = [];
  for (const sc of SCREENS) {
    let g = groups.find((x) => x.name === sc.group);
    if (!g) groups.push((g = { name: sc.group, items: [] }));
    g.items.push(sc);
  }
  return `<div class="proto-bar">
    ${groups.map((g) => `<div class="grp"><span class="grp-label">${g.name}</span>${g.items.map((sc) => `<button class="${sc.id === S.screen ? "on" : ""}" data-screen="${sc.id}">${sc.label}</button>`).join("")}</div>`).join('<span class="sep"></span>')}
    <span class="sep"></span>
    <div class="grp"><span class="grp-label">主题</span><button class="${S.theme === "light" ? "on" : ""}" data-theme="light">亮</button><button class="${S.theme === "dark" ? "on" : ""}" data-theme="dark">暗</button></div>
    <div class="grp"><span class="grp-label">← → 切换画面</span></div>
  </div>`;
}
function render() {
  const sc = screen();
  const f = FRAMES[sc.frame];
  document.body.className = `proto ${S.bare ? "bare" : ""} ${S.theme === "dark" ? "page-dark" : ""}`;
  const inner = f.kind === "settings" ? settingsFrame() : chatFrame();
  const cap = `${sc.group} · ${sc.label}　${f.w}×${f.h}`;
  const root = document.getElementById("root");
  root.innerHTML = `${S.bare ? "" : protoBar()}<div class="proto-stage">
    ${S.bare ? "" : `<div class="proto-caption">${esc(cap)}</div>`}
    ${!S.bare && sc.note ? `<div class="proto-note">${esc(sc.note)}</div>` : ""}
    <div class="frame-holder"><div class="frame-shadow ${f.phone ? "phone" : ""}"><div class="frame theme-${S.theme} ${f.phone ? "phone" : ""}" style="width:${f.w}px;height:${f.h}px">${inner}</div></div></div>
  </div>`;
  fit();
  placeTip();
  const url = new URL(location.href);
  url.searchParams.set("s", S.screen);
  url.searchParams.set("t", S.theme);
  history.replaceState(null, "", url);
}
function fit() {
  if (S.bare) return;
  const holder = document.querySelector(".frame-holder");
  const frame = document.querySelector(".frame");
  const f = FRAMES[screen().frame];
  const avail = window.innerWidth - 48;
  const k = Math.min(1, avail / f.w);
  frame.style.transform = k < 1 ? `scale(${k})` : "";
  holder.style.width = f.w * k + "px";
  holder.style.height = f.h * k + "px";
}

// ───────── 交互 ─────────
document.addEventListener("click", (e) => {
  const scBtn = e.target.closest("[data-screen]");
  if (scBtn) { applyScreen(scBtn.dataset.screen); return render(); }
  const th = e.target.closest("[data-theme]");
  if (th) { S.theme = th.dataset.theme; return render(); }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const m = a.dataset.m;
  const row = m && P.models.find((x) => x.model === m);
  switch (a.dataset.act) {
    case "lite": P.liteOpen = !P.liteOpen; break;
    case "tip": S.tipOpen = !S.tipOpen; break;
    case "edit": P.editing.add(m); P.drafts[m] = draftOf(row.price); delete P.errors[m]; break;
    case "custom": P.pinned.add(m); P.editing.add(m); P.drafts[m] = draftOf(row.price); P.forceHover = null; break;
    case "cancel":
      P.editing.delete(m); P.pinned.delete(m); delete P.drafts[m]; delete P.errors[m]; break;
    case "save": {
      const price = parseDraft(P.drafts[m]);
      if (!price) { P.errors[m] = "四列都要填数字。"; break; }
      row.price = price; row.priceSource = "override";
      P.editing.delete(m); P.pinned.delete(m); delete P.drafts[m]; delete P.errors[m];
      break;
    }
    case "remove": {
      // 移除自定义价：原本 LiteLLM 有价 → 回到 LiteLLM；原本没价 → 回到待定价
      const orig = PRICE_MODELS_INITIAL.find((x) => x.model === m);
      if (row.origin === "table" && orig?.priceSource === "table") { row.priceSource = "table"; row.price = { ...orig.price }; }
      else if (row.origin === "table") { row.priceSource = "table"; }
      else { row.priceSource = null; row.price = null; P.drafts[m] = draftOf(null); }
      P.editing.delete(m);
      break;
    }
    default: return;
  }
  render();
});
document.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.draft) {
    const m = el.dataset.draft;
    P.drafts[m] = { ...(P.drafts[m] || draftOf(null)), [el.dataset.field]: el.value };
    return;
  }
  if (el.dataset.actInput === "query") {
    P.query = el.value;
    const pos = el.selectionStart;
    render();
    const again = document.querySelector('[data-act-input="query"]');
    again.focus();
    again.setSelectionRange(pos, pos);
  }
});
document.addEventListener("mouseover", (e) => {
  if (e.target.closest(".useg") && !S.tipOpen) { S.tipOpen = true; render(); }
});
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, textarea, [contenteditable]")) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const i = SCREENS.findIndex((x) => x.id === S.screen);
  const n = SCREENS.length;
  applyScreen(SCREENS[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n].id);
  render();
});
window.addEventListener("resize", () => { fit(); placeTip(); });

applyScreen(S.screen);
render();
