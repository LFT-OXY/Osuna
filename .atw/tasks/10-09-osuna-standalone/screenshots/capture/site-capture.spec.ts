// 临时文件（不提交）：起隔离 daemon + Metro，造好官网取图用的数据，然后挂起等外部脚本截图。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { daemonTest as test } from "../support/fixtures";

const CAPTURE_DIR = "/tmp/impl12-capture";

// 编排环境里带着上游正式 daemon 的 PASEO_* 变量，不让它们进到隔离 daemon。
for (const key of Object.keys(process.env)) {
  if (key.startsWith("PASEO_")) delete process.env[key];
}
const PROVIDER_ID = "acp-agent";

test.use({
  // daemon 及其子进程的 HOME 指到临时目录，避免任何默认路径落到真实用户目录。
  e2eDaemonEnvironment: { HOME: `${CAPTURE_DIR}/home` },
  e2eDaemonConfig: {
    version: 1,
    agents: {
      providers: {
        [PROVIDER_ID]: {
          extends: "acp",
          label: "ACP Agent",
          enabled: true,
          command: [process.execPath, path.resolve(__dirname, "../support/fixtures/site-capture-acp.cjs")],
        },
      },
    },
  },
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function writeFiles(root: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function createRepo(root: string, name: string, files: Record<string, string>) {
  const repo = path.join(root, name);
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.email", "dev@osuna.test");
  git(repo, "config", "user.name", "Osuna");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFiles(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "-m", "init");
  return repo;
}

const NOTES_API_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify(
    {
      name: "notes-api",
      version: "0.4.0",
      private: true,
      type: "module",
      scripts: { dev: "tsx watch src/server.ts", test: "vitest run" },
      dependencies: { hono: "^4.6.0", kysely: "^0.27.4" },
      devDependencies: { tsx: "^4.19.0", typescript: "^5.6.0", vitest: "^2.1.0" },
    },
    null,
    2,
  )}\n`,
  "README.md": "# notes-api\n\n一个小型笔记服务。\n\n## 接口\n\n- `GET /notes` 列出全部笔记\n- `POST /notes` 新建笔记\n",
  "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true, module: "ESNext", target: "ES2022" } }, null, 2)}\n`,
  "src/server.ts": `import { Hono } from "hono";\nimport { notes } from "./routes/notes";\n\nexport const app = new Hono();\n\napp.get("/health", (c) => c.json({ ok: true }));\napp.route("/notes", notes);\n`,
  "src/db.ts": `import { Kysely, SqliteDialect } from "kysely";\nimport Database from "better-sqlite3";\nimport type { Note } from "./store";\n\nexport const db = new Kysely<{ notes: Note }>({\n  dialect: new SqliteDialect({ database: new Database("notes.db") }),\n});\n`,
  "src/store.ts": `import { db } from "./db";\n\nexport interface Note {\n  id: string;\n  title: string;\n  body: string;\n  updatedAt: string;\n}\n\nexport async function listNotes(): Promise<Note[]> {\n  return db.selectFrom("notes").selectAll().orderBy("updatedAt", "desc").execute();\n}\n`,
  "src/routes/notes.ts": `import { Hono } from "hono";\nimport { listNotes } from "../store";\n\nexport const notes = new Hono();\n\nnotes.get("/", async (c) => {\n  const all = await listNotes();\n  return c.json({ notes: all });\n});\n`,
  "test/helpers.ts": `import { db } from "../src/db";\n\nexport async function seedNotes(count: number) {\n  await db.deleteFrom("notes").execute();\n  for (let index = 1; index <= count; index++) {\n    await db\n      .insertInto("notes")\n      .values({\n        id: String(index),\n        title: \`Note \${index}\`,\n        body: "",\n        updatedAt: new Date(index * 1000).toISOString(),\n      })\n      .execute();\n  }\n}\n`,
  "test/health.test.ts": `import { expect, it } from "vitest";\nimport { app } from "../src/server";\n\nit("reports healthy", async () => {\n  const res = await app.request("/health");\n  expect(await res.json()).toEqual({ ok: true });\n});\n`,
  "test/notes.test.ts": `import { describe, expect, it } from "vitest";\nimport { app } from "../src/server";\nimport { seedNotes } from "./helpers";\n\ndescribe("GET /notes", () => {\n  it("returns notes ordered by last update", async () => {\n    await seedNotes(3);\n    const res = await app.request("/notes");\n    const body = await res.json();\n    expect(body.notes.map((note: { title: string }) => note.title)).toEqual([\n      "Note 3",\n      "Note 2",\n      "Note 1",\n    ]);\n  });\n});\n`,
};

const DASHBOARD_FILES: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "web-dashboard", version: "1.8.2", private: true }, null, 2)}\n`,
  "README.md": "# web-dashboard\n\n团队数据看板。\n",
  "src/format.ts": `export function formatDay(date: Date): string {\n  return date.toLocaleDateString("zh-CN");\n}\n`,
};

const INFRA_FILES: Record<string, string> = {
  "README.md": "# infra-scripts\n\n部署与备份脚本。\n",
  "deploy.sh": "#!/usr/bin/env bash\nset -euo pipefail\n\necho \"deploying...\"\n",
};

test("serve data for website captures", async ({ e2eWorkerClient: client }) => {
  test.setTimeout(4 * 60 * 60 * 1000);
  await mkdir(CAPTURE_DIR, { recursive: true });
  const root = await mkdtemp(path.join(await realpath(tmpdir()), "osuna-site-"));

  try {
    const notesRepo = await createRepo(root, "notes-api", NOTES_API_FILES);
    const dashboardRepo = await createRepo(root, "web-dashboard", DASHBOARD_FILES);
    const infraRepo = await createRepo(root, "infra-scripts", INFRA_FILES);

    const workspaces: Record<string, string> = {};
    for (const [name, repo] of [
      ["notes", notesRepo],
      ["dashboard", dashboardRepo],
      ["infra", infraRepo],
    ] as const) {
      const created = await client.createWorkspace({ source: { kind: "directory", path: repo } });
      if (!created.workspace) throw new Error(created.error ?? `workspace ${name} failed`);
      workspaces[name] = created.workspace.id;
    }

    const notesAgent = await client.createAgent({
      provider: PROVIDER_ID,
      cwd: notesRepo,
      workspaceId: workspaces.notes,
      title: "给笔记列表加分页",
      initialPrompt: "给笔记列表接口加上分页，并补上测试。",
    });
    await client.waitForFinish(notesAgent.id, 60_000);

    const dashboardAgent = await client.createAgent({
      provider: PROVIDER_ID,
      cwd: dashboardRepo,
      workspaceId: workspaces.dashboard,
      title: "排查 CI 偶发失败",
      initialPrompt: "图表测试在 CI 上偶尔失败，帮我查一下原因。",
    });
    await client.waitForFinish(dashboardAgent.id, 60_000);
    await client.checkoutRefresh(notesRepo);

    const notes: string[] = [];
    for (const slug of ["note-tags", "fix-search-ranking"]) {
      try {
        const created = await client.createWorkspace({
          source: { kind: "worktree", cwd: notesRepo, action: "branch-off", worktreeSlug: slug },
        });
        if (created.workspace) workspaces[slug] = created.workspace.id;
        else notes.push(`worktree ${slug}: ${created.error}`);
      } catch (error) {
        notes.push(`worktree ${slug}: ${String(error)}`);
      }
    }

    let terminalId: string | null = null;
    try {
      const created = await client.createTerminal(notesRepo, "zsh", undefined, {
        workspaceId: workspaces.notes,
        command: "/bin/zsh",
        args: ["-f"],
      });
      terminalId = created.terminal?.id ?? null;
      if (!terminalId) notes.push(`terminal: ${created.error}`);
      else {
        await client.subscribeTerminal(terminalId);
        const type = async (data: string) => {
          client.sendTerminalInput(terminalId as string, { type: "input", data });
          await new Promise((resolve) => setTimeout(resolve, 1200));
        };
        await type("PROMPT='%1~ %# '; clear\r");
        await type("git status --short\r");
        await type("git diff --stat\r");
      }
    } catch (error) {
      notes.push(`terminal: ${String(error)}`);
    }

    await writeFile(
      path.join(CAPTURE_DIR, "info.json"),
      `${JSON.stringify(
        {
          metroPort: process.env.E2E_METRO_PORT,
          daemonPort: process.env.E2E_DAEMON_PORT,
          serverId: process.env.E2E_SERVER_ID,
          osunaHome: process.env.E2E_OSUNA_HOME,
          root,
          repos: { notes: notesRepo, dashboard: dashboardRepo, infra: infraRepo },
          workspaces,
          agents: { notes: notesAgent.id, dashboard: dashboardAgent.id },
          terminalId,
          notes,
        },
        null,
        2,
      )}\n`,
    );
    console.log("[site-capture] ready");

    const stopFile = path.join(CAPTURE_DIR, "stop");
    while (!existsSync(stopFile)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
