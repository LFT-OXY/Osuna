# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS source-pack

ARG OSUNA_VERSION

ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /tmp/osuna-src
COPY . .

RUN set -eux; \
    if [ -n "${OSUNA_VERSION:-}" ]; then \
      test "$(node -p "require('./package.json').version")" = "${OSUNA_VERSION}"; \
    fi; \
    node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); delete pkg.scripts.prepare; fs.writeFileSync("package.json", `${JSON.stringify(pkg)}\n`);'; \
    npm ci

RUN set -eux; \
    mkdir -p /tmp/osuna-packs; \
    npm pack --workspace=@osuna/highlight --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/relay --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/protocol --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/client --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/plugin --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/server --pack-destination /tmp/osuna-packs; \
    npm pack --workspace=@osuna/cli --pack-destination /tmp/osuna-packs

FROM ${NODE_IMAGE}

ENV HOME=/home/osuna \
    OSUNA_HOME=/home/osuna/.osuna \
    OSUNA_LISTEN=0.0.0.0:6777 \
    OSUNA_WEB_UI_ENABLED=true \
    OSUNA_LOG_FORMAT=json \
    OSUNA_LOG_LEVEL=info \
    CLAUDE_CONFIG_DIR=/home/osuna/.claude \
    CODEX_HOME=/home/osuna/.codex \
    XDG_CONFIG_HOME=/home/osuna/.config \
    XDG_DATA_HOME=/home/osuna/.local/share \
    XDG_STATE_HOME=/home/osuna/.local/state \
    XDG_CACHE_HOME=/home/osuna/.cache \
    ONNXRUNTIME_NODE_INSTALL=skip

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      git \
      gosu \
      lbzip2 \
      openssh-client \
      procps \
      tini; \
    rm -rf /var/lib/apt/lists/*

COPY --from=source-pack /tmp/osuna-packs /tmp/osuna-packs
RUN set -eux; \
	npm install -g /tmp/osuna-packs/*.tgz; \
    rm -rf /tmp/osuna-packs; \
    npm cache clean --force; \
    server_entry="$(npm root -g)/@osuna/server/dist/scripts/supervisor-entrypoint.js"; \
    test -f "$server_entry"; \
    printf '%s\n' "$server_entry" > /etc/osuna-server-entry; \
    node --check "$server_entry"

RUN set -eux; \
    existing_group="$(getent group 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_group" ] && [ "$existing_group" != "osuna" ]; then \
      groupmod --new-name osuna "$existing_group"; \
    elif [ -z "$existing_group" ]; then \
      groupadd --gid 1000 osuna; \
    fi; \
    existing_user="$(getent passwd 1000 | cut -d: -f1 || true)"; \
    if [ -n "$existing_user" ] && [ "$existing_user" != "osuna" ]; then \
      usermod --login osuna --gid osuna --home /home/osuna --shell /bin/bash "$existing_user"; \
    elif [ -z "$existing_user" ]; then \
      useradd --uid 1000 --gid osuna --create-home --home-dir /home/osuna --shell /bin/bash osuna; \
    fi; \
    mkdir -p \
      /workspace \
      "$OSUNA_HOME" \
      "$CLAUDE_CONFIG_DIR" \
      "$CODEX_HOME" \
      "$XDG_CONFIG_HOME" \
      "$XDG_DATA_HOME" \
      "$XDG_STATE_HOME" \
      "$XDG_CACHE_HOME"; \
    chown -R osuna:osuna /home/osuna /workspace

COPY docker/base/rootfs/ /
RUN chmod +x /usr/local/bin/osuna-docker-entrypoint

WORKDIR /workspace

EXPOSE 6777
VOLUME ["/home/osuna"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const listen=process.env.OSUNA_LISTEN||'0.0.0.0:6777'; const m=listen.match(/:(\\d+)$/); const port=m?Number(m[1]):6777; require('http').get({hostname:'127.0.0.1',port,path:'/api/health'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/osuna-docker-entrypoint"]
