import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  backAddProjectPage,
  chooseAddProjectHost,
  currentAddProjectPage,
  moveAddProjectActiveIndex,
  moveAddProjectSelection,
  openAddProjectFlow,
  openDirectorySearchPage,
  openGithubLocationPage,
  openNewDirectoryNamePage,
  openNewDirectoryParentPage,
  setAddProjectActiveIndex,
  setAddProjectPageInput,
  setNewDirectoryName,
  type AddProjectHost,
} from "./model";
import {
  ADD_PROJECT_PAGE_KEYS,
  addProjectMethodEmptyText,
  buildAddProjectMethods,
  buildCloneLocationOptions,
  buildManualGithubRepositoryChoices,
  renderAddProjectCopy,
  type AddProjectCopy,
} from "./options";

const HOST: AddProjectHost = {
  serverId: "host-1",
  label: "Local",
  canAddProject: true,
  canBrowse: true,
  canCloneGithubRepositories: true,
  canSearchGithubRepositories: true,
  canCreateDirectory: true,
};

describe("Add Project navigation", () => {
  it("skips a single connected host without adding it to history", () => {
    const state = openAddProjectFlow({ hosts: [HOST] });

    expect(currentAddProjectPage(state)).toEqual({
      kind: "method",
      hostId: "host-1",
      activeIndex: 0,
      error: null,
      isSubmitting: false,
    });
    expect(backAddProjectPage(state)).toBeNull();
  });

  it("restores page input and selection after Back", () => {
    const secondHost = { ...HOST, serverId: "host-2", label: "Remote" };
    let state = openAddProjectFlow({ hosts: [HOST, secondHost] });
    state = setAddProjectPageInput(state, "rem");
    state = setAddProjectActiveIndex(state, 1);
    state = chooseAddProjectHost(state, secondHost.serverId);
    state = openDirectorySearchPage(state, secondHost.serverId);

    state = backAddProjectPage(state) ?? state;
    state = backAddProjectPage(state) ?? state;

    expect(currentAddProjectPage(state)).toEqual({
      kind: "host",
      query: "rem",
      activeIndex: 1,
      error: null,
    });
  });

  it("wraps keyboard selection in both directions", () => {
    expect(moveAddProjectActiveIndex(2, 3, "next")).toBe(0);
    expect(moveAddProjectActiveIndex(0, 3, "previous")).toBe(2);
    expect(moveAddProjectSelection(0, [true, false, true], "next")).toBe(2);
  });

  it("restores a directory name after returning to and reselecting its parent", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openNewDirectoryParentPage(state, HOST.serverId);
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");
    state = setNewDirectoryName(state, "command-center");
    state = backAddProjectPage(state) ?? state;
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "new-directory-name",
      parentPath: "~/dev",
      name: "command-center",
    });
  });

  it("restores the GitHub destination query and active parent when reopening a repository", () => {
    const repository = {
      id: "repo-1",
      nameWithOwner: "LFT-OXY/Osuna",
      cloneUrl: "git@github.com:LFT-OXY/Osuna.git",
      description: null,
      visibility: "public",
      updatedAt: null,
    };
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openGithubLocationPage(state, HOST.serverId, repository);
    state = setAddProjectPageInput(state, "~/dev");
    state = setAddProjectActiveIndex(state, 2);
    state = backAddProjectPage(state) ?? state;
    state = openGithubLocationPage(state, HOST.serverId, repository);

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "github-location",
      query: "~/dev",
      activeIndex: 2,
    });
  });
});

