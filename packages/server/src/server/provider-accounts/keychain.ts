import { execCommand } from "../../utils/spawn.js";

/**
 * 系统钥匙串里 CLI 自己存的登录（Codex 的 `Codex Auth`、Claude Code 的 `Claude Code-credentials`）。
 * 多号自动轮换只经这个适配器读写钥匙串；测试换成假的，绝不碰真实的钥匙串。
 */
export interface CliKeychain {
  /** 这个系统上 Osuna 能不能读写钥匙串；不能时调用方说明原因，不当作没登录。 */
  readonly available: boolean;
  /** 一项的内容；没有这一项时为 null。 */
  read(service: string, account: string): Promise<string | null>;
  /** 新建或替换一项（换号时把目标号的登录写进 CLI 的钥匙串）。 */
  write(service: string, account: string, value: string): Promise<void>;
}

/** 钥匙串没收下这一项；不带输出与参数，两者都含登录。 */
export class KeychainWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeychainWriteError";
  }
}

const SECURITY_TIMEOUT_MS = 10_000;
// `security` 找不到这一项时的退出码（errSecItemNotFound）。
const ITEM_NOT_FOUND_EXIT_CODE = 44;

// 浏览器测试的 daemon 由 e2e 封条（packages/app/e2e/support/daemon-upgrade-seal.mjs）在这里装上假的钥匙串，
// 绝不跑真的 `security`；生产里没有它。
const SEALED_CLI_KEYCHAIN = Symbol.for("paseo.e2e.cliKeychain");

function sealedKeychain(): CliKeychain | null {
  const sealed: unknown = Reflect.get(globalThis, SEALED_CLI_KEYCHAIN);
  if (typeof sealed !== "object" || sealed === null) return null;
  const read: unknown = Reflect.get(sealed, "read");
  const write: unknown = Reflect.get(sealed, "write");
  const available: unknown = Reflect.get(sealed, "available");
  if (typeof read !== "function" || typeof write !== "function" || typeof available !== "boolean") {
    return null;
  }
  return {
    available,
    read: async (service, account) => {
      const value: unknown = await read.call(sealed, service, account);
      return typeof value === "string" ? value : null;
    },
    write: async (service, account, value) => {
      await write.call(sealed, service, account, value);
    },
  };
}

/** macOS 用系统的 `security`；别的系统暂不支持（Codex 的 keyring 存法在那里读不了）。 */
export function createSystemKeychain(platform: NodeJS.Platform = process.platform): CliKeychain {
  const sealed = sealedKeychain();
  if (sealed) return sealed;
  if (platform !== "darwin") {
    return {
      available: false,
      read: async () => null,
      write: async () => {
        throw new KeychainWriteError("Osuna can't write the system keyring on this platform");
      },
    };
  }
  return {
    available: true,
    async read(service, account) {
      try {
        const { stdout } = await execCommand(
          "security",
          ["find-generic-password", "-s", service, "-a", account, "-w"],
          { timeout: SECURITY_TIMEOUT_MS, envMode: "internal" },
        );
        const value = stdout.replace(/\n$/, "");
        return value === "" ? null : value;
      } catch (error) {
        if (exitCodeOf(error) === ITEM_NOT_FOUND_EXIT_CODE) return null;
        throw error;
      }
    },
    // 照 magpie 的 securityKeychain.Put：-U 替换已有的那一项。出错时不带输出与参数，两者都含登录。
    async write(service, account, value) {
      try {
        await execCommand(
          "security",
          ["add-generic-password", "-U", "-s", service, "-a", account, "-w", value],
          { timeout: SECURITY_TIMEOUT_MS, envMode: "internal" },
        );
      } catch {
        throw new KeychainWriteError("The keychain didn't take the sign-in");
      }
    },
  };
}

function exitCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "number" ? error.code : null;
}
