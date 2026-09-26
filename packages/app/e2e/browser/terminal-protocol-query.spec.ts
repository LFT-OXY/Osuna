import { writeFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "../support/fixtures";
import { TerminalE2EHarness } from "../support/helpers/terminal-dsl";
import { getTerminalBufferText, waitForTerminalContent } from "../support/helpers/terminal-perf";

const OSC11_CAPTURE_SCRIPT = `
let captured = Buffer.alloc(0);

function finish() {
  process.stdout.write("PASEO_OSC11_CAPTURE:" + JSON.stringify(captured.toString("latin1")) + "\\n");
  process.exit(0);
}

process.stdout.write("\\x1b]11;?\\x07");
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  captured = Buffer.concat([captured, chunk]);
  if (captured.includes(Buffer.from("rgb:"))) {
    finish();
  }
});
setTimeout(finish, 700);
`;

// 深色主题 terminal.background 是 styles/theme.ts 里 paseoDarkColors.surface0 = #0a0a0a，
// daemon 按 OSC 11 的 rgb:rrrr/gggg/bbbb 形式回答。
const DARK_TERMINAL_BACKGROUND_REPLY = "rgb:0a0a/0a0a/0a0a";

test.describe("Terminal protocol queries", () => {
  let harness: TerminalE2EHarness;

  test.beforeAll(async () => {
    harness = await TerminalE2EHarness.create({ tempPrefix: "terminal-protocol-query-" });
    await writeFile(path.join(harness.tempRepo.path, "osc11-capture.cjs"), OSC11_CAPTURE_SCRIPT);
  });

  test.afterAll(async () => {
    await harness?.cleanup();
  });

  test("does not send browser OSC 11 color-query replies back to the PTY", async ({ page }) => {
    const terminalInstance = await harness.createTerminal({ name: "osc11-query" });
    try {
      // daemon 按 app 上报的真实主题回答 OSC 11。跟随系统时 e2e 浏览器是浅色，底色合法地就是白，
      // 这条测试就分不出「正常的白」和「浏览器的回复漏回 PTY」。钉死深色主题，白重新只有一种解释。
      await page.addInitScript(() => {
        localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "dark" }));
      });
      await harness.openTerminal(page, { terminalId: terminalInstance.id });
      await harness.setupPrompt(page);

      const terminal = harness.terminalSurface(page);
      await terminal.pressSequentially("node osc11-capture.cjs\n", { delay: 0 });

      await waitForTerminalContent(page, (text) => text.includes("PASEO_OSC11_CAPTURE:"), 10_000);
      await page.waitForTimeout(500);

      const text = await getTerminalBufferText(page);

      expect(text).toContain(DARK_TERMINAL_BACKGROUND_REPLY);
      expect(text).not.toContain("rgb:ffff/ffff/ffff");
    } finally {
      await harness.killTerminal(terminalInstance.id);
    }
  });
});
