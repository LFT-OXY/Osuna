import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import { page } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipTrigger } from "@/components/ui/tooltip";
import { i18n } from "@/i18n/i18next";
import type { TurnUsageModelRow, TurnUsagePanelModel } from "@/usage/turn-usage";
import { TURN_USAGE_PANEL_WIDTH, TurnUsagePanel } from "./turn-usage-panel";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  await i18n.changeLanguage("en");
});

const LONG_MODEL = "orcarouter/Qwen3.8-27B-Instruct-MLX-4bit-dwq-experimental";

function row(model: string, overrides: Partial<TurnUsageModelRow> = {}): TurnUsageModelRow {
  return {
    model,
    input: 14_312,
    cache: 188_600,
    output: 4_580,
    reasoning: 0,
    estimatedCost: 0.189606,
    priced: true,
    ...overrides,
  };
}

const PANELS: Record<string, TurnUsagePanelModel> = {
  "one model with reasoning": {
    totals: {
      input: 8_420,
      cache: 51_200,
      output: 3_120,
      reasoning: 1_856,
      estimatedCost: 0.048125,
      priced: true,
    },
    models: { kind: "single", model: row(LONG_MODEL, { reasoning: 1_856 }) },
    unpricedModels: [],
  },
  "two models": {
    totals: {
      input: 16_412,
      cache: 200_600,
      output: 5_220,
      reasoning: 0,
      estimatedCost: 0.196106,
      priced: true,
    },
    models: {
      kind: "multi",
      models: [row(LONG_MODEL), row("claude-haiku-4-5", { estimatedCost: 0.0065 })],
    },
    unpricedModels: [],
  },
  "a model without price data": {
    totals: {
      input: 26_040,
      cache: 328_400,
      output: 7_030,
      reasoning: 640,
      estimatedCost: 0.00953,
      priced: false,
    },
    models: {
      kind: "multi",
      models: [
        row(LONG_MODEL, { estimatedCost: 0, priced: false, reasoning: 640 }),
        row("claude-haiku-4-5", { estimatedCost: 0.00953 }),
      ],
    },
    unpricedModels: [LONG_MODEL],
  },
};

const MODEL_NAMES: Record<string, string[]> = {
  "one model with reasoning": [LONG_MODEL],
  "two models": [LONG_MODEL, "claude-haiku-4-5"],
  "a model without price data": [LONG_MODEL, "claude-haiku-4-5"],
};

// 输入、缓存、输出，有推理时加一格。
const STAT_COUNT: Record<string, number> = {
  "one model with reasoning": 4,
  "two models": 3,
  "a model without price data": 4,
};

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mountPanel(panel: TurnUsagePanelModel, triggerLeft: number): void {
  const container = document.createElement("div");
  container.style.cssText = `position: absolute; top: 600px; left: ${triggerLeft}px;`;
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Tooltip open enabledOnDesktop enabledOnMobile>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable testID="trigger">
            <Text>· ↑14.3K ↓4.6K · $0.17</Text>
          </Pressable>
        </TooltipTrigger>
        <TurnUsagePanel panel={panel} durationMs={132_000} />
      </Tooltip>,
    ),
  );
  mounted.push({ root, container });
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function byTestId(testID: string): HTMLElement {
  const element = document.querySelector(`[data-testid="${testID}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${testID} did not render`);
  }
  return element;
}

async function placedFrame(): Promise<DOMRect> {
  // 定位要等触发器量完、外框 onLayout 之后才落位；之前在 -9999。
  await expect
    .poll(
      () =>
        document.querySelector('[data-testid="turn-usage-panel"]')?.getBoundingClientRect().left,
    )
    .toBeGreaterThanOrEqual(0);
  return byTestId("turn-usage-panel").getBoundingClientRect();
}

describe.each([
  ["desktop", 1280, 900, 560],
  ["phone", 390, 844, 140],
])("the turn usage panel on a %s screen", (_label, width, height, triggerLeft) => {
  beforeAll(async () => {
    await page.viewport(width, height);
  });

  it.each(Object.keys(PANELS))("keeps every piece inside its frame with %s", async (name) => {
    mountPanel(PANELS[name], triggerLeft);
    const frame = await placedFrame();

    expect(frame.width).toBe(TURN_USAGE_PANEL_WIDTH);
    expect(frame.left).toBeGreaterThanOrEqual(8);
    expect(frame.right).toBeLessThanOrEqual(width - 8);

    // 零宽节点（空的 Text、折叠的包装层）不占位置，不参与越界判断。
    const drawn = [...byTestId("turn-usage-panel").querySelectorAll("*")]
      .map((element) => ({
        label: element.textContent ?? element.tagName,
        rect: element.getBoundingClientRect(),
      }))
      .filter((entry) => entry.rect.width > 0);
    for (const { label, rect } of drawn) {
      expect(rect.left, label).toBeGreaterThanOrEqual(frame.left - 0.5);
      expect(rect.right, label).toBeLessThanOrEqual(frame.right + 0.5);
    }

    const modelNames = [...document.querySelectorAll('[data-testid="turn-usage-panel-model"]')];
    expect(modelNames.map((modelName) => modelName.textContent)).toEqual(MODEL_NAMES[name]);
    for (const modelName of modelNames) {
      const rect = modelName.getBoundingClientRect();
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.right).toBeLessThanOrEqual(frame.right);
    }

    const valueTops = [
      ...document.querySelectorAll('[data-testid="turn-usage-panel-stat-value"]'),
    ].map((value) => value.getBoundingClientRect().top);
    expect(valueTops).toHaveLength(STAT_COUNT[name]);
    expect(new Set(valueTops).size).toBe(1);
  });

  it("centres the frame on the segment that opened it", async () => {
    mountPanel(PANELS["two models"], triggerLeft);
    const frame = await placedFrame();
    const trigger = byTestId("trigger").getBoundingClientRect();

    const triggerCentre = trigger.left + trigger.width / 2;
    const clampedLeft = Math.min(
      width - 8 - TURN_USAGE_PANEL_WIDTH,
      Math.max(8, triggerCentre - TURN_USAGE_PANEL_WIDTH / 2),
    );
    expect(frame.left).toBeCloseTo(clampedLeft, 0);
  });
});

describe("the turn usage panel's content", () => {
  it("gives reasoning its own cell only when the turn has some", async () => {
    mountPanel(PANELS["one model with reasoning"], 560);
    await placedFrame();

    expect(byTestId("turn-usage-panel-stat-output").textContent).toBe("Output3.1K");
    expect(byTestId("turn-usage-panel-stat-reasoning").textContent).toBe("Incl. reasoning1.9K");
  });

  it("marks a turn with a model counted at $0", async () => {
    mountPanel(PANELS["a model without price data"], 560);
    await placedFrame();

    expect(getComputedStyle(byTestId("turn-usage-panel-cost")).textDecorationStyle).toBe("dotted");
    expect(byTestId("turn-usage-panel-unpriced-warning").textContent).toBe(
      `${LONG_MODEL} has no price data and counts as $0. Set a custom price in Settings › Price table.`,
    );
    const unpricedEntry = byTestId("turn-usage-panel-model").parentElement;
    expect(unpricedEntry?.textContent).toBe(`${LONG_MODEL}No price data`);
  });

  it("names a lone model without a per-model list", async () => {
    mountPanel(PANELS["one model with reasoning"], 560);
    await placedFrame();

    expect(byTestId("turn-usage-panel").textContent).not.toContain("By model");
    expect(document.querySelector('[data-testid="turn-usage-panel-unpriced-warning"]')).toBeNull();
  });
});
