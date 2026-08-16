#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root=""
endpoint="ws://127.0.0.1:53662/v1/capture"
pre_run_arguments=()

usage() {
  echo "Usage: $0 --project <path> [--project-file <relative.csproj>] [--endpoint <ws-url>] [--state-root <external-path>] [--skip-build] -- <normal project command>" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      project_root="$2"
      pre_run_arguments+=("$1" "$2")
      shift 2
      ;;
    --endpoint)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      endpoint="$2"
      pre_run_arguments+=("$1" "$2")
      shift 2
      ;;
    --project-file|--state-root)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      pre_run_arguments+=("$1" "$2")
      shift 2
      ;;
    --skip-build)
      pre_run_arguments+=("$1")
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Error: unsupported integration option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$project_root" || $# -eq 0 ]]; then
  usage
  exit 1
fi

project_root="$(cd "$project_root" 2>/dev/null && pwd)" || {
  echo "Error: project directory does not exist: $project_root" >&2
  exit 1
}

receipt=""
child_pid=""
cleanup_complete=0
forwarded_status=0

cleanup() {
  if [[ $cleanup_complete -eq 1 || -z "$receipt" ]]; then
    return 0
  fi

  cleanup_complete=1
  "$script_dir/post-run.sh" --receipt "$receipt"
}

on_exit() {
  local command_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  cleanup || cleanup_status=$?
  if [[ $command_status -ne 0 ]]; then
    exit "$command_status"
  fi
  exit "$cleanup_status"
}

forward_signal() {
  local signal="$1"
  case "$signal" in
    INT)
      forwarded_status=130
      ;;
    TERM)
      forwarded_status=143
      ;;
  esac
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    kill "-$signal" -- "-$child_pid" 2>/dev/null || kill "-$signal" "$child_pid" 2>/dev/null || true
  fi
}

trap on_exit EXIT
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

receipt="$("$script_dir/pre-run.sh" "${pre_run_arguments[@]}")"
if [[ $forwarded_status -ne 0 ]]; then
  cleanup
  trap - EXIT INT TERM
  exit "$forwarded_status"
fi

export HTTP_INSPECTOR_WS="$endpoint"

set -m
(
  cd "$project_root"
  exec "$@"
) &
child_pid=$!
set +m

set +e
wait "$child_pid"
command_status=$?
while kill -0 "$child_pid" 2>/dev/null; do
  wait "$child_pid"
  command_status=$?
done
set -e

if [[ $forwarded_status -ne 0 ]]; then
  command_status=$forwarded_status
fi

cleanup
trap - EXIT INT TERM
exit "$command_status"
