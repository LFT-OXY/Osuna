import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import type { PendingPermission } from "@/types/shared";
import { QuestionFormCard } from "./question-form-card";

// Load translations so controls expose their real accessible names.
void testI18n;

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * A real browser with the real web `EditingTextInput`, because the bug under test lives in the
 * gap between that input and React state: the input owns its text and never replays state, so a
 * card that drops the Other text from state alone keeps showing it while submit ignores it.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function buildPermission(questions: Record<string, unknown>[]): PendingPermission {
  return {
    key: "perm-1",
    agentId: "agent-1",
    request: {
      id: "perm-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: { questions },
    },
  };
}

// 辅助函数针对第一道题；后面的题只用来接住"答完跳到下一题"。
function mountCard(question: Record<string, unknown>, ...followUps: Record<string, unknown>[]) {
  const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QuestionFormCard
        permission={buildPermission([question, ...followUps])}
        onRespond={onRespond}
        isResponding={false}
      />,
    ),
  );
  mounted.push({ root, container });

  const view = within(container);
  const optionRole = question.multiSelect ? "checkbox" : "radio";
  const queryOtherInput = () =>
    view.queryByRole<HTMLInputElement>("textbox", { name: String(question.question) });
  const otherInput = () =>
    view.getByRole<HTMLInputElement>("textbox", { name: String(question.question) });
  const option = (label: string) => view.getByRole(optionRole, { name: label });
  const check = (label: string) => act(() => option(label).click());
  const type = (text: string) => {
    // Osuna 的卡片把输入框收在"其他..."行里，点开才出现。
    if (!queryOtherInput()) {
      act(() => view.getByTestId("question-form-other-option").click());
    }
    const input = otherInput();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("HTML input value setter is unavailable");
    act(() => {
      valueSetter.call(input, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    });
  };
  const press = (name: string) => act(() => view.getByRole("button", { name }).click());
  const submit = () => press("Submit");
  const showQuestion = (number: number) =>
    act(() => view.getByTestId(`question-form-question-nav-${number}`).click());
  const submittedAnswers = (): Record<string, string> => {
    const response = onRespond.mock.calls[0]?.[0];
    if (!response || response.behavior !== "allow") throw new Error("card did not submit");
    return (response.updatedInput as { answers: Record<string, string> }).answers;
  };
  return {
    check,
    option,
    type,
    otherInput,
    queryOtherInput,
    press,
    submit,
    showQuestion,
    submittedAnswers,
    respondCount: () => onRespond.mock.calls.length,
  };
}

const multiSelectQuestion = {
  question: "Which fruits do you like?",
  header: "Fruits",
  options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }],
  multiSelect: true,
  allowOther: true,
};

const singleSelectQuestion = {
  question: "Which provider?",
  header: "Provider",
  options: [{ label: "Claude Code" }, { label: "Codex" }],
  multiSelect: false,
  allowOther: true,
};

const followUpQuestion = {
  question: "Roll out now?",
  header: "Rollout",
  options: [{ label: "Now" }, { label: "Later" }],
  multiSelect: false,
};

describe("QuestionFormCard other answers", () => {
  it("keeps checked options when the other answer is typed afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.check("Apple");
    card.check("Cherry");
    card.type("durian");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Cherry, durian" });
  });

  it("keeps the typed other answer when options are checked afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.type("durian");
    card.check("Apple");
    card.check("Banana");

    expect(card.otherInput().value).toBe("durian");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Banana, durian" });
  });

  // Osuna 的单选题点选项即作答，没有"选完再提交"的中间状态。要在同一道题里先选后改，
  // 得有第二道题接住，再回到第一题。
  it("replaces the selected option with the typed other answer (single-select)", () => {
    const card = mountCard(singleSelectQuestion, followUpQuestion);

    card.check("Codex");
    card.showQuestion(1);
    expect(card.option("Codex").getAttribute("aria-checked")).toBe("true");

    card.type("OpenCode");
    expect(card.option("Codex").getAttribute("aria-checked")).toBe("false");

    card.press("Next");
    card.check("Now");
    expect(card.submittedAnswers()).toEqual({ Provider: "OpenCode", Rollout: "Now" });
  });

  // 点选项即作答：输入行收起，屏幕上不留提交时不算数的旧文字，也没有额外的提交步骤。
  it("clears the typed other answer on screen when an option is picked afterwards (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.type("OpenCode");
    card.check("Codex");

    expect(card.queryOtherInput()).toBeNull();
    expect(card.respondCount()).toBe(1);
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex" });
  });
});
