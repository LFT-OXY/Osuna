import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { changelogLink } from "~/changelog";
import { CodeBlock } from "~/components/code-block";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";
import {
  downloadUrls,
  webAppUrl,
  AppleIcon,
  AndroidIcon,
  WindowsIcon,
  LinuxIcon,
  TerminalIcon,
  GlobeIcon,
} from "~/downloads";
import { useBetaRelease, useRelease } from "~/routes/__root";
import "~/styles.css";

interface DownloadSearch {
  channel?: "beta";
}

const STABLE_SEARCH: DownloadSearch = {};
const BETA_SEARCH: DownloadSearch = { channel: "beta" };

export const Route = createFileRoute("/download")({
  validateSearch: (search: Record<string, unknown>): DownloadSearch =>
    search.channel === "beta" ? { channel: "beta" } : {},
  head: () =>
    pageMeta(
      "下载 Osuna – 桌面端与安卓",
      "下载 Osuna 桌面端与安卓 APK，或用 Docker 把 daemon 跑在服务器上。自托管，开源，免费。",
      "/download",
    ),
  component: Download,
});

function Download() {
  const stable = useRelease();
  const beta = useBetaRelease();
  const { channel } = Route.useSearch();

  // A ?channel=beta link outlives the beta it was shared for, so the release
  // decides the channel, not the URL.
  const activeBeta = channel === "beta" ? beta : null;
  const onBeta = activeBeta !== null;
  const release = activeBeta ?? stable;
  const { version } = release;
  const urls = downloadUrls(release);

  return (
    <SiteShell width="default">
      <div className="mb-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2">下载</h1>
          <p className="text-muted-foreground">
            v{version}
            <span className="mx-2 text-muted-foreground/40">·</span>
            <Link
              {...changelogLink(version)}
              className="underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-current transition-colors"
            >
              更新内容
            </Link>
          </p>
        </div>
        {beta && <ChannelSwitch onBeta={onBeta} />}
      </div>

      {onBeta && <BetaNotice />}

      {/* Desktop */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">桌面端</h2>
            <p className="text-sm text-muted-foreground mt-1">推荐，开箱即用</p>
          </div>
          <MonitorIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
        </div>

        <div className="divide-y divide-border">
          <PlatformRow icon={AppleIcon} label="macOS">
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <PillGroup>
                <DownloadPill href={urls.macAppleSilicon} label="Apple Silicon" />
                <DownloadPill href={urls.macIntel} label="Intel" />
              </PillGroup>
              <span className="text-xs text-muted-foreground">需要 macOS 13 或更高版本</span>
            </div>
          </PlatformRow>

          <PlatformRow icon={WindowsIcon} label="Windows">
            <PillGroup>
              <DownloadPill
                href={urls.windowsExeX64}
                label={urls.windowsExeArm64 ? "Intel / x64" : "下载"}
              />
              {urls.windowsExeArm64 && <DownloadPill href={urls.windowsExeArm64} label="ARM64" />}
            </PillGroup>
          </PlatformRow>

          <PlatformRow icon={LinuxIcon} label="Linux">
            {urls.linuxAppImage && urls.linuxDeb && urls.linuxRpm ? (
              <PillGroup>
                <DownloadPill href={urls.linuxAppImage} label="AppImage" />
                <DownloadPill href={urls.linuxDeb} label="DEB" />
                <DownloadPill href={urls.linuxRpm} label="RPM" />
              </PillGroup>
            ) : (
              <span className="text-sm text-muted-foreground">
                这一版没有 Linux 安装包，可以用 Docker 或源码构建
              </span>
            )}
          </PlatformRow>
        </div>
      </section>

      {/* Mobile */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold">手机</h2>
          <PhoneIcon className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="divide-y divide-border">
          <PlatformRow icon={AndroidIcon} label="安卓">
            <PillGroup>
              <DownloadPill href={urls.androidApk} label="APK" />
            </PillGroup>
          </PlatformRow>
        </div>
      </section>

      {/* Web */}
      {!onBeta && (
        <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8 mb-6">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h2 className="text-2xl font-semibold">网页端</h2>
              <p className="text-sm text-muted-foreground mt-1">用浏览器连接到你的主机</p>
            </div>
            <GlobeIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
          </div>

          <div className="divide-y divide-border">
            <PlatformRow icon={GlobeIcon} label="网页端">
              <PillGroup>
                <DownloadPill href={webAppUrl} label="打开" external />
              </PillGroup>
            </PlatformRow>
          </div>
        </section>
      )}

      {/* Server */}
      <section className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold">服务器</h2>
            <p className="text-sm text-muted-foreground mt-1">
              把 daemon 跑在任意机器上，再用任意客户端连接
            </p>
          </div>
          <TerminalIcon className="h-5 w-5 text-muted-foreground mt-1.5" />
        </div>

        <div className="divide-y divide-border">
          <PlatformRow icon={TerminalIcon} label="Docker">
            <CodeBlock size="sm">
              {`docker pull ghcr.io/lft-oxy/osuna:${onBeta ? version : "latest"}`}
            </CodeBlock>
          </PlatformRow>

          <PlatformRow icon={TerminalIcon} label="源码构建">
            <a
              href="/docs"
              className="text-sm text-muted-foreground underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-current transition-colors"
            >
              查看文档
            </a>
          </PlatformRow>
        </div>
      </section>

      <p className="text-center text-xs text-muted-foreground mt-8">
        全部版本都在{" "}
        <a
          href="https://github.com/LFT-OXY/Osuna/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground transition-colors"
        >
          GitHub Releases
        </a>
        。
      </p>
    </SiteShell>
  );
}

function ChannelSwitch({ onBeta }: { onBeta: boolean }) {
  return (
    <div
      aria-label="发布通道"
      className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1"
    >
      <ChannelOption label="稳定版" active={!onBeta} search={STABLE_SEARCH} />
      <ChannelOption label="Beta" active={onBeta} search={BETA_SEARCH} />
    </div>
  );
}

function ChannelOption({
  label,
  active,
  search,
}: {
  label: string;
  active: boolean;
  search: DownloadSearch;
}) {
  return (
    <Link
      to="/download"
      search={search}
      replace
      resetScroll={false}
      aria-current={active ? "true" : undefined}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}

function BetaNotice() {
  return (
    <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-5 md:px-8 md:py-6">
      <p className="text-sm">Beta 版先于稳定版发布，可能不稳定。</p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        已经在用桌面端？在 <span className="text-foreground">设置 → 发布通道</span> 里选
        Beta，之后它会自己更新。
      </p>
    </div>
  );
}

function PlatformRow({
  icon: Icon,
  label,
  children,
}: {
  icon: (props: React.SVGProps<SVGSVGElement>) => ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 text-foreground" />
        <span className="font-medium">{label}</span>
      </div>
      {children}
    </div>
  );
}

function PillGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function DownloadPill({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background hover:bg-foreground/85 transition-colors"
    >
      {label}
      {external && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="ml-1.5 h-3 w-3"
          aria-hidden="true"
        >
          <path d="M7 17L17 7" />
          <path d="M7 7h10v10" />
        </svg>
      )}
    </a>
  );
}

function MonitorIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function PhoneIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
