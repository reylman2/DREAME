#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$(cd "$ROOT/.." && pwd)/ComfyUI}"

if [ ! -d "$COMFYUI_DIR/.venv" ]; then
  echo "ComfyUI venv not found: $COMFYUI_DIR/.venv"
  exit 1
fi

cd "$COMFYUI_DIR"
. .venv/bin/activate

exec python -u main.py --listen "${COMFYUI_HOST:-127.0.0.1}" --port "${COMFYUI_PORT:-8188}" ${COMFYUI_ARGS:---cpu}
