import { expect, test } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  DAEMON_LIFECYCLE_ERROR_KEYS,
  describeDaemonLifecycleFailure,
  renderDaemonLifecycleText,
  restartDaemonFromSettings,
  updateDaemonFromSettings,
} from "./daemon-lifecycle";

async function failureText(request: Promise<unknown>, language = "en"): Promise<string> {
  try {
    await request;
  } catch (error) {
    return renderDaemonLifecycleText(
      i18n.getFixedT(language),
      describeDaemonLifecycleFailure(error),
    );
  }
  throw new Error("Expected the request to fail");
}

test("settings restart completes when a replacement worker is observed without a sampled disconnect", async () => {
  let pid = 10;
  await restartDaemonFromSettings("daemon", "settings", {
    getStatus: async () => ({ pid, version: "1.0.0", serverId: "daemon" }),
    restartServer: async () => {
      pid = 11;
    },
  });
  expect(pid).toBe(11);
});

test("a status permission failure prevents the restart request", async () => {
  let restarted = false;
  await expect(
    restartDaemonFromSettings("daemon", "settings", {
      getStatus: async () => {
        throw new Error("Permission denied");
      },
      restartServer: async () => {
        restarted = true;
      },
    }),
  ).rejects.toThrow("Permission denied");
  expect(restarted).toBe(false);
});

test("a different responder fails confirmation immediately", async () => {
  let serverId = "daemon";
  await expect(
    failureText(
      restartDaemonFromSettings("daemon", "settings", {
        getStatus: async () => ({ pid: 10, version: "1.0.0", serverId }),
        restartServer: async () => {
          serverId = "other";
        },
      }),
    ),
  ).resolves.toBe("Restart acknowledged: true. Error: Daemon identity changed");
});

test("an unacknowledged restart that fails confirmation says so", async () => {
  let serverId = "daemon";
  await expect(
    failureText(
      restartDaemonFromSettings("daemon", "settings", {
        getStatus: async () => ({ pid: 10, version: "1.0.0", serverId }),
        restartServer: async () => {
          serverId = "other";
          throw Object.assign(new Error("Connection lost"), { code: "DAEMON_CONNECTION_LOST" });
        },
      }),
    ),
  ).resolves.toBe("Restart acknowledged: false. Error: Daemon identity changed");
});

test("every lifecycle error key the module builds has a translation", () => {
  const missing = DAEMON_LIFECYCLE_ERROR_KEYS.filter(
    (name) => !i18n.exists(`settings.host.daemon.lifecycleErrors.${name}`),
  );
  expect(missing).toEqual([]);
});

test("a lost restart acknowledgment can still confirm the replacement", async () => {
  let pid = 10;
  await restartDaemonFromSettings("daemon", "settings", {
    getStatus: async () => ({ pid, version: "1.0.0", serverId: "daemon" }),
    restartServer: async () => {
      pid = 11;
      throw Object.assign(new Error("Connection lost"), { code: "DAEMON_CONNECTION_LOST" });
    },
  });
  expect(pid).toBe(11);
});

test("installation and worker version confirmation are separate outcomes", async () => {
  let pid = 10;
  await expect(
    failureText(
      updateDaemonFromSettings("daemon", {
        getStatus: async () => ({ pid, version: "1.0.0", serverId: "daemon" }),
        updateDaemon: async () => {
          pid = 11;
          return { success: true, error: null, newVersion: "2.0.0" };
        },
      }),
    ),
  ).resolves.toBe(
    "Package installed; replacement worker version was not confirmed. Error: Expected installed version 2.0.0; observed worker 1.0.0.",
  );
});

test("missing versions read as unknown in English and Chinese", async () => {
  const request = () => {
    let pid = 10;
    return updateDaemonFromSettings("daemon", {
      getStatus: async () => ({ pid, version: pid === 10 ? "1.0.0" : null, serverId: "daemon" }),
      updateDaemon: async () => {
        pid = 11;
        return { success: true, error: null, newVersion: null };
      },
    });
  };
  await expect(failureText(request())).resolves.toBe(
    "Package installed; replacement worker version was not confirmed. Error: Expected installed version unknown; observed worker unknown.",
  );
  await expect(failureText(request(), "zh-CN")).resolves.toBe(
    "包已安装，但未能确认新工作进程的版本。错误：应安装版本 未知，实际工作进程版本 未知。",
  );
});

test("a failed installation keeps the daemon's own error text", async () => {
  await expect(
    failureText(
      updateDaemonFromSettings("daemon", {
        getStatus: async () => ({ pid: 10, version: "1.0.0", serverId: "daemon" }),
        updateDaemon: async () => ({ success: false, error: "npm ERR! 404", newVersion: null }),
      }),
    ),
  ).resolves.toBe("npm ERR! 404");
});

test("a failed installation without a daemon error explains it in the app language", async () => {
  const request = () =>
    updateDaemonFromSettings("daemon", {
      getStatus: async () => ({ pid: 10, version: "1.0.0", serverId: "daemon" }),
      updateDaemon: async () => ({ success: false, error: null, newVersion: null }),
    });
  await expect(failureText(request())).resolves.toBe("Package installation failed");
  await expect(failureText(request(), "zh-CN")).resolves.toBe("包安装失败");
});

test("an installed version is confirmed only in its replacement worker", async () => {
  let pid = 10,
    version = "1.0.0";
  await expect(
    updateDaemonFromSettings("daemon", {
      getStatus: async () => ({ pid, version, serverId: "daemon" }),
      updateDaemon: async () => {
        pid = 11;
        version = "2.0.0";
        return { success: true, error: null, newVersion: version };
      },
    }),
  ).resolves.toEqual({ workerVersion: "2.0.0" });
});

test("RPC errors mentioning transport are not retried", async () => {
  let requested = false;
  await expect(
    failureText(
      restartDaemonFromSettings("daemon", "settings", {
        getStatus: async () => {
          if (requested)
            throw Object.assign(new Error("Connection policy denied by plugin"), {
              code: "permission_denied",
            });
          return { pid: 10, version: "1.0.0", serverId: "daemon" };
        },
        restartServer: async () => {
          requested = true;
        },
      }),
    ),
  ).resolves.toBe("Restart acknowledged: true. Error: Connection policy denied by plugin");
});
