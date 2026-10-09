#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"

export OSUNA_LISTEN="${OSUNA_LISTEN:-127.0.0.1:6768}"
configure_dev_osuna_home

configure_dev_local_models_dir

echo "══════════════════════════════════════════════════════"
echo "  Osuna Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${OSUNA_HOME}"
echo "  Models:  ${OSUNA_LOCAL_MODELS_DIR:-$OSUNA_HOME/models/local-speech}"
echo "  Listen:  ${OSUNA_LISTEN}"
echo "══════════════════════════════════════════════════════"

export OSUNA_CORS_ORIGINS="${OSUNA_CORS_ORIGINS:-*}"
export OSUNA_NODE_INSPECT="${OSUNA_NODE_INSPECT:---inspect=0}"

if [ "${OSUNA_SKIP_DEV_SERVER_BUILD:-0}" = "1" ]; then
  exec npm run dev:server:watch
fi

exec sh -c 'npm run build:server-deps && npm run dev:server:watch'
