import React, { act, forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from "react-native";
import { page, userEvent } from "@vitest/browser/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import { ComposerTextInput } from "@/composer/input/text-input.web";
import type { ComposerTextInputHandle } from "@/composer/input/text-input.types";
import { i18n } from "@/i18n/i18next";
import { ComposerAttachmentTray } from "./attachment-tray";
import { resolveSkillChipBackspace, removeSkillChip, type SkillChip } from "./skill-chips";

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * Composer 入口与 MessageInput 在 browser 项目里加载不了（expo-modules-core），所以这里用 Composer
 * 真实的 web 文本输入、真实的 Attachment tray 和 Composer 用的同一个退格判定，拼出输入区。
 */

const askme: SkillChip = { name: "atw-askme", description: "Ask me questions" };
const tdd: SkillChip = { name: "atw-tdd" };

const TRAY_LABELS = {
  skillChip: (name: string) => i18n.t("composer.attachments.skillChip", { name }),
  removeSkill: i18n.t("composer.attachments.removeSkill"),
};

function ignoreAttachmentAction(): void {}

const SkillChipComposer = forwardRef<
  ComposerTextInputHandle,
  { initialText: string; initialChips: readonly SkillChip[] }
>(function SkillChipComposer({ initialText, initialChips }, ref) {
  const [chips, setChips] = useState(initialChips);
  const inputRef = useRef<ComposerTextInputHandle>(null);
  useImperativeHandle(ref, () => {
    if (!inputRef.current) throw new Error("composer text input did not mount");
    return inputRef.current;
  }, []);
  const handleRemove = useCallback(
    (name: string) => setChips((current) => removeSkillChip(current, name)),
    [],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const selection = inputRef.current?.getSelection?.();
      if (!selection) return;
      const remaining = resolveSkillChipBackspace({
        key: event.nativeEvent.key,
        selection,
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
});

const mounted: { root: Root; container: HTMLDivElement }[] = [];

function mount(props: { initialText: string; initialChips: readonly SkillChip[] }) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const inputRef = React.createRef<ComposerTextInputHandle>();
  act(() => root.render(<SkillChipComposer {...props} ref={inputRef} />));
  mounted.push({ root, container });
  if (!inputRef.current) throw new Error("composer text input did not mount");
  return { container, input: inputRef.current };
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

async function pressBackspaceAt(input: ComposerTextInputHandle, caret: number): Promise<void> {
  act(() => {
    input.focus();
    input.replaceText(input.getText(), { start: caret, end: caret });
  });
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
    const { container, input } = mount({ initialText: "hello", initialChips: [askme, tdd] });

    await pressBackspaceAt(input, 0);

    expect(chipNames(container)).toEqual(["atw-askme"]);
    expect(input.getText()).toBe("hello");
  });

  it("deletes a character, not a chip, on Backspace inside the prompt", async () => {
    const { container, input } = mount({ initialText: "hello", initialChips: [askme, tdd] });

    await pressBackspaceAt(input, 3);

    expect(chipNames(container)).toEqual(["atw-askme", "atw-tdd"]);
    expect(input.getText()).toBe("helo");
  });
});
