import { promises as fs } from "node:fs";
import path from "node:path";
import type { UsageProjectKind } from "@getpaseo/protocol/usage/types";
import type { PersistedProjectRecord } from "../workspace-registry.js";
import { isMissingPathError } from "./types.js";

export interface UsageProjectAttribution {
  rootPath: string;
  displayName: string;
  kind: UsageProjectKind;
}

/**
 * A bucket row only knows its cwd. Attribution goes registered project first,
 * then the enclosing Git work tree, then the cwd itself — a directory that no
 * longer exists still lands on that last rung rather than disappearing.
 */
export class UsageProjectResolver {
  private readonly listProjects: () => Promise<PersistedProjectRecord[]>;
  private readonly cache = new Map<string, UsageProjectAttribution>();
  private readonly gitRoots = new Map<string, string | null>();

  constructor(options: { listProjects: () => Promise<PersistedProjectRecord[]> }) {
    this.listProjects = options.listProjects;
  }

  async resolveAll(cwds: Iterable<string>): Promise<Map<string, UsageProjectAttribution>> {
    const pending = Array.from(cwds).filter((cwd) => !this.cache.has(cwd));
    const projects = pending.length > 0 ? await this.listProjects() : [];
    for (const cwd of pending) {
      this.cache.set(cwd, await this.resolve(cwd, projects));
    }
    const resolved = new Map<string, UsageProjectAttribution>();
    for (const cwd of cwds) {
      const attribution = this.cache.get(cwd);
      if (attribution) resolved.set(cwd, attribution);
    }
    return resolved;
  }

  private async resolve(
    cwd: string,
    projects: PersistedProjectRecord[],
  ): Promise<UsageProjectAttribution> {
    const registered = bestRegisteredProject(cwd, projects);
    if (registered) {
      return {
        rootPath: registered.rootPath,
        displayName: registered.displayName,
        kind: registered.kind,
      };
    }
    const gitRoot = await this.findGitRoot(cwd);
    if (gitRoot) {
      return { rootPath: gitRoot, displayName: path.basename(gitRoot), kind: "git" };
    }
    return { rootPath: cwd, displayName: path.basename(cwd) || cwd, kind: "directory" };
  }

  private async findGitRoot(cwd: string): Promise<string | null> {
    const cached = this.gitRoots.get(cwd);
    if (cached !== undefined) return cached;

    let current = path.resolve(cwd);
    const visited: string[] = [];
    for (;;) {
      const known = this.gitRoots.get(current);
      if (known !== undefined) {
        for (const directory of visited) this.gitRoots.set(directory, known);
        return known;
      }
      visited.push(current);
      if (await exists(path.join(current, ".git"))) {
        for (const directory of visited) this.gitRoots.set(directory, current);
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const directory of visited) this.gitRoots.set(directory, null);
    return null;
  }
}

function bestRegisteredProject(
  cwd: string,
  projects: PersistedProjectRecord[],
): PersistedProjectRecord | null {
  let best: PersistedProjectRecord | null = null;
  for (const project of projects) {
    if (!isWithin(project.rootPath, cwd)) continue;
    if (!best || project.rootPath.length > best.rootPath.length) best = project;
  }
  return best;
}

function isWithin(rootPath: string, cwd: string): boolean {
  const relative = path.relative(rootPath, cwd);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}
