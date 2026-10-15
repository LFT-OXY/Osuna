// PROTOTYPE — 08 界面票第二轮：magpie 式三层（接口列表页 / 接口详情 / 添加表单 / Agent 页总开关）。
// 在真实设置页上拼出画面，存成离线 HTML。用完挪进任务目录。
import { chromium } from "playwright";
import fs from "node:fs";

const [sid, screen, outDir] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
await page.addInitScript(() => {
  const k = "@paseo:app-settings";
  const v = JSON.parse(localStorage.getItem(k) || "{}");
  v.language = "zh-CN";
  localStorage.setItem(k, JSON.stringify(v));
});
await page.goto("http://localhost:8081/");
await page.waitForTimeout(9000);
const go = (p) => page.evaluate((p) => { history.pushState({}, "", p); dispatchEvent(new PopStateEvent("popstate")); }, p);

await go("/settings/appearance");
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("[aria-label]")].find((e) => /^主题/.test(e.getAttribute("aria-label")));
  window.__protoTrigger = el ? el.outerHTML : null;
});

if (screen === "list") {
  // 列表页借「提供方」列表；同时先到详情页借下拉框以外的零件（不需要）
  await go(`/settings/hosts/${sid}/providers`);
  await page.waitForTimeout(5000);
} else {
  await go(`/settings/hosts/${sid}/providers/claude`);
  await page.waitForTimeout(6000);
  if (screen === "form") {
    await page.getByTestId("api-endpoints-add").click();
    await page.waitForTimeout(2000);
  }
}

