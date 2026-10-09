// 取官网用的真实界面图。要解析到 playwright，运行时连同 app-shot-lib.mjs 一起放到 packages/app 下。
// 前置：site-capture.spec.ts 已经起好隔离 daemon + Metro 并写出 /tmp/impl12-capture/info.json。
import { agentRoute, base, info, openPage, OUT } from "./app-shot-lib.mjs";

const only = process.argv[2];

async function settle(page) {
  await page.mouse.move(160, 640);
  await page.waitForTimeout(1200);
}

if (!only || only === "desktop") {
  const { browser, page } = await openPage({ width: 1440, height: 826, scale: 2 });
  await page.goto(base + agentRoute(info.workspaces.notes, info.agents.notes), { waitUntil: "commit" });
  await page.waitForTimeout(12000);
  const dismiss = page.locator('[data-testid^="worktree-setup-callout-"][data-testid$="-dismiss"]');
  if (await dismiss.count()) await dismiss.first().click();
  await page.getByTestId("workspace-explorer-toggle").first().click();
  await page.waitForTimeout(2500);
  await page.getByTestId(`workspace-tab-agent_${info.agents.notes}`).filter({ visible: true }).first().click();
  await settle(page);
  await page.screenshot({ path: `${OUT}/app-desktop-chat.png` });

  await page.getByTestId("diff-tree-file-0").first().click();
  await page.waitForTimeout(3500);
  await settle(page);
  await page.screenshot({ path: `${OUT}/app-desktop-review.png` });

  await page.getByTestId(`workspace-tab-terminal_${info.terminalId}`).filter({ visible: true }).first().click();
  await page.waitForTimeout(3000);
  await page.locator(".xterm").first().click();
  await page.keyboard.type("clear\n");
  await page.waitForTimeout(800);
  for (const command of ["git status --short", "git --no-pager diff --stat", "git --no-pager log --oneline"]) {
    await page.keyboard.type(`${command}\n`, { delay: 10 });
    await page.waitForTimeout(1000);
  }
  await settle(page);
  await page.screenshot({ path: `${OUT}/app-desktop-terminal.png` });
  await browser.close();
}

if (!only || only === "phone") {
  const { browser, page } = await openPage({ width: 402, height: 820, scale: 2, mobile: true });
  await page.goto(base + agentRoute(info.workspaces.notes, info.agents.notes), { waitUntil: "commit" });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${OUT}/app-phone-chat.png` });

  await page.getByTestId("menu-button").filter({ visible: true }).first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/app-phone-workspaces.png` });
  await page.getByTestId("sidebar-close").filter({ visible: true }).first().click();
  await page.waitForTimeout(1500);

  await page.getByTestId("workspace-explorer-toggle").filter({ visible: true }).first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/app-phone-changes.png` });
  await browser.close();
}
