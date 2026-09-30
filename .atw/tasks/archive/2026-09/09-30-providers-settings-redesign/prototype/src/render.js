// ───────── 画面清单 ─────────
const FRAMES = {
  desktop: { w: 1440, h: 900, label: "桌面 1440×900（Electron macOS）" },
  narrow: { w: 1024, h: 900, label: "窄桌面 1024×900：内容区 704 放不下 280+24+400，退回栈式" },
  compact: { w: 390, h: 844, label: "手机 390×844" },
  composer: { w: 1440, h: 900, label: "桌面 1440×900：从 composer 模型选择器的齿轮打开" },
};
const SCREENS = [
  { id: "D1", group: "桌面", label: "Claude · 第三方接口使用中", frame: "desktop", set: { sel: "claude" } },
  { id: "D2", group: "桌面", label: "Codex · 官方", frame: "desktop", set: { sel: "codex" } },
  { id: "D3", group: "桌面", label: "Pi · 未安装", frame: "desktop", set: { sel: "pi" } },
  { id: "D4", group: "桌面", label: "OpenCode · 出错", frame: "desktop", set: { sel: "opencode" } },
  { id: "D5", group: "桌面", label: "Copilot · 已禁用", frame: "desktop", set: { sel: "copilot" } },
  { id: "D6", group: "桌面", label: "自定义提供方 · ⋯ 菜单", frame: "desktop", set: { sel: "zai", menu: true } },
  { id: "D7", group: "桌面", label: "诊断展开", frame: "desktop", set: { sel: "codex", diag: true, scrollTo: "diag" } },
  { id: "D8", group: "桌面", label: "添加 Model 展开", frame: "desktop", set: { sel: "codex", addModel: true, scrollTo: "models" } },
  { id: "D9", group: "桌面", label: "「+」目录弹窗", frame: "desktop", set: { sel: "claude", catalog: true } },
  { id: "N1", group: "窄桌面", label: "列表", frame: "narrow", set: { view: "list", sel: "claude" } },
  { id: "N2", group: "窄桌面", label: "详情", frame: "narrow", set: { view: "detail", sel: "claude" } },
  { id: "C1", group: "手机", label: "列表", frame: "compact", set: { view: "list", sel: "claude" } },
  { id: "C2", group: "手机", label: "Claude", frame: "compact", set: { view: "detail", sel: "claude" } },
  { id: "C3", group: "手机", label: "Pi 未安装", frame: "compact", set: { view: "detail", sel: "pi" } },
  { id: "C4", group: "手机", label: "「+」目录", frame: "compact", set: { view: "list", sel: "claude", catalog: true } },
  { id: "M1", group: "Composer 入口", label: "Claude 详情弹窗", frame: "composer", set: { sel: "claude" } },
];

const DEFAULT_STATE = { sel: "claude", view: "detail", menu: false, diag: false, addModel: false, catalog: false, scrollTo: null };
const params = new URLSearchParams(location.search);
const S = {
  screen: params.get("s") || "D1",
  theme: params.get("t") || "light",
  fit: params.get("fit") !== "0",
  bare: params.get("bare") === "1",
  os: HOST_PLATFORM,
  toast: null,
  added: [],
  ...DEFAULT_STATE,
};

const INITIAL_ENABLED = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.enabled]));
// 切换预设画面时回到初始数据，避免上一个画面里的操作残留
function applyScreen(id) {
  const sc = SCREENS.find((x) => x.id === id) || SCREENS[0];
  for (const p of PROVIDERS) p.enabled = INITIAL_ENABLED[p.id];
  S.added = [];
  Object.assign(S, DEFAULT_STATE, sc.set, { screen: sc.id, os: HOST_PLATFORM, toast: null });
}

