export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionFormQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  allowEmpty: boolean;
  placeholder?: string;
  dismissLabel?: string;
}

export type QuestionSelections = Record<number, ReadonlySet<number>>;
export type QuestionOtherTexts = Record<number, string>;
/** 缺省即未处理。只由用户操作改变，不能从有没有选择推出来：允许留空的输入题没有内容也算已作答。 */
export type QuestionStatus = "answered" | "skipped";
export type QuestionStatuses = Record<number, QuestionStatus>;

export interface QuestionFormState {
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  statuses: QuestionStatuses;
}

export const EMPTY_QUESTION_FORM_STATE: QuestionFormState = {
  selections: {},
  otherTexts: {},
  statuses: {},
};

export type QuestionFormStep =
  | { kind: "show"; index: number }
  | { kind: "submit"; answers: Record<string, string> }
  | { kind: "dismiss" };

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function parseQuestionFormQuestions(input: unknown): QuestionFormQuestion[] | null {
  if (
    typeof input !== "object" ||
    input === null ||
    !("questions" in input) ||
    !Array.isArray((input as Record<string, unknown>).questions)
  ) {
    return null;
  }
  const raw = (input as Record<string, unknown>).questions as unknown[];
  const questions: QuestionFormQuestion[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const q = item as Record<string, unknown>;
    if (typeof q.question !== "string" || typeof q.header !== "string") return null;
    if (!Array.isArray(q.options)) return null;
    const options: QuestionOption[] = [];
    for (const opt of q.options as unknown[]) {
      if (typeof opt !== "object" || opt === null) return null;
      const o = opt as Record<string, unknown>;
      if (typeof o.label !== "string") return null;
      options.push({
        label: o.label,
        description: typeof o.description === "string" ? o.description : undefined,
      });
    }
    questions.push({
      question: q.question,
      header: q.header,
      options,
      multiSelect: q.multiSelect === true,
      allowOther: q.allowOther === true || q.isOther === true,
      allowEmpty: q.allowEmpty === true,
      placeholder: readOptionalString(q, "placeholder"),
      dismissLabel: readOptionalString(q, "dismissLabel"),
    });
  }
  return questions.length > 0 ? questions : null;
}

export function questionShowsTextInput(question: QuestionFormQuestion): boolean {
  return question.options.length === 0 || question.allowOther;
}

export function isQuestionAnswered(
  question: QuestionFormQuestion,
  qIndex: number,
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
): boolean {
  const selected = selections[qIndex];
  if (selected && selected.size > 0) {
    return true;
  }

  if (!questionShowsTextInput(question)) {
    return false;
  }

  const otherText = otherTexts[qIndex]?.trim();
  if (otherText && otherText.length > 0) {
    return true;
  }

  // 有预设选项时，空着的"其他..."不算作答，否则会记成已作答却写不出答案。
  return question.allowEmpty && question.options.length === 0;
}

/** 省略 `statuses` 时写入所有题；给出时只写入已作答的题。 */
export function buildQuestionFormAnswers(
  questions: QuestionFormQuestion[],
  selections: QuestionSelections,
  otherTexts: QuestionOtherTexts,
  statuses?: QuestionStatuses,
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    if (statuses && statuses[i] !== "answered") continue;
    const q = questions[i];
    const selected = selections[i];
    const otherText = otherTexts[i]?.trim();

    if (questionShowsTextInput(q)) {
      if (otherText && otherText.length > 0) {
        answers[q.header] = otherText;
        continue;
      }
      if (q.allowEmpty && q.options.length === 0) {
        answers[q.header] = "";
        continue;
      }
    }

    if (selected && selected.size > 0) {
      const labels = Array.from(selected).map((idx) => q.options[idx].label);
      answers[q.header] = labels.join(", ");
    }
  }
  return answers;
}

export function shouldSubmitEmptyOnDismiss(questions: QuestionFormQuestion[]): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) => question.allowEmpty && question.options.length === 0)
  );
}

export function resolveSkipLabel(questions: QuestionFormQuestion[], fallbackLabel: string): string {
  return questions.find((question) => question.dismissLabel)?.dismissLabel ?? fallbackLabel;
}

