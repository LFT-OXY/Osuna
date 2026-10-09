---
title: Docker
description: Run the Osuna daemon and bundled web UI with the official Docker image.
nav: Docker
order: 6
category: Getting started
---

# Docker

The official Osuna Docker image runs the daemon and serves the bundled browser UI from the same HTTP origin. It is meant for servers, dev boxes, NAS devices, homelab hosts, and other places where you want Osuna running without the desktop app.

Docker images follow the stable Osuna release cadence. `ghcr.io/lft-oxy/osuna:latest` points at the latest stable release, not an arbitrary `main` build.

If you already run a 0.14.x container, follow [Upgrading from 0.14.x](#upgrading-from-014x) before you start the new image.

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Then open:

```text
http://localhost:6767
```

If you set `OSUNA_PASSWORD`, use that same password when adding the direct daemon connection in the web UI, mobile app, or CLI.

## What the image includes

The image:

- installs the Osuna daemon and CLI
- serves the bundled web UI
- listens on `0.0.0.0:6767` inside the container
- stores daemon state under `/home/osuna/.osuna`
- runs the daemon and launched agents as the non-root `osuna` user

The image does not bundle agent CLIs such as Claude Code, Codex, OpenCode, Copilot, or Pi. Add the agents you use with a small child image.

Host-side CLI commands select the container explicitly, for example `osuna project ls --host 127.0.0.1:6767`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Docker Compose

```yaml
services:
  osuna:
    image: ghcr.io/lft-oxy/osuna:latest
    container_name: osuna
    restart: unless-stopped
    ports:
      - "6767:6767"
    environment:
      OSUNA_PASSWORD: "change-me"
      # OSUNA_HOSTNAMES: "osuna.example.com,.lan"
    volumes:
      - ./osuna-home:/home/osuna
      - ./workspace:/workspace
```

Start it:

```bash
docker compose up -d
```

## Install agent CLIs

Create a child image for the providers you want available:

```Dockerfile
FROM ghcr.io/lft-oxy/osuna:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -t osuna-with-agents .
```

Then use `image: osuna-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for first-run mounted-volume setup, then drops the daemon and launched agents to the non-root `osuna` user.

You can authenticate agents either by passing provider environment variables or by running the provider login flow inside the container:

```bash
docker exec -it --user osuna osuna codex
docker exec -it --user osuna osuna claude
```

Agent credentials persist in `/home/osuna`.

## Volumes

Mount two paths for most deployments:

| Mount         | Purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `/home/osuna` | Osuna state plus agent config and credentials such as `.codex`, `.claude` |
| `/workspace`  | Code that Osuna and launched agents can read and write                    |

On Linux, the built-in `osuna` user is uid/gid `1000:1000`. Make mounted directories writable by that user, or run the container with Docker's `--user` / Compose `user:` option.

## Reverse proxy

Forward normal HTTP traffic and WebSocket upgrades to the container.

Caddy:

```caddy
osuna.example.com {
  reverse_proxy 127.0.0.1:6767
}
```

Nginx:

```nginx
server {
    listen 443 ssl;
    server_name osuna.example.com;

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach Osuna by DNS name, allow that host:

```yaml
environment:
  OSUNA_HOSTNAMES: "osuna.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

Set `OSUNA_PASSWORD` for any published port or network-reachable deployment. Use HTTPS at your reverse proxy for browser access outside localhost.

The static web UI is public on the daemon origin. The daemon API and WebSocket are protected by password auth when configured.

Agents can access whatever you mount into `/workspace` and whatever credentials you place in `/home/osuna`. Keep those mounts scoped to what the agents should be able to use.

See [Security](/docs/security) for the full daemon trust model.

## Upgrading from 0.14.x

Osuna 1.0.0 renamed the image, the container user, its home directory, the state directory, and every environment variable. The desktop app and a locally run CLI move their data on first start. A container does not: the image sets `OSUNA_HOME`, and the daemon never migrates into a home that was chosen explicitly. Make these changes yourself before the new container starts for the first time.

| 0.14.x                    | 1.0.0                         |
| ------------------------- | ----------------------------- |
| Home mount `/home/paseo`  | `/home/osuna`                 |
| State directory `.paseo`  | `.osuna`                      |
| Variables named `PASEO_*` | `OSUNA_*`                     |
| Container user `paseo`    | `osuna`, still uid/gid `1000` |
| Image                     | `ghcr.io/lft-oxy/osuna`       |

1. Stop and remove the old container. The data stays in the mounted directory.
2. Rename the state directory inside the directory you mounted as the container home. With the `paseo-home` bind mount from the old examples:

   ```bash
   mv paseo-home/.paseo paseo-home/.osuna
   ```

   For a named volume, run the same rename from any container that mounts it. Agent credentials such as `.claude` and `.codex` sit next to the state directory and need no change.

3. Mount that directory at `/home/osuna` and switch to the new image.
4. Rename every `PASEO_*` variable to its `OSUNA_*` name, for example `PASEO_PASSWORD` to `OSUNA_PASSWORD` and `PASEO_HOSTNAMES` to `OSUNA_HOSTNAMES`. Osuna ignores the old names, so a container that still passes only `PASEO_PASSWORD` runs without a password. The daemon log names each leftover variable.
5. Rebuild child images from the new base, and use `--user osuna` with `docker exec`.

```bash
docker run -d --name osuna \
  -p 6767:6767 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

If the new container started before the rename, it created an empty `.osuna` and came up with no agents or workspaces. Your data is still in `.paseo`. Stop the container, move the new `.osuna` aside, then do the rename.

The daemon does not rewrite stored paths. Workspaces under `/workspace` carry over unchanged. Worktree workspaces live under the state directory, so their recorded paths still start with `/home/paseo/.paseo/worktrees`, which no longer exists in the new container. Merge or push their branches and archive those workspaces before you upgrade.

## Troubleshooting

- **The UI loads but cannot connect:** if `OSUNA_PASSWORD` is set, add a direct connection with the same password.
- **403 Host not allowed:** set `OSUNA_HOSTNAMES` to the DNS names you use.
- **Provider not available:** install that agent CLI in a child image or make sure the binary is on `PATH`.
- **Permission errors in `/workspace`:** make the mounted directory writable by uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs:** run `docker logs osuna`, or inspect `/home/osuna/.osuna/daemon.log` inside the container.