// ───────── 小工具 ─────────
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function icon(name, size = 16, extra = "") {
  const svg = ICONS[name];
  if (!svg) return `<span style="width:${size}px;height:${size}px;display:inline-block"></span>`;
  return svg.replace("<svg", `<svg width="${size}" height="${size}" ${extra}`);
}
const provider = (id) => allProviders().find((p) => p.id === id);
function allProviders() {
  return [...PROVIDERS, ...S.added];
}
function modelCount(p) {
  return p.models.length + p.custom.length;
}
function statusOf(p) {
  if (!p.enabled) return { tone: "muted", label: T.status.disabled };
  if (p.status === "loading") return { tone: "loading", label: T.status.loading };
  if (p.status === "error") return { tone: "danger", label: T.status.error };
  if (p.status === "ready") return { tone: "success", label: T.status.available };
  return { tone: "warning", label: T.status.notInstalled };
}
// 列表行第二行：模型数、第三方接口名或状态
function statusLine(p) {
  const st = statusOf(p);
  if (st.tone === "success") {
    const ep = p.endpoints?.active && p.endpoints.list.find((e) => e.id === p.endpoints.active);
    return { tone: "success", label: ep ? T.apiEndpointLine(ep.name) : T.models(modelCount(p)) };
  }
  return st;
}
const dot = (tone) =>
  tone === "loading"
    ? `<svg class="spin" width="10" height="10" viewBox="0 0 32 32" style="color:var(--muted)"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="4" opacity="0.2"/><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="80" stroke-dashoffset="60"/></svg>`
    : `<span class="dot ${tone}"></span>`;
const sw = (on, id) => `<div class="sw-wrap" data-act="toggle" data-id="${id}"><div class="sw ${on ? "on" : ""}"><i></i></div></div>`;

