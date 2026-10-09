import * as React from "react";
import {
  ArrowRight,
  Bot,
  BookOpen,
  ExternalLink,
  GitFork,
  Laptop,
  Monitor,
  Puzzle,
  Smartphone,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import {
  motion,
  AnimatePresence,
  useInView,
  useScroll,
  useTransform,
  type Transition,
} from "framer-motion";

// Shared motion presets — hoisted so every JSX site receives the same object
// reference and doesn't trigger jsx-no-new-object-as-prop.
const FADE_IN_UP = { opacity: 0, y: 20 };
const FADE_IN = { opacity: 1, y: 0 };
const FADE_IN_UP_TINY = { opacity: 0, y: -10 };
const FADE_IN_UP_XL = { opacity: 0, y: 30 };
const FADE_IN_UP_40 = { opacity: 0, y: 40 };
const FADE_IN_UP_4 = { opacity: 0, y: 4 };
const FADE_OUT_UP_4 = { opacity: 0, y: 4 };

const EASE_OUT_06_DELAY_01: Transition = { duration: 0.6, delay: 0.1, ease: "easeOut" };
const EASE_OUT_08_DELAY_05: Transition = { duration: 0.8, delay: 0.5, ease: "easeOut" };
const EASE_OUT_05: Transition = { duration: 0.5, ease: "easeOut" };
const EASE_OUT_015: Transition = { duration: 0.15, ease: "easeOut" };
const DURATION_05: Transition = { duration: 0.5 };

const VIEWPORT_60 = { once: true, margin: "-60px" };
const AGENT_LIST_GRID_STYLE = {
  gridTemplateColumns: "auto auto auto minmax(0, 1fr)",
};

// A ~240px-wide phone rotated 15° only foreshortens a couple percent at
// perspective 1200 — it reads as a flat, skewed card. The side phones already
// sit on a correctly projecting plane (the frame and its scaled interior share
// one flattened texture), so the interior just needs the projection to be
// strong enough to see: a tighter perspective gives the trio a real book-fold.
const PHONE_PERSPECTIVE_STYLE = { minHeight: 480, perspective: 700 };
import { CursorFieldProvider } from "~/components/butterfly";
import { CommandDialog } from "~/components/command-dialog";
import { getDesktopDownload, getMobileDownload, AndroidIcon, TerminalIcon } from "~/downloads";
import type { VisitorPlatform } from "~/platform";
import { isMobilePlatform } from "~/platform";
import { useRelease, useVisitorPlatform } from "~/routes/__root";
import { HeroMockup } from "~/components/hero-mockup";
import {
  ClaudeCodeIcon,
  CodexIcon,
  CursorIcon,
  OpenCodeIcon,
  PiIcon,
} from "~/components/agent-icons";
import { GitHubIcon } from "~/components/brand-icons";
import { PhoneFrame } from "~/components/phone-frame";
import { FAQItem } from "~/components/faq-item";
import { SiteFooter } from "~/components/site-footer";
import { SiteHeader } from "~/components/site-header";
import "~/styles.css";

interface LandingPageProps {
  title: React.ReactNode;
  subtitle: React.ReactNode;
}

export function LandingPage({ title, subtitle }: LandingPageProps) {
  return (
    <CursorFieldProvider>
      {/* Hero section with background image */}
      <div className="relative bg-cover bg-center bg-no-repeat">
        <div className="relative px-6 pt-4 pb-10 md:px-32 md:pt-6 md:pb-12 max-w-7xl mx-auto">
          <Nav />
          <Hero title={title} subtitle={subtitle} />
          <GetStarted />
        </div>

        {/* Mockup - inside hero so it's above the gradient, positioned to overflow into black section */}
        <motion.div
          initial={FADE_IN_UP_40}
          animate={FADE_IN}
          transition={EASE_OUT_08_DELAY_05}
          className="relative px-6 md:px-8 pt-4 md:pt-8 pb-8 md:pb-16"
        >
          <div className="max-w-7xl mx-auto">
            <HeroMockup />
          </div>
        </motion.div>
      </div>

      {/* Phone showcase */}
      <PhoneShowcase />

      {/* Content section */}
      <div className="bg-background">
        <main className="p-6 md:p-20 md:pt-40 max-w-5xl mx-auto">
          <div className="space-y-24">
            <MultiProviderSection />
            <TurnkeySection />
            <AutomationSection />
            <ExtensibleSection />
            <FAQ />
          </div>
        </main>
        <SiteFooter />
      </div>
    </CursorFieldProvider>
  );
}

function Nav() {
  return (
    <nav className="mb-20 md:mb-24">
      <SiteHeader />
    </nav>
  );
}

function Hero({ title, subtitle }: { title: React.ReactNode; subtitle: React.ReactNode }) {
  return (
    <div className="space-y-6 text-center">
      <h1 className="text-4xl md:text-6xl font-medium tracking-tight leading-[1.15]">{title}</h1>
      <p className="text-base leading-relaxed text-white/70 md:text-lg max-w-lg mx-auto">
        {subtitle}
      </p>
    </div>
  );
}

const CLAUDE_CODE_BADGE_ICON = <ClaudeCodeIcon className="h-6 w-6" />;
const CODEX_BADGE_ICON = <CodexIcon className="h-6 w-6" />;
const OPENCODE_BADGE_ICON = <OpenCodeIcon className="h-6 w-6" />;
const PI_BADGE_ICON = <PiIcon className="h-6 w-6" />;
const CURSOR_BADGE_ICON = <CursorIcon className="h-6 w-6" />;

function AgentBadge({ name, icon }: { name: string; icon: React.ReactNode }) {
  const [hovered, setHovered] = React.useState(false);
  const handleMouseEnter = React.useCallback(() => setHovered(true), []);
  const handleMouseLeave = React.useCallback(() => setHovered(false), []);

  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full p-1.5 text-white/60"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {icon}
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={FADE_IN_UP_4}
            animate={FADE_IN}
            exit={FADE_OUT_UP_4}
            transition={EASE_OUT_015}
            className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-white text-black text-xs whitespace-nowrap pointer-events-none"
          >
            {name}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function FeatureSection({
  title,
  description,
  badge,
  links,
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  links?: ReadonlyArray<{ href: string; label: string }>;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
    >
      <SectionTitle title={title} description={description} badge={badge} links={links} />
      {children}
    </motion.section>
  );
}

function SectionTitle({
  title,
  description,
  badge,
  links,
}: {
  title: string;
  description: string;
  badge?: string;
  links?: ReadonlyArray<{ href: string; label: string }>;
}) {
  return (
    <div className="mb-12 space-y-2">
      <div className="flex items-center gap-3">
        <h2 className="text-3xl font-medium">{title}</h2>
        {badge && (
          <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-300">
            {badge}
          </span>
        )}
      </div>
      <p className="text-base text-pretty text-muted-foreground max-w-lg">{description}</p>
      {links ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-extra-muted-foreground transition-colors hover:text-muted-foreground"
            >
              {link.label}
              <ExternalLink className="h-3 w-3" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const PROVIDER_ICON_CLASS = "h-5 w-5 sm:h-7 sm:w-7";

function MultiProviderSection() {
  const providers = [
    { name: "Claude Code", icon: <ClaudeCodeIcon className={PROVIDER_ICON_CLASS} /> },
    { name: "Codex", icon: <CodexIcon className={PROVIDER_ICON_CLASS} /> },
    { name: "OpenCode", icon: <OpenCodeIcon className={PROVIDER_ICON_CLASS} /> },
    { name: "Pi", icon: <PiIcon className={PROVIDER_ICON_CLASS} /> },
    { name: "Cursor", icon: <CursorIcon className={PROVIDER_ICON_CLASS} /> },
  ];

  return (
    <FeatureSection title="接入你已有的工具" description="沿用你的订阅、技能与配置">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
        {providers.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 sm:gap-3 sm:px-5 sm:py-4"
          >
            <span className="shrink-0 text-white/80">{p.icon}</span>
            <span className="truncate text-sm font-medium sm:text-base">{p.name}</span>
          </div>
        ))}
        <a
          href="/docs/supported-providers"
          className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:gap-3 sm:px-5 sm:py-4 sm:text-base"
        >
          查看全部
          <ArrowRight className="h-4 w-4 shrink-0" />
        </a>
      </div>
    </FeatureSection>
  );
}

function TurnkeySection() {
  return (
    <FeatureSection title="在哪里都能运行" description="在本机使用，或连接到另一台机器">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
        <div className="flex flex-col gap-6 border-b border-white/10 p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3 text-muted-foreground">
              <Monitor className="h-6 w-6" strokeWidth={1.5} />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-xl font-medium text-white/90">桌面端</h3>
              <p className="max-w-lg text-sm leading-relaxed text-white/50">
                下载后打开就能用，daemon 已经内置
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8">
          <div className="grid gap-4 md:grid-cols-2">
            <TurnkeyExtensionCard
              icon={Smartphone}
              title="手机与网页端"
              description="从任意客户端连接到同一批工作区"
              ctaHref="/download"
              ctaLabel="下载"
            />
            <TurnkeyExtensionCard
              icon={Laptop}
              title="远程机器"
              description="把 Osuna 跑在家里的服务器或云主机上"
              ctaHref="/docs/docker"
              ctaLabel="文档"
            />
          </div>
        </div>
      </div>
    </FeatureSection>
  );
}

function TurnkeyExtensionCard({
  icon: Icon,
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex min-h-48 flex-col rounded-xl border border-white/10 bg-white/[0.025] p-5">
      <div className="mb-5 flex items-center gap-3 text-muted-foreground">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <h3 className="font-medium text-white/85">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/45">{description}</p>
      <div className="mt-auto pt-5">
        <a
          href={ctaHref}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1.5 text-xs text-background transition-colors hover:bg-foreground/90"
        >
          {ctaLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

type AutomationKind = "mcp" | "cli";

const AUTOMATION_OPTIONS: Array<{
  kind: AutomationKind;
  label: string;
  caption: string;
  icon: LucideIcon;
}> = [
  {
    kind: "mcp",
    label: "MCP",
    caption: "由另一个 Agent 调用",
    icon: Bot,
  },
  {
    kind: "cli",
    label: "CLI",
    caption: "在终端里调用",
    icon: Terminal,
  },
];

const AUTOMATION_LINKS = [
  { href: "/docs/mcp", label: "MCP 文档" },
  { href: "/docs/cli", label: "CLI 文档" },
] as const;

function AutomationSection() {
  const [activeKind, setActiveKind] = React.useState<AutomationKind>("mcp");

  return (
    <FeatureSection
      title="为自动化而生"
      description="用 MCP 或 CLI 驱动 Osuna"
      links={AUTOMATION_LINKS}
    >
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="grid self-start gap-2" role="tablist">
          {AUTOMATION_OPTIONS.map((option) => (
            <AutomationSelector
              key={option.kind}
              option={option}
              active={option.kind === activeKind}
              onSelect={setActiveKind}
            />
          ))}
        </div>
        <AutomationDetail kind={activeKind} />
      </div>
    </FeatureSection>
  );
}

function AutomationSelector({
  option,
  active,
  onSelect,
}: {
  option: (typeof AUTOMATION_OPTIONS)[number];
  active: boolean;
  onSelect: (kind: AutomationKind) => void;
}) {
  const Icon = option.icon;
  const handleClick = React.useCallback(() => onSelect(option.kind), [onSelect, option.kind]);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={handleClick}
      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors md:block md:p-4 ${
        active
          ? "border-white/20 bg-white/[0.07]"
          : "border-white/10 bg-white/[0.025] hover:border-white/15 hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 text-muted-foreground md:mb-1">
        <Icon className="h-3 w-3" strokeWidth={1.5} />
        <span className="text-[10px]">{option.label}</span>
      </div>
      <p className="text-xs leading-snug text-white/85 md:text-sm">{option.caption}</p>
    </button>
  );
}

function AutomationDetail({ kind }: { kind: AutomationKind }) {
  return (
    <div
      role="tabpanel"
      className="min-h-80 min-w-0 overflow-hidden rounded-xl border border-white/10 bg-black/20 p-5 md:h-[26rem] md:p-6"
    >
      {kind === "mcp" ? <McpAutomationTranscript /> : null}
      {kind === "cli" ? <CliAutomationExample /> : null}
    </div>
  );
}

function McpAutomationTranscript() {
  return (
    <div className="space-y-5">
      <div className="ml-auto w-fit max-w-xl rounded-xl rounded-tr-none bg-white/[0.07] px-4 py-3">
        <p className="text-sm leading-relaxed text-white/75">
          把标了 ready 的 GitHub issue 分给各自的工作树 Agent，并行处理。
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
        <div className="min-w-0 flex-1 space-y-4">
          <p className="text-sm leading-relaxed text-white/55">
            找到两个 ready 的 issue，我在各自的工作树里分别启动。
          </p>
          <div className="space-y-2 font-mono text-[11px]">
            <McpAgentCall issue="#412" provider="claude/opus-4.6" />
            <McpAgentCall issue="#417" provider="codex/gpt-5.6-sol" />
          </div>
          <p className="text-sm leading-relaxed text-white/55">
            两个 Agent 已经在运行，完成后我会通知你。
          </p>
        </div>
      </div>
    </div>
  );
}

function McpAgentCall({ issue, provider }: { issue: string; provider: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-3 py-2">
      <span className="text-sky-300/80">create_agent</span>
      <span className="text-white/25">{issue}</span>
      <span className="text-white/35">{provider}</span>
      <span className="text-white/25">worktree</span>
    </div>
  );
}

function CliAutomationExample() {
  return (
    <div className="font-mono text-[11px] leading-5 text-white/60">
      <div className="space-y-6">
        <div>
          <ShellPrompt>
            <span className="text-white">osuna run</span> <span className="text-white/35">\</span>
          </ShellPrompt>
          <div className="pl-5">
            <span className="text-sky-300/75">--provider</span>{" "}
            <span className="text-white/75">codex/gpt-5.6-sol</span>{" "}
            <span className="text-white/35">\</span>
          </div>
          <div className="pl-5 text-emerald-300/80">{'"Fix issue #412 and add tests."'}</div>
          <div className="mt-1 text-emerald-300/65">✓ Started agent a7f3c2</div>
        </div>

        <div className="space-y-1">
          <ShellPrompt>
            <span className="text-white">osuna ls</span>
          </ShellPrompt>
          <AgentListOutput />
        </div>

        <div>
          <div className="text-white/30"># 指定另一台主机</div>
          <ShellPrompt>
            <span className="text-white">osuna ls</span>{" "}
            <span className="text-sky-300/75">--host</span>{" "}
            <span className="text-white/75">devbox:6767</span>
          </ShellPrompt>
        </div>
      </div>
    </div>
  );
}

function ShellPrompt({ children }: { children: React.ReactNode }) {
  return (
    <div className="whitespace-nowrap">
      <span className="select-none text-white/25">$ </span>
      {children}
    </div>
  );
}

function AgentListOutput() {
  return (
    <div className="grid gap-x-5" style={AGENT_LIST_GRID_STYLE}>
      <span className="text-white/30">AGENT</span>
      <span className="text-white/30">STATUS</span>
      <span className="text-white/30">PROVIDER/MODEL</span>
      <span className="text-white/30">TITLE</span>
      <span className="text-white/55">a7f3c2</span>
      <span className="text-emerald-300/70">running</span>
      <span className="text-white/55">codex/gpt-5.6-sol</span>
      <span className="text-white/55">Fix issue #412 and add tests.</span>
    </div>
  );
}

function ExtensibleSection() {
  return (
    <FeatureSection title="按你的方式定制" description="扩展 Osuna，让它贴合你的工作方式">
      <div className="grid gap-4 md:grid-cols-2">
        <ExtensibleCard
          icon={Puzzle}
          title="插件"
          description="插件可以增加服务端功能，也能用自定义组件改造客户端，对包括手机在内的所有客户端生效"
          links={PLUGIN_CARD_LINKS}
        />
        <ExtensibleCard
          icon={GitFork}
          title="Fork 仓库"
          description="Osuna 以 Apache 2.0 许可开源。你可以查看实现、fork 项目，并按自己的流程或组织改造它"
          links={FORK_CARD_LINKS}
        />
      </div>
    </FeatureSection>
  );
}

interface ExtensibleCardLink {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: boolean;
}

const PLUGIN_CARD_LINKS: ReadonlyArray<ExtensibleCardLink> = [
  { href: "/docs/plugins", label: "插件文档", icon: BookOpen },
];

const FORK_CARD_LINKS: ReadonlyArray<ExtensibleCardLink> = [
  {
    href: "https://github.com/LFT-OXY/Osuna",
    label: "查看仓库",
    icon: GitHubIcon,
    external: true,
  },
];

function ExtensibleCard({
  icon: Icon,
  title,
  description,
  links,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  links: ReadonlyArray<ExtensibleCardLink>;
}) {
  return (
    <div className="flex min-h-64 flex-col rounded-xl border border-white/10 bg-white/[0.025] p-6">
      <div className="mb-8 text-muted-foreground">
        <Icon className="h-6 w-6" strokeWidth={1.5} />
      </div>
      <h3 className="text-lg font-medium text-white/85">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/45">{description}</p>
      <div className="mt-auto flex flex-col items-start gap-3 pt-6">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            {...(link.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <link.icon className="h-4 w-4" />
            {link.label}
            {link.external ? <ExternalLink className="h-3.5 w-3.5 opacity-70" /> : null}
          </a>
        ))}
      </div>
    </div>
  );
}

function GetStarted() {
  const platform = useVisitorPlatform();
  return (
    <div className="pt-10">
      {/* The primary call to action owns its own row on phones so the small icon
          buttons never wrap and orphan one of themselves onto a line alone. It
          still hugs its label rather than stretching across the row. */}
      <div className="mx-auto flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <PrimaryDownloadButton platform={platform} />
        <div className="flex items-center justify-center gap-3">
          {isMobilePlatform(platform) ? <DesktopAppLink /> : <AndroidLink />}
          <ServerInstallButton />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 pt-6">
        <span className="text-xs text-muted-foreground">支持</span>
        <div className="flex items-center gap-1">
          <AgentBadge name="Claude Code" icon={CLAUDE_CODE_BADGE_ICON} />
          <AgentBadge name="Codex" icon={CODEX_BADGE_ICON} />
          <AgentBadge name="OpenCode" icon={OPENCODE_BADGE_ICON} />
          <AgentBadge name="Pi" icon={PI_BADGE_ICON} />
          <AgentBadge name="Cursor" icon={CURSOR_BADGE_ICON} />
        </div>
      </div>
    </div>
  );
}

const PRIMARY_CTA_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:bg-foreground/90 transition-colors";
const SECONDARY_CTA_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-white/12 px-3 py-2.5 text-sm text-white hover:bg-white/10 transition-colors";

function PrimaryDownloadButton({ platform }: { platform: VisitorPlatform }) {
  const release = useRelease();
  const download = isMobilePlatform(platform)
    ? getMobileDownload(release, platform)
    : getDesktopDownload(release, platform);
  const Icon = download.icon;
  // 站内链接（没有对应安装包时退到下载页）留在当前标签页。
  const external = download.href.startsWith("/")
    ? {}
    : { target: "_blank", rel: "noopener noreferrer" };
  return (
    <a href={download.href} {...external} className={PRIMARY_CTA_CLASS}>
      <Icon className="h-4 w-4" />
      {download.label}
    </a>
  );
}

// On a phone the desktop build is the secondary path, so it points at /download
// instead of handing the visitor a .dmg they cannot open.
function DesktopAppLink() {
  return (
    <a href="/download" className={SECONDARY_CTA_CLASS}>
      <Monitor className="h-4 w-4" strokeWidth={1.5} />
      桌面端
    </a>
  );
}

function AndroidLink() {
  return (
    <a href="/download" className={SECONDARY_CTA_CLASS} aria-label="安卓版">
      <AndroidIcon className="h-5 w-5" />
    </a>
  );
}

const SERVER_INSTALL_TRIGGER = (
  <span
    className="inline-flex items-center justify-center rounded-lg border border-white/12 px-3 py-2.5 text-white hover:bg-white/10 transition-colors"
    aria-label="在远程机器上运行 daemon"
  >
    <TerminalIcon className="h-5 w-5" />
  </span>
);

const SERVER_INSTALL_COMMAND =
  'docker run -d --name osuna -p 6767:6767 -e OSUNA_PASSWORD=change-me -v "$PWD/osuna-home:/home/osuna" -v "$PWD:/workspace" ghcr.io/lft-oxy/osuna:latest';

const SERVER_INSTALL_FOOTNOTE = (
  <>
    镜像不含 Agent CLI。Compose 与反向代理的配置见{" "}
    <a href="/docs/docker" className="underline hover:text-white/60">
      Docker 文档
    </a>
    。
  </>
);

function ServerInstallButton() {
  return (
    <CommandDialog
      trigger={SERVER_INSTALL_TRIGGER}
      title="在远程机器上运行 Agent"
      description="用于没有界面的服务器，之后从 Osuna 的各个客户端连接。桌面端已经内置 daemon"
      command={SERVER_INSTALL_COMMAND}
      footnote={SERVER_INSTALL_FOOTNOTE}
    />
  );
}

interface PhoneShotInfo {
  src: string;
  alt: string;
  /** The colour at the top edge of the screenshot; the frame's status bar continues it. */
  surface: string;
}

// 网页端在 402 x 820 视口下的实拍（2x），正好填满外框状态栏以下的屏幕区域。
const PHONE_SHOTS = {
  workspaces: {
    src: "/app-phone-workspaces.webp",
    alt: "Osuna 手机端的工作区列表",
    surface: "#030403",
  },
  chat: {
    src: "/app-phone-chat.webp",
    alt: "Osuna 手机端与 Agent 的对话",
    surface: "#0d0e0d",
  },
  changes: {
    src: "/app-phone-changes.webp",
    alt: "Osuna 手机端的改动差异",
    surface: "#030403",
  },
} satisfies Record<string, PhoneShotInfo>;

function PhoneShot({ shot }: { shot: PhoneShotInfo }) {
  return <img src={shot.src} alt={shot.alt} width={402} height={820} className="h-full w-full" />;
}

function PhoneShowcase() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const textInView = useInView(containerRef, { once: true, margin: "-80px" });

  // Scroll-linked animation: track how far through the container the user has scrolled
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "center center"],
  });

  // Responsive slide distance
  const [slideDistance, setSlideDistance] = React.useState(260);
  React.useEffect(() => {
    function update() {
      setSlideDistance(window.innerWidth < 768 ? 140 : 260);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Side phones start at x=0 (behind center) and slide out to final position
  const sideOpacity = useTransform(scrollYProgress, [0.2, 0.6], [0, 1]);
  const leftX = useTransform(scrollYProgress, [0.2, 0.6], [0, -slideDistance]);
  const rightX = useTransform(scrollYProgress, [0.2, 0.6], [0, slideDistance]);

  const leftPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: leftX, rotateY: -15, scale: 0.97 }),
    [sideOpacity, leftX],
  );
  const rightPhoneStyle = React.useMemo(
    () => ({ opacity: sideOpacity, x: rightX, rotateY: 15, scale: 0.97 }),
    [sideOpacity, rightX],
  );
  const centerPhoneAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);
  const textAnimate = React.useMemo(() => (textInView ? FADE_IN : {}), [textInView]);

  return (
    <div ref={containerRef} className="flex flex-col items-center pt-4 pb-16 gap-20">
      {/* Arrow + text */}
      <motion.div
        initial={FADE_IN_UP_TINY}
        animate={textAnimate}
        transition={DURATION_05}
        className="flex flex-col items-center gap-1.5 px-6"
      >
        <svg
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          className="text-white/20"
        >
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <p className="max-w-md text-balance text-center text-lg text-white/80">
          离开桌前，工作不用停。
        </p>
        <p className="max-w-sm text-balance text-center text-sm text-white/50">
          <span className="inline-block">手机上用安卓 APK 或网页端，</span>
          <span className="inline-block">查看进度、回复 Agent、审查改动。</span>
        </p>
      </motion.div>

      {/* Phone trio — side phones are absolute, start behind center, slide outward with perspective rotation */}
      <div
        className="relative flex items-center justify-center overflow-x-clip w-full"
        style={PHONE_PERSPECTIVE_STYLE}
      >
        {/* Left phone — workspace drawer, rotated to face inward */}
        <motion.div style={leftPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <PhoneFrame time="18:54" depth="right" surface={PHONE_SHOTS.workspaces.surface}>
            <PhoneShot shot={PHONE_SHOTS.workspaces} />
          </PhoneFrame>
        </motion.div>

        {/* Center phone — agent chat */}
        <motion.div
          initial={FADE_IN_UP_XL}
          animate={centerPhoneAnimate}
          transition={EASE_OUT_06_DELAY_01}
          className="w-[220px] md:w-[240px] relative z-10"
        >
          <PhoneFrame time="18:53" surface={PHONE_SHOTS.chat.surface}>
            <PhoneShot shot={PHONE_SHOTS.chat} />
          </PhoneFrame>
        </motion.div>

        {/* Right phone — diff view, rotated to face inward */}
        <motion.div style={rightPhoneStyle} className="w-[160px] md:w-[240px] absolute">
          <PhoneFrame time="18:55" depth="left" surface={PHONE_SHOTS.changes.surface}>
            <PhoneShot shot={PHONE_SHOTS.changes} />
          </PhoneFrame>
        </motion.div>
      </div>
    </div>
  );
}

function FAQ() {
  return (
    <motion.div
      initial={FADE_IN_UP}
      whileInView={FADE_IN}
      viewport={VIEWPORT_60}
      transition={EASE_OUT_05}
      className="space-y-6"
    >
      <h2 className="text-3xl font-medium">常见问题</h2>
      <div className="space-y-6">
        <FAQItem question="免费吗？">
          免费。Osuna 是开源软件。你需要自己安装 Agent
          的命令行工具，并使用自己的凭据。语音默认在本地处理，也可以按需配置云端语音服务。
        </FAQItem>
        <FAQItem question="我的代码会离开我的机器吗？">
          Osuna 不会把你的代码发到任何地方。Agent 在本机运行，照常访问各自的
          API。远程访问可以用可选的
          <a href="/docs/security" className="underline hover:text-white/80">
            端到端加密中继
          </a>
          、局域网直连，或你自己的隧道。
        </FAQItem>
        <FAQItem question="支持哪些 Agent？">
          Osuna 为 Claude、Codex、OpenCode、Pi 和 OMP 做了专门适配，其余通过 ACP 接入。完整列表见
          <a href="/docs/supported-providers" className="underline hover:text-white/80">
            支持的提供方
          </a>
          。
        </FAQItem>
        <FAQItem question="Osuna 怎么运行这些 Agent？">
          直接运行你机器上已经装好的命令行工具，和你平时的用法一样。Osuna 不修改它们的行为。
        </FAQItem>
        <FAQItem question="必须用桌面端吗？">
          不必。daemon 可以不带界面运行，再用任意客户端连接。桌面端只是把 daemon 和界面打包在一起。
        </FAQItem>
        <FAQItem question="语音是怎么工作的？">
          语音默认在你的设备上处理：你说话，应用转写成文字发给 Agent。也可以配置 OpenAI
          的语音服务，换取更好的转写和朗读效果。见
          <a href="/docs/voice" className="underline hover:text-white/80">
            语音文档
          </a>
          。
        </FAQItem>
        <FAQItem question="能从外网连接吗？">
          可以。使用官方中继（端到端加密，Osuna
          读不到你的流量）、自己搭的隧道（Tailscale、Cloudflare Tunnel 等），或者直接暴露 daemon
          端口。见
          <a href="/docs/configuration" className="underline hover:text-white/80">
            配置文档
          </a>
          。
        </FAQItem>
        <FAQItem question="需要 git 或 GitHub 吗？">
          不需要。Osuna 在任何目录下都能工作。工作树是可选功能，只有用 git 时才相关。
        </FAQItem>
        <FAQItem question="用 Osuna 会被封号吗？">
          Osuna 只使用各提供方官方支持的接入方式，不绕过它们的服务条款，不提取令牌，也不直接调用推理
          API。
        </FAQItem>
        <FAQItem question="工作树是怎么工作的？">
          启动 Agent 时选择工作树（应用、桌面端或 CLI 都可以），Osuna 会创建一个 git 工作树并让
          Agent 在里面运行。Agent 在独立的分支上工作，不碰你的主工作目录。见
          <a href="/docs/worktrees" className="underline hover:text-white/80">
            工作树文档
          </a>
          。
        </FAQItem>
      </div>
    </motion.div>
  );
}
