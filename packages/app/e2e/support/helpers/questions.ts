import { expect, type Page } from "@playwright/test";

export async function waitForQuestionPrompt(page: Page, timeout = 30_000): Promise<void> {
  await expect(page.getByTestId("question-form-card").first()).toBeVisible({ timeout });
}

export async function expectCurrentQuestion(
  page: Page,
  input: { index: number; total: number; question: string },
): Promise<void> {
  const card = page.getByTestId("question-form-card").first();
  await expect(card.getByTestId("question-form-current-question")).toHaveText(input.question);
  // Nav tabs only render for multi-question cards (hidden for a lone question).
  if (input.total > 1) {
    await expect(questionNavTab(page, input)).toHaveAttribute("aria-selected", "true");
  }
}

export async function expectQuestionHidden(page: Page, question: string): Promise<void> {
  await expect(page.getByText(question, { exact: true })).toHaveCount(0);
}

// Options render as radios (single-select) or checkboxes (multi-select), so match
// either role by accessible name.
function questionOption(page: Page, option: string) {
  const card = page.getByTestId("question-form-card").first();
  return card.getByRole("radio", { name: option }).or(card.getByRole("checkbox", { name: option }));
}

// The multi-question nav renders as a tablist; each question is a tab.
function questionNavTab(page: Page, input: { index: number; total: number }) {
  return page
    .getByTestId("question-form-card")
    .first()
    .getByRole("tab", { name: `Question ${input.index} of ${input.total}` });
}

export async function chooseQuestionOption(page: Page, option: string): Promise<void> {
  await questionOption(page, option).click();
}

export async function expectQuestionOptionSelected(page: Page, option: string): Promise<void> {
  await expect(questionOption(page, option)).toHaveAttribute("aria-checked", "true");
}

export async function openQuestion(
  page: Page,
  input: { index: number; total: number },
): Promise<void> {
  await questionNavTab(page, input).click();
}

export async function expectQuestionNavigationEnabled(
  page: Page,
  input: { index: number; total: number },
): Promise<void> {
  await expect(questionNavTab(page, input)).toBeEnabled();
}

export async function fillQuestionAnswer(
  page: Page,
  input: { question: string; answer: string },
): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("textbox", { name: input.question })
    .fill(input.answer);
}

export async function submitQuestionAnswers(page: Page): Promise<void> {
  await page.getByTestId("question-form-primary-action").click();
  await expectQuestionPromptResolved(page);
}

export async function expectQuestionPrimaryActionEnabled(page: Page, label: string): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: label }),
  ).toBeEnabled();
}

export async function expectQuestionPrimaryActionDisabled(
  page: Page,
  label: string,
): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: label }),
  ).toBeDisabled();
}

export async function expectQuestionDismissEnabled(page: Page): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByRole("button", { name: "Dismiss" }),
  ).toBeEnabled();
}

export async function continueToNextQuestion(page: Page): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("button", { name: "Next" })
    .click();
}

export async function expectQuestionPrimaryActionHidden(page: Page): Promise<void> {
  await expect(
    page.getByTestId("question-form-card").first().getByTestId("question-form-primary-action"),
  ).toHaveCount(0);
}

export async function expectQuestionPromptResolved(page: Page): Promise<void> {
  await expect(page.getByTestId("question-form-card")).toHaveCount(0, { timeout: 30_000 });
}

// mock agent 把收到的答案写进结束文本（header=答案，按题目顺序用 "; " 连接），忽略时回 dismissed。
export async function expectAgentReceivedAnswers(page: Page, summary: string): Promise<void> {
  await expect(
    page.getByText(`Synthetic questions resolved: ${summary}`, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

export async function expectAgentReceivedDismissal(page: Page): Promise<void> {
  await expect(page.getByText("Synthetic questions dismissed", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

export async function skipCurrentQuestion(page: Page): Promise<void> {
  await page.getByTestId("question-form-card").first().getByTestId("question-form-skip").click();
}

export async function dismissQuestionPrompt(page: Page): Promise<void> {
  await page
    .getByTestId("question-form-card")
    .first()
    .getByRole("button", { name: "Dismiss" })
    .click();
  await expectQuestionPromptResolved(page);
}

// "其他..."行原地展开成输入框，输入框的无障碍名称是题目文字。
export async function answerQuestionWithOther(
  page: Page,
  input: { question: string; answer: string },
): Promise<void> {
  const card = page.getByTestId("question-form-card").first();
  await card.getByTestId("question-form-other-option").click();
  const textbox = card.getByRole("textbox", { name: input.question });
  await expect(textbox).toBeFocused();
  await textbox.fill(input.answer);
  await textbox.press("Enter");
}
