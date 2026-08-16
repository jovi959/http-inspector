#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ "${OSTYPE:-}" != darwin* ]]; then
  printf '%s\n' 'Error: build_app.sh stages the macOS .app. Use build_windows_portable.sh for the portable Windows executable.' >&2
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_COMMAND=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  if ! corepack enable pnpm >/dev/null 2>&1 || ! command -v pnpm >/dev/null 2>&1; then
    printf '%s\n' 'Error: Corepack is installed but could not enable pnpm. Run "corepack enable pnpm" or install pnpm directly, then try again.' >&2
    exit 1
  fi
  PNPM_COMMAND=(pnpm)
else
  printf '%s\n' 'Error: pnpm is required. Install Node.js with Corepack enabled, or install pnpm, then run this script again.' >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  printf '%s\n' 'Error: Rust cargo is required. Install Rust, then run this script again.' >&2
  exit 1
fi

printf '%s\n' 'Building the HTTP Inspector Tauri application...'
"${PNPM_COMMAND[@]}" tauri build --bundles app

SOURCE_APP="$ROOT_DIR/target/release/bundle/macos/HTTP Inspector.app"
RELEASE_DIRECTORY="$ROOT_DIR/releases/macos"
RELEASE_APP="$RELEASE_DIRECTORY/HTTP Inspector.app"

if [[ ! -d "$SOURCE_APP" ]]; then
  printf '%s\n' "Error: Tauri did not produce the expected macOS app at $SOURCE_APP" >&2
  exit 1
fi

mkdir -p "$RELEASE_DIRECTORY"
rm -rf -- "$RELEASE_APP"
ditto "$SOURCE_APP" "$RELEASE_APP"

printf '%s\n' 'Build complete. The runnable macOS app is at:'
printf '%s\n' "  $RELEASE_APP"
