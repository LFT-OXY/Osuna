import { expect, test } from "../support/fixtures";
import { expectWorkspaceTabVisible } from "../support/helpers/archive-tab";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  dispatchGroups,
  dispatchRow,
  emitDispatchCalls,
  expectDispatchHeader,
  expectSubagentRowNeedsInput,
  installHostWithoutSubagentCallLinks,
  openSubagentsTrack,
  parkSubagentOnPermission,
  providerDispatchRow,
  seedDispatchChild,
  seedDispatchParent,
} from "../support/helpers/subagents";

test.describe("Dispatch group", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "dispatch-group-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("consecutive calls share a group, prose splits them, and rows follow their subagents live", async ({
    page,
  }) => {
    const parentId = await seedDispatchParent(workspace, "Fan-out parent");
    const testsChild = await seedDispatchChild(workspace, {
      parentId,
      callId: "call-tests",
      title: "Write tests",
    });
    await seedDispatchChild(workspace, { parentId, callId: "call-docs", title: "Write docs" });
    await seedDispatchChild(workspace, { parentId, callId: "call-review", title: "Review" });

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [
      { callId: "call-tests", title: "Write tests" },
      { callId: "call-docs", title: "Write docs" },
      { text: "Then a review." },
      { callId: "call-review", title: "Review" },
    ]);

    await expect(dispatchGroups(page)).toHaveCount(2, { timeout: 30_000 });
    await expect(
      dispatchGroups(page)
        .nth(0)
        .getByTestId(/^dispatch-group-row-/),
    ).toHaveCount(2);
    await expect(
      dispatchGroups(page)
        .nth(1)
        .getByTestId(/^dispatch-group-row-/),
    ).toHaveCount(1);
    await expectDispatchHeader(page, 0, "Dispatched 2 subagents: 2 done");

    await workspace.client.sendAgentMessage(testsChild, "Keep going.");

    await expectDispatchHeader(page, 0, "Dispatched 2 subagents: 1 working, 1 done");
    await expect(
      dispatchRow(page, "call-tests").locator('[aria-label="Agent running"]'),
    ).toBeVisible();
    await expectDispatchHeader(page, 0, "Dispatched 2 subagents: 2 done");
  });

  test("a row opens its subagent, stays shut while starting, and marks archived and detached children", async ({
    page,
  }) => {
    const parentId = await seedDispatchParent(workspace, "Open parent");
    const archivedChild = await seedDispatchChild(workspace, {
      parentId,
      callId: "call-archived",
      title: "Archived child",
    });
    const detachedChild = await seedDispatchChild(workspace, {
      parentId,
      callId: "call-detached",
      title: "Detached child",
    });
    await workspace.client.archiveAgent(archivedChild);
    await workspace.client.detachAgent(detachedChild);

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [
      { callId: "call-archived", title: "Archived child" },
      { callId: "call-detached", title: "Detached child" },
      { callId: "call-late", title: "Late child", runningMs: 60_000 },
    ]);

    await expect(dispatchRow(page, "call-archived")).toContainText("Archived", {
      timeout: 30_000,
    });
    await expect(dispatchRow(page, "call-detached")).toContainText("Detached");
    const late = dispatchRow(page, "call-late");
    await expect(late).toContainText("Starting");
    await expect(late).toHaveAttribute("aria-disabled", "true");

    const lateChild = await seedDispatchChild(workspace, {
      parentId,
      callId: "call-late",
      title: "Late child",
    });

    await expect(late).not.toHaveAttribute("aria-disabled", "true", { timeout: 30_000 });
    await expect(late).not.toContainText("Starting");
    await late.click();
    await expectWorkspaceTabVisible(page, lateChild);
  });

  test("a subagent waiting for approval shows on its row and in the header", async ({ page }) => {
    const parentId = await seedDispatchParent(workspace, "Approval parent");
    const child = await seedDispatchChild(workspace, {
      parentId,
      callId: "call-approval",
      title: "Needs approval",
    });

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [
      { callId: "call-approval", title: "Needs approval" },
    ]);
    await expectDispatchHeader(page, 0, "Dispatched 1 subagent: 1 done");

    const requestId = await parkSubagentOnPermission(workspace, child);

    await expectDispatchHeader(page, 0, "Dispatched 1 subagent: 1 waiting for approval");
    const row = dispatchRow(page, "call-approval");
    await expect(row).toContainText("Waiting for approval · MockPlanApproval");
    await expect(row.locator('[aria-label="Agent needs input"]')).toBeVisible();

    await workspace.client.respondToPermission(child, requestId, { behavior: "deny" });
    await expectDispatchHeader(page, 0, "Dispatched 1 subagent: 1 done");
  });

  test("a provider subagent call joins the group, follows its subagent live, and opens read-only", async ({
    page,
  }) => {
    const parentId = await seedDispatchParent(workspace, "Provider parent");
    await seedDispatchChild(workspace, { parentId, callId: "call-paseo", title: "Paseo child" });

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [
      { callId: "call-paseo", title: "Paseo child" },
      {
        callId: "toolu_native",
        providerSubagent: {
          id: "native-sub",
          description: "Map the router",
          subtitle: "Explore · 3.1k tokens",
          runningMs: 5_000,
        },
      },
    ]);

    const row = providerDispatchRow(page, "toolu_native", "native-sub");
    await expect(row).toContainText("Map the router", { timeout: 30_000 });
    await expect(row).toContainText("Explore · 3.1k tokens");
    await expect(dispatchGroups(page)).toHaveCount(1);
    await expectDispatchHeader(page, 0, "Dispatched 2 subagents: 1 working, 1 done");
    await expect(row.locator('[aria-label="Agent running"]')).toBeVisible();

    await expectDispatchHeader(page, 0, "Dispatched 2 subagents: 2 done");
    await expect(page.getByTestId("tool-call-badge")).toHaveCount(0);

    await row.click();
    const panel = page.getByTestId("provider-subagent-panel").filter({ visible: true });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText("Map the router").first()).toBeVisible();
  });

  test("a provider subagent's permission waits on its rows and is approved from its read-only panel", async ({
    page,
  }) => {
    const parentId = await seedDispatchParent(workspace, "Provider approval parent");

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [
      {
        callId: "toolu_write",
        providerSubagent: {
          id: "native-writer",
          description: "Edit the router",
          permission: { name: "Write" },
        },
      },
    ]);

    const row = providerDispatchRow(page, "toolu_write", "native-writer");
    await expect(row).toContainText("Waiting for approval · Write", { timeout: 30_000 });
    await expect(row.locator('[aria-label="Agent needs input"]')).toBeVisible();
    await expectDispatchHeader(page, 0, "Dispatched 1 subagent: 1 waiting for approval");
    // 父面板照旧显示这条权限。
    await expect(page.getByTestId("permission-request-accept")).toBeVisible();
    await openSubagentsTrack(page);
    await expectSubagentRowNeedsInput(page, "native-writer");

    await page.getByTestId("subagents-track-row-native-writer").click();
    const panel = page.getByTestId("provider-subagent-panel").filter({ visible: true });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole("textbox", { name: "Message agent..." })).toHaveCount(0);
    await panel.getByTestId("permission-request-accept").click();

    // 批准回给父 agent，mock 收到后才让子智能体完成。
    await expect(panel.getByTestId("permission-request-accept")).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect
      .poll(() => workspace.client.fetchAgent({ agentId: parentId }), { timeout: 30_000 })
      .toMatchObject({ agent: { pendingPermissions: [] } });
  });

  test("a call no subagent carries the label of falls back to the generic tool card", async ({
    page,
  }) => {
    const parentId = await seedDispatchParent(workspace, "Unlinked parent");

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [{ callId: "call-nobody", title: "Nobody" }]);

    await expect(page.getByTestId("tool-call-badge")).toHaveCount(1, { timeout: 30_000 });
    await expect(dispatchGroups(page)).toHaveCount(0);
  });

  test("an old host keeps create_agent calls on the generic tool card", async ({ page }) => {
    await installHostWithoutSubagentCallLinks(page);
    const parentId = await seedDispatchParent(workspace, "Old host parent");
    await seedDispatchChild(workspace, { parentId, callId: "call-old", title: "Old host child" });

    await openAgentRoute(page, { workspaceId: workspace.workspaceId, agentId: parentId });
    await emitDispatchCalls(workspace, parentId, [{ callId: "call-old", title: "Old host child" }]);

    await expect(page.getByTestId("tool-call-badge")).toHaveCount(1, { timeout: 30_000 });
    await expect(dispatchGroups(page)).toHaveCount(0);
  });
});
