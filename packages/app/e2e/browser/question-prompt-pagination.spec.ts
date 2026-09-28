import { test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  answerQuestionWithOther,
  chooseQuestionOption,
  continueToNextQuestion,
  dismissQuestionPrompt,
  expectAgentReceivedAnswers,
  expectAgentReceivedDismissal,
  expectCurrentQuestion,
  expectQuestionDismissEnabled,
  expectQuestionHidden,
  expectQuestionNavigationEnabled,
  expectQuestionOptionSelected,
  expectQuestionPrimaryActionDisabled,
  expectQuestionPrimaryActionEnabled,
  expectQuestionPrimaryActionHidden,
  expectQuestionPromptResolved,
  fillQuestionAnswer,
  openQuestion,
  skipCurrentQuestion,
  submitQuestionAnswers,
  waitForQuestionPrompt,
} from "../support/helpers/questions";

const TOTAL_QUESTIONS = 3;
const SURFACE_QUESTION = "Which surface should this apply to?";
const ROLLOUT_QUESTION = "Which rollout should we use?";
const SUCCESS_QUESTION = "What success criteria should we use?";
const REPO_URL_QUESTION = "What is the GitHub private repo URL to push to?";
const COMMIT_MESSAGE_QUESTION = "What should the first commit message be?";
const THEME_QUESTION = "Which client theme should we test?";
const PLATFORMS_QUESTION = "Which platforms should we cover?";
const SINGLE_CHOICE_PROMPT = "Emit synthetic questions: one single-choice question with other.";
const MULTI_SELECT_PROMPT = "Emit synthetic questions: one multi-select question.";

test.describe("Question prompt pagination", () => {
  test("shows one question at a time with numbered navigation", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-pagination-",
      title: "Question pagination e2e",
      initialPrompt: "Emit synthetic questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionHidden(page, ROLLOUT_QUESTION);
      await expectQuestionHidden(page, SUCCESS_QUESTION);

      await chooseQuestionOption(page, "App");
      await expectCurrentQuestion(page, {
        index: 2,
        total: TOTAL_QUESTIONS,
        question: ROLLOUT_QUESTION,
      });

      await openQuestion(page, { index: 1, total: TOTAL_QUESTIONS });
      await expectCurrentQuestion(page, {
        index: 1,
        total: TOTAL_QUESTIONS,
        question: SURFACE_QUESTION,
      });
      await expectQuestionOptionSelected(page, "App");

      await openQuestion(page, { index: 2, total: TOTAL_QUESTIONS });
      await chooseQuestionOption(page, "Behind feature flag");
      await expectCurrentQuestion(page, {
        index: 3,
        total: TOTAL_QUESTIONS,
        question: SUCCESS_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: SUCCESS_QUESTION,
        answer: "Only one prompt is visible at a time.",
      });
      await submitQuestionAnswers(page);
      await expectAgentReceivedAnswers(
        page,
        "surface=App; rollout=Behind feature flag; success=Only one prompt is visible at a time.",
      );
    } finally {
      await session.cleanup();
    }
  });

  test("free-write questions use Next before final Submit", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-free-write-",
      title: "Question free-write e2e",
      initialPrompt: "Emit synthetic questions: two free-write questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, {
        index: 1,
        total: 2,
        question: REPO_URL_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: REPO_URL_QUESTION,
        answer: "git@github.com:user/private-repo.git",
      });

      await expectQuestionPrimaryActionEnabled(page, "Next");
      await expectQuestionDismissEnabled(page);
      await expectQuestionNavigationEnabled(page, { index: 2, total: 2 });

      await continueToNextQuestion(page);
      await expectCurrentQuestion(page, {
        index: 2,
        total: 2,
        question: COMMIT_MESSAGE_QUESTION,
      });
      await expectQuestionPrimaryActionDisabled(page, "Submit");

      await fillQuestionAnswer(page, {
        question: COMMIT_MESSAGE_QUESTION,
        answer: "Initialize private repo",
      });
      await expectQuestionPrimaryActionEnabled(page, "Submit");
      await submitQuestionAnswers(page);
      await expectAgentReceivedAnswers(
        page,
        "repoUrl=git@github.com:user/private-repo.git; commitMessage=Initialize private repo",
      );
    } finally {
      await session.cleanup();
    }
  });

  test("a lone single-select question submits when an option is picked", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-single-choice-",
      title: "Question single choice e2e",
      initialPrompt: SINGLE_CHOICE_PROMPT,
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, { index: 1, total: 1, question: THEME_QUESTION });
      await expectQuestionPrimaryActionHidden(page);

      await chooseQuestionOption(page, "Dark");
      await expectQuestionPromptResolved(page);
      await expectAgentReceivedAnswers(page, "theme=Dark");
    } finally {
      await session.cleanup();
    }
  });

  test("the other row expands into an input that submits on Enter", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-other-",
      title: "Question other answer e2e",
      initialPrompt: SINGLE_CHOICE_PROMPT,
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await answerQuestionWithOther(page, {
        question: THEME_QUESTION,
        answer: "High contrast",
      });
      await expectQuestionPromptResolved(page);
      await expectAgentReceivedAnswers(page, "theme=High contrast");
    } finally {
      await session.cleanup();
    }
  });

  test("skipping one question still submits the others", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-skip-",
      title: "Question skip e2e",
      initialPrompt: "Emit synthetic questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await skipCurrentQuestion(page);
      await expectCurrentQuestion(page, {
        index: 2,
        total: TOTAL_QUESTIONS,
        question: ROLLOUT_QUESTION,
      });

      await chooseQuestionOption(page, "Immediately");
      await expectCurrentQuestion(page, {
        index: 3,
        total: TOTAL_QUESTIONS,
        question: SUCCESS_QUESTION,
      });

      await fillQuestionAnswer(page, {
        question: SUCCESS_QUESTION,
        answer: "Rollout starts without a surface.",
      });
      await expectQuestionPrimaryActionEnabled(page, "Submit");
      await submitQuestionAnswers(page);
      await expectAgentReceivedAnswers(
        page,
        "rollout=Immediately; success=Rollout starts without a surface.",
      );
    } finally {
      await session.cleanup();
    }
  });

  test("multi-select questions toggle options and confirm with Submit", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-multi-select-",
      title: "Question multi-select e2e",
      initialPrompt: MULTI_SELECT_PROMPT,
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await expectCurrentQuestion(page, { index: 1, total: 1, question: PLATFORMS_QUESTION });
      await expectQuestionPrimaryActionDisabled(page, "Submit");

      await chooseQuestionOption(page, "iOS");
      await chooseQuestionOption(page, "Web");
      await expectQuestionOptionSelected(page, "iOS");
      await expectQuestionOptionSelected(page, "Web");
      await expectCurrentQuestion(page, { index: 1, total: 1, question: PLATFORMS_QUESTION });

      await expectQuestionPrimaryActionEnabled(page, "Submit");
      await submitQuestionAnswers(page);
      await expectAgentReceivedAnswers(page, "platforms=iOS, Web");
    } finally {
      await session.cleanup();
    }
  });

  test("the close button dismisses the whole prompt", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "question-dismiss-",
      title: "Question dismiss e2e",
      initialPrompt: "Emit synthetic questions.",
    });

    try {
      await openAgentRoute(page, session);
      await waitForQuestionPrompt(page, 120_000);

      await chooseQuestionOption(page, "App");
      await dismissQuestionPrompt(page);
      await expectAgentReceivedDismissal(page);
    } finally {
      await session.cleanup();
    }
  });
});
