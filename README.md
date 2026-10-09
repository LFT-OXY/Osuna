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

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from a local directory or Git repository with `osuna plugin add <source>`.

See the [plugin docs](docs/plugins.md). Plugins run with access to your daemon machine and inside
connected clients; install only code you trust.

## Getting Started

Osuna runs a local server called the daemon that manages your coding agents. Clients like the desktop app, web app, CLI, and mobile app connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from the [GitHub releases page](https://github.com/LFT-OXY/Osuna/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair a device** and scan the QR code. The link opens the Osuna web app. On Android you can also install the APK from the releases page. The upstream Paseo mobile app is not a supported client.

To use the `osuna` command in a terminal, open **Settings → Integrations → Command line** and click **Install**. This links the command into `~/.local/bin`.

### Docker

Run the Osuna daemon and self-hosted web UI in Docker. This path is useful for servers and remote machines:

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Open `http://localhost:6767` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/osuna` volume. See the [Docker documentation](docs/docker.md) for full setup details.

### Build from source

On a server or headless machine without Docker, build the daemon and CLI from this repository. Use the Node.js version in `.tool-versions`.

```bash
git clone https://github.com/LFT-OXY/Osuna.git
cd Osuna
npm ci
npm run build:server
node packages/cli/bin/osuna
```

The last command starts the daemon and offers to print a pairing QR code. Run `node packages/cli/bin/osuna --help` for the other commands.

Don't install `@getpaseo/cli` from npm. That package is upstream Paseo, not Osuna.

## CLI usage

Everything you can do in the app, you can do from the terminal.

```bash
osuna run --provider claude/opus-4.6 "implement user authentication"
osuna run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

osuna ls                           # list running agents
osuna attach abc123                # stream live output
osuna send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
osuna run --host workstation.local:6767 --cwd /workspace "run the full test suite"
```

Run `osuna --help` for the full command list.

## Skills

Skills teach your agent to use Osuna to orchestrate other agents.

```bash
npx skills add LFT-OXY/Osuna
```

Then use them in any agent conversation:

- `/osuna-handoff` — hand off work between agents. I use this to plan with Claude and then handoff to Codex to implement.
- `/osuna-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/osuna-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Osuna daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `osuna` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Website and public docs (`osuna.chinhae.cc`)

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

Osuna started as a fork of [Paseo](https://github.com/getpaseo/paseo) and is now developed independently. See [NOTICE](NOTICE).
