// 内置提供方的官方安装命令，照录官方文档原文；上游变更时只改这里。
// 每个系统只列官方首推写法，不列 npm / brew 等备选。

export const INSTALL_PLATFORMS = ["macos", "linux", "windows"] as const;

export type InstallPlatform = (typeof INSTALL_PLATFORMS)[number];

export interface ProviderInstallCommand {
  // 同一系统有多种写法时的简短说明（终端或包管理器名），不翻译。
  label: string | null;
  command: string;
}

export interface ProviderInstallGuideData {
  docsUrl: string;
  commands: Readonly<Record<InstallPlatform, readonly ProviderInstallCommand[]>>;
}

const CLAUDE_UNIX: ProviderInstallCommand = {
  label: null,
  command: "curl -fsSL https://claude.ai/install.sh | bash",
};

const CODEX_UNIX: ProviderInstallCommand = {
  label: null,
  command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
};

const PI_UNIX: ProviderInstallCommand = {
  label: null,
  command: "curl -fsSL https://pi.dev/install.sh | sh",
};

const OMP_UNIX: ProviderInstallCommand = {
  label: null,
  command: "curl -fsSL https://omp.sh/install | sh",
};

export type GuidedProvider = "claude" | "codex" | "pi" | "omp";

export const PROVIDER_INSTALL_GUIDES: Readonly<Record<GuidedProvider, ProviderInstallGuideData>> = {
  claude: {
    docsUrl: "https://code.claude.com/docs/en/setup",
    commands: {
      macos: [CLAUDE_UNIX],
      linux: [CLAUDE_UNIX],
      windows: [
        { label: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
        {
          label: "CMD",
          command:
            "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
        },
      ],
    },
  },
  codex: {
    docsUrl: "https://learn.chatgpt.com/docs/codex/cli",
    commands: {
      macos: [CODEX_UNIX],
      linux: [CODEX_UNIX],
      windows: [
        {
          label: null,
          command:
            'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
        },
      ],
    },
  },
  pi: {
    docsUrl: "https://pi.dev/docs/latest/quickstart",
    commands: {
      macos: [PI_UNIX],
      linux: [PI_UNIX],
      // quickstart 只给 macOS / Linux 安装脚本，Windows 用它列出的 npm 写法（需 Node 22.19+）。
      windows: [
        {
          label: "npm",
          command: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
        },
      ],
    },
  },
  omp: {
    docsUrl: "https://omp.sh/docs/quickstart",
    commands: {
      macos: [OMP_UNIX],
      linux: [OMP_UNIX],
      windows: [{ label: null, command: "irm https://omp.sh/install.ps1 | iex" }],
    },
  },
};
