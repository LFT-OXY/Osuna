// 内置提供方的官方安装与升级命令，照录官方文档原文；上游变更时只改这里。
// 安装方式的取舍：安装只需一条命令、且官方写了升级命令的才收录；多步安装、预发布版本、
// 官方没写升级写法或升级会失败的，留给文档链接。标签名不翻译，名称和顺序跟官方文档走；
// Oh My Pi 例外：README 的 "Bun (recommended)" "Pinned versions (mise)" 写成 Bun、mise，Windows 提到第二位。

const INSTALL_PLATFORMS = ["macos", "linux", "windows"] as const;

export type InstallPlatform = (typeof INSTALL_PLATFORMS)[number];

type NonEmpty<Item> = readonly [Item, ...Item[]];

export interface ProviderInstallCommand {
  // 同一组里有多种写法时的简短说明（终端或包管理器名），不翻译。
  label: string | null;
  command: string;
}

export interface ProviderInstallMethod {
  // 提供方内唯一，用来记住选中的标签。
  id: string;
  label: string;
  // 这种安装方式适用的主机系统，只用来挑默认标签；标签本身始终都显示。
  platforms: NonEmpty<InstallPlatform>;
  install: NonEmpty<ProviderInstallCommand>;
  upgrade: NonEmpty<ProviderInstallCommand>;
}

export interface ProviderInstallGuideData {
  docsUrl: string;
  methods: NonEmpty<ProviderInstallMethod>;
}

const ANY_PLATFORM: NonEmpty<InstallPlatform> = INSTALL_PLATFORMS;
const UNIX: NonEmpty<InstallPlatform> = ["macos", "linux"];
const WINDOWS: NonEmpty<InstallPlatform> = ["windows"];

function oneCommand(command: string): NonEmpty<ProviderInstallCommand> {
  return [{ label: null, command }];
}

const CLAUDE_UPDATE = oneCommand("claude update");
const COPILOT_UPDATE = oneCommand("copilot update");
const OPENCODE_UPGRADE = oneCommand("opencode upgrade");
const PI_UPDATE = oneCommand("pi update");
const OMP_UPDATE = oneCommand("omp update");

const CODEX_UNIX_SCRIPT = oneCommand("curl -fsSL https://chatgpt.com/codex/install.sh | sh");
const CODEX_WINDOWS_SCRIPT = oneCommand(
  'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
);
const CODEX_NPM = oneCommand("npm install -g @openai/codex");

export type GuidedProvider = "claude" | "codex" | "copilot" | "opencode" | "pi" | "omp";

