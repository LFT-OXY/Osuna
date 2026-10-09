import {
  isCompleteGitRemote,
  parseGitHubRemoteUrl,
  parseGitRemoteLocation,
} from "@osuna/protocol/git-remote";
import type { TFunction } from "i18next";
import { shortenPath } from "@/utils/shorten-path";
import type { AddProjectHost, AddProjectPage, GithubRepositoryChoice } from "./model";

export type AddProjectMethodId = "directory-search" | "browse" | "github" | "new-directory";

// 这里只返回翻译键和参数，由组件按当前语言渲染
export interface AddProjectCopy {
  key: string;
  params?: Record<string, string>;
}

export function renderAddProjectCopy(t: TFunction, copy: AddProjectCopy): string {
  return t(copy.key, copy.params);
}

// 各页面的标题与面板无障碍标签共用这组键名：addProject.titles.* / addProject.panelAccessibilityLabels.*
export const ADD_PROJECT_PAGE_KEYS: Record<AddProjectPage["kind"], string> = {
  host: "host",
  method: "method",
  "directory-search": "directorySearch",
  "github-search": "githubSearch",
  "github-location": "githubLocation",
  "new-directory-parent": "newDirectoryParent",
  "new-directory-name": "newDirectoryName",
};

export interface AddProjectMethodOption {
  id: AddProjectMethodId;
  label: AddProjectCopy;
  description: AddProjectCopy;
  disabled?: boolean;
}

export interface ManualGithubRepositoryChoice extends GithubRepositoryChoice {
  hint: AddProjectCopy;
}

export interface AddProjectPathOption {
  id: string;
  path: string;
  displayPath: string;
  secondaryText: AddProjectCopy;
  disabled: boolean;
}

export function filterAddProjectHosts(hosts: AddProjectHost[], query: string): AddProjectHost[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return hosts;
  return hosts.filter(
    (host) =>
      host.label.toLowerCase().includes(normalized) ||
      host.serverId.toLowerCase().includes(normalized),
  );
}

export function buildAddProjectMethods(host: AddProjectHost): AddProjectMethodOption[] {
  if (!host.canAddProject) return [];
  const options: AddProjectMethodOption[] = [];
  options.push({
    id: "directory-search",
    label: { key: "addProject.methods.directorySearch.label" },
    description: {
      key: "addProject.methods.directorySearch.description",
      params: { host: host.label },
    },
  });
  if (host.canBrowse) {
    options.push({
      id: "browse",
      label: { key: "addProject.methods.browse.label" },
      description: { key: "addProject.methods.browse.description" },
    });
  }
  options.push({
    id: "github",
    label: { key: "addProject.methods.github.label" },
    description: githubMethodDescription(host),
    disabled: !host.canCloneGithubRepositories,
  });
  options.push({
    id: "new-directory",
    label: { key: "addProject.methods.newDirectory.label" },
    description: host.canCreateDirectory
      ? { key: "addProject.methods.newDirectory.description", params: { host: host.label } }
      : { key: "addProject.methods.newDirectory.updateHost" },
    disabled: !host.canCreateDirectory,
  });
  return options;
}

export function addProjectMethodEmptyText(host: AddProjectHost | null): AddProjectCopy {
  return host?.canAddProject === false
    ? { key: "addProject.empty.updateHost" }
    : { key: "addProject.empty.noMatchingOptions" };
}

function githubMethodDescription(host: AddProjectHost): AddProjectCopy {
  if (!host.canCloneGithubRepositories) {
    return { key: "addProject.methods.github.updateHost" };
  }
  if (host.canSearchGithubRepositories) {
    return { key: "addProject.methods.github.search" };
  }
  return { key: "addProject.methods.github.manual" };
}

export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function buildManualGithubRepositoryChoices(query: string): ManualGithubRepositoryChoice[] {
  const repo = query.trim();
  if (!repo) return [];

  if (isCompleteGitRemote(repo)) {
    const identity = parseGitHubRemoteUrl(repo);
    const location = parseGitRemoteLocation(repo);
    const remoteName = location ? pathBaseName(location.path).replace(/\.git$/u, "") : repo;
    return [
      {
        id: `manual:${repo}`,
        nameWithOwner: identity?.repo ?? remoteName,
        cloneUrl: repo,
        description: null,
        hint: { key: "addProject.rows.cloneRepositoryUrl" },
        updatedAt: null,
      },
    ];
  }

  const shorthand = repo.match(/^([^\s/]+)\/([^\s/]+)$/u);
  if (!shorthand) return [];
  const nameWithOwner = `${shorthand[1]}/${shorthand[2]}`;
  return (["https", "ssh"] as const).map((cloneProtocol) => ({
    id: `manual:${cloneProtocol}:${nameWithOwner}`,
    nameWithOwner,
    cloneUrl: nameWithOwner,
    cloneProtocol,
    description: null,
    hint: {
      key: "addProject.rows.cloneOwnerRepoVia",
      params: { protocol: cloneProtocol.toUpperCase() },
    },
    updatedAt: null,
  }));
}

export function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return null;
  if (index === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, index);
}

export function joinDirectoryPath(parent: string, name: string): string {
  const trimmedParent = parent.replace(/[\\/]+$/, "");
  const separator = trimmedParent.includes("\\") && !trimmedParent.includes("/") ? "\\" : "/";
  return `${trimmedParent}${separator}${name}`;
}

export function buildSuggestedParentDirectories(projectPaths: string[]): string[] {
  const values = [
    ...projectPaths.flatMap((path) => {
      const parent = parentDirectory(path);
      return parent ? [parent] : [];
    }),
    "~/dev",
    "~/Developer",
    "~/src",
    "~/projects",
    "~/workspace",
    "~",
  ];
  return [...new Set(values)];
}

export function buildCloneLocationOptions(input: {
  parents: string[];
  repositoryName: string;
  existingPaths: string[];
}): AddProjectPathOption[] {
  const existing = new Set(input.existingPaths.map(pathIdentity));
  const seen = new Set<string>();
  return input.parents.flatMap((parent) => {
    const path = joinDirectoryPath(parent, input.repositoryName);
    const identity = pathIdentity(path);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const pathExists = existing.has(identity);
    return [
      {
        id: parent,
        path: parent,
        displayPath: path,
        secondaryText: pathExists
          ? { key: "addProject.rows.alreadyExists" }
          : { key: "addProject.rows.parentDirectory", params: { path: parent } },
        disabled: pathExists,
      },
    ];
  });
}

function pathIdentity(path: string): string {
  const normalized = shortenPath(path.trim()).replace(/\\/g, "/").replace(/\/+$/u, "");
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}
