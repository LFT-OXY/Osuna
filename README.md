<h1 align="center">Osuna</h1>

<p align="center">
  <a href="https://github.com/LFT-OXY/Osuna/stargazers">
    <img src="https://img.shields.io/github/stars/LFT-OXY/Osuna?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/LFT-OXY/Osuna/releases">
    <img src="https://img.shields.io/github/v/release/LFT-OXY/Osuna?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">One interface for Claude Code, Codex, Copilot, OpenCode, and Pi agents.</p>

> **Fork notice.** Osuna is a fork of [Paseo](https://github.com/getpaseo/paseo), licensed under
> Apache-2.0. It has been renamed and otherwise modified, and it is maintained independently of
> upstream. The original copyright notice is kept in [LICENSE](LICENSE). Under section 6 of the
> license, the names "Paseo" and "Osuna" and their logos are not covered by the license grant.

Run agents in parallel on your own machines. Ship from your phone or your desk.

- **Self-hosted:** Agents run on your machine with your full dev environment. Use your tools, your configs, and your skills.
- **Multi-provider:** Claude Code, Codex, Copilot, OpenCode, and Pi through the same interface. Pick the right model for each job.
- **Voice control:** Dictate tasks or talk through problems in voice mode. Hands-free when you need it.
- **Cross-device:** iOS, Android, desktop, web, and CLI. Start work at your desk, check in from your phone, script it from the terminal.
- **Privacy-first:** Osuna doesn't have any telemetry, tracking, or forced log-ins.

## Plugins

Add themes, workspace panels, commands, settings screens, and coding-agent providers with trusted
TypeScript plugins. Install from a local directory or Git repository with `osuna plugin add <source>`.

See the [plugin docs](public-docs/plugins/index.md), or start with the
[0.8 beta quickstart](public-docs/plugins/v0.8/index.md). Plugins run with access to your daemon
machine and inside connected clients; install only code you trust.

## Getting Started

Osuna runs a local server called the daemon that manages your coding agents. Clients like the desktop app, mobile app, web app, and CLI connect to it.

### Prerequisites

You need at least one agent CLI installed and configured with your credentials:

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### Desktop app (recommended)

Download it from the [GitHub releases page](https://github.com/LFT-OXY/Osuna/releases). Open the app and the daemon starts automatically. Nothing else to install.

To connect from your phone, open **Settings → your host → Pair Device**.

### CLI / headless

Install the CLI and start Osuna:

```bash
npm install -g @osuna/cli
osuna
```

Osuna starts locally, then asks whether to enable the end-to-end encrypted relay for device pairing. If you decline, connect directly over TCP, Tailscale, or another VPN. This path is useful for servers and remote machines.

For full setup and configuration, see:

- [Docs](public-docs/index.md)
- [Connectivity guide](public-docs/connectivity.md)
- [Configuration reference](public-docs/configuration.md)

### Docker

Run the Osuna daemon and self-hosted web UI in Docker:

```bash
docker run -d --name osuna \
  -p 6777:6777 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Open `http://localhost:6777` after it starts. Extend the base image with the agent CLIs you use, then provide credentials through environment variables or the persistent `/home/osuna` volume. See the [Docker documentation](docs/docker.md) for full setup details.

## CLI

Everything you can do in the app, you can do from the terminal.

```bash
osuna run --provider claude/opus-4.6 "implement user authentication"
osuna run --provider codex/gpt-5.5 --worktree feature-x "implement feature X"

osuna ls                           # list running agents
osuna attach abc123                # stream live output
osuna send abc123 "also add tests" # follow-up task

# run on a remote daemon; --cwd is a path on that host
osuna run --host workstation.local:6777 --cwd /workspace "run the full test suite"
```

See the [full CLI reference](public-docs/cli.md) for more.

## TypeScript SDK

Build issue integrations, dashboards, and orchestration services with `@osuna/client`:

```ts
import { createPaseoClient } from "@osuna/client";

const client = createPaseoClient({ url: "ws://127.0.0.1:6777/ws" });
await client.connect();

const agent = await client.agents.create({
  config: { provider: "codex/gpt-5.5" },
  cwd: "/Users/me/dev/storefront",
  prompt: "Review the current diff and name the riskiest change.",
});

const result = await agent.waitForFinish();
console.log(result.lastMessage);

await client.close();
```

See the [SDK quickstart](public-docs/sdk/quickstart.md), [recipes](public-docs/sdk/recipes.md), and [API reference](public-docs/sdk/reference.md).

## Skills

Skills teach your agent to use Osuna to orchestrate other agents.

```bash
npx skills add LFT-OXY/Osuna
```

Then use them in any agent conversation:

- `/paseo-handoff` — hand off work between agents. Plan with one agent, then hand off to another to implement.
- `/paseo-advisor` — spin up a single agent as an advisor for a second opinion, without delegating the work itself.
- `/paseo-committee` — form a committee of two contrasting agents to step back, do root cause analysis, and produce a plan.

## Development

Quick monorepo package map:

- `packages/server`: Osuna daemon (agent process orchestration, WebSocket API, MCP server)
- `packages/app`: Expo client (iOS, Android, web)
- `packages/cli`: `osuna` CLI for daemon and agent workflows
- `packages/desktop`: Electron desktop app
- `packages/relay`: Relay transport and encryption used by the daemon and clients
- `packages/website`: Marketing site and documentation source

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

## License

Apache-2.0. See [LICENSE](LICENSE).
