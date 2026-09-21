import fs from "node:fs";
import { isMainModule } from "./is-main-module.mjs";

// The local Expo modules under `packages/app/modules` that ship Android sources.
// `osuna-hardware-keyboard` is iOS-only and never appears in a Gradle build.
const EXPECTED_PROJECTS = [":osuna-diff-prototype", ":osuna-native-trace", ":osuna-word-stream"];

// A Gradle project name comes from the module's `package.json` name, not its directory,
// and nothing type-checks it against the Kotlin package or the podspec. A stale pre-rename
// name still compiles on the JS side and only fails on a device.
const FORBIDDEN_PROJECT_PATTERN = /^:paseo-/;

function parseLinkedProjects(projectsOutput) {
  return [...projectsOutput.matchAll(/Project '(:[^']+)'/g)].map((match) => match[1]);
}

function parseBuiltProjects(buildLog) {
  return [...buildLog.matchAll(/^> Task (:[^\s:]+):/gm)].map((match) => match[1]);
}

export function validateAndroidAutolink({ projectsOutput, buildLog }) {
  const linked = parseLinkedProjects(projectsOutput);
  const built = new Set(parseBuiltProjects(buildLog));

  const stale = [...new Set([...linked, ...built])].filter((project) =>
    FORBIDDEN_PROJECT_PATTERN.test(project),
  );
  if (stale.length > 0) {
    throw new Error(`Pre-rename Gradle projects survived autolinking: ${stale.join(", ")}`);
  }

  const missing = EXPECTED_PROJECTS.filter((project) => !linked.includes(project));
  if (missing.length > 0) {
    throw new Error(
      `Autolinking did not include these Gradle projects: ${missing.join(", ")}. ` +
        `Linked projects: ${linked.join(", ") || "(none)"}`,
    );
  }

  const unbuilt = EXPECTED_PROJECTS.filter((project) => !built.has(project));
  if (unbuilt.length > 0) {
    throw new Error(
      `These Gradle projects were linked but ran no task, so the app never depended on them: ${unbuilt.join(", ")}`,
    );
  }
}

function parseArgs(argv) {
  let projectsPath;
  let buildLogPath;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--projects") {
      projectsPath = argv[++index];
    } else if (argv[index] === "--build-log") {
      buildLogPath = argv[++index];
    }
  }

  if (!projectsPath || !buildLogPath) {
    throw new Error(
      "Usage: node scripts/validate-android-autolink.mjs --projects <file> --build-log <file>",
    );
  }

  return { projectsPath, buildLogPath };
}

if (isMainModule(import.meta.url)) {
  const { projectsPath, buildLogPath } = parseArgs(process.argv.slice(2));
  validateAndroidAutolink({
    projectsOutput: fs.readFileSync(projectsPath, "utf8"),
    buildLog: fs.readFileSync(buildLogPath, "utf8"),
  });
  console.log(`Android autolinking verified: ${EXPECTED_PROJECTS.join(", ")}`);
}
