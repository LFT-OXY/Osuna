import { type Doc, getDocs } from "./docs";

const SITE_URL = "https://osuna.chinhae.cc";

const PRODUCT_PREAMBLE = `# Osuna

> Mobile and desktop app for monitoring and controlling your local AI coding agents from anywhere. Your dev environment, in your pocket.

Osuna is an open source application that lets you run AI coding agents on your own machine and drive them from your phone, desktop, browser, or terminal. Your code stays local — Osuna connects directly to your real development environment instead of running agents in someone else's cloud.

A self-hosted daemon manages agent lifecycle, exposes a WebSocket API, and ships with an MCP server so other agents can talk to it. Desktop apps for macOS and Windows, an Android app, and a web app let you launch sessions, watch them work, review diffs, and ship from anywhere. A Docker-style CLI ("osuna run", "osuna ls", "osuna logs", "osuna wait") gives you scripting access. An end-to-end encrypted relay lets a phone or browser reach your daemon over the public internet without exposing it.

Osuna runs the agent CLIs you already have installed. Claude Code, Codex, GitHub Copilot, OpenCode, Pi, and Oh My Pi are built in; Cursor, Gemini CLI, Cline, goose, Amp, and 30+ others install from the ACP catalog. Each agent runs as its own process; Osuna handles I/O, persistence, git worktree isolation, schedules, and skills.

Distribution: desktop apps for macOS and Windows and an Android APK at https://github.com/LFT-OXY/Osuna/releases; web app at https://osuna-app.chinhae.cc; Docker image ghcr.io/lft-oxy/osuna; or build the daemon and CLI from source. Source: Apache-2.0 at https://github.com/LFT-OXY/Osuna. Website: https://osuna.chinhae.cc.
`;

function docLine(doc: Doc): string {
  const url = `${SITE_URL}${doc.href}.md`;
  const description = doc.frontmatter.description?.trim();
  const suffix = description ? `: ${description}` : "";
  return `- [${doc.frontmatter.title}](${url})${suffix}`;
}

function topLevelDocs(): Doc[] {
  return getDocs().filter((d) => !d.slug.includes("/"));
}

export function buildLlmsTxt(): string {
  const docs = topLevelDocs().map(docLine).join("\n");

  return `${PRODUCT_PREAMBLE}
## Docs

${docs}

## Optional

- [Changelog](${SITE_URL}/changelog): Release notes for the Osuna daemon, CLI, desktop, and Android apps.
- [Download](${SITE_URL}/download): Desktop installers for macOS and Windows, and the Android APK.
- [Privacy](${SITE_URL}/privacy): Privacy policy.
- [Terms](${SITE_URL}/terms): Terms for the official relay.
- [GitHub](https://github.com/LFT-OXY/Osuna): Source code, issues, and releases.
`;
}
