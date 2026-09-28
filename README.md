<p align="center">
  <img src="packages/app/assets/images/osuna-logo.png" width="64" height="64" alt="Osuna logo">
</p>

<h1 align="center">Osuna</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://github.com/LFT-OXY/Osuna/releases">
    <img src="https://img.shields.io/github/v/release/LFT-OXY/Osuna?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** Desktop, web, CLI, and your phone. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Osuna doesn't have any telemetry, tracking, or forced log-ins.

> [!NOTE]
> Osuna is a fork of [Paseo](https://github.com/getpaseo/paseo). Internal names keep the upstream spelling: the CLI command is still `paseo`, data lives in `~/.paseo`, and environment variables start with `PASEO_`.

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from a local directory or Git repository with `paseo plugin add <source>`.

See the [plugin docs](docs/plugins.md). Plugins run with access to your daemon machine and inside
connected clients; install only code you trust.

## Getting Started

Osuna runs a local server called the daemon that manages your coding agents. Clients like the desktop app, web app, CLI, and the Paseo mobile app connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from the [GitHub releases page](https://github.com/LFT-OXY/Osuna/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, install the official Paseo mobile app, then open **Settings → your host → Pair Device** in Osuna.

### CLI

Open **Settings → Integrations → Command line** in the desktop app and click **Install**. This links the `paseo` command into `~/.local/bin`.

Don't install `@getpaseo/cli` from npm. That package is upstream Paseo, not Osuna.

### Docker

Run the Osuna daemon and self-hosted web UI in Docker. This path is useful for servers and remote machines:

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/paseo:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/paseo` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI usage

Everything you can do in the app, you can do from the terminal.

```bash
paseo run --provider claude/opus-4.6 "implement user authentication"
paseo run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

paseo ls                           # list running agents
paseo attach abc123                # stream live output
paseo send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
paseo run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

Run `paseo --help` for the full command list.

## Skills

Skills teach your agent to use Osuna to orchestrate other agents.

```bash
npx skills add LFT-OXY/Osuna
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Osuna daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `paseo` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Upstream marketing site and documentation (`paseo.sh`); this fork doesn't deploy it

Common commands:

```bash
# run all local dev services
npm run dev

# run individual surfaces
npm run dev:server
npm run dev:app
npm run dev:desktop
npm run dev:website

# build the server stack
npm run build:server

# repo-wide checks
npm run typecheck
```

See [docs/development.md](docs/development.md) for full setup.

## License

Apache-2.0
