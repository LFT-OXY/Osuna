---
title: Getting started
description: Install Osuna and start running coding agents from anywhere.
nav: Getting started
order: 1
category: Getting started
---

# Getting started

Osuna runs your coding agents on your machine and gives you a mobile, desktop, web, and CLI client to drive them from anywhere. Three common ways to install.

## Desktop app (recommended)

Download from the [GitHub releases page](https://github.com/LFT-OXY/Osuna/releases). Open it and you're done.

The desktop app bundles its own daemon and starts it automatically, no separate install required. On first launch you'll see a brief startup screen, then connect from your phone using **Settings → your host → Pair Device**.

### Linux

Use the `.deb` on Debian/Ubuntu or the `.rpm` on Fedora to keep Chromium's sandbox available even when your distribution restricts user namespaces. The installer configures the bundled sandbox helper; you do not need to change system security settings.

For an AppImage, make the download executable and open it:

```bash
chmod +x Osuna-x86_64.AppImage
./Osuna-x86_64.AppImage
```

If it reports `error loading libfuse.so.2`, run without FUSE:

```bash
./Osuna-x86_64.AppImage --appimage-extract-and-run
```

Alternatively, install `libfuse2t64` on Ubuntu 24.04 or newer (`sudo apt install libfuse2t64`), or your distribution's FUSE 2 compatibility package. This dependency belongs to the AppImage runtime, before Osuna starts.

Osuna checks sandbox availability each time it launches. AppImage and extracted tar archives retain sandboxing when user namespaces work. On a restricted host without a usable installed helper, they launch with Chromium's sandbox disabled. Prefer the installed package if you require OS process isolation. **Settings → Diagnostics → App Diagnostics** reports the sandbox state and reason; the desktop log records the same decision. An explicit `--no-sandbox` argument overrides the automatic choice.

## Server / CLI

For headless machines, dev boxes, or any setup where you want the daemon running without the desktop UI:

```bash
npm install -g @osuna/cli
osuna
```

Osuna starts the daemon locally, then asks whether to enable the end-to-end encrypted relay and print a pairing QR code. If you decline, enter the daemon address manually over TCP, Tailscale, or another VPN.

The daemon can also serve the browser web app itself, so you can use the full UI without the hosted app. See [Self-hosting the web UI](/docs/web-ui).

Configuration and local state live under `OSUNA_HOME` (defaults to `~/.osuna`).

## Docker

For servers, dev boxes, NAS devices, or homelab hosts, run the official image:

```bash
docker run -d --name osuna \
  -p 6777:6777 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Then open `http://localhost:6777`.

The image runs the daemon and serves the bundled web UI. It does not bundle agent CLIs, so extend it with the agents you use. See [Docker](/docs/docker) for Compose, reverse proxy, agent install, and security examples.

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
