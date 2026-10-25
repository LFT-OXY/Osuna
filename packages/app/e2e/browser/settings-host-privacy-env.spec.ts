import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import {
  expectReadCliSignIns,
  readCliSignInsOnDaemon,
  readCliSignInsSwitch,
} from "../support/helpers/host-privacy";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsHostSection } from "../support/helpers/settings";
import { createUsageFixtureRoots } from "../support/helpers/usage-fixtures";

// 这份 spec 单独起一个设了 PASEO_NO_CLI_SIGN_INS 的 daemon：生效值为关，存的值仍是开。
test.use({
  e2eDaemonEnvironment: {
    ...createUsageFixtureRoots("paseo-host-privacy-env-").environment,
    PASEO_NO_CLI_SIGN_INS: "1",
  },
});

test("held off by PASEO_NO_CLI_SIGN_INS, the switch shows off, can't be changed, and names the environment variable", async ({
  page,
}) => {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "host");
  const section = page.getByTestId("host-privacy-section").filter({ visible: true });
  await expect(section).toContainText("Read CLI sign-ins");
  await expect(section.getByTestId("host-privacy-read-cli-sign-ins-hint")).toHaveText(
    "Turned off by the PASEO_NO_CLI_SIGN_INS environment variable",
  );
  await expectReadCliSignIns(page, { checked: false, disabled: true });
  await readCliSignInsSwitch(page).click({ force: true });
  await expectReadCliSignIns(page, { checked: false, disabled: true });
  await expect(page.getByTestId("host-privacy-turn-off-sheet")).toHaveCount(0);
  // 存的值没被改写。
  expect(await readCliSignInsOnDaemon()).toBe(true);
});
