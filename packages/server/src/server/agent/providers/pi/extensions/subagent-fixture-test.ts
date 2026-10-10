import { readFileSync } from "node:fs";
import pino from "pino";
import { expect, vi } from "vitest";
import type { AgentStreamEvent } from "../../../agent-sdk-types.js";
import { PiRpcAgentClient } from "../agent.js";
import { streamPiHistory } from "../history-mapper.js";
import type { PiAgentMessage, PiAgentSessionEvent } from "../rpc-types.js";
import { FakePi } from "../test-utils/fake-pi.js";

interface Fixture {
  provenance: {
    package: string;
    version: string;
    sourceCommit: string;
    piVersion: string;
    captureDate: string;
  };
  events: PiAgentSessionEvent[];
  messages: PiAgentMessage[];
}

export function readSubagentFixture(
  path: URL,
  replaceSessionFile?: { from: string; to: string },
): Fixture {
  let source = readFileSync(path, "utf8");
  if (replaceSessionFile)
    source = source.replaceAll(
      replaceSessionFile.from,
      JSON.stringify(replaceSessionFile.to).slice(1, -1),
    );
  const fixture = JSON.parse(source) as Fixture;
  expect(fixture.provenance).toEqual({
    package: expect.any(String),
    version: expect.any(String),
    sourceCommit: expect.any(String),
    piVersion: expect.any(String),
    captureDate: expect.any(String),
  });
  return fixture;
}

export async function verifySubagentFixture(
  fixture: Fixture,
): Promise<Extract<AgentStreamEvent, { type: "provider_subagent" }>[]> {
  const pi = new FakePi();
  const client = new PiRpcAgentClient({ logger: pino({ level: "silent" }), runtime: pi });
  const session = await client.createSession({
    provider: "pi",
    cwd: "/tmp/paseo-pi-subagent-fixture",
  });
  const live: AgentStreamEvent[] = [];
  session.subscribe((event) => live.push(event));
  try {
    await session.startTurn("Delegate work");
    for (const event of fixture.events) pi.latestSession().emit(event);
    const immediate = live.filter((event) => event.type === "provider_subagent");
    expect(immediate.some((event) => event.event.type === "timeline")).toBe(false);
    pi.latestSession().finishTurn();
    const replay: AgentStreamEvent[] = [];
    for await (const event of streamPiHistory("pi", fixture.messages)) replay.push(event);
    const replaySubagents = replay.filter((event) => event.type === "provider_subagent");
    await vi.waitFor(() => {
      expect(live.filter((event) => event.type === "provider_subagent")).toEqual(replaySubagents);
    });
    // Osuna：display:false 的 custom 消息不进时间线，实时与回放一致；其余照常显示成助手消息。
    for (const message of fixture.messages) {
      if (message.role !== "custom" || typeof message.content !== "string") continue;
      const text = message.content;
      const showsAsAssistantText = (event: AgentStreamEvent) =>
        event.type === "timeline" &&
        event.item.type === "assistant_message" &&
        event.item.text === text;
      const shown = message.display !== false;
      expect(live.some(showsAsAssistantText)).toBe(shown);
      expect(replay.some(showsAsAssistantText)).toBe(shown);
    }
    const liveSubagents = live.filter((event) => event.type === "provider_subagent");
    const firstTimeline = liveSubagents.findIndex((event) => event.event.type === "timeline");
    if (firstTimeline !== -1) {
      expect(
        liveSubagents.slice(0, firstTimeline).some((event) => event.event.type === "upsert"),
      ).toBe(true);
    }
    expect(liveSubagents).toEqual(replaySubagents);
    return liveSubagents;
  } finally {
    await session.close();
  }
}
