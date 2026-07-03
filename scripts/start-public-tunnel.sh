#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "找不到 cloudflared。请先安装：brew install cloudflared"
  exit 1
fi

LOG_FILE="${PUBLIC_TUNNEL_LOG:-/tmp/dreamehub-cloudflared.log}"
: > "$LOG_FILE"

env_value() {
  local key="$1"
  if [ ! -f .env ]; then
    return 0
  fi
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' .env
}

TUNNEL_PROXY="${PUBLIC_TUNNEL_PROXY:-}"
if [ -z "$TUNNEL_PROXY" ]; then
  for key in PUBLIC_TUNNEL_PROXY HTTPS_PROXY HTTP_PROXY ALL_PROXY OPENAI_PROXY SMTP_PROXY; do
    value="$(env_value "$key")"
    if [ -n "$value" ]; then
      TUNNEL_PROXY="$value"
      break
    fi
  done
fi

if [ -n "$TUNNEL_PROXY" ]; then
  export HTTP_PROXY="$TUNNEL_PROXY"
  export HTTPS_PROXY="$TUNNEL_PROXY"
  export ALL_PROXY="$TUNNEL_PROXY"
  export http_proxy="$TUNNEL_PROXY"
  export https_proxy="$TUNNEL_PROXY"
  export all_proxy="$TUNNEL_PROXY"
  echo "公网隧道代理：$TUNNEL_PROXY"
fi

echo "正在启动 Cloudflare Quick Tunnel -> http://127.0.0.1:${PORT:-3000}"
cloudflared tunnel --url "http://127.0.0.1:${PORT:-3000}" --no-autoupdate > "$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

for _ in $(seq 1 60); do
  if ! kill -0 "$TUNNEL_PID" >/dev/null 2>&1; then
    cat "$LOG_FILE"
    exit 1
  fi
  PUBLIC_URL="$(grep -Eo 'https://[-a-z0-9]+\\.trycloudflare\\.com' "$LOG_FILE" | tail -n 1 || true)"
  if [ -n "$PUBLIC_URL" ]; then
    if [ -f .env ] && grep -q '^PUBLIC_BASE_URL=' .env; then
      sed -i.bak "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$PUBLIC_URL|" .env
      rm -f .env.bak
    else
      printf '\nPUBLIC_BASE_URL=%s\n' "$PUBLIC_URL" >> .env
    fi
    echo "PUBLIC_BASE_URL=$PUBLIC_URL"
    echo "已写入 .env。请重启 npm start，让后端读取新的 PUBLIC_BASE_URL。"
    wait "$TUNNEL_PID"
    exit 0
  fi
  sleep 1
done

echo "Cloudflare Quick Tunnel 60 秒内没有返回公网 URL。日志："
cat "$LOG_FILE"
kill "$TUNNEL_PID" >/dev/null 2>&1 || true
exit 1
