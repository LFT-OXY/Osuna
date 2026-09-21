import assert from "node:assert/strict";
import test from "node:test";
import { validateAndroidAutolink } from "./validate-android-autolink.mjs";

const projectsOutput = `
------------------------------------------------------------
Root project 'Osuna'
------------------------------------------------------------

Root project 'Osuna'
+--- Project ':app'
+--- Project ':expo'
+--- Project ':expo-modules-core'
+--- Project ':osuna-diff-prototype'
+--- Project ':osuna-native-trace'
\\--- Project ':osuna-word-stream'
`;

const buildLog = `
> Task :osuna-diff-prototype:compileDebugKotlin
> Task :osuna-native-trace:compileDebugKotlin
> Task :osuna-word-stream:compileDebugKotlin UP-TO-DATE
> Task :app:assembleDebug
BUILD SUCCESSFUL in 12m 3s
`;

test("accepts a build where every renamed module is linked and compiled", () => {
  validateAndroidAutolink({ projectsOutput, buildLog });
});

test("rejects a module that autolinking never included", () => {
  const withoutTrace = projectsOutput.replace("+--- Project ':osuna-native-trace'\n", "");
  assert.throws(
    () => validateAndroidAutolink({ projectsOutput: withoutTrace, buildLog }),
    /:osuna-native-trace/,
  );
});

test("rejects a surviving pre-rename Gradle project", () => {
  const withPaseo = projectsOutput.replace(
    "+--- Project ':osuna-native-trace'",
    "+--- Project ':paseo-native-trace'\n+--- Project ':osuna-native-trace'",
  );
  assert.throws(
    () => validateAndroidAutolink({ projectsOutput: withPaseo, buildLog }),
    /:paseo-native-trace/,
  );
});

test("rejects a module that is linked but never reaches the app's dependency graph", () => {
  const withoutTraceTasks = buildLog.replace("> Task :osuna-native-trace:compileDebugKotlin\n", "");
  assert.throws(
    () => validateAndroidAutolink({ projectsOutput, buildLog: withoutTraceTasks }),
    /:osuna-native-trace/,
  );
});

test("rejects a pre-rename task in the build log", () => {
  const withPaseoTask = `${buildLog}> Task :paseo-word-stream:compileDebugKotlin\n`;
  assert.throws(
    () => validateAndroidAutolink({ projectsOutput, buildLog: withPaseoTask }),
    /:paseo-word-stream/,
  );
});
