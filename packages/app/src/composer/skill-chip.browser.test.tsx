import React, { act, useCallback, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { EditingTextInput as ComposerTextInput } from "@/components/ui/text-input/text-input.web";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { i18n } from "@/i18n/i18next";
import { ComposerAttachmentTray } from "./attachment-tray";
import { resolveSkillChipBackspace, removeSkillChip, type SkillChip } from "./skill-chips";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * Composer 入口与 MessageInput 在 browser 项目里加载不了（expo-modules-core），所以这里用真实的
 * web 文本输入、真实的 Attachment tray 和 Composer 用的同一个退格判定，拼出输入区。
 */

const askme: SkillChip = { name: "atw-askme", description: "Ask me questions" };
const tdd: SkillChip = { name: "atw-tdd" };

const TRAY_LABELS = {
  skillChip: (name: string) => i18n.t("composer.attachments.skillChip", { name }),
  removeSkill: i18n.t("composer.attachments.removeSkill"),
};

function ignoreAttachmentAction(): void {}

function SkillChipComposer({
  initialText,
  initialChips,
}: {
  initialText: string;
  initialChips: readonly SkillChip[];
}) {
  const [chips, setChips] = useState(initialChips);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const handleRemove = useCallback(
    (name: string) => setChips((current) => removeSkillChip(current, name)),
    [],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const textarea = inputRef.current?.getNativeRef();
      if (!(textarea instanceof HTMLTextAreaElement)) return;
      const remaining = resolveSkillChipBackspace({
        key: event.nativeEvent.key,
        selection: { start: textarea.selectionStart, end: textarea.selectionEnd },
        chips,
      });
      if (!remaining) return;
      event.preventDefault();
      setChips(remaining);
    },
    [chips],
  );
  return (
    <>
      <ComposerAttachmentTray
        skillChips={chips}
        hasAttachments
        disabled={false}
        onRemoveSkillChip={handleRemove}
        labels={TRAY_LABELS}
      >
        <AttachmentPill
          testID="file-attachment"
          onOpen={ignoreAttachmentAction}
          onRemove={ignoreAttachmentAction}
          openAccessibilityLabel="Open notes.md"
          removeAccessibilityLabel="Remove notes.md"
        >
          <AttachmentLabel title="notes.md" subtitle="Markdown" />
        </AttachmentPill>
      </ComposerAttachmentTray>
      <ComposerTextInput
        ref={inputRef}
        initialValue={initialText}
        multiline
        onKeyPress={handleKeyPress}
        testID="composer-input"
      />
    </>
  );
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mount(props: { initialText: string; initialChips: readonly SkillChip[] }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<SkillChipComposer {...props} />));
  mounted.push({ root, container });
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("composer text input did not render a textarea");
  return { container, textarea };
}

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  await userEvent.unhover(document.body);
});

function trayItemTestIds(container: HTMLElement): (string | null)[] {
  const tray = container.querySelector('[data-testid="composer-attachment-tray"]');
  if (!tray) throw new Error("attachment tray did not render");
  return Array.from(
    tray.querySelectorAll('[data-testid="composer-skill-chip"], [data-testid="file-attachment"]'),
  ).map((item) => item.getAttribute("data-testid"));
}

function chipNames(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="composer-skill-chip"]')).map(
    (item) => item.textContent ?? "",
  );
}

function chip(container: HTMLElement, name: string): HTMLElement {
  const match = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="composer-skill-chip"]'),
  ).find((item) => item.textContent === name);
  if (!match) throw new Error(`no chip named ${name}`);
  return match;
}

async function pressBackspaceAt(textarea: HTMLTextAreaElement, caret: number): Promise<void> {
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  await userEvent.keyboard("{Backspace}");
}

describe("Skill chips in the composer", () => {
  it("lines the chips up before the attachments and reads them as Skill: name", () => {
    const { container } = mount({ initialText: "", initialChips: [askme, tdd] });

    expect(trayItemTestIds(container)).toEqual([
      "composer-skill-chip",
      "composer-skill-chip",
      "file-attachment",
    ]);
    expect(chipNames(container)).toEqual(["atw-askme", "atw-tdd"]);
    expect(
      Array.from(container.querySelectorAll('[role="group"]')).map((group) =>
        group.getAttribute("aria-label"),
      ),
    ).toEqual(["Skill: atw-askme", "Skill: atw-tdd"]);
  });

  it("removes the chip whose × is pressed and shows its name and description on hover", async () => {
    await page.viewport(1280, 800);
    const { container } = mount({ initialText: "", initialChips: [askme, tdd] });

    await userEvent.hover(chip(container, "atw-askme"));
    const tooltip = await vi.waitFor(() => {
      const node = document.querySelector('[data-testid="composer-skill-chip-tooltip"]');
      if (!node) throw new Error("tooltip not open");
      return node;
    });
    expect(tooltip.textContent).toBe("atw-askmeAsk me questions");

    const remove = chip(container, "atw-askme").querySelector(
      '[data-testid="composer-skill-chip-remove"]',
    );
    if (!(remove instanceof HTMLElement)) throw new Error("× did not appear on hover");
    expect(remove.getAttribute("aria-label")).toBe("Remove");
    await userEvent.click(remove);

    expect(chipNames(container)).toEqual(["atw-tdd"]);
  });

  it("removes the last chip on Backspace at the very start and keeps the prompt", async () => {
    const { container, textarea } = mount({ initialText: "hello", initialChips: [askme, tdd] });

    await pressBackspaceAt(textarea, 0);

    expect(chipNames(container)).toEqual(["atw-askme"]);
    expect(textarea.value).toBe("hello");
  });

  it("deletes a character, not a chip, on Backspace inside the prompt", async () => {
    const { container, textarea } = mount({ initialText: "hello", initialChips: [askme, tdd] });

    await pressBackspaceAt(textarea, 3);

    expect(chipNames(container)).toEqual(["atw-askme", "atw-tdd"]);
    expect(textarea.value).toBe("helo");
  });
});