export const PROVIDER_INSTALL_GUIDES: Readonly<Record<GuidedProvider, ProviderInstallGuideData>> = {
  claude: {
    docsUrl: "https://code.claude.com/docs/en/setup",
    methods: [
      {
        id: "macos-linux",
        label: "macOS/Linux",
        platforms: UNIX,
        install: oneCommand("curl -fsSL https://claude.ai/install.sh | bash"),
        upgrade: CLAUDE_UPDATE,
      },
      {
        id: "windows",
        label: "Windows",
        platforms: WINDOWS,
        install: [
          { label: "PowerShell", command: "irm https://claude.ai/install.ps1 | iex" },
          {
            label: "CMD",
            command:
              "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
          },
        ],
        upgrade: CLAUDE_UPDATE,
      },
      {
        id: "homebrew",
        label: "Homebrew",
        platforms: UNIX,
        install: oneCommand("brew install --cask claude-code"),
        upgrade: oneCommand("brew upgrade claude-code"),
      },
      {
        id: "winget",
        label: "WinGet",
        platforms: WINDOWS,
        install: oneCommand("winget install Anthropic.ClaudeCode"),
        upgrade: oneCommand("winget upgrade Anthropic.ClaudeCode"),
      },
      {
        id: "npm",
        label: "npm",
        platforms: ANY_PLATFORM,
        install: oneCommand("npm install -g @anthropic-ai/claude-code"),
        // 官方明确说别用 npm update -g。
        upgrade: oneCommand("npm install -g @anthropic-ai/claude-code@latest"),
      },
    ],
  },
  // 升级照录官方 Update 标签：脚本和 npm 都是重跑安装命令，不带一键升级用的 CODEX_NON_INTERACTIVE。
  codex: {
    docsUrl: "https://learn.chatgpt.com/docs/codex/cli",
    methods: [
      {
        id: "macos-linux",
        label: "macOS/Linux",
        platforms: UNIX,
        install: CODEX_UNIX_SCRIPT,
        upgrade: CODEX_UNIX_SCRIPT,
      },
      {
        id: "windows",
        label: "Windows",
        platforms: WINDOWS,
        install: CODEX_WINDOWS_SCRIPT,
        upgrade: CODEX_WINDOWS_SCRIPT,
      },
      { id: "npm", label: "npm", platforms: ANY_PLATFORM, install: CODEX_NPM, upgrade: CODEX_NPM },
      {
        id: "homebrew",
        label: "Homebrew",
        platforms: UNIX,
        install: oneCommand("brew install --cask codex"),
        upgrade: oneCommand("brew upgrade --cask codex"),
      },
    ],
  },
  copilot: {
    docsUrl:
      "https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli",
    methods: [
      {
        id: "npm",
        label: "npm",
        platforms: ANY_PLATFORM,
        install: oneCommand("npm install -g @github/copilot"),
        upgrade: COPILOT_UPDATE,
      },
      {
        id: "winget",
        label: "WinGet",
        platforms: WINDOWS,
        install: oneCommand("winget install GitHub.Copilot"),
        upgrade: COPILOT_UPDATE,
      },
      {
        id: "homebrew",
        label: "Homebrew",
        platforms: UNIX,
        install: oneCommand("brew install --cask copilot-cli"),
        upgrade: COPILOT_UPDATE,
      },
      {
        id: "install-script",
        label: "Install script",
        platforms: UNIX,
        install: [
          { label: "curl", command: "curl -fsSL https://gh.io/copilot-install | bash" },
          { label: "wget", command: "wget -qO- https://gh.io/copilot-install | bash" },
        ],
        upgrade: COPILOT_UPDATE,
      },
    ],
  },
  opencode: {
    docsUrl: "https://opencode.ai/docs/#install",
    methods: [
      {
        id: "install-script",
        label: "Install script",
        platforms: UNIX,
        install: oneCommand("curl -fsSL https://opencode.ai/install | bash"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "npm",
        label: "npm",
        platforms: ANY_PLATFORM,
        install: oneCommand("npm install -g opencode-ai"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "bun",
        label: "Bun",
        platforms: ANY_PLATFORM,
        install: oneCommand("bun install -g opencode-ai"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "pnpm",
        label: "pnpm",
        platforms: ANY_PLATFORM,
        install: oneCommand("pnpm install -g opencode-ai"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "homebrew",
        label: "Homebrew",
        platforms: UNIX,
        install: oneCommand("brew install anomalyco/tap/opencode"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "chocolatey",
        label: "Chocolatey",
        platforms: WINDOWS,
        install: oneCommand("choco install opencode"),
        upgrade: OPENCODE_UPGRADE,
      },
      {
        id: "scoop",
        label: "Scoop",
        platforms: WINDOWS,
        install: oneCommand("scoop install opencode"),
        upgrade: OPENCODE_UPGRADE,
      },
    ],
  },
  // 文档站的 quickstart 没有 Windows 安装命令，链接用 README：安装脚本、Windows、npm、Nix 都在。
  pi: {
    docsUrl: "https://github.com/earendil-works/pi",
    methods: [
      {
        id: "curl",
        label: "curl",
        platforms: UNIX,
        install: oneCommand("curl -fsSL https://pi.dev/install.sh | sh"),
        upgrade: PI_UPDATE,
      },
      {
        id: "powershell",
        label: "PowerShell",
        platforms: WINDOWS,
        install: oneCommand('powershell -c "irm https://pi.dev/install.ps1 | iex"'),
        upgrade: PI_UPDATE,
      },
      {
        id: "npm",
        label: "npm",
        platforms: ANY_PLATFORM,
        install: oneCommand("npm install -g --ignore-scripts @earendil-works/pi-coding-agent"),
        upgrade: PI_UPDATE,
      },
      {
        id: "pnpm",
        label: "pnpm",
        platforms: ANY_PLATFORM,
        install: oneCommand("pnpm add -g --ignore-scripts @earendil-works/pi-coding-agent"),
        upgrade: PI_UPDATE,
      },
      {
        id: "bun",
        label: "bun",
        platforms: ANY_PLATFORM,
        install: oneCommand("bun add -g --ignore-scripts @earendil-works/pi-coding-agent"),
        upgrade: PI_UPDATE,
      },
      {
        id: "nix",
        label: "Nix",
        platforms: UNIX,
        install: oneCommand("nix profile add github:earendil-works/pi/stable"),
        // pi update 升级不了 Nix 装的版本。
        upgrade: oneCommand("nix profile upgrade pi"),
      },
    ],
  },
  // 文档站只列两种脚本装法，Homebrew、Bun、mise 只在 README 的 Install 一节里。
  omp: {
    docsUrl: "https://github.com/can1357/oh-my-pi#install",
    methods: [
      {
        id: "macos-linux",
        label: "macOS · Linux",
        platforms: UNIX,
        install: oneCommand("curl -fsSL https://omp.sh/install | sh"),
        upgrade: OMP_UPDATE,
      },
      {
        id: "windows",
        label: "Windows (PowerShell)",
        platforms: WINDOWS,
        install: oneCommand("irm https://omp.sh/install.ps1 | iex"),
        upgrade: OMP_UPDATE,
      },
      {
        id: "homebrew",
        label: "Homebrew",
        platforms: UNIX,
        install: oneCommand("brew install can1357/tap/omp"),
        upgrade: OMP_UPDATE,
      },
      {
        id: "bun",
        label: "Bun",
        platforms: ANY_PLATFORM,
        install: oneCommand("bun install -g @oh-my-pi/pi-coding-agent"),
        upgrade: OMP_UPDATE,
      },
      {
        id: "mise",
        label: "mise",
        platforms: ANY_PLATFORM,
        install: oneCommand("mise use -g github:can1357/oh-my-pi"),
        upgrade: OMP_UPDATE,
      },
    ],
  },
};
