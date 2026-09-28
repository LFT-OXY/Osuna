import React, { act, useEffect, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { userEvent } from "@vitest/browser/context";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { useAutocomplete } from "@/hooks/use-autocomplete";
import { Autocomplete, type AutocompleteOption } from "./autocomplete";
import { orderAutocompleteGroups } from "./autocomplete-utils";

// 应用源码在 Vitest 下按经典 JSX 运行时编译，需要全局的 React。
beforeEach(() => vi.stubGlobal("React", React));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

const HELP: AutocompleteOption = {
  id: "help",
  label: "/help",
  description: "Show help",
  kind: "command",
};
const TDD: AutocompleteOption = {
  id: "tdd",
  label: "/tdd",
  description: "Write a red test first",
  detail: "<feature>",
  kind: "skill",
};
const COMPACT: AutocompleteOption = {
  id: "compact",
  label: "/compact",
  description: "Compact the context",
  kind: "command",
};
const REVIEW: AutocompleteOption = {
  id: "review",
  label: "/review",
  description: "Review changes",
  kind: "skill",
};

function makeOptions(kind: "command" | "skill", count: number): AutocompleteOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${kind}-${index}`,
    label: `/${kind}-${index}`,
    kind,
  }));
}

interface HarnessProps {
  options: readonly AutocompleteOption[];
  onSelect: (option: AutocompleteOption) => void;
  isLoading?: boolean;
  errorMessage?: string;
  footerText?: string;
  maxHeight?: number;
}

// Composer 里的接法：选项先分组，高亮与键盘由 useAutocomplete 管，按键从输入框转发过来。
function Harness({
  options,
  onSelect,
  isLoading,
  errorMessage,
  footerText,
  maxHeight,
}: HarnessProps) {
  const ordered = useMemo(() => orderAutocompleteGroups(options), [options]);
  const { selectedIndex, onHighlight, onKeyPress } = useAutocomplete({
    isVisible: true,
    options: ordered,
    query: "",
    onSelectOption: onSelect,
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      onKeyPress({ key: event.key, preventDefault: () => event.preventDefault() });
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onKeyPress]);
  return (
    <Autocomplete
      options={ordered}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onHighlight={onHighlight}
      isLoading={isLoading}
      errorMessage={errorMessage}
      loadingText="Loading commands..."
      emptyText="No commands found"
      footerText={footerText}
      maxHeight={maxHeight}
    />
  );
}

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(props: Omit<HarnessProps, "onSelect">) {
  const onSelect = vi.fn<(option: AutocompleteOption) => void>();
  const container = document.createElement("div");
  container.style.width = "360px";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness {...props} onSelect={onSelect} />));
  mounted.push({ root, container });
  const rerender = (next: Omit<HarnessProps, "onSelect">) =>
    act(() => root.render(<Harness {...next} onSelect={onSelect} />));
  return { container, onSelect, rerender };
}

function rowLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="option"]')).map(
    (row) => row.querySelector('[data-testid="autocomplete-option-label"]')?.textContent ?? "",
  );
}

function highlightedLabel(container: HTMLElement): string | null {
  const rows = Array.from(container.querySelectorAll('[role="option"]'));
  const highlighted = rows.filter((row) => row.getAttribute("aria-selected") === "true");
  if (highlighted.length > 1) throw new Error("More than one row is highlighted");
  return (
    highlighted[0]?.querySelector('[data-testid="autocomplete-option-label"]')?.textContent ?? null
  );
}

// 分组标题与各行按文档顺序排出的可见文本，用来断言"标题在它那组的行上面"。
function visibleSequence(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll(
      '[data-testid="autocomplete-group-title"], [data-testid="autocomplete-option-label"]',
    ),
  ).map((node) => node.textContent ?? "");
}

async function nextFrames() {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

function isInsideScroller(container: HTMLElement, element: Element): boolean {
  const scroller = Array.from(container.querySelectorAll<HTMLElement>("div")).find(
    (node) =>
      node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== "visible",
  );
  if (!scroller) throw new Error("The list did not become scrollable");
  const viewport = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1;
}

async function press(key: string) {
  await act(async () => {
    await userEvent.keyboard(`{${key}}`);
  });
}

afterEach(async () => {
  await userEvent.unhover(document.body);
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

describe("Command menu", () => {
  it("groups commands above skills, each under its title", () => {
    const { container } = mount({ options: [TDD, HELP, REVIEW, COMPACT] });

    expect(visibleSequence(container)).toEqual([
      "Commands",
      "/help",
      "/compact",
      "Skills",
      "/tdd",
      "/review",
    ]);
  });

  it("drops the title of a group that has no rows", () => {
    const { container } = mount({ options: [TDD, REVIEW] });

    expect(visibleSequence(container)).toEqual(["Skills", "/tdd", "/review"]);
  });

  it("shows the description and argument hint on the row", () => {
    const { container } = mount({ options: [TDD] });
    const row = container.querySelector('[role="option"]');

    expect(row?.textContent).toContain("Write a red test first");
    expect(row?.textContent).toContain("<feature>");
  });

  it("highlights the first row when it opens", () => {
    const { container } = mount({ options: [TDD, HELP, REVIEW] });

    expect(rowLabels(container)).toEqual(["/help", "/tdd", "/review"]);
    expect(highlightedLabel(container)).toBe("/help");
  });

  it("moves the highlight with the arrow keys across groups and selects it with Enter", async () => {
    const { container, onSelect } = mount({ options: [TDD, HELP] });

    await press("ArrowDown");
    expect(highlightedLabel(container)).toBe("/tdd");

    await press("Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0].id).toBe("tdd");
  });

  it("selects the highlighted row with Tab", async () => {
    const { onSelect } = mount({ options: [HELP, TDD] });

    await press("Tab");
    expect(onSelect.mock.calls[0]?.[0].id).toBe("help");
  });

  it("skips the hint row at the foot of the list", async () => {
    const { container } = mount({
      options: [HELP, TDD],
      footerText: "Send a message to load all commands",
    });

    expect(container.textContent).toContain("Send a message to load all commands");
    await press("ArrowUp");
    expect(highlightedLabel(container)).toBe("/tdd");
    await press("ArrowDown");
    expect(highlightedLabel(container)).toBe("/help");
  });

  it("moves the highlight to the row under the pointer", async () => {
    const { container } = mount({ options: [HELP, TDD, REVIEW] });
    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');

    await act(async () => {
      await userEvent.hover(rows[2]!);
    });
    expect(highlightedLabel(container)).toBe("/review");

    await press("ArrowUp");
    expect(highlightedLabel(container)).toBe("/tdd");
  });

  it("keeps the keyboard highlight when a row scrolls under a still pointer", () => {
    const { container } = mount({ options: [HELP, TDD, REVIEW] });
    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');

    // 列表滚动后浏览器只补发边界事件（pointerover / pointerenter），不发 pointermove。
    act(() => {
      rows[2]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      rows[2]!.dispatchEvent(new PointerEvent("pointerenter"));
    });
    expect(highlightedLabel(container)).toBe("/help");
  });

  it("selects a row when it is clicked", async () => {
    const { container, onSelect } = mount({ options: [HELP, TDD] });
    const rows = container.querySelectorAll<HTMLElement>('[role="option"]');

    await act(async () => {
      await userEvent.click(rows[1]!);
    });
    expect(onSelect.mock.calls[0]?.[0].id).toBe("tdd");
  });

  it("scrolls a group's title into view with its first row", async () => {
    const { container } = mount({ options: [...makeOptions("command", 8), TDD], maxHeight: 120 });
    const commandsTitle = container.querySelector('[data-testid="autocomplete-group-title"]')!;

    await press("ArrowUp");
    await nextFrames();
    expect(highlightedLabel(container)).toBe("/tdd");
    expect(isInsideScroller(container, commandsTitle)).toBe(false);

    await press("ArrowDown");
    await nextFrames();
    expect(highlightedLabel(container)).toBe("/command-0");
    expect(isInsideScroller(container, commandsTitle)).toBe(true);
  });

  it("keeps a group's title in view after filtering moves it", async () => {
    const skills = makeOptions("skill", 8);
    const { container, rerender } = mount({
      options: [...makeOptions("command", 4), ...skills],
      maxHeight: 120,
    });
    await nextFrames();

    // 过滤掉两条命令：技能组标题整体上移，尺寸不变。
    rerender({ options: [...makeOptions("command", 2), ...skills], maxHeight: 120 });
    await nextFrames();
    await press("ArrowUp");
    await nextFrames();
    const lastRow = Array.from(container.querySelectorAll('[role="option"]')).at(-1)!;
    expect(highlightedLabel(container)).toBe("/skill-7");
    expect(isInsideScroller(container, lastRow)).toBe(true);
    for (let step = 0; step < skills.length - 1; step += 1) {
      await press("ArrowUp");
      await nextFrames();
    }

    expect(highlightedLabel(container)).toBe("/skill-0");
    const titles = container.querySelectorAll('[data-testid="autocomplete-group-title"]');
    expect(titles[1]?.textContent).toBe("Skills");
    expect(isInsideScroller(container, titles[1]!)).toBe(true);
  });

  it("says so when nothing matches", () => {
    const { container } = mount({ options: [] });

    expect(container.textContent).toContain("No commands found");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("shows the no-match row and the incomplete-list hint together", () => {
    const { container } = mount({
      options: [],
      footerText: "Send a message to load all commands",
    });

    expect(container.textContent).toContain("No commands found");
    expect(container.textContent).toContain("Send a message to load all commands");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("shows a load failure as a hint row", () => {
    const { container } = mount({ options: [], errorMessage: "daemon offline" });

    expect(container.textContent).toContain("Error: daemon offline");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("shows the loading row with nothing to select", async () => {
    const { container, onSelect } = mount({ options: [], isLoading: true });

    expect(container.textContent).toContain("Loading commands...");
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);
    await press("Enter");
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("File list", () => {
  it("lists files and folders top-down without group titles", () => {
    const { container } = mount({
      options: [
        { id: "directory:src", label: "src", kind: "directory" },
        { id: "file:README.md", label: "README.md", kind: "file" },
        { id: "directory:docs", label: "docs", kind: "directory" },
      ],
    });

    expect(visibleSequence(container)).toEqual(["src", "README.md", "docs"]);
    expect(highlightedLabel(container)).toBe("src");
  });
});
