// 临时文件（不提交）：连到 zz-site-capture.spec.ts 起好的隔离 daemon + Metro，按场景截图。
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const info = JSON.parse(readFileSync("/tmp/impl12-capture/info.json", "utf8"));
const OUT = "/tmp/impl12-capture/shots";
mkdirSync(OUT, { recursive: true });

const base = `http://localhost:${info.metroPort}`;
const host = {
  serverId: info.serverId,
  label: "localhost",
  connections: [
    { id: `direct:127.0.0.1:${info.daemonPort}`, type: "directTcp", endpoint: `127.0.0.1:${info.daemonPort}` },
  ],
  preferredConnectionId: `direct:127.0.0.1:${info.daemonPort}`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export function agentRoute(workspaceId, agentId) {
  return `/h/${info.serverId}/workspace/${workspaceId}?open=${encodeURIComponent(`agent:${agentId}`)}`;
}

export async function openPage({ width, height, scale, mobile = false }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: "dark",
    locale: "zh-CN",
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  await page.route(/:(6767)\b/, (route) => route.abort());
  await page.addInitScript((daemon) => {
    if (!localStorage.getItem("@osuna:daemon-registry")) {
      localStorage.setItem("@osuna:daemon-registry", JSON.stringify([daemon]));
    }
    // 无头 Chromium 把默认栈里的 SFMono-Regular 解析成比例字体；显式选 Menlo（设置里的"代码字体"）。
    if (!localStorage.getItem("@osuna:app-settings")) {
      localStorage.setItem("@osuna:app-settings", JSON.stringify({ monoFontFamily: "Menlo" }));
    }
  }, host);
  return { browser, page };
}

export { info, base, OUT };
