import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "@vitest/browser/context";
import { afterEach, describe, expect, it } from "vitest";
import { Row } from "./row";

// 测试主题（test-stubs/react-native-unistyles.ts）里的行 token。
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const HOVER = "rgb(241, 241, 241)";
const ACTIVE = "rgb(228, 228, 228)";
const SELECTED = "rgb(234, 234, 234)";
const SELECTED_RING = "rgb(218, 218, 218) 0px 0px 0px 1px inset";
const FOREGROUND = "rgb(17, 17, 17)";
const FOREGROUND_MUTED = "rgb(102, 102, 102)";

interface MountedRow {
  root: Root;
  container: HTMLDivElement;
}

const mounted: MountedRow[] = [];

function noop() {}

function renderActions() {
  return <span data-testid="row-actions-content">⋮</span>;
}

function mountRow(props: { selected?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() =>
    root.render(
      <Row
        title="feat/ui-redesign"
        selected={props.selected}
        onPress={noop}
        renderActions={renderActions}
        testID="row"
      />,
    ),
  );
  mounted.push({ root, container });

  const row = container.querySelector<HTMLElement>('[data-testid="row"]');
  const title = row?.querySelector<HTMLElement>('[data-testid="row-title"]');
  const actions = row?.querySelector<HTMLElement>('[data-testid="row-actions"]');
  if (!row || !title || !actions) {
    throw new Error("Row did not render its press target, title, and actions slot");
  }
  return { row, title, actions };
}

afterEach(async () => {
  await userEvent.unhover(document.body);
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("Row", () => {
  it("rests with no fill, a muted label-size title, and hidden actions", () => {
    const { row, title, actions } = mountRow();

    expect(getComputedStyle(row).backgroundColor).toBe(TRANSPARENT);
    expect(getComputedStyle(row).boxShadow).toBe("none");
    expect(getComputedStyle(title).color).toBe(FOREGROUND_MUTED);
    expect(getComputedStyle(title).fontSize).toBe("13px");
    expect(getComputedStyle(actions).opacity).toBe("0");
    expect(getComputedStyle(actions).pointerEvents).toBe("none");
  });

  it("fills with the hover token, lifts the title, and reveals actions on hover", async () => {
    const { row, title, actions } = mountRow();

    await userEvent.hover(row);

    await expect.poll(() => getComputedStyle(row).backgroundColor).toBe(HOVER);
    expect(getComputedStyle(title).color).toBe(FOREGROUND);
    expect(getComputedStyle(actions).opacity).toBe("1");
    expect(getComputedStyle(actions).pointerEvents).toBe("auto");
  });

  it("fills with the active token while pressed", async () => {
    const { row } = mountRow();

    // react-native-web 的响应者系统以 mousedown 作为按下的起点。
    act(() => {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1 }));
    });

    await expect.poll(() => getComputedStyle(row).backgroundColor).toBe(ACTIVE);

    act(() => {
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    });
  });

  it("marks selection with the selected fill and a thin inset ring", () => {
    const { row, title } = mountRow({ selected: true });

    expect(getComputedStyle(row).backgroundColor).toBe(SELECTED);
    expect(getComputedStyle(row).boxShadow).toBe(SELECTED_RING);
    expect(getComputedStyle(title).color).toBe(FOREGROUND);
    expect(row.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the selected fill and ring while a selected row is hovered", async () => {
    const { row, actions } = mountRow({ selected: true });

    await userEvent.hover(row);

    await expect.poll(() => getComputedStyle(actions).opacity).toBe("1");
    expect(getComputedStyle(row).backgroundColor).toBe(SELECTED);
    expect(getComputedStyle(row).boxShadow).toBe(SELECTED_RING);
  });
});
