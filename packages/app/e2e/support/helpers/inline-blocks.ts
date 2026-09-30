import { expect, type Locator, type Page } from "@playwright/test";
import type { ListCommandsResponse } from "@getpaseo/protocol/messages";
import type { InlineBlockVariant } from "@/inline-blocks";
import { daemonWsRoutePattern } from "./daemon-port";

export type StubbedAgentCommand = ListCommandsResponse["payload"]["commands"][number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The frame with its list_commands_response payload swapped for `commands`, or null for
 * non-JSON frames and every other message, which pass through unchanged.
 */
function rewriteListCommandsFrame(
  message: string,
  commands: readonly StubbedAgentCommand[],
): string | null {
  let frame: unknown;
  try {
    frame = JSON.parse(message);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(frame) || frame.type !== "session") return null;
  const response = frame.message;
  if (!isRecord(response) || response.type !== "list_commands_response") return null;
  if (!isRecord(response.payload)) return null;
  const payload = { ...response.payload, commands: [...commands], error: null };
  return JSON.stringify({ ...frame, message: { ...response, payload } });
}

/**
 * Replaces every agent's command list with `commands`. The mock provider reports none, and the
 * bubble only shows a leading `/name` as a Skill block when the name is a listed skill.
 * Install before navigating; the route survives reloads.
 */
export async function installAgentCommandsStub(
  page: Page,
  commands: readonly StubbedAgentCommand[],
): Promise<void> {
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") {
        ws.send(message);
        return;
      }
      ws.send(rewriteListCommandsFrame(message, commands) ?? message);
    });
  });
}

export interface ExpectedInlineBlock {
  variant: InlineBlockVariant;
  /** The block's accessible name, e.g. "File: x.ts". */
  label: string;
}

/** The inline blocks inside `container`, in reading order. */
export async function expectInlineBlocks(
  container: Locator,
  expected: readonly ExpectedInlineBlock[],
): Promise<void> {
  const blocks = container.getByTestId("inline-block");
  await expect(blocks).toHaveCount(expected.length, { timeout: 15_000 });
  for (const [index, block] of expected.entries()) {
    const locator = blocks.nth(index);
    await expect(locator).toHaveAttribute("data-inline-block", block.variant);
    await expect(locator).toHaveAccessibleName(block.label);
    await expect(locator).toBeVisible();
  }
}
