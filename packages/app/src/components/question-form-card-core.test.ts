import { describe, expect, test } from "vitest";
import {
  buildQuestionFormAnswers,
  canConfirmQuestion,
  EMPTY_QUESTION_FORM_STATE,
  isOtherInputExpanded,
  isQuestionAnswered,
  markQuestionAnswered,
  parseQuestionFormQuestions,
  pickQuestionOption,
  questionShowsTextInput,
  resolveNextQuestionFormStep,
  resolvePrimaryActionKind,
  resolveSkipLabel,
  setQuestionOtherText,
  shouldSubmitEmptyOnDismiss,
  skipQuestion,
  type QuestionFormQuestion,
} from "./question-form-card-core";

describe("question form card core", () => {
  test("treats optional input prompts as skippable empty answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Optional comment?",
          header: "Response",
          options: [],
          multiSelect: false,
          placeholder: "Optional comment (press Enter to skip)...",
          allowEmpty: true,
          dismissLabel: "Skip",
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(isQuestionAnswered(question, 0, {}, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, {})).toEqual({ Response: "" });
    expect(shouldSubmitEmptyOnDismiss(questions)).toBe(true);
    expect(resolveSkipLabel(questions, "Dismiss")).toBe("Skip");
  });

  test("requires a selection for option-only questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick one",
          header: "Response",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(false);
    expect(isQuestionAnswered(question, 0, {}, { 0: "freeform" })).toBe(false);
    expect(isQuestionAnswered(question, 0, { 0: new Set([1]) }, {})).toBe(true);
    expect(buildQuestionFormAnswers(questions, { 0: new Set([1]) }, {})).toEqual({
      Response: "B",
    });
  });

  test("shows text input for explicit other questions", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          isOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(isQuestionAnswered(question, 0, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });

  test("shows text input for questions that allow other answers", () => {
    const questions = parseQuestionFormQuestions({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          allowOther: true,
          multiSelect: false,
        },
      ],
    });

    if (!questions) throw new Error("questions did not parse");
    const [question] = questions;
    if (!question) throw new Error("question missing");
    expect(questionShowsTextInput(question)).toBe(true);
    expect(isQuestionAnswered(question, 0, {}, { 0: "custom" })).toBe(true);
    expect(buildQuestionFormAnswers(questions, {}, { 0: "custom" })).toEqual({
      Response: "custom",
    });
  });
});

function parseOrThrow(input: unknown): QuestionFormQuestion[] {
  const questions = parseQuestionFormQuestions(input);
  if (!questions) throw new Error("questions did not parse");
  return questions;
}

const surfaceRolloutSuccess = parseOrThrow({
  questions: [
    {
      question: "Which surface?",
      header: "surface",
      options: [{ label: "App" }, { label: "Desktop" }],
      multiSelect: false,
    },
    {
      question: "Which rollout?",
      header: "rollout",
      options: [{ label: "Now" }, { label: "Flag" }],
      multiSelect: false,
    },
    {
      question: "Success criteria?",
      header: "success",
      options: [],
      multiSelect: false,
    },
  ],
});

