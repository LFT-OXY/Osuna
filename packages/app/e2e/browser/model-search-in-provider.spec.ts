import path from "node:path";
import type { DaemonClient } from "@osuna/client/internal/daemon-client";
import { test, expect, type Page } from "../support/fixtures";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import {
  closeModelPicker,
  expectModelPickerHeight,
  expectModelPickerWidth,
  expectModelSearchResult,
  expectNoModelRowsFor,
  expectPinnedProfilesHidden,
  expectProfileVisibleForProvider,
  expectProviderSearchEmptyState,
  openModelPicker,
  readModelPickerHeight,
  readModelPickerWidth,
  searchProviderModels,
  seedAgentProfiles,
  seedModelProvider,
  expectSearchResultsVirtualized,
} from "../support/helpers/agent-profiles";
import { expectComposerVisible } from "../support/helpers/composer";
import { clickNewChat, clickNewTerminal, gotoWorkspace } from "../support/helpers/launcher";
import { expectProviderStatus, selectComposerProvider } from "../support/helpers/provider-selector";
import { seedWorkspace } from "../support/helpers/seed-client";

// 它的快速模型与 mock 提供方的同名，同一个搜索词在两家都能命中，显示哪家只取决于限定范围。
const MOCK = { id: "mock", models: [{ id: "ten-second-stream" }] };

const STUDIO = {
  id: "mock-studio",
  label: "Mock Studio",
  models: [
    { id: "studio-fast", label: "Ten second stream", description: "Studio quick pass" },
    { id: "studio-deep", label: "Studio deep think", description: "Studio long pass" },
  ],
};

// 指向另一家提供方，用来证明模型菜单仍列出全部 profiles。
const STUDIO_PROFILE = {
  id: "agent_profile_e2e_search_studio",
  name: "Studio anchor",
  provider: STUDIO.id,
  model: "studio-deep",
};

const LARGE_CATALOG_SIZE = 200;
const LARGE_CATALOG = {
  id: "mock-bulk",
  label: "Mock Bulk",
  models: Array.from({ length: LARGE_CATALOG_SIZE }, (_, index) => ({
    id: `bulk-${index}`,
    label: `Bulk model ${index}`,
    description: `Bulk search result ${index}`,
  })),
};

async function waitForProviderReady(provider: string, cwd: string): Promise<void> {
  const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "model-search" });
  try {
    await expectProviderStatus({ client, cwd, provider, status: "ready" });
  } finally {
    await client.close();
  }
}

test.describe("Model search in the composer", () => {
  test("search only reaches the current provider's models", async ({ page }) => {
    const provider = await seedModelProvider(STUDIO);
    const profile = await seedAgentProfiles([STUDIO_PROFILE]);
    const workspace = await seedWorkspace({ repoPrefix: "model-search-provider-" });

    try {
      await waitForProviderReady(STUDIO.id, workspace.repoPath);
      await test.step("open a draft composer on the mock provider", async () => {
        await gotoWorkspace(page, workspace.workspaceId);
        await clickNewChat(page);
        await expectComposerVisible(page);
        await selectComposerProvider(page, "mock");
        await openModelPicker(page);
      });
      const restingWidth = await readModelPickerWidth(page);

      await test.step("the picker opens on the provider and still lists every profile", async () => {
        await expect(page.getByTestId("sheet-header-back")).toHaveCount(0);
        await expect(page.locator('[data-testid^="model-provider-"]')).toHaveCount(0);
        await expectNoModelRowsFor(page, STUDIO);
        await expectProfileVisibleForProvider(page, {
          name: STUDIO_PROFILE.name,
          summary: "Mock Studio · Studio deep think",
        });
      });

      await test.step("a label both providers offer only matches the current one", async () => {
        await searchProviderModels(page, "ten second stream");
        await expectModelSearchResult(page, {
          provider: "mock",
          modelId: "ten-second-stream",
          modelLabel: "Ten second stream",
        });
        await expectNoModelRowsFor(page, STUDIO);
        await expectModelPickerWidth(page, restingWidth);
      });

      await test.step("results replace the pinned profiles", async () => {
        await expectPinnedProfilesHidden(page);
        await closeModelPicker(page);
      });

      await test.step("after switching provider the same query reaches only the new one", async () => {
        await selectComposerProvider(page, STUDIO.id);
        await openModelPicker(page);
        await searchProviderModels(page, "ten second stream");
        await expectModelSearchResult(page, {
          provider: STUDIO.id,
          modelId: "studio-fast",
          modelLabel: "Ten second stream",
        });
        await expectNoModelRowsFor(page, MOCK);
      });

      await test.step("a query can still find a model by its own name", async () => {
        await searchProviderModels(page, "studio deep");
        await expectModelSearchResult(page, {
          provider: STUDIO.id,
          modelId: "studio-deep",
          modelLabel: "Studio deep think",
        });
      });

      // 搜索会退回子序列匹配，「无结果」要用无法从模型名或描述里按序挑出的字母。
      await test.step("a query with no matches shows the empty state", async () => {
        await searchProviderModels(page, "zzz");
        await expectProviderSearchEmptyState(page);
        await closeModelPicker(page);
      });
    } finally {
      await workspace.cleanup();
      await profile.restore();
      await provider.restore();
    }
  });

  test("desktop search keeps its frame stable and virtualizes a large provider catalog", async ({
    page,
  }) => {
    const provider = await seedModelProvider(LARGE_CATALOG);
    const workspace = await seedWorkspace({ repoPrefix: "model-search-large-catalog-" });

    try {
      await waitForProviderReady(LARGE_CATALOG.id, workspace.repoPath);
      await test.step("open the large provider's model picker", async () => {
        await gotoWorkspace(page, workspace.workspaceId);
        await clickNewChat(page);
        await expectComposerVisible(page);
        await selectComposerProvider(page, LARGE_CATALOG.id);
        await openModelPicker(page);
      });

      const restingHeight = await readModelPickerHeight(page);
      const restingWidth = await readModelPickerWidth(page);

      await test.step("a broad query renders only the visible result window", async () => {
        await searchProviderModels(page, "bulk model");
        await expectSearchResultsVirtualized(page, {
          provider: LARGE_CATALOG.id,
          total: LARGE_CATALOG_SIZE,
        });
        await expectModelPickerHeight(page, restingHeight);
        await expectModelPickerWidth(page, restingWidth);
      });

      await test.step("narrowing to one result does not resize the picker", async () => {
        await searchProviderModels(page, "bulk model 199");
        await expectModelSearchResult(page, {
          provider: LARGE_CATALOG.id,
          modelId: "bulk-199",
          modelLabel: "Bulk model 199",
        });
        await expectModelPickerHeight(page, restingHeight);
        await expectModelPickerWidth(page, restingWidth);
      });
    } finally {
      await workspace.cleanup();
      await provider.restore();
    }
  });
});

