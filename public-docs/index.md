---
title: Getting started
description: Install Osuna and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Osuna runs your coding agents on your machine and gives you desktop, web, Android, and CLI clients to drive them from anywhere. There are three ways to install it.

## Desktop app (recommended)

Download the macOS or Windows build from [osuna.chinhae.cc/download](https://osuna.chinhae.cc/download) or the [GitHub releases page](https://github.com/LFT-OXY/Osuna/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen.

To connect from your phone, open **Settings → your host → Pair a device** and scan the QR code. The link opens the Osuna web app in the phone's browser. On Android you can also install the APK from the releases page. See [Connectivity](/docs/connectivity) for the relay and direct options.

To use the `osuna` command in a terminal, open **Settings → Integrations → Command line** and select **Install**. This links the command into `~/.local/bin`.

### First launch warnings

The builds are not notarized by Apple and the Windows installer is not code-signed, so the operating system warns the first time you open a downloaded copy.

- **macOS:** right-click Osuna in Applications, choose **Open**, then **Open** again. If macOS says the app is damaged, clear the quarantine flag and open it again:

  ```bash
  xattr -dr com.apple.quarantine /Applications/Osuna.app
  ```

  If it is still blocked, open **System Settings → Privacy & Security** and choose **Open Anyway**.

- **Windows:** when SmartScreen blocks the installer, choose **More info**, then **Run anyway**.

### Linux

Releases do not include a Linux desktop build. Run the daemon with [Docker](#docker) or [build it from source](#build-from-source), then use the web app or the CLI.

## Docker

For servers, dev boxes, NAS devices, or homelab hosts, run the official image:

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Then open `http://localhost:6767`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, upgrade, and security examples.

## Build from source

On a server or headless machine without Docker, build the daemon and CLI from the repository. Use the Node.js version in `.tool-versions`.

```bash
git clone https://github.com/LFT-OXY/Osuna.git
cd Osuna
npm ci
npm run build:server
node packages/cli/bin/osuna
```

The last command starts the daemon locally, then asks whether to enable the end-to-end encrypted relay and print a pairing QR code. If you decline, enter the daemon address manually over TCP, Tailscale, or another VPN.

The rest of these docs write the command as `osuna`. To get that name from a source build, link the script into a directory on your `PATH`:

```bash
ln -s "$PWD/packages/cli/bin/osuna" ~/.local/bin/osuna
```

There is no Osuna package on npm.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. A source build needs one more build step for that. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `OSUNA_HOME` (defaults to `~/.osuna`).

## Where next

- [Connectivity](/docs/connectivity), connect through the relay or Tailscale.
- [Docker](/docs/docker), run the daemon and bundled web UI in a container.
- [Workspaces](/docs/workspaces), the project, workspace, and session model Osuna is built around.
- [Providers](/docs/providers), what a provider is and how Osuna wraps existing CLIs.
- [Orchestration](/docs/orchestration), let one agent delegate work to other providers and models.
- [Plugins](/docs/plugins), add trusted local surfaces, sidebar actions, daemon behavior, and composer attachments.
- [CLI reference](/docs/cli), every command.
- [Self-hosting the web UI](/docs/web-ui), serve the browser app from your own daemon.
- [GitHub repo](https://github.com/LFT-OXY/Osuna)
- [Report an issue](https://github.com/LFT-OXY/Osuna/issues)

## Prerequisites

Osuna manages other agents, it doesn't ship one. Before it's useful, install at least one provider CLI yourself and make sure it works with your credentials. See [Supported providers](/docs/supported-providers) for the full list.

You'll also want the [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated, Osuna uses it for PR-aware worktrees and a few orchestration features.
