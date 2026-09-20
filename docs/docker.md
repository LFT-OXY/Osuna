# Running Osuna in Docker

Osuna publishes a container image for running the daemon on a server, VM, NAS,
or homelab box. The image also serves the bundled browser web UI, so one
container gives you both the daemon API and a self-hosted UI.

The image source lives in [`docker/`](../docker/).

## How it works

The official image:

- builds `@osuna/server` and `@osuna/cli` from source-built workspace tarballs
- runs the daemon as the non-root `osuna` user
- listens on `0.0.0.0:6777` inside the container
- enables the bundled daemon web UI with `OSUNA_WEB_UI_ENABLED=true`
- stores daemon state and agent credentials under `/home/osuna`
- leaves agent CLIs out of the base image

Open the container's HTTP origin, for example `http://localhost:6777`, to load
the web UI. The served app receives a same-origin connection hint and connects
back to that daemon. Static UI files load without daemon auth; API and
WebSocket requests still require `OSUNA_PASSWORD` when one is configured.

Host-side CLI commands select the container explicitly, for example `osuna project ls --host 127.0.0.1:6777`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Quick Start

```bash
docker run -d --name osuna \
  -p 6777:6777 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Then open:

```text
http://localhost:6777
```

If you set `OSUNA_PASSWORD`, enter the same password when adding the direct
daemon connection in the web UI or another Osuna client.

## Docker Compose

Use [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml):

```bash
cp docker/docker-compose.example.yml docker-compose.yml
$EDITOR docker-compose.yml
docker compose up -d
```

Minimal example:

```yaml
services:
  osuna:
    image: ghcr.io/lft-oxy/osuna:latest
    restart: unless-stopped
    ports:
      - "6777:6777"
    environment:
      OSUNA_PASSWORD: "change-me"
    volumes:
      - ./osuna-home:/home/osuna
      - ./workspace:/workspace
```

## Installing Agents

The base image does not preinstall Claude Code, Codex, OpenCode, Copilot, Pi, or
other agent CLIs. That keeps the default image small and avoids coupling Osuna
releases to third-party agent release cycles.

Create a child image for the agents you use:

```Dockerfile
FROM ghcr.io/lft-oxy/osuna:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -f Dockerfile -t osuna-with-agents .
```

Then use `image: osuna-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to the
non-root `osuna` user.

An example child image is in
[`docker/Dockerfile.agents.example`](../docker/Dockerfile.agents.example).

You can also mount credentials from the host or run agent login once inside the
container:

```bash
docker exec -it --user osuna osuna codex
docker exec -it --user osuna osuna claude
```

Agent credentials and config persist in `/home/osuna`, alongside daemon state.
Provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, or `ANTHROPIC_BASE_URL` can be passed through `docker run -e`
or `compose.environment`; Osuna passes them to launched agents.

## Volumes

| Mount         | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `/home/osuna` | Osuna state under `.osuna` plus agent config such as `.codex`, `.claude` |
| `/workspace`  | Code that Osuna and launched agents can read and write                   |

The image defaults:

| Variable       | Default              |
| -------------- | -------------------- |
| `HOME`         | `/home/osuna`        |
| `OSUNA_HOME`   | `/home/osuna/.osuna` |
| `OSUNA_LISTEN` | `0.0.0.0:6777`       |

If you bind-mount host directories on Linux, make sure the container user can
write them. The built-in `osuna` user has uid/gid `1000:1000`. For a different
host uid/gid, either adjust ownership on the mounted directories or run the
container with Docker's `--user` / Compose `user:` option.

## Reverse Proxies

When serving Osuna behind a reverse proxy, forward normal HTTP requests and
WebSocket upgrades to the same daemon port.

Caddy example:

```caddy
osuna.example.com {
  reverse_proxy 127.0.0.1:6777
}
```

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name osuna.example.com;

    location / {
        proxy_pass http://127.0.0.1:6777;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach the daemon by DNS name, set `OSUNA_HOSTNAMES` so host-header
validation allows that name:

```yaml
environment:
  OSUNA_HOSTNAMES: "osuna.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Security

- Set `OSUNA_PASSWORD` for any published port or network-reachable deployment.
- Prefer HTTPS at the reverse proxy for direct browser access.
- Use the [upstream Paseo relay](https://github.com/getpaseo/paseo-relay) for
  untrusted networks or mobile access when you do not want to expose the daemon
  port directly.
- The container is the isolation boundary for agents. Agents can read and write
  whatever you mount into `/workspace` and whatever credentials you place in
  `/home/osuna`.
- The bundled web UI static files are public on the daemon origin. The daemon
  API and WebSocket remain protected by password auth when configured.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building Locally

```bash
docker build -f docker/base/Dockerfile -t osuna:local .
```

To assert the source tree version while building:

```bash
docker build \
  --build-arg OSUNA_VERSION=0.1.102 \
  -t osuna:0.1.102 \
  -f docker/base/Dockerfile \
  .
```

The Docker workflow builds the image on pull requests and on `main` as a
non-publishing check. Stable `vX.Y.Z` tag pushes publish
`ghcr.io/lft-oxy/osuna:X.Y.Z` and `ghcr.io/lft-oxy/osuna:latest`. Beta tags
publish only the exact prerelease tag, such as
`ghcr.io/lft-oxy/osuna:0.1.102-beta.1`, and do not update `latest`.

To replace a Docker image in place without rebuilding the desktop or APK
artifacts, dispatch the Docker workflow manually instead of pushing a `v*`
release tag:

```bash
gh workflow run docker.yml \
  --ref main \
  -f osuna_version=0.1.102-beta.1 \
  -f publish=true
```

Manual Docker publishes require an explicit `osuna_version`. The workflow builds
from the checked-out source tree and publishes only the exact prerelease image
tag for prerelease versions.

The published image is multi-arch for `linux/amd64` and `linux/arm64`.

## Troubleshooting

- **The web UI loads but cannot connect**: if `OSUNA_PASSWORD` is set, add a
  direct connection with the same password.
- **403 Host not allowed**: set `OSUNA_HOSTNAMES` to the DNS names you use.
- **Provider not available**: install that agent CLI in a child image or mount a
  runtime where the binary is on `PATH`.
- **Permission errors in `/workspace`**: make the mounted directory writable by
  uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs**: inspect `docker logs osuna` or
  `/home/osuna/.osuna/daemon.log` inside the container.