const log = await page.evaluate((screen) => {
  const $ = (s, r = document) => r.querySelector(s);
  const tid = (id, r = document) => $(`[data-testid="${id}"]`, r);
  const deep = (el) => el.cloneNode(true);
  const shallow = (el) => el.cloneNode(false);
  const strip = (el) => { el.removeAttribute?.("data-testid"); el.querySelectorAll?.("[data-testid]").forEach((e) => e.removeAttribute("data-testid")); return el; };
  const leaf = (root, s) => [...root.querySelectorAll("*")].find((e) => e.children.length === 0 && (typeof s === "string" ? e.textContent === s : s.test(e.textContent)));
  const text = (tpl, s, style) => { const e = strip(shallow(tpl)); e.textContent = s; if (style) Object.assign(e.style, style); return e; };
  const ns = "http://www.w3.org/2000/svg";
  const PLUG = '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>';
  const icon = (paths, size = 16, color = "#71717a") => {
    const s = document.createElementNS(ns, "svg");
    for (const [k, v] of Object.entries({ width: String(size), height: String(size), viewBox: "0 0 24 24", fill: "none", stroke: color, "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) s.setAttribute(k, v);
    s.innerHTML = paths;
    s.style.flexShrink = "0";
    return s;
  };
  const CHEV_R = '<path d="m9 18 6-6-6-6"/>';
  const CHEV_D = '<path d="m6 9 6 6 6-6"/>';
  const BOX = '<rect width="18" height="18" x="3" y="3" rx="2"/>';
  const BOX_ON = '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/>';
  const REFRESH = '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>';

  // 中性主机名
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (/MacBook/.test(walker.currentNode.nodeValue)) walker.currentNode.nodeValue = "我的 Mac";

  // 侧栏加「第三方接口」，放在「提供方」后面
  const provItem = tid("settings-host-section-providers");
  const usageItem = tid("settings-host-section-usage");
  const newItem = strip(deep(usageItem));
  newItem.querySelector("svg").innerHTML = PLUG;
  leaf(newItem, "价格表").textContent = "第三方接口";
  provItem.after(newItem);
  const swapClasses = (a, b) => {
    const ca = a.getAttribute("class"), cb = b.getAttribute("class");
    if (ca !== null) b.setAttribute("class", ca); else b.removeAttribute("class");
    if (cb !== null) a.setAttribute("class", cb); else a.removeAttribute("class");
    if (a.tagName.toLowerCase() === "svg") return;
    [...a.children].forEach((c, i) => b.children[i] && swapClasses(c, b.children[i]));
  };
  if (screen === "list" || screen === "detail") swapClasses(provItem, newItem);

  // 顶部标题栏的图标换成插头
  const setHeaderIcon = (anchor) => {
    let n = anchor;
    while (n && !n.querySelector("svg")) n = n.parentElement;
    const svg = n?.querySelector("svg");
    if (svg) svg.innerHTML = PLUG;
  };

  const triggerEl = (label) => {
    const w = document.createElement("div");
    w.innerHTML = window.__protoTrigger;
    const el = w.firstElementChild;
    el.removeAttribute("aria-label");
    el.querySelectorAll("svg").forEach((e, i) => { if (i === 0) (e.parentElement.children.length === 1 ? e.parentElement : e).remove(); });
    const t = [...el.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim());
    if (t) t.textContent = label;
    return el;
  };
  const avatar = (frameTpl, ch, bg, fg) => {
    const f = strip(shallow(frameTpl));
    const t = document.createElement("div");
    t.textContent = ch;
    Object.assign(t.style, { font: "600 13px -apple-system, 'PingFang SC', sans-serif", color: fg });
    f.style.backgroundColor = bg;
    f.append(t);
    return f;
  };
  const AV = { "云雾中转": ["云", "#e8f0ff", "#1b4ed8"], "Kimi": ["K", "#f1f1f3", "#18181b"], "智谱 GLM": ["智", "#eaf3ee", "#3e704a"], "OpenRouter": ["O", "#f3eefc", "#6d4fc2"] };

  if (screen === "list") {
    setHeaderIcon(tid("settings-detail-header-title"));
    tid("settings-detail-header-title").textContent = "第三方接口";
    const card = tid("host-page-providers-card");
    const enabled = tid("providers-enabled-group");
    const disabled = tid("providers-disabled-group");
    const [enHeader, enCard] = enabled.children;
    const [disHeader, disCard] = disabled.children;
    const rowTpl = tid("provider-row-claude");
    const dots = { success: tid("provider-status-dot-success"), warning: tid("provider-status-dot-warning"), danger: tid("provider-status-dot-danger"), muted: tid("provider-status-dot-muted") };
    const swOn = rowTpl.querySelector('[role="switch"]');
    const swOff = tid("provider-row-copilot").querySelector('[role="switch"]');
    const titleTpl = leaf(rowTpl, "Claude");
    const statusTpl = tid("provider-status-line");
    const statusTextTpl = leaf(statusTpl, /个模型/);
    const disabledRowTpl = tid("provider-row-copilot");
    const frameTpl = rowTpl.children[0].children[0].children[0];
    const mkRow = (e, off) => {
      const src = off ? disabledRowTpl : rowTpl;
      const r = strip(deep(src));
      const left = r.children[0];
      left.children[0].children[0].replaceWith(avatar(frameTpl, ...AV[e.name]));
      const t = leaf(r, off ? "Copilot" : "Claude");
      t.textContent = e.name;
      const line = r.querySelector("div > div:nth-child(2) > div:nth-child(2)") ?? left.children[1].children[1];
      const sl = strip(shallow(statusTpl));
      sl.append(strip(deep(dots[e.dot])), text(statusTextTpl, e.line));
      left.children[1].children[1].replaceWith(sl);
      if (e.trail) sl.append(text(statusTextTpl, e.trail, { color: e.trailColor }));
      return r;
    };
    const EPS = [
      { name: "云雾中转", dot: "success", line: "Anthropic、OpenAI Chat · yunwu.ai · 已选 14 个模型" },
      { name: "Kimi", dot: "warning", line: "OpenAI Chat · api.moonshot.cn · 已选 2 个模型 ·", trail: "冷却中，12 分钟后恢复", trailColor: "#7b5d39" },
      { name: "智谱 GLM", dot: "danger", line: "Anthropic、OpenAI Chat · open.bigmodel.cn · 已选 3 个模型 ·", trail: "key 无效，需要检查", trailColor: "#9d433b" },
    ];
    const fillCard = (src, rows) => {
      const w = strip(deep(src));
      const inner = w.children[0];
      const [w0, w1] = inner.children;
      inner.replaceChildren(...rows.map((r, i) => { const x = shallow(i === 0 ? w0 : (w1 ?? w0)); x.append(r); return x; }));
      return w;
    };
    const enCard2 = fillCard(enCard, EPS.map((e) => mkRow(e, false)));
    const disCard2 = fillCard(disCard, [mkRow({ name: "OpenRouter", dot: "muted", line: "已关闭 · OpenAI Chat、Responses · openrouter.ai · 已选 9 个模型" }, true)]);
    leaf(enHeader, "已启用").textContent = "已开启";
    leaf(enHeader, "8").textContent = "3";
    leaf(disHeader, "已停用").textContent = "已关闭";
    leaf(disHeader, "2").textContent = "1";
    const note = text(statusTextTpl, "接口整台电脑共用。在 Claude Code、Codex 的设置里打开「使用第三方接口」后，就能用这里开着的接口里选好的模型；关掉某一家，所有 Agent 都不再用它。", { margin: "-4px 4px 14px", lineHeight: "20px", whiteSpace: "normal", WebkitLineClamp: "unset", display: "block", overflow: "visible", textOverflow: "clip" });
    enabled.replaceChildren(enHeader, note, enCard2);
    disabled.replaceChildren(disHeader, disCard2);
    return "list";
  }

  // 下面三个画面都在 Claude 提供方详情页上
  const verSec = tid("provider-version-section");
  const instSec = tid("provider-install-guide");
  const apiSec = tid("api-endpoints-section");
  const modelsSec = tid("provider-models-section");
  const diagSec = tid("provider-diagnostic-section");
  const officialRow = tid("api-endpoints-official");
  const epRow = tid("api-endpoint-row-ep_proto_yunwu") ?? officialRow;
  const rowContentTpl = officialRow.children[0];
  const titleTpl = rowContentTpl.children[0];
  const hintTpl = rowContentTpl.children[1];
  const sw = tid("provider-detail-enabled-switch");
  const apiHeader = apiSec.children[0];
  const apiCardWrap = apiSec.children[1];
  const apiCard = apiCardWrap.children[0];
  const addBtn = tid("api-endpoints-add");

  const row = (first, kids, trail) => {
    const r = strip(shallow(first ? officialRow : epRow));
    const c = strip(shallow(rowContentTpl));
    kids.forEach((k) => c.append(k));
    r.append(c);
    if (trail) r.append(trail);
    return r;
  };
  const title = (s, st) => text(titleTpl, s, st);
  const hint = (s, st) => text(hintTpl, s, st);
  const section = (label, trailing, note, rows) => {
    const s = strip(shallow(apiSec));
    const h = strip(deep(apiHeader));
    leaf(h, "第三方接口").textContent = label;
    const b = h.querySelector("button, [role='button']");
    if (trailing) b.replaceWith(trailing); else b?.remove();
    const w = strip(shallow(apiCardWrap));
    const c = strip(shallow(apiCard));
    rows.forEach((r) => c.append(r));
    w.append(c);
    s.append(h);
    if (note) s.append(hint(note, { margin: "-4px 4px 12px", lineHeight: "20px" }));
    s.append(w);
    return s;
  };
  const ghost = (label, paths) => {
    const b = strip(deep(addBtn));
    leaf(b, "添加").textContent = label;
    const svg = b.querySelector("svg");
    if (paths) svg.innerHTML = paths; else (svg.parentElement.children.length === 1 ? svg.parentElement : svg).remove();
    return b;
  };

  if (screen === "agent") {
    verSec.remove(); instSec.remove();
    const s = section("第三方接口", null, null, [
      row(true, [title("使用第三方接口"), hint("打开后，Claude Code 能用「第三方接口」页里开着的接口的已选模型；关掉就回到官方。")], strip(deep(sw))),
      row(false, [title("默认模型"), hint("终端新会话、第一次新建对话从它开始")], triggerEl("claude-sonnet-4-5")),
      row(false, [title("管理第三方接口"), hint("3 个开着 · Kimi 冷却中，12 分钟后恢复")], icon(CHEV_R, 16)),
    ]);
    apiSec.replaceWith(s);
    return "agent";
  }

  if (screen === "form") {
    const sheet = tid("api-endpoint-form");
    const nameIn = tid("api-endpoint-form-name");
    const urlIn = tid("api-endpoint-form-base-url");
    // 找到各字段共同的父容器
    let a = nameIn; const anc = new Set(); while (a) { anc.add(a); a = a.parentElement; }
    let common = urlIn; while (!anc.has(common)) common = common.parentElement;
    const fieldOf = (el) => { let n = el; while (n.parentElement !== common) n = n.parentElement; return n; };
    const nameField = fieldOf(nameIn), urlField = fieldOf(urlIn), keyField = fieldOf(tid("api-endpoint-form-api-key"));
    const actions = fieldOf(tid("api-endpoint-form-save"));
    const hintLeaf = leaf(common, /^从这个接口拉取模型列表/);
    const setVal = (inp, v, ph) => { inp.setAttribute("value", v); inp.value = v; if (ph) inp.setAttribute("placeholder", ph); };
    setVal(nameIn, "云雾中转");
    setVal(tid("api-endpoint-form-api-key"), "sk-yw-8f2c1d9e4b7a3f9a");
    // 地址 + 自动检测：借「手动添加模型 ID」那一行（输入框 + 按钮）
    const modelIdIn = tid("api-endpoint-form-model-id");
    const addModelBtn = tid("api-endpoint-form-add-model");
    let rowEl = modelIdIn; while (!rowEl.contains(addModelBtn)) rowEl = rowEl.parentElement;
    const detectRow = strip(deep(rowEl));
    setVal(detectRow.querySelector("input"), "https://yunwu.ai", "贴中转站给的任意一个地址");
    const db = leaf(detectRow, "添加"); db.textContent = "自动检测";
    const dbtn = db.closest("button") ?? db.parentElement;
    [dbtn, ...dbtn.querySelectorAll("*")].forEach((e) => { e.style.opacity = "1"; });
    const addrField = strip(deep(urlField));
    let iw = addrField.querySelector("input"); while (iw.parentElement !== addrField && iw.parentElement.children.length === 1) iw = iw.parentElement;
    iw.replaceWith(detectRow);
    leaf(addrField, "Base URL").textContent = "地址";
    addrField.append(text(hintLeaf, "填好 key 后点「自动检测」，Osuna 会用三种请求格式各试一次，把能用的地址填到下面。"));
    // 三种格式各一个地址，可手改；留空 = 这家不用这种格式
    const fmt = (label, v, ok, note) => {
      const f = strip(deep(urlField));
      const inp = f.querySelector("input");
      setVal(inp, v, "没检测到，留空就不用这种格式");
      inp.removeAttribute("data-testid");
      const l = leaf(f, "Base URL");
      l.textContent = label;
      const mark = text(l, ok ? "  ✓ 检测通过" : "  未检测到", { color: ok ? "#3e704a" : "#a1a1aa", marginLeft: "6px" });
      l.parentElement.style.display = "flex"; l.parentElement.style.flexDirection = "row"; l.parentElement.style.alignItems = "center";
      l.after(mark);
      return f;
    };
    const box = document.createElement("div");
    Object.assign(box.style, { display: "flex", flexDirection: "column", gap: "12px", padding: "14px 14px 4px", border: "1px solid #e4e4e7", borderRadius: "12px", background: "#fafafa" });
    box.append(
      fmt("Anthropic 格式地址", "https://yunwu.ai", true),
      fmt("OpenAI Chat 格式地址", "https://yunwu.ai/v1", true),
      fmt("OpenAI Responses 格式地址", "", false),
    );
    const next = text(hintLeaf, "key 只填一次，三种格式共用。保存后进入这个接口的详情页，拉取上游模型、按 Claude / GPT / Gemini 分组挑选。", { marginTop: "4px" });
    const save = tid("api-endpoint-form-save");
    const saveLabel = leaf(save, /保存/);
    if (saveLabel) saveLabel.textContent = "保存并拉取模型";
    [save, ...save.querySelectorAll("*")].forEach((e) => { e.style.opacity = "1"; });
    leaf(sheet, "新建第三方接口").textContent = "添加第三方接口";
    common.replaceChildren(nameField, keyField, addrField, box, next, actions);
    return "form";
  }

  if (screen === "detail") {
    setHeaderIcon(tid("settings-providers-breadcrumb"));
    leaf(tid("settings-providers-breadcrumb"), "提供方").textContent = "第三方接口";
    const crumbTitle = leaf(tid("settings-detail-pane") ?? document.body, "Claude");
    // 详情头
    const head = tid("provider-detail-header-claude");
    const frame = head.children[0];
    frame.replaceWith(avatar(frame, "云", "#e8f0ff", "#1b4ed8"));
    leaf(head, "Claude").textContent = "云雾中转";
    leaf(head, "17 个模型").textContent = "Anthropic、OpenAI Chat · 已选 14 个模型";
    leaf(head, "已启用").textContent = "已开启";
    const refresh = leaf(head, "刷新");
    refresh.textContent = "测试连接";
    const rsvg = refresh.parentElement.querySelector("svg");
    if (rsvg) rsvg.innerHTML = '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>';
    // 面包屑里的「Claude」
    [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent === "Claude").forEach((e) => { e.textContent = "云雾中转"; });

    // 连接
    const valueTpl = leaf(verSec, /v2\.1/);
    const kv = (first, k, v, mono) => row(first, [title(k)], text(valueTpl, v, mono ? { fontFamily: "Menlo, monospace", fontSize: "13px" } : null));
    const conn = section("连接", ghost("编辑", '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'), "key 三种格式共用。每次请求：Agent 自己的格式这家有就原样转发；Claude 模型有 Anthropic 地址时一律走它（保住缓存）；都没有就由 Osuna 翻译。", [
      kv(true, "Anthropic 格式地址", "https://yunwu.ai", true),
      kv(false, "OpenAI Chat 格式地址", "https://yunwu.ai/v1", true),
      kv(false, "OpenAI Responses 格式地址", "未填，不用这种格式"),
      kv(false, "API key", "sk-yw-••••••••3f9a", true),
    ]);

    // 模型：按家族分组
    const mh = modelsSec.children[0];
    leaf(mh, "17").textContent = "已选 14 / 共 236";
    leaf(mh, /^已更新/).textContent = "拉取于 2 分钟前";
    const addModel = tid("provider-add-model");
    leaf(addModel, "添加模型").textContent = "重新拉取";
    addModel.querySelector("svg").innerHTML = REFRESH;
    const manual = strip(deep(addModel));
    leaf(manual, "重新拉取").textContent = "手动添加";
    manual.querySelector("svg").innerHTML = '<path d="M5 12h14"/><path d="M12 5v14"/>';
    addModel.after(manual);
    const disc = tid("provider-models-discovered");
    const gHeadTpl = disc.children[0];
    const mRowTpl = disc.children[1];
    const nameTpl = mRowTpl.children[0];
    const descTpl = mRowTpl.children[2];
    const search = modelsSec.querySelector("input");
    if (search) search.setAttribute("placeholder", "搜索 236 个模型");
    const FAM = [
      ["Claude", 6, [["claude-opus-4-1", 1], ["claude-sonnet-4-5", 1], ["claude-haiku-4-5", 1], ["claude-3-7-sonnet", 1], ["claude-opus-4", 0], ["claude-3-5-haiku", 0]], true],
      ["GPT", 11, [["gpt-5", 1], ["gpt-5-codex", 1], ["gpt-5-mini", 1], ["gpt-4.1", 1], ["o3", 1], ["o4-mini", 1], ["gpt-4o", 0]], true, 4],
      ["Gemini", 7, 0], ["DeepSeek", 4, 2], ["Kimi", 3, 0], ["GLM", 4, 0], ["通义千问", 12, 0], ["其他", 189, 0],
    ];
    const groups = [];
    FAM.forEach(([fam, total, items, open, more]) => {
      const picked = Array.isArray(items) ? items.filter((x) => x[1]).length : items;
      const h = strip(deep(gHeadTpl));
      const famLeaf = leaf(h, "已发现");
      famLeaf.textContent = fam;
      famLeaf.style.color = "#18181b";
      const cnt = leaf(h, "17");
      cnt.textContent = `已选 ${picked} / ${total}`;
      const all = text(cnt, picked === total ? "全不选" : "全选这组", { color: "#1b4ed8", marginLeft: "14px" });
      const L = document.createElement("div");
      Object.assign(L.style, { display: "flex", alignItems: "center", gap: "6px" });
      L.append(icon(open ? CHEV_D : CHEV_R, 14), famLeaf);
      const R = document.createElement("div");
      Object.assign(R.style, { display: "flex", alignItems: "center" });
      R.append(cnt, all);
      h.replaceChildren(L, R);
      Object.assign(h.style, { display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" });
      h.style.borderTop = groups.length ? "1px solid #f0f0f2" : "";
      h.style.cursor = "pointer";
      groups.push(h);
      if (open) {
        items.forEach(([id, on]) => {
          const r = strip(shallow(mRowTpl));
          r.style.display = "flex"; r.style.alignItems = "center"; r.style.gap = "10px"; r.style.paddingLeft = "36px";
          r.append(icon(on ? BOX_ON : BOX, 16, on ? "#1b4ed8" : "#a1a1aa"), text(nameTpl, id, { fontFamily: "Menlo, monospace", fontSize: "13px" }));
          groups.push(r);
        });
        if (more) groups.push(text(descTpl, `还有 ${more} 个，展开全部`, { padding: "6px 16px 10px 62px", color: "#1b4ed8" }));
      }
    });
    disc.replaceChildren(...groups);

    // Claude 档位映射
    const tiers = section("Claude 档位映射（可选）", null, "Claude Code 里选 opus / sonnet / haiku / fable 时，走这家接口就换成右边的模型；不填就原样发过去。", [
      row(true, [title("Opus")], triggerEl("claude-opus-4-1")),
      row(false, [title("Sonnet")], triggerEl("claude-sonnet-4-5")),
      row(false, [title("Haiku")], triggerEl("claude-haiku-4-5")),
      row(false, [title("Fable")], triggerEl("不映射")),
    ]);

    verSec.replaceWith(conn);
    instSec.remove();
    apiSec.remove();
    modelsSec.after(tiers);
    diagSec?.remove();
    return "detail";
  }
  return "?";
}, screen);

await page.mouse.move(5, 895);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/${screen}.png` });
if (screen === "form") {
  await page.evaluate(() => { [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)).forEach((e) => { e.scrollTop = e.scrollHeight; }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/${screen}-2.png` });
  await page.evaluate(() => document.querySelectorAll("*").forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }));
}
if (screen === "detail") {
  await page.evaluate(() => {
    const els = [...document.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    els.forEach((e) => { e.scrollTop = e.scrollHeight; });
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/${screen}-2.png` });
  await page.evaluate(() => document.querySelectorAll("*").forEach((e) => { if (e.scrollTop) e.scrollTop = 0; }));
}

const html = await page.evaluate(async () => {
  for (const img of document.querySelectorAll("img")) {
    try {
      const blob = await (await fetch(img.src)).blob();
      img.src = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      img.removeAttribute("srcset");
    } catch {}
  }
  const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
  const doc = document.documentElement.cloneNode(true);
  doc.querySelectorAll("script, link, noscript").forEach((e) => e.remove());
  const head = doc.querySelector("head");
  head.querySelectorAll("style").forEach((e) => e.remove());
  const st = document.createElement("style");
  st.textContent = css;
  head.append(st);
  return "<!doctype html>\n" + doc.outerHTML;
});
fs.writeFileSync(`${outDir}/${screen}.html`, html);
console.log(screen, "ok", (html.length / 1024).toFixed(0) + "KB", log);
await browser.close();
