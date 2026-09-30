import { expect, test } from "../support/fixtures";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  expectSubagentRowNeedsInput,
  expectSubagentsPill,
  observeAgentAttention,
  openSubagentsTrack,
  parkSubagentOnPermission,
  seedParentWithSubagent,
} from "../support/helpers/subagents";

test.describe("Subagent permission", () => {
  let workspace: SeededWorkspace;

  test.beforeAll(async () => {
    workspace = await seedWorkspace({ repoPrefix: "subagent-permission-" });
  });

  test.afterAll(async () => {
    await workspace?.cleanup();
  });

  test("a subagent waiting for approval shows in the track and alerts the user at the subagent", async ({
    page,
  }) => {
    const agents = await seedParentWithSubagent(workspace, {
      parentTitle: "Permission parent",
      childTitle: "Permission child",
    });
    await workspace.client.waitForAgentUpsert(
      agents.child.id,
      (snapshot) => snapshot.status === "idle",
    );
    const attention = await observeAgentAttention(page);

    await openAgentRoute(page, { workspaceId: agents.workspaceId, agentId: agents.parent.id });
    await expectSubagentsPill(page, "1 subagent");

    const requestId = await parkSubagentOnPermission(workspace, agents.child.id);

    await expectSubagentsPill(page, "1 needs input");
    await openSubagentsTrack(page);
    await expectSubagentRowNeedsInput(page, agents.child.id);
    await expect(
      page
        .getByTestId(`sidebar-workspace-row-${getServerId()}:${agents.workspaceId}`)
        .getByTestId("workspace-status-indicator-needs_input"),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => attention.framesFor(agents.child.id))
      .toEqual([
        { agentId: agents.child.id, reason: "permission", notificationAgentId: agents.child.id },
      ]);

    await workspace.client.respondToPermission(agents.child.id, requestId, { behavior: "deny" });
    await expectSubagentsPill(page, "1 subagent");
  });
});
