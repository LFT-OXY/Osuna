import { test, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import type { SessionOutboundMessage } from "../messages.js";

type CheckoutDiffUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "checkout_diff_update" }
>["payload"];

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-checkout-diff-"));
}

function initGitRepo(cwd: string): void {
  execSync("git init -b main", { cwd, stdio: "pipe" });
  execSync("git config user.email 'test@test.com'", { cwd, stdio: "pipe" });
  execSync("git config user.name 'Test'", { cwd, stdio: "pipe" });
}

function commitFile(cwd: string, fileName: string, content: string): void {
  const filePath = path.join(cwd, fileName);
  writeFileSync(filePath, content);
  execSync(`git add "${fileName}"`, { cwd, stdio: "pipe" });
  execSync("git -c commit.gpgsign=false commit -m 'Initial commit'", {
    cwd,
    stdio: "pipe",
  });
}

async function waitForCheckoutDiffUpdate(
  ctx: DaemonTestContext,
  subscriptionId: string,
  predicate: (payload: CheckoutDiffUpdatePayload) => boolean,
  timeoutMs = 15000,
): Promise<CheckoutDiffUpdatePayload> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for checkout_diff_update (${subscriptionId})`));
    }, timeoutMs);

    const unsubscribe = ctx.client.on("checkout_diff_update", (message) => {
      if (message.type !== "checkout_diff_update") {
        return;
      }
      if (message.payload.subscriptionId !== subscriptionId) {
        return;
      }
      if (!predicate(message.payload)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message.payload);
    });
  });
}

let ctx: DaemonTestContext;

beforeEach(async () => {
  ctx = await createDaemonTestContext();
});

afterEach(async () => {
  await ctx.cleanup();
}, 60000);

test("pushes file-level checkout diff updates with deterministic path order", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "base\n");

    const subscription = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
    const initial = await subscription.ready;
    const subscriptionId = initial.subscriptionId;

    expect(initial.error).toBeNull();
    expect(initial.files).toEqual([]);

    writeFileSync(path.join(cwd, "zeta.txt"), "zeta\n");
    writeFileSync(path.join(cwd, "alpha.txt"), "alpha\n");

    const update = await waitForCheckoutDiffUpdate(ctx, subscriptionId, (payload) => {
      const paths = new Set(payload.files.map((file) => file.path));
      return paths.has("alpha.txt") && paths.has("zeta.txt");
    });

    expect(update.error).toBeNull();
    expect(update.files.map((file) => file.path)).toEqual(["alpha.txt", "zeta.txt"]);

    await subscription.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60000);

test("marks a changed lock file as generated and leaves an ordinary file unmarked", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "base\n");

    const subscription = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
    const initial = await subscription.ready;

    writeFileSync(path.join(cwd, "package-lock.json"), "{}\n");
    writeFileSync(path.join(cwd, "index.ts"), "export {};\n");

    const update = await waitForCheckoutDiffUpdate(ctx, initial.subscriptionId, (payload) => {
      const paths = new Set(payload.files.map((file) => file.path));
      return paths.has("package-lock.json") && paths.has("index.ts");
    });

    expect(update.files.map((file) => ({ path: file.path, generated: file.generated }))).toEqual([
      { path: "index.ts", generated: undefined },
      { path: "package-lock.json", generated: true },
    ]);

    await subscription.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60000);

test("pushes updates when subscribed from a subdirectory and files change outside it", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "base\n");

    const nestedDir = path.join(cwd, "nested", "dir");
    mkdirSync(nestedDir, { recursive: true });

    const subscription = ctx.client.observeCheckoutDiff(nestedDir, { mode: "uncommitted" });
    const initial = await subscription.ready;
    const subscriptionId = initial.subscriptionId;

    expect(initial.error).toBeNull();
    expect(initial.files).toEqual([]);

    writeFileSync(path.join(cwd, "outside-subdir.txt"), "changed outside\n");

    const update = await waitForCheckoutDiffUpdate(ctx, subscriptionId, (payload) =>
      payload.files.some((file) => file.path === "outside-subdir.txt"),
    );

    expect(update.error).toBeNull();
    expect(update.files.some((file) => file.path === "outside-subdir.txt")).toBe(true);

    await subscription.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60000);

test("keeps the socket usable after rejecting an oversized structured diff", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "large-a.js", "const value = 0;\n");
    commitFile(cwd, "large-b.js", "const value = 0;\n");
    // Short lines stay eligible for highlighting; a giant single line is skipped
    // before token expansion and cannot exercise the structured-payload limit.
    const denseExpression = `const value = ${"a+".repeat(100)}a;\n`.repeat(4_000);
    writeFileSync(path.join(cwd, "large-a.js"), denseExpression);
    writeFileSync(path.join(cwd, "large-b.js"), denseExpression);

    const subscription = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
    const initial = await subscription.ready;

    expect(initial).toMatchObject({
      cwd,
      files: [],
      diffTooLarge: true,
      error: { code: "UNKNOWN" },
    });

    const status = await ctx.client.getCheckoutStatus(cwd);
    expect(status).toMatchObject({ cwd, isGit: true });
    await subscription.release();
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 120000);

type CheckoutDiffFile = CheckoutDiffUpdatePayload["files"][number];

function fileListFields(file: CheckoutDiffFile) {
  return {
    path: file.path,
    oldPath: file.oldPath,
    isNew: file.isNew,
    isDeleted: file.isDeleted,
    additions: file.additions,
    deletions: file.deletions,
    status: file.status,
    generated: file.generated,
  };
}

test("serves a files-only subscription beside a full one with the same file list and no hunks", async () => {
  const cwd = tmpCwd();

  try {
    initGitRepo(cwd);
    commitFile(cwd, "base.txt", "one\ntwo\nthree\n");
    commitFile(cwd, "gone.txt", "bye\n");
    commitFile(cwd, "old-name.ts", "export const name = 1;\n");
    commitFile(cwd, "image.bin", "\u0000\u0001\u0002binary\n");

    writeFileSync(path.join(cwd, "base.txt"), "one\n2\nthree\nfour\n");
    rmSync(path.join(cwd, "gone.txt"));
    execSync("git mv old-name.ts new-name.ts", { cwd, stdio: "pipe" });
    writeFileSync(path.join(cwd, "image.bin"), "\u0000\u0003\u0004binary\n");
    writeFileSync(path.join(cwd, "package-lock.json"), "{\n}\n");
    writeFileSync(path.join(cwd, "added.ts"), "a\nb\nc\n");

    const full = ctx.client.observeCheckoutDiff(cwd, { mode: "uncommitted" });
    const filesOnly = ctx.client.observeCheckoutDiff(cwd, {
      mode: "uncommitted",
      filesOnly: true,
    });
    const [fullInitial, filesOnlyInitial] = await Promise.all([full.ready, filesOnly.ready]);

    expect(filesOnlyInitial.error).toBeNull();
    expect(filesOnlyInitial.files.map(fileListFields)).toEqual([
      {
        path: "added.ts",
        oldPath: undefined,
        isNew: true,
        isDeleted: false,
        additions: 3,
        deletions: 0,
        status: "ok",
        generated: undefined,
      },
      {
        path: "base.txt",
        oldPath: undefined,
        isNew: false,
        isDeleted: false,
        additions: 2,
        deletions: 1,
        status: "ok",
        generated: undefined,
      },
      {
        path: "gone.txt",
        oldPath: undefined,
        isNew: false,
        isDeleted: true,
        additions: 0,
        deletions: 1,
        status: "ok",
        generated: undefined,
      },
      {
        path: "image.bin",
        oldPath: undefined,
        isNew: false,
        isDeleted: false,
        additions: 0,
        deletions: 0,
        status: "binary",
        generated: undefined,
      },
      {
        path: "new-name.ts",
        oldPath: "old-name.ts",
        isNew: false,
        isDeleted: false,
        additions: 1,
        deletions: 0,
        status: "ok",
        generated: undefined,
      },
      {
        path: "package-lock.json",
        oldPath: undefined,
        isNew: true,
        isDeleted: false,
        additions: 2,
        deletions: 0,
        status: "ok",
        generated: true,
      },
    ]);
    expect(filesOnlyInitial.files.every((file) => file.hunks.length === 0)).toBe(true);
    expect(fullInitial.files.map(fileListFields)).toEqual(
      filesOnlyInitial.files.map(fileListFields),
    );
    expect(fullInitial.files.find((file) => file.path === "base.txt")?.hunks.length).toBe(1);

    writeFileSync(path.join(cwd, "later.ts"), "x\ny\n");
    const [fullUpdate, filesOnlyUpdate] = await Promise.all([
      waitForCheckoutDiffUpdate(ctx, fullInitial.subscriptionId, (payload) =>
        payload.files.some((file) => file.path === "later.ts"),
      ),
      waitForCheckoutDiffUpdate(ctx, filesOnlyInitial.subscriptionId, (payload) =>
        payload.files.some((file) => file.path === "later.ts"),
      ),
    ]);

    expect(filesOnlyUpdate.files.every((file) => file.hunks.length === 0)).toBe(true);
    expect(fullUpdate.files.find((file) => file.path === "later.ts")?.hunks.length).toBe(1);
    expect(fullUpdate.files.map(fileListFields)).toEqual(filesOnlyUpdate.files.map(fileListFields));

    await Promise.all([full.release(), filesOnly.release()]);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}, 60000);
