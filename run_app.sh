#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${OSTYPE:-}" == darwin* ]]; then
  APP_PATH="$ROOT_DIR/releases/macos/HTTP Inspector.app"
  if [[ ! -d "$APP_PATH" ]]; then
    printf '%s\n' "Error: compiled macOS app was not found at $APP_PATH" >&2
    printf '%s\n' 'Run ./build_app.sh first.' >&2
    exit 1
  fi

  open "$APP_PATH"
  printf '%s\n' "Started $APP_PATH"
  exit 0
fi

if [[ "${OSTYPE:-}" == linux* ]]; then
  APP_PATH="$ROOT_DIR/target/release/http-inspector"
  if [[ ! -x "$APP_PATH" ]]; then
    printf '%s\n' "Error: compiled Linux binary was not found at $APP_PATH" >&2
    printf '%s\n' 'Run ./build_app.sh first.' >&2
    exit 1
  fi

  exec "$APP_PATH"
fi

printf '%s\n' "Error: unsupported shell platform '$OSTYPE'. Run the generated Tauri artifact for your operating system directly." >&2
exit 1
