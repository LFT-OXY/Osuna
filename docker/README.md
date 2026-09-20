# Osuna Docker Image

This directory contains the official Osuna daemon image.

The image runs the daemon headless and serves the bundled web UI from the same
HTTP origin. Start it, then open the daemon URL in a browser.

```bash
docker run -d --name osuna \
  -p 6777:6777 \
  -e OSUNA_PASSWORD=change-me \
  -v "$PWD/osuna-home:/home/osuna" \
  -v "$PWD:/workspace" \
  ghcr.io/lft-oxy/osuna:latest
```

Then open `http://localhost:6777`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM ghcr.io/lft-oxy/osuna:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code
```

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.
