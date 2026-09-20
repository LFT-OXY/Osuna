import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 本地 Expo 模块的身份横跨 Gradle、CMake、JNI、podspec、expo-module.config.json 与 TS，
// 彼此不能 import，改错一层照样编译通过，装到设备上才崩。这里替它们做那层断言。
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const modulesRoot = join(appRoot, "modules");
const srcRoot = join(appRoot, "src");

interface ModuleConfig {
  android?: { modules?: string[] };
  ios?: { modules?: string[]; reactDelegateHandlers?: string[] };
  apple?: { modules?: string[]; reactDelegateHandlers?: string[] };
}

interface LocalModule {
  dirName: string;
  root: string;
  packageName: string;
  config: ModuleConfig;
}

function readLocalModules(): LocalModule[] {
  return readdirSync(modulesRoot)
    .filter((entry) => statSync(join(modulesRoot, entry)).isDirectory())
    .map((dirName) => {
      const root = join(modulesRoot, dirName);
      return {
        dirName,
        root,
        packageName: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name,
        config: JSON.parse(readFileSync(join(root, "expo-module.config.json"), "utf8")),
      };
    });
}

function walk(root: string, extensions: string[]): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === "build" ? [] : walk(entryPath, extensions);
    return extensions.includes(extname(entry.name)) ? [entryPath] : [];
  });
}

function captureAll(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function captureInFiles(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) => captureAll(readFileSync(file, "utf8"), pattern));
}

const MODULE_NAME_PATTERN = /\bName\("([^"]+)"\)/g;

function declaredModuleNames(module: LocalModule, extension?: string): string[] {
  const sources = walk(module.root, extension ? [extension] : [".kt", ".swift"]);
  return captureInFiles(sources, MODULE_NAME_PATTERN);
}

const localModules = readLocalModules();

describe.each(localModules)("local native module $dirName", (module) => {
  // 目录名不参与 autolinking 解析，package.json 的 name 才是 Gradle 工程名的来源。
  // 两者分叉时 `modules/` 下看到的名字会骗人。
  it("names the package after its directory", () => {
    expect(module.packageName).toBe(module.dirName);
  });

  it("points expo-module.config.json at Kotlin classes that exist", () => {
    const androidModules = module.config.android?.modules ?? [];
    if (androidModules.length === 0) return;

    for (const fullyQualifiedName of androidModules) {
      const className = fullyQualifiedName.split(".").pop() as string;
      const packageName = fullyQualifiedName.slice(0, -(className.length + 1));
      const sourcePath = join(
        module.root,
        "android/src/main/java",
        ...packageName.split("."),
        `${className}.kt`,
      );

      expect(existsSync(sourcePath), `missing ${sourcePath}`).toBe(true);
      const source = readFileSync(sourcePath, "utf8");
      expect(source).toMatch(new RegExp(`^package ${packageName}$`, "m"));
      expect(source).toMatch(new RegExp(`\\bclass ${className}\\b`));
    }
  });

  it("keeps the Gradle namespace and group on the Kotlin package prefix", () => {
    const androidModules = module.config.android?.modules ?? [];
    if (androidModules.length === 0) return;

    const buildGradle = readFileSync(join(module.root, "android/build.gradle"), "utf8");
    const namespace = buildGradle.match(/namespace\s+"([^"]+)"/)?.[1];
    const group = buildGradle.match(/group\s*=\s*'([^']+)'/)?.[1];

    for (const fullyQualifiedName of androidModules) {
      expect(fullyQualifiedName.startsWith(`${namespace}.`)).toBe(true);
    }
    expect(group).toBe(namespace);
  });

  it("points expo-module.config.json at Swift classes that exist", () => {
    const appleClasses = [
      ...(module.config.ios?.modules ?? []),
      ...(module.config.ios?.reactDelegateHandlers ?? []),
      ...(module.config.apple?.modules ?? []),
      ...(module.config.apple?.reactDelegateHandlers ?? []),
    ];
    if (appleClasses.length === 0) return;

    const swiftSources = walk(join(module.root, "ios"), [".swift"]).map((file) =>
      readFileSync(file, "utf8"),
    );
    for (const className of appleClasses) {
      const declaration = new RegExp(`\\bclass ${className}\\b`);
      expect(
        swiftSources.some((source) => declaration.test(source)),
        `no Swift declaration for ${className}`,
      ).toBe(true);
    }
  });

  // CocoaPods 取 s.name，Expo autolinking 取 podspec 文件名，两者分叉会生成一条 import
  // 不到的 Swift module。
  it("matches each podspec filename to its pod name", () => {
    const iosDir = join(module.root, "ios");
    if (!existsSync(iosDir)) return;

    for (const podspec of readdirSync(iosDir).filter((entry) => entry.endsWith(".podspec"))) {
      const podName = readFileSync(join(iosDir, podspec), "utf8").match(
        /s\.name\s*=\s*'([^']+)'/,
      )?.[1];
      expect(podName).toBe(basename(podspec, ".podspec"));
    }
  });

  it("loads the native library the CMake target builds", () => {
    const cmakePath = join(module.root, "android/CMakeLists.txt");
    if (!existsSync(cmakePath)) return;

    const cmake = readFileSync(cmakePath, "utf8");
    const target = cmake.match(/add_library\(([\w-]+)\s+SHARED/)?.[1];
    expect(cmake).toMatch(new RegExp(`^project\\(${target}\\)$`, "m"));

    const loaded = captureInFiles(walk(module.root, [".kt"]), /System\.loadLibrary\("([^"]+)"\)/g);
    expect(loaded).toEqual([target]);
  });

  // 只改一个平台的 Name()，另一个平台仍能让 TS 侧的查找成立，缺的那端只在设备上失败。
  it("declares the same module name on every platform it supports", () => {
    const kotlinNames = declaredModuleNames(module, ".kt");
    const swiftNames = declaredModuleNames(module, ".swift");
    if (kotlinNames.length === 0 || swiftNames.length === 0) return;

    expect([...new Set(kotlinNames)].sort()).toEqual([...new Set(swiftNames)].sort());
  });

  // JNI 按名字静态绑定：宏前缀与 Kotlin 包名/类名分叉，Kotlin 侧编译照样通过，
  // 调用 external 方法时才 UnsatisfiedLinkError。
  it("derives the JNI method prefix from the Kotlin package and class", () => {
    const jniPath = join(module.root, "cpp/jni.cpp");
    if (!existsSync(jniPath)) return;

    const prefix = readFileSync(jniPath, "utf8").match(/#define METHOD\(name\) (\w+)_##name/)?.[1];
    const androidModules = module.config.android?.modules ?? [];
    expect(androidModules).toContain(prefix?.replace(/^Java_/, "").replaceAll("_", "."));
  });
});

describe("native module lookups", () => {
  it("resolves every app lookup to a locally declared module name", () => {
    const declared = new Set(localModules.flatMap((module) => declaredModuleNames(module)));
    const lookups = captureInFiles(
      walk(srcRoot, [".ts", ".tsx"]),
      /require(?:Optional)?Native(?:Module|ViewManager)(?:<[^>]*>)?\("([^"]+)"\)/g,
    );

    expect(lookups.length).toBeGreaterThan(0);
    for (const name of lookups) {
      expect(declared, `no native module declares Name("${name}")`).toContain(name);
    }
  });
});
