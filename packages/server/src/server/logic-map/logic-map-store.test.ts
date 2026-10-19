import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";

import { createEmptyLogicMap, LOGIC_MAPS_DIRECTORY } from "./logic-map-store.js";
import { parseLogicMapSkeleton } from "./logic-map-skeleton.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeWorkspace(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "paseo-logic-map-"));
  tempDirs.push(cwd);
  return cwd;
}

test("a new logic map is an empty, valid skeleton under docs/logic-maps/<temporary name>/", async () => {
  const cwd = await makeWorkspace();

  const mapName = await createEmptyLogicMap(cwd);

  expect(LOGIC_MAPS_DIRECTORY).toBe("docs/logic-maps");
  expect(mapName).toMatch(/^untitled-[0-9a-f]{8}$/);
  const mapDir = path.join(cwd, "docs", "logic-maps", mapName);
  expect(await readdir(mapDir)).toEqual(["map.json"]);
  const skeleton = parseLogicMapSkeleton(
    JSON.parse(await readFile(path.join(mapDir, "map.json"), "utf8")),
  );
  expect(skeleton).toEqual({ title: null, specFramework: null, nodes: [], edges: [] });
});

test("each new logic map gets its own folder and leaves existing maps alone", async () => {
  const cwd = await makeWorkspace();

  const first = await createEmptyLogicMap(cwd);
  const second = await createEmptyLogicMap(cwd);

  expect(second).not.toBe(first);
  expect((await readdir(path.join(cwd, "docs", "logic-maps"))).sort()).toEqual(
    [first, second].sort(),
  );
});

test("a workspace directory that does not exist is an error, not a new folder tree", async () => {
  const cwd = path.join(await makeWorkspace(), "missing");

  await expect(createEmptyLogicMap(cwd)).rejects.toThrow(/does not exist/);
});
