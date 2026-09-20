import { describe, expect, test } from "vitest";
import {
  buildSelfNodeCommand,
  createExternalCommandProcessEnv,
  createExternalProcessEnv,
  createOsunaInternalEnv,
  resolveOsunaNodeEnv,
} from "./osuna-env.js";

describe("osuna env contract", () => {
  const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";
  const OSUNA_NODE_ENV = "OSUNA_NODE_ENV";
  const baseEnv = {
    [ELECTRON_RUN_AS_NODE]: "1",
    ELECTRON_NO_ATTACH_CONSOLE: "1",
    NODE_ENV: "development",
    PATH: "/usr/bin",
    OSUNA_AGENT_ID: "agent-123",
    OSUNA_DESKTOP_MANAGED: "1",
    [OSUNA_NODE_ENV]: "production",
    OSUNA_SUPERVISED: "1",
    ESBUILD_BINARY_PATH: "/Applications/Osuna.app/Contents/Resources/app.asar.unpacked/esbuild",
  };
  const runtimeControlEnvKeys = [
    "ELECTRON_RUN_AS_NODE",
    "OSUNA_NODE_ENV",
    "OSUNA_DESKTOP_MANAGED",
    "OSUNA_SUPERVISED",
    "ELECTRON_NO_ATTACH_CONSOLE",
    "ESBUILD_BINARY_PATH",
  ] as const;

  test("builds internal daemon child env by preserving pass-through and control vars", () => {
    const env = createOsunaInternalEnv(baseEnv);

    expect(env).toMatchObject({
      [ELECTRON_RUN_AS_NODE]: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      NODE_ENV: "development",
      PATH: "/usr/bin",
      OSUNA_DESKTOP_MANAGED: "1",
      [OSUNA_NODE_ENV]: "production",
      OSUNA_SUPERVISED: "1",
      OSUNA_AGENT_ID: "agent-123",
    });
  });

  test("builds external process env by scrubbing runtime control vars after overlays", () => {
    const env = createExternalProcessEnv(baseEnv, {
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      ELECTRON_RUN_AS_NODE: "0",
      EXTRA_VALUE: "from-overlay",
      OSUNA_DESKTOP_MANAGED: "1",
      OSUNA_NODE_ENV: "test",
      OSUNA_SUPERVISED: "1",
      PATH: "/custom/bin",
    });

    for (const key of runtimeControlEnvKeys) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.NODE_ENV).toBe("development");
    expect(env.OSUNA_AGENT_ID).toBe("agent-123");
    expect(env.PATH).toBe("/custom/bin");
  });

  test("applies non-control overlays to external process env", () => {
    const env = createExternalProcessEnv(baseEnv, { PATH: "/custom/bin" }, { CUSTOM: "value" });

    expect(env.CUSTOM).toBe("value");
    expect(env.NODE_ENV).toBe("development");
    expect(env.PATH).toBe("/custom/bin");
  });

  test("builds external command env without process.execPath special-casing", () => {
    const env = createExternalCommandProcessEnv(process.execPath, baseEnv, {
      ELECTRON_RUN_AS_NODE: "0",
      OSUNA_NODE_ENV: "test",
    });

    expect(env[ELECTRON_RUN_AS_NODE]).toBeUndefined();
    expect(env.NODE_ENV).toBe("development");
    expect(env.OSUNA_AGENT_ID).toBe("agent-123");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined();
    expect(env.OSUNA_DESKTOP_MANAGED).toBeUndefined();
    expect(env[OSUNA_NODE_ENV]).toBeUndefined();
    expect(env.OSUNA_SUPERVISED).toBeUndefined();
  });

  test("builds self node command with Electron node mode", () => {
    const command = buildSelfNodeCommand(["script.js"], {
      CUSTOM: "value",
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual(["script.js"]);
    expect(command.env[ELECTRON_RUN_AS_NODE]).toBe("1");
    expect(command.env.CUSTOM).toBe("value");
    expect(command.env.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined();
    expect(command.env.OSUNA_DESKTOP_MANAGED).toBeUndefined();
    expect(command.env[OSUNA_NODE_ENV]).toBeUndefined();
    expect(command.env.OSUNA_SUPERVISED).toBeUndefined();
  });

  test("does not add Electron node mode for non-execPath commands", () => {
    const env = createExternalCommandProcessEnv("node", baseEnv, {
      ELECTRON_RUN_AS_NODE: "1",
    });

    expect(env[ELECTRON_RUN_AS_NODE]).toBeUndefined();
  });

  test("does not use user NODE_ENV as Osuna runtime mode", () => {
    expect(resolveOsunaNodeEnv({ NODE_ENV: "development" })).toBeUndefined();
    expect(resolveOsunaNodeEnv({ NODE_ENV: "development", OSUNA_NODE_ENV: "production" })).toBe(
      "production",
    );
    expect(resolveOsunaNodeEnv({ NODE_ENV: "test", OSUNA_NODE_ENV: "local" })).toBeUndefined();
  });
});