// ───────── 设置侧栏（Electron macOS） ─────────
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
        ${HOST_ITEMS.map((x) => item(x, x[1] === "Providers")).join("")}
      </div>
    </div>
  </nav>`;
}

function screenHeader(crumb) {
  const title = crumb
    ? `<button class="crumb-parent" data-act="back">Providers</button><span class="crumb-sep">/</span><span class="stitle">${esc(crumb)}</span>`
    : `<span class="stitle">Providers</span>`;
  return `<div class="shdr"><div class="hbadge">${icon("boxes", 16)}</div>${title}</div>`;
}

// ───────── SettingsSection ─────────
function section({ id = "", title, count, trail = "", body }) {
  return `<section class="sec" ${id ? `data-sec="${id}"` : ""}>
    <div class="sec-h"><div class="sec-title">${title}${count != null ? `<span class="sec-count">${count}</span>` : ""}</div>${trail ? `<div class="sec-trail">${trail}</div>` : ""}</div>
    <div class="sec-c">${body}</div>
  </section>`;
}

// ───────── 提供方列表 ─────────
function providerRow(p, { compact, selected }) {
  const sl = statusLine(p);
  return `<div class="row prow ${selected ? "sel" : ""}" data-act="select" data-id="${p.id}">
    <div class="row-lead">
      <div class="iconframe">${icon(p.icon, 16)}</div>
      <div class="row-content">
        <div class="row-title ellipsis">${esc(p.label)}</div>
        <div class="st-line">${dot(sl.tone)}<span class="ellipsis">${esc(sl.label)}</span></div>
      </div>
    </div>
    <div class="trail">${sw(p.enabled, p.id)}${compact ? `<span class="chev">${icon("chevron-right", 14)}</span>` : ""}</div>
  </div>`;
}
function providerList({ compact }) {
  const trail = `<button class="btn ghost square" data-act="catalog" aria-label="${T.addProviderA11y}" title="${T.addProviderA11y}">${icon("plus", 14)}</button>`;
  const rows = allProviders()
    .map((p) => providerRow(p, { compact, selected: !compact && p.id === S.sel }))
    .join("");
  return section({ title: T.providers, trail, body: `<div class="card">${rows}</div>` });
}

// ───────── 详情 ─────────
function badge(p) {
  const st = statusOf(p);
  const tone = st.tone === "muted" || st.tone === "loading" ? "" : st.tone;
  return `<span class="badge ${tone}">${esc(st.label)}</span>`;
}
function detailActions(p, { compactHeader } = {}) {
  const menu = S.menu ? actionsMenu(p, compactHeader) : "";
  if (compactHeader) {
    return `<button class="hbtn" data-act="refresh" aria-label="${T.refresh}">${icon("rotate-cw", 20)}</button>
      <button class="hbtn" data-act="menu" aria-label="更多">${icon("ellipsis", 20)}</button>${menu}`;
  }
  return `<button class="btn secondary" data-act="refresh">${icon("rotate-cw", 14)}${T.refresh}</button>
    <button class="iconbtn ${S.menu ? "open" : ""}" data-act="menu" aria-label="${esc(p.label)} actions">${icon("ellipsis", 14)}</button>${menu}`;
}
function actionsMenu(p, compactHeader) {
  const remove =
    p.source === "custom"
      ? `<div class="msep"></div><button class="mi danger" data-act="noop"><span class="mi-icon">${icon("trash-2", 16)}</span>${T.removeProvider}</button>`
      : "";
  const pos = compactHeader ? "top:48px;right:4px" : "top:32px;right:0";
  return `<div class="menu" style="${pos};width:220px" data-stop>
    <button class="mi hl" data-act="run-diag"><span class="mi-icon">${icon("file-text", 16)}</span>${T.diagnostic}</button>${remove}
  </div>`;
}
function detailHeader(p) {
  const n = modelCount(p);
  const meta = [badge(p)];
  if (p.enabled && p.status === "ready") meta.push(`<span>${T.models(n)}</span>`);
  return `<div class="dhead">
    <div class="iconframe lg">${icon(p.icon, 20)}</div>
    <div class="dhead-text"><div class="dhead-name ellipsis">${esc(p.label)}</div><div class="dhead-meta">${meta.join("")}</div></div>
    <div class="dhead-actions">${detailActions(p)}</div>
  </div>`;
}

function errorAlert(p) {
  return `<section class="sec"><div class="alert error">
    <div class="a-icon">${icon("circle-x", 14)}</div>
    <div class="a-body">
      <div class="a-title">${esc(T.errorTitle(p.label))}</div>
      <div class="a-desc mono">${esc(p.error)}</div>
      <div class="a-actions"><button class="btn outline" data-act="refresh">${T.refresh}</button><button class="btn outline" data-act="run-diag">${T.runDiagnostic}</button></div>
    </div>
  </div></section>`;
}
function inheritedAlert(p) {
  const claude = provider("claude");
  const ep = claude.endpoints.active && claude.endpoints.list.find((e) => e.id === claude.endpoints.active);
  if (!ep) return "";
  return `<section class="sec"><div class="alert warning">
    <div class="a-icon">${icon("triangle-alert", 14)}</div>
    <div class="a-body"><div class="a-title">${esc(T.ep.inheritedTitle(ep.name))}</div><div class="a-desc">${esc(T.ep.inheritedDesc)}</div></div>
  </div></section>`;
}

function installSection(p) {
  const g = p.install;
  const tabs = ["macos", "linux", "windows"];
  const names = { macos: "macOS", linux: "Linux", windows: "Windows" };
  const seg = `<div class="seg">${tabs.map((t) => `<button class="${S.os === t ? "on" : ""}" data-act="os" data-os="${t}">${names[t]}</button>`).join("")}</div>`;
  const cmds = S.os
    ? g[S.os].map((c) => `<div class="row"><div class="row-content">${c.tag ? `<div class="caption muted" style="margin-bottom:2px">${c.tag}</div>` : ""}<div class="cmd">${esc(c.cmd)}</div></div>
        <button class="btn ghost" data-act="copy-cmd">${icon("copy", 14)}${T.install.copy}</button></div>`).join("")
    : `<div class="row"><div class="caption muted">${T.install.choosePlatform}</div></div>`;
  const foot = `<div class="row"><div class="caption muted" style="flex:1">${T.install.hostHint}</div><a class="link" href="#" data-act="noop">${T.install.docs}${icon("external-link", 12)}</a></div>`;
  return section({ title: T.install.title(p.label), trail: seg, body: `<div class="card">${cmds}${foot}</div>` });
}

function endpointsSection(p) {
  const ep = p.endpoints;
  const use = (active, name) =>
    active ? `<span class="inuse">${T.ep.inUse}</span>` : `<button class="btn outline" data-act="noop" aria-label="使用 ${esc(name)}">${T.ep.use}</button>`;
  const official = `<div class="row"><div class="row-content"><div class="row-title">${T.ep.official}</div><div class="row-hint">${esc(T.ep.officialHint(p.label))}</div></div>${use(!ep.active, T.ep.official)}</div>`;
  const rows = ep.list
    .map(
      (e) => `<div class="row"><div class="row-content"><div class="row-title ellipsis">${esc(e.name)}</div>
        <div class="ep-meta"><span class="ep-url">${esc(e.url)}</span><span class="caption muted" style="flex-shrink:0">${T.ep.modelCount(e.count)}</span></div></div>
        <div class="ep-actions"><button class="btn ghost icon" data-act="noop" aria-label="编辑 ${esc(e.name)}">${icon("pencil", 14)}</button><button class="btn ghost icon" data-act="noop" aria-label="删除 ${esc(e.name)}">${icon("trash-2", 14)}</button>${use(ep.active === e.id, e.name)}</div></div>`,
    )
    .join("");
  const trail = `<button class="btn ghost" data-act="noop">${icon("plus", 14)}${T.ep.add}</button>`;
  return section({ title: T.ep.title, trail, body: `<div class="card">${official}${rows}</div>` });
}

function modelRow([label, id, desc], { custom } = {}) {
  const same = label === id;
  return `<div class="mrow">
    <span class="m-name">${esc(label)}</span>
    ${same ? "" : `<span class="m-id">${esc(id)}</span>`}
    ${desc ? `<span class="m-desc">${esc(desc)}</span>` : `<span class="m-fill"></span>`}
    ${custom ? `<button class="m-del" data-act="noop" aria-label="移除 ${esc(id)}">${icon("trash-2", 14)}</button>` : ""}
  </div>`;
}
function modelsSection(p) {
  const n = modelCount(p);
  const trail = `${p.updated ? `<span class="caption muted">${T.updated(p.updated)}</span>` : ""}<button class="btn ghost" data-act="add-model">${icon("plus", 14)}${T.addModel}</button>`;
  let body;
  if (!n && !S.addModel) {
    body = `<div class="card"><div class="empty">${p.enabled ? T.noneDetected : T.disabledHint}</div></div>`;
  } else {
    const search = n > 0 ? `<div class="msearch">${icon("search", 16)}<input placeholder="${T.searchModels}"></div>` : "";
    const add = S.addModel
      ? `<div class="madd"><div class="input focus"><input placeholder="${T.modelIdPlaceholder}" autofocus></div><button class="btn default">${T.add}</button><button class="btn ghost" data-act="add-model-cancel">${T.cancel}</button></div>`
      : "";
    const disc = p.models.length
      ? `<div class="mgroup"><span>${T.discovered}</span><span>${p.models.length}</span></div>${p.models.map((m) => modelRow(m)).join("")}`
      : "";
    const cust = p.custom.length
      ? `<div class="mgroup"><span>${T.custom}</span><span>${p.custom.length}</span></div>${p.custom.map((m) => modelRow(m, { custom: true })).join("")}`
      : "";
    body = `<div class="card">${search}${add}${disc}${cust}</div>`;
  }
  return section({ id: "models", title: T.modelsSection, count: n || null, trail, body });
}

function diagSection(p) {
  let trail = "";
  let body;
  if (S.diag) {
    trail = `<span class="caption muted">${T.diagnosticRanAt}</span>
      <button class="btn ghost square" data-act="copy-diag" aria-label="${T.copyDiagnostic}">${icon("copy", 14)}</button>
      <button class="btn ghost square" data-act="run-diag" aria-label="刷新诊断">${icon("rotate-cw", 14)}</button>`;
    const text = p.diagnostic || `${p.label}\n  Status: ${statusOf(p).label}`;
    body = `<div class="code">${esc(text).replace(/^(\s+)([^:\n]+:)/gm, '$1<span class="k">$2</span>')}</div>`;
  } else {
    body = `<div class="card"><div class="row"><div class="caption muted" style="flex:1">${esc(T.diagnosticHint(p.label))}</div><button class="btn outline" data-act="run-diag">${icon("file-text", 14)}${T.runDiagnostic}</button></div></div>`;
  }
  return section({ id: "diag", title: T.diagnostic, trail, body });
}

function detailSections(p) {
  const out = [];
  if (p.enabled && p.status === "error") out.push(errorAlert(p));
  if (p.extends === "claude") out.push(inheritedAlert(p));
  if (p.enabled && p.status === "unavailable" && p.install) out.push(installSection(p));
  if (p.endpoints) out.push(endpointsSection(p));
  out.push(modelsSection(p));
  out.push(diagSection(p));
  return out.join("");
}
function detail(p) {
  return `${detailHeader(p)}${detailSections(p)}`;
}

// ───────── 弹窗 ─────────
function catalogBody() {
  return `<div class="card">${CATALOG.map(
    (c) => `<div class="row"><div class="row-lead"><div class="iconframe">${icon(c.icon, 20)}</div>
      <div class="row-content"><div class="cat-title"><span class="cat-name ellipsis">${esc(c.name)}</span><span class="cat-ver">${esc(c.ver)}</span></div>
      <div class="row-hint ellipsis">${esc(c.desc)}</div>
      <div style="margin-top:2px"><a class="link" href="#" data-act="noop">${T.installInstructions}${icon("external-link", 12)}</a></div></div></div>
      <button class="btn default w92" data-act="add-provider" data-name="${esc(c.name)}" data-icon="${c.icon}">${T.add}</button></div>`,
  ).join("")}</div>`;
}
function catalogDialog() {
  return `<div class="overlay"><div class="scrim" data-act="close"></div>
    <div class="dialog" data-stop>
      <div class="dlg-head"><div class="dlg-row"><div class="dlg-title">${T.catalogTitle}</div><button class="dlg-close" data-act="close">${icon("x", 16)}</button></div>
        <div class="dlg-search">${icon("search", 16)}<input placeholder="${T.catalogSearch}"></div></div>
      <div class="dlg-body scroll">${catalogBody()}</div>
    </div></div>`;
}
function catalogSheet() {
  return `<div class="bs-overlay"><div class="bs-scrim" data-act="close"></div><div class="bs" data-stop>
    <div class="bs-handle"><i></i></div>
    <div class="dlg-head"><div class="dlg-row"><div class="dlg-title">${T.catalogTitle}</div><button class="dlg-close" data-act="close">${icon("x", 16)}</button></div>
      <div class="dlg-search">${icon("search", 16)}<input placeholder="${T.catalogSearch}"></div></div>
    <div class="dlg-body scroll" style="padding:16px">${catalogBody()}</div>
  </div></div>`;
}

function toast() {
  if (!S.toast) return "";
  return `<div class="toast"><span class="t-icon">${icon("circle-check", 18)}</span>${esc(S.toast)}</div>`;
}

// ───────── 画框 ─────────
function desktopFrame() {
  const p = provider(S.sel);
  return `<div class="app">${settingsSidebar()}
    <div class="pane">${screenHeader()}
      <div class="pscroll scroll" data-scroll>
        <div class="split">
          <div class="list-col">${providerList({ compact: false })}</div>
          <div class="detail-col">${detail(p)}</div>
        </div>
      </div>
    </div></div>${S.catalog ? catalogDialog() : ""}${toast()}`;
}
function narrowFrame() {
  const p = provider(S.sel);
  const inner =
    S.view === "list"
      ? `${screenHeader()}<div class="pscroll scroll" data-scroll><div class="column">${providerList({ compact: true })}</div></div>`
      : `${screenHeader(p.label)}<div class="pscroll scroll" data-scroll><div class="column">${detail(p)}</div></div>`;
  return `<div class="app">${settingsSidebar()}<div class="pane">${inner}</div></div>${S.catalog ? catalogDialog() : ""}${toast()}`;
}
function compactFrame() {
  const p = provider(S.sel);
  let inner;
  if (S.view === "list") {
    inner = `<div class="bhdr"><button class="back" data-act="noop">${icon("arrow-left", 20)}</button><div class="btitle">Providers</div></div>
      <div class="pscroll scroll no-scrollbar" data-scroll><div class="column">${providerList({ compact: true })}</div></div>`;
  } else {
    inner = `<div class="bhdr"><button class="back" data-act="back">${icon("arrow-left", 20)}</button><div class="btitle ellipsis">${esc(p.label)}</div>
        <div class="bactions">${detailActions(p, { compactHeader: true })}</div></div>
      <div class="pscroll scroll no-scrollbar" data-scroll><div class="column">${compactDetailHeader(p)}${detailSections(p)}</div></div>`;
  }
  return `<div class="app" style="flex-direction:column">${inner}</div>${S.catalog ? catalogSheet() : ""}${toast()}`;
}
function compactDetailHeader(p) {
  const meta = [badge(p)];
  if (p.enabled && p.status === "ready") meta.push(`<span>${T.models(modelCount(p))}</span>`);
  return `<div class="dhead"><div class="iconframe lg">${icon(p.icon, 20)}</div>
    <div class="dhead-text"><div class="dhead-name ellipsis">${esc(p.label)}</div><div class="dhead-meta">${meta.join("")}</div></div></div>`;
}
function composerFrame() {
  const p = provider(S.sel);
  return `<div class="backdrop-img" style="background-image:url(${S.theme === "dark" ? ASSETS.workspaceDark : ASSETS.workspaceLight})"></div>
    <div class="overlay"><div class="scrim" data-act="noop"></div>
      <div class="dialog" style="max-width:640px" data-stop>
        <div class="dlg-head"><div class="dlg-row">
          <div class="dlg-title"><div class="iconframe">${icon(p.icon, 16)}</div><span class="ellipsis">${esc(p.label)}</span>${badge(p)}</div>
          <div class="dlg-actions">${detailActions(p)}</div>
          <button class="dlg-close" style="margin-left:4px" data-act="noop">${icon("x", 16)}</button>
        </div></div>
        <div class="dlg-body sections scroll" data-scroll>${detailSections(p)}</div>
      </div></div>${toast()}`;
}

// ───────── 挂载 ─────────
function render() {
  const sc = SCREENS.find((x) => x.id === S.screen);
  const kind = sc.frame;
  const f = FRAMES[kind];
  document.body.className = `proto ${S.theme === "dark" ? "page-dark" : ""} ${S.bare ? "bare" : ""}`;
  const html = { desktop: desktopFrame, narrow: narrowFrame, compact: compactFrame, composer: composerFrame }[kind]();
  const bar = S.bare ? "" : toolbar();
  const holderScale = !S.bare && S.fit ? Math.min(1, (window.innerWidth - 48) / f.w) : 1;
  document.getElementById("root").innerHTML = `${bar}
    <div class="proto-stage">
      <div class="frame-holder" style="width:${f.w * holderScale}px;height:${f.h * holderScale}px">
        <div class="frame-shadow ${kind === "compact" ? "phone" : ""}" style="width:${f.w}px;height:${f.h}px;transform:scale(${holderScale});transform-origin:top left">
          <div class="frame theme-${S.theme} ${kind === "compact" ? "phone" : ""}" id="frame" style="width:${f.w}px;height:${f.h}px">${html}</div>
        </div>
      </div>
      ${S.bare ? "" : `<div class="proto-caption">${esc(sc.group)} · ${esc(sc.label)}　|　${esc(f.label)}</div>`}
    </div>`;
  if (S.scrollTo) {
    const el = document.querySelector(`[data-sec="${S.scrollTo}"]`);
    const sc2 = document.querySelector("[data-scroll]");
    if (el && sc2) sc2.scrollTop = el.offsetTop - 24;
  }
}
function toolbar() {
  const groups = [...new Set(SCREENS.map((s) => s.group))];
  const btns = groups
    .map((g) => `<div class="grp"><span class="grp-label">${g}</span>${SCREENS.filter((s) => s.group === g).map((s) => `<button class="${s.id === S.screen ? "on" : ""}" data-proto="screen" data-v="${s.id}">${s.label}</button>`).join("")}</div>`)
    .join('<span class="sep"></span>');
  return `<div class="proto-bar">${btns}<span class="sep"></span>
    <div class="grp"><span class="grp-label">主题</span><button class="${S.theme === "light" ? "on" : ""}" data-proto="theme" data-v="light">浅色</button><button class="${S.theme === "dark" ? "on" : ""}" data-proto="theme" data-v="dark">深色</button></div>
    <div class="grp"><span class="grp-label">缩放</span><button class="${S.fit ? "on" : ""}" data-proto="fit" data-v="1">适应宽度</button><button class="${!S.fit ? "on" : ""}" data-proto="fit" data-v="0">100%</button></div>
  </div>`;
}
function syncUrl() {
  const q = new URLSearchParams({ s: S.screen, t: S.theme });
  if (!S.fit) q.set("fit", "0");
  history.replaceState(null, "", `?${q}`);
}
function flash(msg) {
  S.toast = msg;
  render();
  clearTimeout(flash.t);
  flash.t = setTimeout(() => {
    S.toast = null;
    render();
  }, 2200);
}

document.addEventListener("click", (e) => {
  const pb = e.target.closest("[data-proto]");
  if (pb) {
    const { proto, v } = pb.dataset;
    if (proto === "screen") applyScreen(v);
    if (proto === "theme") S.theme = v;
    if (proto === "fit") S.fit = v === "1";
    syncUrl();
    render();
    return;
  }
  const a = e.target.closest("[data-act]");
  const inMenu = e.target.closest(".menu");
  if (!a) {
    if (S.menu && !inMenu) {
      S.menu = false;
      render();
    }
    return;
  }
  e.preventDefault();
  const act = a.dataset.act;
  const kind = SCREENS.find((x) => x.id === S.screen).frame;
  S.scrollTo = null;
  if (act !== "menu") S.menu = false;
  switch (act) {
    case "select":
      S.sel = a.dataset.id;
      S.diag = false;
      S.addModel = false;
      if (kind !== "desktop") S.view = "detail";
      if (!provider(S.sel).install) S.os = HOST_PLATFORM;
      break;
    case "toggle": {
      e.stopPropagation();
      const p = provider(a.dataset.id);
      p.enabled = !p.enabled;
      break;
    }
    case "back":
      S.view = "list";
      break;
    case "menu":
      S.menu = !S.menu;
      break;
    case "run-diag":
      S.diag = true;
      S.scrollTo = "diag";
      break;
    case "add-model":
      S.addModel = true;
      S.scrollTo = "models";
      break;
    case "add-model-cancel":
      S.addModel = false;
      break;
    case "catalog":
      S.catalog = true;
      break;
    case "close":
      S.catalog = false;
      break;
    case "add-provider": {
      const name = a.dataset.name;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (!provider(id)) S.added.push({ id, label: name, icon: a.dataset.icon, enabled: true, status: "unavailable", source: "custom", models: [], custom: [] });
      S.catalog = false;
      S.sel = id;
      if (kind !== "desktop") S.view = "detail";
      break;
    }
    case "os":
      S.os = a.dataset.os;
      break;
    case "copy-cmd":
      flash(T.copied("命令"));
      return;
    case "copy-diag":
      flash(T.copied("诊断"));
      return;
    case "refresh":
      flash(T.refreshing);
      return;
    default:
      return;
  }
  render();
});
window.addEventListener("resize", () => render());
applyScreen(S.screen);
S.theme = params.get("t") || "light";
render();
