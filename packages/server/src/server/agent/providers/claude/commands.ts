import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { AgentSlashCommand } from "../../agent-sdk-types.js";
import { parseFrontMatter } from "../front-matter.js";

const MAX_COMMAND_DIR_DEPTH = 5;

/**
 * Commands the Claude CLI runs itself. All of them appear in SDK `supportedCommands()`
 * (checked against @anthropic-ai/claude-agent-sdk 0.3.246), so they work from Paseo.
 */
export const CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS: readonly AgentSlashCommand[] = [
  {
    name: "clear",
    description:
      "Start a new session with empty context; previous session stays on disk (resumable with /resume)",
    argumentHint: "[name]",
    kind: "command",
  },
  {
    name: "compact",
    description: "Free up context by summarizing the conversation so far",
    argumentHint: "<optional custom summarization instructions>",
    kind: "command",
  },
  {
    name: "context",
    description: "Show current context usage",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "debug",
    description: "Enable debug logging for this session and help diagnose issues",
    argumentHint: "[issue description]",
    kind: "command",
  },
  {
    name: "extra-usage",
    description: "Renamed to /usage-credits",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "heapdump",
    description: "Dump the JS heap to ~/Desktop",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "init",
    description: "Initialize a new CLAUDE.md file with codebase documentation",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "loop",
    description:
      "Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.",
    argumentHint: "[interval] [prompt]",
    kind: "command",
  },
  {
    name: "schedule",
    description:
      "Create, update, list, or run scheduled cloud agents (routines) that execute on a cron schedule.",
    argumentHint: "",
    kind: "command",
  },
  {
    name: "usage",
    description: "Show session cost, plan usage, and what's contributing to your limits",
    argumentHint: "",
    kind: "command",
  },
];

export const REWIND_COMMAND_NAME = "rewind";

/** Paseo implements /rewind itself; the CLI never reports it. */
const REWIND_COMMAND: AgentSlashCommand = {
  name: REWIND_COMMAND_NAME,
  description: "Rewind tracked files to a previous user message",
  argumentHint: "[user_message_uuid]",
  kind: "command",
};

export interface DiscoverClaudeCommandsInput {
  configDir: string;
  cwd: string;
}

interface ScanCommandsInput {
  dir: string;
  namespace: string[];
}

/**
 * Skills and commands on disk plus built-ins, found without starting the CLI.
 * Personal entries (`configDir`) shadow project entries (`<cwd>/.claude`) of the same name.
 */
export async function discoverClaudeCommands(
  input: DiscoverClaudeCommandsInput,
): Promise<AgentSlashCommand[]> {
  const roots = [input.configDir, path.join(input.cwd, ".claude")];
  const scanned = await Promise.all(
    roots.flatMap((root) => [
      scanSkills(path.join(root, "skills")),
      scanCommands({ dir: path.join(root, "commands"), namespace: [] }),
    ]),
  );
  const byName = new Map<string, AgentSlashCommand>();
  for (const command of [...scanned.flat(), ...CLAUDE_ROOT_ONLY_BUILTIN_COMMANDS, REWIND_COMMAND]) {
    if (!byName.has(command.name)) {
      byName.set(command.name, command);
    }
  }
  return Array.from(byName.values());
}

async function scanSkills(skillsDir: string): Promise<AgentSlashCommand[]> {
  const entries = await readDirOrEmpty(skillsDir);
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry): Promise<AgentSlashCommand | null> => {
        const content = await readFileOrNull(path.join(skillsDir, entry.name, "SKILL.md"));
        if (content === null) {
          return null;
        }
        const { frontMatter, body } = parseFrontMatter(content);
        return {
          name: frontMatter["name"] ?? entry.name,
          description: frontMatter["description"] ?? firstBodyLine(body),
          argumentHint: frontMatter["argument-hint"] ?? "",
          kind: "skill",
        };
      }),
  );
  return skills.filter((skill): skill is AgentSlashCommand => skill !== null);
}

/** `commands/a/b.md` is invoked as `/a:b`. */
async function scanCommands(input: ScanCommandsInput): Promise<AgentSlashCommand[]> {
  const { dir, namespace } = input;
  if (namespace.length > MAX_COMMAND_DIR_DEPTH) {
    return [];
  }
  const entries = await readDirOrEmpty(dir);
  const nested = await Promise.all(
    entries.map(async (entry): Promise<AgentSlashCommand[]> => {
      const entryPath = path.join(dir, entry.name);
      if (await isDirectoryEntry(entry, entryPath)) {
        return await scanCommands({ dir: entryPath, namespace: [...namespace, entry.name] });
      }
      if (!entry.name.endsWith(".md")) {
        return [];
      }
      const content = await readFileOrNull(entryPath);
      if (content === null) {
        return [];
      }
      const { frontMatter, body } = parseFrontMatter(content);
      return [
        {
          name: [...namespace, entry.name.slice(0, -".md".length)].join(":"),
          description: frontMatter["description"] ?? firstBodyLine(body),
          argumentHint: frontMatter["argument-hint"] ?? "",
          kind: "command",
        },
      ];
    }),
  );
  return nested.flat();
}

// Symlinked command folders count as folders, like symlinked skill folders.
async function isDirectoryEntry(entry: Dirent, entryPath: string): Promise<boolean> {
  if (!entry.isSymbolicLink()) {
    return entry.isDirectory();
  }
  try {
    return (await fs.stat(entryPath)).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

async function readDirOrEmpty(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

// Absent directories and dangling symlinks are normal; anything else is a real failure.
function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function firstBodyLine(body: string): string {
  return (
    body
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}
