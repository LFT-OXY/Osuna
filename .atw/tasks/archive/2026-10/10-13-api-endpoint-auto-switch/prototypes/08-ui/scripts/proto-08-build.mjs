// PROTOTYPE — 08 界面票一次性脚本：在真实提供方详情页上替换「第三方接口」区块，存成离线 HTML。用完挪进任务目录。
import { chromium } from "playwright";
import fs from "node:fs";

const [sid, variant, outDir] = process.argv.slice(2);
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

// 先到外观页借一个真实的下拉触发器
await go("/settings/appearance");
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[aria-label]')].find((e) => /^主题/.test(e.getAttribute("aria-label")));
  window.__protoTrigger = el ? el.outerHTML : null;
});
await go(`/settings/hosts/${sid}/providers/claude`);
await page.waitForTimeout(6000);

const log = await page.evaluate((variant) => {
  const $ = (s, r = document) => r.querySelector(s);
  const tid = (id) => $(`[data-testid="${id}"]`);
  const deep = (el) => el.cloneNode(true);
  const shallow = (el) => el.cloneNode(false);
  const strip = (el) => { el.removeAttribute("data-testid"); el.querySelectorAll("[data-testid]").forEach((e) => e.removeAttribute("data-testid")); return el; };
  const text = (tpl, s, style) => { const e = strip(shallow(tpl)); e.textContent = s; if (style) Object.assign(e.style, style); return e; };

  // 不相关的两块拿掉，让第三方接口区落在首屏；所有候选（含现状）一致
  tid("provider-version-section")?.remove();
  tid("provider-install-guide")?.remove();
  // 主机名换成中性名字
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) if (/MacBook/.test(walker.currentNode.nodeValue)) walker.currentNode.nodeValue = "我的 Mac";

  if (variant === "baseline") return "baseline";

  const section = tid("api-endpoints-section");
  const [header, cardWrap] = section.children;
  const card = cardWrap.children[0];
  const officialRow = tid("api-endpoints-official");
  const epRow = tid("api-endpoint-row-ep_proto_yunwu");
  const rowContent = epRow.children[0];
  const titleTpl = rowContent.children[0];
  const metaTpl = rowContent.children[1];
  const urlTpl = metaTpl.children[0];
  const captionTpl = metaTpl.children[1];
  const actionsTpl = epRow.children[1];
  const hintTpl = officialRow.children[0].children[1];
  const editBtn = tid("api-endpoint-edit-ep_proto_yunwu");
  const delBtn = tid("api-endpoint-delete-ep_proto_yunwu");
  const outlineBtn = tid("api-endpoint-use-ep_proto_yunwu");
  const kebab = tid("provider-actions-claude");
  const sw = tid("provider-detail-enabled-switch");
  const header0 = tid("provider-detail-header-claude");
  const pillText = [...header0.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === "可用");
  const pillTpl = pillText.parentElement;
  const tintAlpha = getComputedStyle(pillTpl).backgroundColor.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? "0.12";
  const sectionTitleTpl = [...header.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === "第三方接口");
  const addBtn = tid("api-endpoints-add");
  const triggerHtml = window.__protoTrigger;

  const hex2rgba = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a})`;
  const STATUS = {
    success: ["#3e704a", hex2rgba("#3e704a", tintAlpha)],
    warning: ["#7b5d39", hex2rgba("#7b5d39", tintAlpha)],
    error: ["#9d433b", hex2rgba("#9d433b", tintAlpha)],
    muted: [null, null],
  };
  const badge = (label, kind) => {
    const b = strip(deep(pillTpl));
    const t = [...b.querySelectorAll("*")].find((e) => e.children.length === 0) ?? b;
    t.textContent = label;
    const [fg, bg] = STATUS[kind];
    if (kind === "muted") { b.style.backgroundColor = "#e4e4e7"; b.style.borderColor = "#e4e4e7"; t.style.color = "#71717a"; }
    else { b.style.backgroundColor = bg; t.style.color = fg; }
    b.style.flexShrink = "0";
    return b;
  };
  const toggle = (on) => {
    const s = strip(deep(sw));
    s.setAttribute("aria-checked", String(on));
    const track = s.querySelector('[style*="display: contents"] > div');
    const thumb = track.firstElementChild;
    if (!on) { track.style.backgroundColor = "#e4e4e7"; thumb.style.transform = "translateX(0px)"; thumb.style.backgroundColor = "#ffffff"; }
    s.style.flexShrink = "0";
    return s;
  };
  const button = (label) => {
    const b = strip(deep(outlineBtn));
    const t = [...b.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim()) ?? b;
    t.textContent = label;
    return b;
  };
  const trigger = (label) => {
    const w = document.createElement("div");
    w.innerHTML = triggerHtml;
    const el = w.firstElementChild;
    el.removeAttribute("aria-label");
    const t = [...el.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim());
    if (t) t.textContent = label;
    // 外观页触发器带了主题图标，去掉
    el.querySelectorAll("svg").forEach((e, i) => { if (i === 0) (e.parentElement.children.length === 1 ? e.parentElement : e).remove(); });
    return el;
  };
  const actions = (...kids) => { const a = strip(shallow(actionsTpl)); kids.forEach((k) => a.append(k)); return a; };
  const row = (first, content, trail) => {
    const r = strip(shallow(first ? officialRow : epRow));
    r.append(content);
    if (trail) r.append(trail);
    return r;
  };
  const content = (...kids) => { const c = strip(shallow(rowContent)); kids.forEach((k) => c.append(k)); return c; };
  const metaLine = (...kids) => { const m = strip(shallow(metaTpl)); kids.forEach((k) => m.append(k)); return m; };
  const title = (s) => text(titleTpl, s);
  const caption = (s, style) => text(captionTpl, s, style);
  const mono = (s) => text(urlTpl, s);
  const hint = (s, style) => text(hintTpl, s, style);
  const titleWithTag = (name, proto) => {
    const m = metaLine(title(name), caption(proto));
    m.style.marginTop = "0px";
    return m;
  };
  const newCard = () => strip(shallow(card));
  const wrapCard = (c) => { const w = strip(shallow(cardWrap)); w.append(c); return w; };
  const newHeader = (label, withAdd) => {
    const h = strip(deep(header));
    const t = [...h.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === "第三方接口");
    t.textContent = label;
    if (!withAdd) h.querySelector('button, [role="button"]')?.remove();
    return h;
  };
  const sectionNote = (s) => { const n = hint(s); n.style.margin = "-4px 4px 12px"; return n; };

  const EP = [
    { name: "云雾中转", proto: "Anthropic", url: "https://yunwu.ai", models: 6, on: true, status: ["可用", "success"], list: "claude-sonnet-4-5、claude-opus-4-1、gpt-5 等 6 个" },
    { name: "Kimi", proto: "OpenAI Chat", url: "https://api.moonshot.cn/v1", models: 2, on: true, status: ["冷却中 · 12 分钟后恢复", "warning"], list: "kimi-k2.5、kimi-k2-thinking" },
    { name: "智谱 GLM", proto: "Anthropic", url: "https://open.bigmodel.cn/api/anthropic", models: 3, on: false, status: ["需要检查", "error"], list: "glm-4.6、glm-4.5-air、claude-sonnet-4-5" },
    { name: "OpenRouter", proto: "OpenAI Chat", url: "https://openrouter.ai/api", models: 9, on: false, status: ["已暂停", "muted"], list: "anthropic/claude-sonnet-4.5、openai/gpt-5 等 9 个" },
  ];
  const NOTE = "接口整台电脑共用，Claude Code 和 Codex 各自用开关挑；全部关掉就是用官方。";
  const defaultRow = (first) => row(first, content(title("默认模型"), hint("终端新会话、第一次新建对话从它开始")), trigger("claude-sonnet-4-5"));

  const menu = (items) => {
    const m = document.createElement("div");
    Object.assign(m.style, { position: "absolute", right: "56px", top: "46px", zIndex: "10", minWidth: "168px", padding: "4px", background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: "10px", boxShadow: "0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)", display: "flex", flexDirection: "column" });
    items.forEach(([label, danger, sep]) => {
      if (sep) { const d = document.createElement("div"); Object.assign(d.style, { height: "1px", background: "#e4e4e7", margin: "4px 0" }); m.append(d); return; }
      const it = title(label);
      Object.assign(it.style, { padding: "6px 10px", borderRadius: "6px" });
      if (danger) it.style.color = "#9d433b";
      if (label === "立刻恢复") it.style.background = "rgba(0,0,0,0.06)";
      m.append(it);
    });
    return m;
  };

  const frag = [];
  if (variant === "a") {
    const h = newHeader("第三方接口", true);
    const c = newCard();
    c.style.overflow = "visible";
    c.append(defaultRow(true));
    EP.forEach((e, i) => {
      const r = row(false, content(titleWithTag(e.name, e.proto), metaLine(mono(e.url), caption(`${e.models} 个模型`))), actions(badge(...e.status), strip(deep(kebab)), toggle(e.on)));
      if (i === 1) { r.style.position = "relative"; r.style.zIndex = "5"; r.append(menu([["编辑"], ["立刻恢复"], ["暂停"], [null, false, true], ["删除", true]])); }
      c.append(r);
    });
    frag.push(h, sectionNote(NOTE), wrapCard(c));
  }
  if (variant === "b") {
    const h1 = newHeader("Claude Code 用哪些接口", false);
    const c1 = newCard();
    c1.append(defaultRow(true));
    EP.forEach((e) => c1.append(row(false, e.status[0] === "可用" ? content(title(e.name)) : content(title(e.name), hint(e.status[0].replace(" · ", "，"))), toggle(e.on))));
    const h2 = newHeader("所有接口（整台电脑共用）", true);
    h2.style.marginTop = "8px";
    const c2 = newCard();
    const users = ["Claude Code、Codex 在用", "Claude Code 在用", "没有 Agent 在用", "Codex 在用"];
    EP.forEach((e, i) => {
      const act = { warning: button("立刻恢复"), muted: button("恢复"), success: button("暂停"), error: button("暂停") }[e.status[1]];
      c2.append(row(i === 0, content(titleWithTag(e.name, e.proto), metaLine(mono(e.url), caption(`${e.models} 个模型 · ${users[i]}`))), actions(badge(...e.status), act, strip(deep(editBtn)), strip(deep(delBtn)))));
    });
    const wrap1 = document.createElement("div"); wrap1.style.marginBottom = "24px"; wrap1.append(h1, sectionNote("开关只管 Claude Code；全部关掉就是用官方。"), wrapCard(c1));
    frag.push(wrap1, h2, sectionNote("在这里改的东西，Claude Code 和 Codex 都会受影响。"), wrapCard(c2));
  }
  if (variant === "c") {
    const h = newHeader("第三方接口", true);
    const c = newCard();
    c.append(defaultRow(true));
    const chev = (open) => {
      const ns = "http://www.w3.org/2000/svg";
      const s = document.createElementNS(ns, "svg");
      for (const [k, v] of Object.entries({ width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "#71717a", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) s.setAttribute(k, v);
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", open ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6");
      s.append(p);
      s.style.flexShrink = "0";
      return s;
    };
    EP.forEach((e, i) => {
      const open = i === 1;
      const lead = metaLine(chev(open), title(e.name));
      lead.style.marginTop = "0px";
      lead.style.gap = "8px";
      const r = row(false, content(lead), actions(badge(e.status[0].split(" · ")[0], e.status[1]), toggle(e.on)));
      c.append(r);
      if (open) {
        const d = document.createElement("div");
        Object.assign(d.style, { padding: "4px 16px 16px 40px", display: "flex", flexDirection: "column", gap: "8px" });
        const kv = (k, vEl) => { const l = metaLine(caption(k, { width: "56px" }), vEl); l.style.marginTop = "0px"; l.style.alignItems = "flex-start"; return l; };
        d.append(
          kv("协议", hint("OpenAI Chat", { marginTop: "0px", color: "#18181b" })),
          kv("地址", mono(e.url)),
          kv("模型", hint(e.list, { marginTop: "0px", color: "#18181b" })),
          kv("状态", hint("额度用尽，12 分钟后自动恢复（14:52）", { marginTop: "0px", color: "#7b5d39" })),
        );
        const btns = metaLine(button("立刻恢复"), button("编辑"), button("暂停"), button("删除"));
        btns.style.marginTop = "4px";
        btns.style.gap = "8px";
        d.append(btns);
        c.append(d);
      }
    });
    frag.push(h, sectionNote(NOTE), wrapCard(c));
  }
  section.replaceChildren(...frag);
  return variant;
}, variant);

await page.mouse.move(5, 895);
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/${variant}.png` });

// 存成离线 HTML：样式表全部内联，图片转成 data URL，去掉脚本
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
fs.writeFileSync(`${outDir}/${variant}.html`, html);
console.log(variant, "ok", (html.length / 1024).toFixed(0) + "KB", log);
await browser.close();