describe("Add Project options", () => {
  it("hides every mutating method when the host lacks stable project identity", () => {
    const outdatedHost = { ...HOST, canAddProject: false };

    expect(buildAddProjectMethods(outdatedHost)).toEqual([]);
    expect(addProjectMethodEmptyText(outdatedHost)).toEqual({ key: "addProject.empty.updateHost" });
  });

  it("keeps host-upgrade methods discoverable while hiding local-only Browse", () => {
    expect(
      buildAddProjectMethods({
        ...HOST,
        canBrowse: false,
        canCloneGithubRepositories: false,
        canSearchGithubRepositories: false,
        canCreateDirectory: false,
      }),
    ).toEqual([
      {
        id: "directory-search",
        label: { key: "addProject.methods.directorySearch.label" },
        description: {
          key: "addProject.methods.directorySearch.description",
          params: { host: "Local" },
        },
      },
      {
        id: "github",
        label: { key: "addProject.methods.github.label" },
        description: { key: "addProject.methods.github.updateHost" },
        disabled: true,
      },
      {
        id: "new-directory",
        label: { key: "addProject.methods.newDirectory.label" },
        description: { key: "addProject.methods.newDirectory.updateHost" },
        disabled: true,
      },
    ]);
  });

  it("offers manual URL and protocol-specific owner/repo clone choices", () => {
    expect(buildManualGithubRepositoryChoices("git@github.com:LFT-OXY/Osuna.git")).toEqual([
      expect.objectContaining({
        id: "manual:git@github.com:LFT-OXY/Osuna.git",
        nameWithOwner: "LFT-OXY/Osuna",
        cloneUrl: "git@github.com:LFT-OXY/Osuna.git",
        hint: { key: "addProject.rows.cloneRepositoryUrl" },
      }),
    ]);
    expect(buildManualGithubRepositoryChoices("LFT-OXY/Osuna")).toEqual([
      expect.objectContaining({
        cloneProtocol: "https",
        cloneUrl: "LFT-OXY/Osuna",
        hint: { key: "addProject.rows.cloneOwnerRepoVia", params: { protocol: "HTTPS" } },
      }),
      expect.objectContaining({
        cloneProtocol: "ssh",
        cloneUrl: "LFT-OXY/Osuna",
        hint: { key: "addProject.rows.cloneOwnerRepoVia", params: { protocol: "SSH" } },
      }),
    ]);
    expect(buildManualGithubRepositoryChoices("osuna")).toEqual([]);
  });

  it("shows final clone paths while retaining parent paths as values", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["~/dev", "~/workspace"],
        repositoryName: "osuna",
        existingPaths: ["~/workspace/osuna"],
      }),
    ).toEqual([
      {
        id: "~/dev",
        path: "~/dev",
        displayPath: "~/dev/osuna",
        secondaryText: { key: "addProject.rows.parentDirectory", params: { path: "~/dev" } },
        disabled: false,
      },
      {
        id: "~/workspace",
        path: "~/workspace",
        displayPath: "~/workspace/osuna",
        secondaryText: { key: "addProject.rows.alreadyExists" },
        disabled: true,
      },
    ]);
  });

  it("shows equivalent absolute-home and tilde destinations only once", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["/Users/moboudra/dev", "~/dev"],
        repositoryName: "dotfiles",
        existingPaths: [],
      }),
    ).toEqual([
      {
        id: "/Users/moboudra/dev",
        path: "/Users/moboudra/dev",
        displayPath: "/Users/moboudra/dev/dotfiles",
        secondaryText: {
          key: "addProject.rows.parentDirectory",
          params: { path: "/Users/moboudra/dev" },
        },
        disabled: false,
      },
    ]);
  });
});

describe("Add Project options rendered in English", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
    await i18n.changeLanguage("en");
  });

  function render(copy: AddProjectCopy): string {
    return renderAddProjectCopy(i18n.t, copy);
  }

  it("keeps the method labels and descriptions", () => {
    const methods = buildAddProjectMethods({ ...HOST, canSearchGithubRepositories: false });
    expect(methods.map((method) => [render(method.label), render(method.description)])).toEqual([
      ["Search for directory", "Find a directory on Local"],
      ["Browse", "Choose or create a directory in Finder"],
      ["Clone from GitHub", "Enter a GitHub URL or owner/repo"],
      ["New directory", "Create an empty directory on Local"],
    ]);
    expect(
      render(
        buildAddProjectMethods(HOST).find((method) => method.id === "github")?.description ?? {
          key: "missing",
        },
      ),
    ).toBe("Search projects available to your GitHub account");
    expect(
      buildAddProjectMethods({
        ...HOST,
        canCloneGithubRepositories: false,
        canCreateDirectory: false,
      })
        .filter((method) => method.disabled)
        .map((method) => render(method.description)),
    ).toEqual([
      "Update this host to clone GitHub repositories",
      "Update this host to create directories",
    ]);
  });

  it("resolves a title and panel label for every page", () => {
    for (const pageKey of Object.values(ADD_PROJECT_PAGE_KEYS)) {
      expect(i18n.exists(`addProject.titles.${pageKey}`), pageKey).toBe(true);
      expect(i18n.exists(`addProject.panelAccessibilityLabels.${pageKey}`), pageKey).toBe(true);
    }
    expect(i18n.t("addProject.panelAccessibilityLabels.githubSearch")).toBe(
      "Add project: github-search",
    );
  });

  it("keeps the empty, manual clone, and destination hints", () => {
    expect(render(addProjectMethodEmptyText({ ...HOST, canAddProject: false }))).toBe(
      "Update the host to use Add Project.",
    );
    expect(render(addProjectMethodEmptyText(HOST))).toBe("No matching options");
    expect(render(addProjectMethodEmptyText(null))).toBe("No matching options");
    expect(
      buildManualGithubRepositoryChoices("LFT-OXY/Osuna").map((choice) => render(choice.hint)),
    ).toEqual(["Clone owner/repo via HTTPS", "Clone owner/repo via SSH"]);
    expect(
      buildManualGithubRepositoryChoices("https://github.com/LFT-OXY/Osuna.git").map((choice) =>
        render(choice.hint),
      ),
    ).toEqual(["Clone this repository URL"]);
    expect(
      buildCloneLocationOptions({
        parents: ["~/dev", "~/workspace"],
        repositoryName: "osuna",
        existingPaths: ["~/workspace/osuna"],
      }).map((option) => render(option.secondaryText)),
    ).toEqual(["Parent directory: ~/dev", "Already exists"]);
  });
});
