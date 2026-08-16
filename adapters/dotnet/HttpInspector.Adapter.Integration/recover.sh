#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 --project <path> [--state-root <external-path>]" >&2
  exit 1
fi

exec "$script_dir/post-run.sh" "$@"