async function setRuntimeCatalog(client: DaemonClient, count: number, cwd: string) {
  await client.patchDaemonConfig({
    providers: {
      gemini: {
        extends: "acp",
        label: "Catalog provider",
        enabled: true,
        command: [
          process.execPath,
          path.resolve(__dirname, "../support/fixtures/catalog-acp.cjs"),
          String(count),
        ],
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await client.getProvidersSnapshot({ cwd })).entries.find(
          (entry) => entry.provider === "gemini",
        )?.status,
      { timeout: 30_000 },
    )
    .toBe("ready");
}
async function reloadSavedDraft(page: Page) {
  await page.evaluate(() =>
    localStorage.setItem(
      "@osuna:e2e-disable-default-seed-once",
      localStorage.getItem("@osuna:e2e-seed-nonce")!,
    ),
  );
  await page.reload();
  await expectComposerVisible(page);
}
async function expectOneCatalogChoice(page: Page, label: string) {
  await selectComposerProvider(page, "gemini");
  await openModelPicker(page);
  await searchProviderModels(page, label);
  await expect(page.getByTestId("model-row-gemini-gemini-3.5-flash")).toHaveCount(1);
  await closeModelPicker(page);
}

async function configureModelOverride(client: DaemonClient, cwd: string) {
  await client.patchDaemonConfig({
    providers: {
      gemini: {
        additionalModels: [{ id: "gemini-3.5-flash", label: "Configured model", isDefault: true }],
      },
    },
  });
  await expect
    .poll(
      async () =>
        (await client.getProvidersSnapshot({ cwd: cwd })).entries.find(
          (entry) => entry.provider === "gemini",
        )?.models,
      { timeout: 30_000 },
    )
    .toMatchObject([{ id: "gemini-3.5-flash", label: "Configured model", isDefault: true }]);
}

const catalogTest = test.extend<{ catalogClient: DaemonClient }>({
  catalogClient: async ({ e2eWorker }, provide) => {
    void e2eWorker;
    const client = await connectDaemonClient<DaemonClient>({ clientIdPrefix: "catalog-models" });
    try {
      await provide(client);
    } finally {
      try {
        await client.patchDaemonConfig({ removeProviders: ["gemini"] });
      } finally {
        await client.close();
      }
    }
  },
});

catalogTest(
  "New Agent and saved drafts stay usable with repeated runtime model rows",
  async ({ page, withWorkspace, catalogClient: client }, testInfo) => {
    const workspace = await withWorkspace({ prefix: "catalog-models-" });
    await test.step("open a draft with a one-row runtime catalog", async () => {
      await setRuntimeCatalog(client, 1, workspace.repoPath);
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await expectComposerVisible(page);
    });
    await test.step("open New Agent after the provider publishes repeated model rows", async () => {
      await clickNewTerminal(page);
      await setRuntimeCatalog(client, 2, workspace.repoPath);
      await clickNewChat(page);
      await expectComposerVisible(page);
      await expectOneCatalogChoice(page, "Gemini 3.5 Flash");
      await page.screenshot({ path: testInfo.outputPath("duplicate-catalog-draft.png") });
    });
    await test.step("reopen the saved draft with the same catalog", async () => {
      await reloadSavedDraft(page);
      await expectOneCatalogChoice(page, "Gemini 3.5 Flash");
    });
    await test.step("retain configured model overrides when runtime IDs repeat", async () => {
      await configureModelOverride(client, workspace.repoPath);
      await reloadSavedDraft(page);
      await expectOneCatalogChoice(page, "Configured model");
    });
  },
);
