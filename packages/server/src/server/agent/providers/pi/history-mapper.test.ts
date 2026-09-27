import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { streamPiHistory, type PiCapturedUserMessageEntry } from "./history-mapper.js";
import type { PiAgentMessage } from "./rpc-types.js";

async function collectHistory(
  messages: PiAgentMessage[],
  userEntries: PiCapturedUserMessageEntry[] = [],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamPiHistory("pi", messages, userEntries)) {
    events.push(event);
  }
  return events;
}

describe("Pi history mapper", () => {
  test("replays user, assistant, reasoning, and completed tool calls", async () => {
    await expect(
      collectHistory([
        {
          role: "user",
          content: [
            { type: "text", text: "read this" },
            { type: "image", data: "base64", mimeType: "image/png" },
            { type: "text", text: "then answer" },
          ],
        },
        {
          role: "assistant",
          responseId: "response-1",
          content: [
            { type: "thinking", thinking: "checking file" },
            { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "note.txt" } },
            { type: "text", text: "done" },
          ],
        },
        {
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "read this\n\nthen answer",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "reasoning", text: "checking file" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "running",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: undefined,
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "done", messageId: "response-1" },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "read",
          status: "completed",
          detail: {
            type: "read",
            filePath: "note.txt",
            content: "file contents",
            offset: undefined,
            limit: undefined,
          },
          error: null,
        },
      },
    ]);
  });

  test("replays bash execution records as completed shell calls", async () => {
    await expect(
      collectHistory([
        {
          role: "bashExecution",
          command: "echo hi",
          output: "hi\n",
          exitCode: 0,
          timestamp: 123,
        },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "tool_call",
          callId: "pi-bash-123",
          name: "bash",
          status: "completed",
          detail: { type: "shell", command: "echo hi", output: "hi\n", exitCode: 0 },
          error: null,
        },
      },
    ]);
  });

  test("replays non-notice custom messages as assistant text, matching the live path", async () => {
    await expect(
      collectHistory([{ role: "custom", content: "Extension command output" }]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "Extension command output" },
      },
    ]);
  });

  test("omits replayed custom messages that declare display false", async () => {
    await expect(
      collectHistory([
        { role: "user", content: "hello" },
        {
          role: "custom",
          customType: "atw-runtime-context",
          content: "<workflow-state>\nPlanning\n</workflow-state>",
          display: false,
        },
        { role: "custom", customType: "status", content: "Shown output", display: true },
      ]),
    ).resolves.toEqual([
      { type: "timeline", provider: "pi", item: { type: "user_message", text: "hello" } },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "assistant_message", text: "Shown output" },
      },
    ]);
  });

  test("replays expanded Pi skill blocks as the typed /skill command", async () => {
    const skillBlock =
      '<skill name="atw-implement" location="/repo/.agents/skills/atw-implement/SKILL.md">\n' +
      "References are relative to /repo/.agents/skills/atw-implement.\n\n" +
      "# Implement\n\nLong skill body.\n" +
      "</skill>";

    await expect(
      collectHistory([
        { role: "user", content: `${skillBlock}\n\nprd.md\nfocus on the live path` },
        { role: "user", content: skillBlock },
      ]),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "/skill:atw-implement prd.md\nfocus on the live path",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: { type: "user_message", text: "/skill:atw-implement" },
      },
    ]);
  });

  test("replays user messages that only resemble a skill block verbatim", async () => {
    const mentionsSkill = 'Why does <skill name="x" location="/x/SKILL.md"> show up?';
    const trailingText =
      '<skill name="x" location="/x/SKILL.md">\nbody\n</skill>\nnot separated by a blank line';

    await expect(
      collectHistory([
        { role: "user", content: mentionsSkill },
        { role: "user", content: trailingText },
      ]),
    ).resolves.toEqual([
      { type: "timeline", provider: "pi", item: { type: "user_message", text: mentionsSkill } },
      { type: "timeline", provider: "pi", item: { type: "user_message", text: trailingText } },
    ]);
  });

  test("uses Pi tree entry ids for replayed user messages", async () => {
    await expect(
      collectHistory(
        [
          { role: "user", content: "first prompt" },
          { role: "assistant", content: [{ type: "text", text: "first answer" }] },
          { role: "user", content: "second prompt" },
        ],
        [
          { id: "entry-user-1", text: "first prompt" },
          { id: "entry-user-2", text: "second prompt" },
        ],
      ),
    ).resolves.toEqual([
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "first prompt",
          messageId: "entry-user-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "assistant_message",
          text: "first answer",
          messageId: "pi-history-assistant-1",
        },
      },
      {
        type: "timeline",
        provider: "pi",
        item: {
          type: "user_message",
          text: "second prompt",
          messageId: "entry-user-2",
        },
      },
    ]);
  });
});