function omitKey<T>(record: Record<number, T>, key: number): Record<number, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/** 单选题直接作答；多选题只切换选中，退回未处理等用户确认。两者都会清掉自由输入。 */
export function pickQuestionOption(
  state: QuestionFormState,
  questions: QuestionFormQuestion[],
  qIndex: number,
  optIndex: number,
): QuestionFormState {
  const question = questions[qIndex];
  if (!question) return state;
  const otherTexts = omitKey(state.otherTexts, qIndex);
  if (!question.multiSelect) {
    return {
      selections: { ...state.selections, [qIndex]: new Set([optIndex]) },
      otherTexts,
      statuses: { ...state.statuses, [qIndex]: "answered" },
    };
  }
  const next = new Set(state.selections[qIndex]);
  if (next.has(optIndex)) {
    next.delete(optIndex);
  } else {
    next.add(optIndex);
  }
  return {
    selections: { ...state.selections, [qIndex]: next },
    otherTexts,
    statuses: omitKey(state.statuses, qIndex),
  };
}

/** 改动输入后这道题要重新确认，否则标签页的勾和实际提交的答案会对不上。 */
export function setQuestionOtherText(
  state: QuestionFormState,
  qIndex: number,
  text: string,
): QuestionFormState {
  return {
    selections: text.length > 0 ? omitKey(state.selections, qIndex) : state.selections,
    otherTexts: { ...state.otherTexts, [qIndex]: text },
    statuses: omitKey(state.statuses, qIndex),
  };
}

/** 「下一步/提交」和回车能否确认当前题。单选题展开"其他..."后只看输入内容，免得误交之前的选项。 */
export function canConfirmQuestion(
  questions: QuestionFormQuestion[],
  qIndex: number,
  state: QuestionFormState,
  isOtherExpanded: boolean,
): boolean {
  const question = questions[qIndex];
  if (!question) return false;
  if (isOtherExpanded && !question.multiSelect) {
    return (state.otherTexts[qIndex]?.trim().length ?? 0) > 0;
  }
  return isQuestionAnswered(question, qIndex, state.selections, state.otherTexts);
}

/** 带预设选项的题，"其他..."行点开过或已有输入时保持展开。纯输入题直接显示输入框，不算。 */
export function isOtherInputExpanded(
  question: QuestionFormQuestion | undefined,
  wasExpanded: boolean,
  otherText: string,
): boolean {
  if (!question || question.options.length === 0 || !question.allowOther) return false;
  return wasExpanded || otherText.length > 0;
}

export function markQuestionAnswered(state: QuestionFormState, qIndex: number): QuestionFormState {
  return { ...state, statuses: { ...state.statuses, [qIndex]: "answered" } };
}

export function skipQuestion(state: QuestionFormState, qIndex: number): QuestionFormState {
  return {
    selections: omitKey(state.selections, qIndex),
    otherTexts: omitKey(state.otherTexts, qIndex),
    statuses: { ...state.statuses, [qIndex]: "skipped" },
  };
}

/** 从当前题往后找第一道未处理的题，找不到再从头找；当前题本身不算。 */
function findNextPendingQuestion(
  questionCount: number,
  currentIndex: number,
  statuses: QuestionStatuses,
): number | null {
  for (let offset = 1; offset < questionCount; offset++) {
    const index = (currentIndex + offset) % questionCount;
    if (statuses[index] === undefined) return index;
  }
  return null;
}

/** 当前题处理完之后的去向。`state` 已包含当前题的处理结果。 */
export function resolveNextQuestionFormStep(
  questions: QuestionFormQuestion[],
  currentIndex: number,
  state: QuestionFormState,
): QuestionFormStep {
  const next = findNextPendingQuestion(questions.length, currentIndex, state.statuses);
  if (next !== null) {
    return { kind: "show", index: next };
  }
  const answers = buildQuestionFormAnswers(
    questions,
    state.selections,
    state.otherTexts,
    state.statuses,
  );
  return Object.keys(answers).length > 0 ? { kind: "submit", answers } : { kind: "dismiss" };
}

export function resolvePrimaryActionKind(
  questionCount: number,
  currentIndex: number,
  statuses: QuestionStatuses,
): "next" | "submit" {
  return findNextPendingQuestion(questionCount, currentIndex, statuses) === null
    ? "submit"
    : "next";
}
