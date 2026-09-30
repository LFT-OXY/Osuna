import { expect, test } from "../support/fixtures";
import {
  THINKING_MODES_PROVIDER,
  expandMentionDefaults,
  expectStoredMentionDefaults,
  installHostWithoutAgentMentions,
  installThinkingModesProvider,
  mentionDefaultsRow,
  mentionDefaultsSummary,
  mentionDefaultsTrigger,
  openMentionDefaultsSettings,
  pickMentionDefault,
  readMentionDefaultOptions,
  withOsunaToolsOff,
  writeMentionDefaults,
} from "../support/helpers/mention-defaults";
import { installDaemonConfigFailureFixture } from "../support/helpers/usage-pricing";

const ACP = THINKING_MODES_PROVIDER.id;

test.describe("Mention defaults settings", () => {
  let provider: { remove(): Promise<void> } | undefined;

  test.beforeEach(async () => {
    provider = await installThinkingModesProvider();
  });

  test.afterEach(async () => {
    await provider?.remove();
    provider = undefined;
  });

  test("saves each choice at once, keeps it across a reload, and clears it with Default", async ({
    page,
  }) => {
    await openMentionDefaultsSettings(page);
    await expect(mentionDefaultsSummary(page, ACP)).toHaveText("All defaults");
    await expandMentionDefaults(page, ACP);
    await expect(mentionDefaultsTrigger(page, ACP, "model")).toHaveText("Default (Swift)");
    await expect(mentionDefaultsTrigger(page, ACP, "thinkingOptionId")).toHaveText(
      "Default (Medium)",
    );
    await expect(mentionDefaultsTrigger(page, ACP, "modeId")).toHaveText("Default (Ask)");

    await pickMentionDefault(page, { provider: ACP, field: "model", option: "Deep" });
    await pickMentionDefault(page, { provider: ACP, field: "thinkingOptionId", option: "High" });
    await expectStoredMentionDefaults(ACP, { model: "acp-deep", thinkingOptionId: "high" });
    await expect(mentionDefaultsSummary(page, ACP)).toHaveText("Deep · High · others default");

    await page.reload();
    await openMentionDefaultsSettings(page);
    await expect(mentionDefaultsSummary(page, ACP)).toHaveText("Deep · High · others default");
    await expandMentionDefaults(page, ACP);
    await expect(mentionDefaultsTrigger(page, ACP, "model")).toHaveText("Deep");
    await expect(mentionDefaultsTrigger(page, ACP, "thinkingOptionId")).toHaveText("High");

    await pickMentionDefault(page, {
      provider: ACP,
      field: "thinkingOptionId",
      option: "Default (Medium)",
    });
    await expectStoredMentionDefaults(ACP, { model: "acp-deep" });
    await expect(mentionDefaultsTrigger(page, ACP, "thinkingOptionId")).toHaveText(
      "Default (Medium)",
    );
  });

  test("changing the model resets a level it lacks and says so", async ({ page }) => {
    // ACP 的模型共用一组档位，所以用一个目录里没有的档位来触发"清回默认"。
    await writeMentionDefaults(ACP, { thinkingOptionId: "max" });
    await openMentionDefaultsSettings(page);
    await expandMentionDefaults(page, ACP);

    await pickMentionDefault(page, { provider: ACP, field: "model", option: "Deep" });
    await expect(
      mentionDefaultsRow(page, ACP).getByText(
        "Thinking level reset to the model's default (Medium)",
        { exact: true },
      ),
    ).toBeVisible();
    await expectStoredMentionDefaults(ACP, { model: "acp-deep" });
    await expect(mentionDefaultsTrigger(page, ACP, "thinkingOptionId")).toHaveText(
      "Default (Medium)",
    );
  });

  test("flags values the provider no longer offers and resets them all", async ({ page }) => {
    await writeMentionDefaults(ACP, { model: "retired-model", modeId: "gone-mode" });
    await openMentionDefaultsSettings(page);
    await expect(mentionDefaultsSummary(page, ACP)).toHaveText(
      "retired-model · gone-mode · others default",
    );
    await expandMentionDefaults(page, ACP);

    const row = mentionDefaultsRow(page, ACP);
    await expect(mentionDefaultsTrigger(page, ACP, "model")).toHaveText("retired-model");
    await expect(
      row.getByText("retired-model is unavailable; the default (Swift) will be used", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      row.getByText("gone-mode is unavailable; the default (Ask) will be used", { exact: true }),
    ).toBeVisible();
    expect(await readMentionDefaultOptions(page, { provider: ACP, field: "model" })).toEqual([
      "Default (Swift)",
      "retired-model (unavailable)",
      "Swift",
      "Deep",
    ]);

    await row.getByRole("button", { name: "Reset all to defaults", exact: true }).click();
    await expectStoredMentionDefaults(ACP, {});
    await expect(mentionDefaultsSummary(page, ACP)).toHaveText("All defaults");
    await expect(mentionDefaultsTrigger(page, ACP, "model")).toHaveText("Default (Swift)");
    await expect(row.getByRole("button", { name: "Reset all to defaults" })).toHaveCount(0);
  });

  test("a failed save shows an error in the row and retries", async ({ page }) => {
    await installDaemonConfigFailureFixture(page, "Injected config write failure", { times: 1 });
    await openMentionDefaultsSettings(page);
    await expandMentionDefaults(page, ACP);

    await pickMentionDefault(page, { provider: ACP, field: "modeId", option: "Code" });
    const error = page.getByTestId(`mention-defaults-save-error-${ACP}`);
    await expect(error).toHaveText("Couldn't save: Injected config write failure");
    await expect(mentionDefaultsTrigger(page, ACP, "modeId")).toHaveText("Default (Ask)");
    await expectStoredMentionDefaults(ACP, {});

    await mentionDefaultsRow(page, ACP).getByRole("button", { name: "Retry", exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(mentionDefaultsTrigger(page, ACP, "modeId")).toHaveText("Code");
    await expectStoredMentionDefaults(ACP, { modeId: "code" });
  });

  test("stays editable with a notice while Osuna tools are off", async ({ page }) => {
    await withOsunaToolsOff(async () => {
      await openMentionDefaultsSettings(page);
      await expect(page.getByTestId("mention-defaults-tools-off")).toHaveText(
        "Osuna tools are off, so @ mentioning agents is unavailable. These settings apply once they're on.",
      );
      await expandMentionDefaults(page, ACP);
      await pickMentionDefault(page, { provider: ACP, field: "modeId", option: "Code" });
      await expectStoredMentionDefaults(ACP, { modeId: "code" });
    });
  });

  test("an old host only shows the update hint", async ({ page }) => {
    await installHostWithoutAgentMentions(page);
    await openMentionDefaultsSettings(page);
    const section = page.getByTestId("mention-defaults-section");
    await expect(
      section.getByText("Update the host to set mention defaults", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("mention-defaults-card")).toHaveCount(0);
    await expect(page.getByTestId(`mention-defaults-toggle-${ACP}`)).toHaveCount(0);
  });
});