describe("question form progression", () => {
  test("a lone single-select question submits as soon as an option is picked", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick one",
          header: "Response",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: false,
        },
      ],
    });

    const state = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 1);

    expect(resolveNextQuestionFormStep(questions, 0, state)).toEqual({
      kind: "submit",
      answers: { Response: "B" },
    });
  });

  test("moves forward to the next pending question, then wraps to earlier ones", () => {
    const afterSurface = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, surfaceRolloutSuccess, 0, 0);
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 0, afterSurface)).toEqual({
      kind: "show",
      index: 1,
    });

    // 先答最后一题，剩下唯一未处理的题在它前面。
    const onlyRolloutPending = markQuestionAnswered(
      setQuestionOtherText(afterSurface, 2, "It ships"),
      2,
    );
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 2, onlyRolloutPending)).toEqual({
      kind: "show",
      index: 1,
    });

    const allAnswered = pickQuestionOption(onlyRolloutPending, surfaceRolloutSuccess, 1, 1);
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 1, allAnswered)).toEqual({
      kind: "submit",
      answers: { surface: "App", rollout: "Flag", success: "It ships" },
    });
  });

  test("re-answering an earlier question submits when every other question is handled", () => {
    let state = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, surfaceRolloutSuccess, 0, 0);
    state = pickQuestionOption(state, surfaceRolloutSuccess, 1, 0);
    state = markQuestionAnswered(setQuestionOtherText(state, 2, "Done"), 2);

    const changed = pickQuestionOption(state, surfaceRolloutSuccess, 0, 1);

    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 0, changed)).toEqual({
      kind: "submit",
      answers: { surface: "Desktop", rollout: "Now", success: "Done" },
    });
  });

  test("skipping clears the question and leaves it out of the answers", () => {
    let state = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, surfaceRolloutSuccess, 0, 0);
    state = pickQuestionOption(state, surfaceRolloutSuccess, 1, 1);
    state = skipQuestion(setQuestionOtherText(state, 2, "Half-typed"), 2);

    expect(state.otherTexts[2]).toBeUndefined();
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 2, state)).toEqual({
      kind: "submit",
      answers: { surface: "App", rollout: "Flag" },
    });

    // 回头跳过一道已答的题，也会清掉它的选择。
    const surfaceSkipped = skipQuestion(state, 0);
    expect(surfaceSkipped.selections[0]).toBeUndefined();
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 0, surfaceSkipped)).toEqual({
      kind: "submit",
      answers: { rollout: "Flag" },
    });
  });

  test("dismisses when every question is skipped", () => {
    let state = skipQuestion(EMPTY_QUESTION_FORM_STATE, 0);
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 0, state)).toEqual({
      kind: "show",
      index: 1,
    });
    state = skipQuestion(skipQuestion(state, 1), 2);
    expect(resolveNextQuestionFormStep(surfaceRolloutSuccess, 2, state)).toEqual({
      kind: "dismiss",
    });
  });

  test("skipping a lone question dismisses it", () => {
    const questions = parseOrThrow({
      questions: [
        { question: "Pick one", header: "Response", options: [{ label: "A" }], multiSelect: false },
      ],
    });

    expect(
      resolveNextQuestionFormStep(questions, 0, skipQuestion(EMPTY_QUESTION_FORM_STATE, 0)),
    ).toEqual({
      kind: "dismiss",
    });
  });

  test("a confirmed empty optional input counts as answered and is not navigated past", () => {
    const questions = parseOrThrow({
      questions: [
        { question: "Pick one", header: "choice", options: [{ label: "A" }], multiSelect: false },
        {
          question: "Optional comment?",
          header: "comment",
          options: [],
          multiSelect: false,
          allowEmpty: true,
        },
      ],
    });

    const picked = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 0);
    // 可选输入题还没内容，但仍是未处理，所以会跳到它。
    expect(resolveNextQuestionFormStep(questions, 0, picked)).toEqual({ kind: "show", index: 1 });

    const confirmed = markQuestionAnswered(picked, 1);
    expect(resolveNextQuestionFormStep(questions, 1, confirmed)).toEqual({
      kind: "submit",
      answers: { choice: "A", comment: "" },
    });
  });

  test("multi-select toggles options until confirmed", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick many",
          header: "many",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
          multiSelect: true,
        },
      ],
    });
    let state = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 0);
    state = pickQuestionOption(state, questions, 0, 2);
    state = pickQuestionOption(state, questions, 0, 0);
    expect(state.statuses[0]).toBeUndefined();
    expect(state.selections[0]).toEqual(new Set([2]));

    expect(resolveNextQuestionFormStep(questions, 0, markQuestionAnswered(state, 0))).toEqual({
      kind: "submit",
      answers: { many: "C" },
    });
  });

  test("typed other text and preset options replace each other", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }, { label: "B" }],
          allowOther: true,
          multiSelect: true,
        },
      ],
    });
    const picked = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 1);
    const typed = setQuestionOtherText(picked, 0, "custom");
    expect(typed.selections[0]?.size ?? 0).toBe(0);

    const repicked = pickQuestionOption(typed, questions, 0, 0);
    expect(repicked.otherTexts[0]).toBeUndefined();
    expect(buildQuestionFormAnswers(questions, repicked.selections, repicked.otherTexts)).toEqual({
      Response: "A",
    });
  });

  test("editing an answered question sends it back to pending until confirmed again", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick many",
          header: "many",
          options: [{ label: "A" }, { label: "B" }],
          multiSelect: true,
          allowOther: true,
        },
        { question: "Pick one", header: "one", options: [{ label: "X" }], multiSelect: false },
      ],
    });

    const confirmed = markQuestionAnswered(
      pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 0),
      0,
    );
    const emptied = pickQuestionOption(confirmed, questions, 0, 0);
    expect(emptied.statuses[0]).toBeUndefined();

    const retyped = setQuestionOtherText(confirmed, 0, "custom");
    expect(retyped.statuses[0]).toBeUndefined();

    // 改过的题退回未处理，答完另一题会回到它。
    const other = pickQuestionOption(retyped, questions, 1, 0);
    expect(resolveNextQuestionFormStep(questions, 1, other)).toEqual({ kind: "show", index: 0 });
  });

  test("an empty other answer cannot confirm a question with preset options", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick or type",
          header: "Response",
          options: [{ label: "A" }],
          allowOther: true,
          allowEmpty: true,
          multiSelect: false,
        },
      ],
    });
    const [question] = questions;
    if (!question) throw new Error("question missing");

    expect(isQuestionAnswered(question, 0, {}, { 0: "" })).toBe(false);
    expect(isQuestionAnswered(question, 0, {}, { 0: "typed" })).toBe(true);
  });

  test("an expanded other row on a single-select question confirms only typed text", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Pick or type",
          header: "one",
          options: [{ label: "A" }],
          allowOther: true,
          multiSelect: false,
        },
        {
          question: "Pick many or type",
          header: "many",
          options: [{ label: "B" }],
          allowOther: true,
          multiSelect: true,
        },
      ],
    });

    // 单选题先选过 A，再点开"其他..."不输入：确认会误交旧选项，所以不允许。
    const picked = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 0, 0);
    expect(canConfirmQuestion(questions, 0, picked, true)).toBe(false);
    expect(canConfirmQuestion(questions, 0, picked, false)).toBe(true);
    expect(canConfirmQuestion(questions, 0, setQuestionOtherText(picked, 0, "typed"), true)).toBe(
      true,
    );

    // 多选题的「提交」本来就确认勾选项，展开"其他..."不改变这一点。
    const toggled = pickQuestionOption(EMPTY_QUESTION_FORM_STATE, questions, 1, 0);
    expect(canConfirmQuestion(questions, 1, toggled, true)).toBe(true);
    expect(canConfirmQuestion(questions, 1, EMPTY_QUESTION_FORM_STATE, true)).toBe(false);
  });

  test("the other row stays expanded once opened or while it holds text", () => {
    const [withOther, textOnly] = parseOrThrow({
      questions: [
        {
          question: "Pick or type",
          header: "a",
          options: [{ label: "A" }],
          allowOther: true,
          multiSelect: false,
        },
        { question: "Type", header: "b", options: [], allowOther: true, multiSelect: false },
      ],
    });

    expect(isOtherInputExpanded(withOther, false, "")).toBe(false);
    expect(isOtherInputExpanded(withOther, true, "")).toBe(true);
    expect(isOtherInputExpanded(withOther, false, "typed")).toBe(true);
    // 纯输入题直接显示输入框，没有"其他..."行。
    expect(isOtherInputExpanded(textOnly, true, "typed")).toBe(false);
    expect(isOtherInputExpanded(undefined, true, "typed")).toBe(false);
  });

  test("labels the confirm action Next only while another question is pending", () => {
    expect(resolvePrimaryActionKind(3, 0, {})).toBe("next");
    expect(resolvePrimaryActionKind(3, 2, { 0: "answered", 1: "skipped" })).toBe("submit");
    // 当前题自己的状态不算。
    expect(resolvePrimaryActionKind(2, 1, { 0: "answered", 1: "answered" })).toBe("submit");
    expect(resolvePrimaryActionKind(1, 0, {})).toBe("submit");
  });

  test("provider dismiss labels override the skip label", () => {
    const questions = parseOrThrow({
      questions: [
        {
          question: "Optional comment?",
          header: "Response",
          options: [],
          multiSelect: false,
          allowEmpty: true,
          dismissLabel: "Skip it",
        },
      ],
    });
    expect(resolveSkipLabel(questions, "Skip")).toBe("Skip it");
    expect(resolveSkipLabel(surfaceRolloutSuccess, "Skip")).toBe("Skip");
  });
});
