import { afterEach, describe, expect, test } from "vitest";
import { createTestOsunaDaemon, type TestOsunaDaemon } from "../test-utils/osuna-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";

let daemon: TestOsunaDaemon | undefined;
let client: DaemonClient | undefined;

async function startDaemonAndReadEnabled(
  options: Parameters<typeof createTestOsunaDaemon>[0],
): Promise<Record<string, boolean | undefined>> {
  daemon = await createTestOsunaDaemon(options);
  client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  await client.connect();
  const snapshot = await client.getProvidersSnapshot();
  const enabledPairs = snapshot.entries.map((entry) => [entry.provider, entry.enabled]);
  return Object.fromEntries(enabledPairs);
}

// 不注入 agentClients：测试 daemon 会自动启用注入了客户端的提供方，这里要看的是出厂默认值。
describe("built-in provider defaults", () => {
  afterEach(async () => {
    await client?.close();
    await daemon?.close();
    client = undefined;
    daemon = undefined;
  });

  test("a fresh config enables Claude Code, Codex, Pi and Oh My Pi, and leaves Copilot and OpenCode off", async () => {
    const enabled = await startDaemonAndReadEnabled({ agentClients: {} });

    expect(enabled).toMatchObject({
      claude: true,
      codex: true,
      pi: true,
      omp: true,
      copilot: false,
      opencode: false,
    });
  });

  test("an explicit enabled: true keeps Copilot and OpenCode on", async () => {
    const enabled = await startDaemonAndReadEnabled({
      agentClients: {},
      providerOverrides: { copilot: { enabled: true }, opencode: { enabled: true } },
    });

    expect(enabled).toMatchObject({ copilot: true, opencode: true });
  });
});
