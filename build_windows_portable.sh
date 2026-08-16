#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

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

if ! command -v rustup >/dev/null 2>&1; then
  printf '%s\n' 'Error: Rustup is required to select the Rust toolchain that owns the Windows target.' >&2
  exit 1
fi

RUSTUP_BIN_DIRECTORY="${CARGO_HOME:-$HOME/.cargo}/bin"
if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ]]; then
  RUSTUP_CARGO_DIRECTORY="$RUSTUP_BIN_DIRECTORY"
else
  RUSTUP_CARGO_DIRECTORY="$(dirname "$(rustup which cargo)")"
fi
export PATH="$RUSTUP_BIN_DIRECTORY:$RUSTUP_CARGO_DIRECTORY:$PATH"

TARGET_TRIPLE="x86_64-pc-windows-msvc"
WINDOWS_TARGET_DIRECTORY="$ROOT_DIR/target/windows-x64-release"

printf '%s\n' 'Building the portable Windows HTTP Inspector executable...'
rustup target add "$TARGET_TRIPLE"

if [[ "${OSTYPE:-}" != msys* && "${OSTYPE:-}" != cygwin* ]]; then
  if ! command -v cargo-xwin >/dev/null 2>&1; then
    printf '%s\n' 'Error: cargo-xwin is required to cross-build the portable Windows executable. Install it with "cargo install cargo-xwin".' >&2
    exit 1
  fi

  # Tauri CLI invokes Cargo with its production custom-protocol feature. cargo-xwin
  # supplies only the Windows linker and SDK environment for that invocation.
  eval "$(cargo xwin env --target "$TARGET_TRIPLE")"
fi

CARGO_TARGET_DIR="$WINDOWS_TARGET_DIRECTORY" "${PNPM_COMMAND[@]}" tauri build --target "$TARGET_TRIPLE" --no-bundle

SOURCE_EXECUTABLE="$WINDOWS_TARGET_DIRECTORY/$TARGET_TRIPLE/release/http-inspector.exe"
RELEASE_DIRECTORY="$ROOT_DIR/releases/windows"
RELEASE_EXECUTABLE="$RELEASE_DIRECTORY/HTTP-Inspector-windows-x64-portable.exe"

if [[ ! -f "$SOURCE_EXECUTABLE" ]]; then
  printf '%s\n' "Error: the cross-build did not produce the expected executable at $SOURCE_EXECUTABLE" >&2
  exit 1
fi

TAURI_RELEASE_MODE_CONFIRMED=false
for build_output in "$WINDOWS_TARGET_DIRECTORY/$TARGET_TRIPLE/release/build/tauri-"*/output; do
  [[ -f "$build_output" ]] || continue
  if grep -qx 'cargo:dev=false' "$build_output"; then
    TAURI_RELEASE_MODE_CONFIRMED=true
    break
  fi
done

if [[ "$TAURI_RELEASE_MODE_CONFIRMED" != true ]]; then
  printf '%s\n' 'Error: the Windows executable was not compiled in Tauri production mode.' >&2
  exit 1
fi

for build_output in "$WINDOWS_TARGET_DIRECTORY/$TARGET_TRIPLE/release/build/http-inspector-"*/output; do
  [[ -f "$build_output" ]] || continue
  if grep -qx 'cargo:rustc-cfg=dev' "$build_output"; then
    printf '%s\n' 'Error: the Windows executable was compiled with Tauri dev mode and would require a Vite server.' >&2
    exit 1
  fi
done

mkdir -p "$RELEASE_DIRECTORY"
cp -f "$SOURCE_EXECUTABLE" "$RELEASE_EXECUTABLE"

printf '%s\n' 'Build complete. The portable Windows executable is at:'
printf '%s\n' "  $RELEASE_EXECUTABLE"
