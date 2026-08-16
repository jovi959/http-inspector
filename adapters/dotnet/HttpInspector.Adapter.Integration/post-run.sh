#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
receipt_path=""
project_root=""
state_root=""
expected_run_id=""
json_output=0

source "$script_dir/lib/common.sh"
source "$script_dir/lib/receipt-manager.sh"
source "$script_dir/lib/mutation-planner.sh"
source "$script_dir/lib/cleanup-engine.sh"

usage() {
  echo "Usage: $0 --project <path> [--state-root <external-path>] [--run-id <uuid>] [--json]" >&2
  echo "   or: $0 --receipt <external-receipt-path> [--json]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --receipt)
      http_inspector_require_value "$1" "${2:-}"
      receipt_path="$2"
      shift 2
      ;;
    --project)
      http_inspector_require_value "$1" "${2:-}"
      project_root="$2"
      shift 2
      ;;
    --state-root)
      http_inspector_require_value "$1" "${2:-}"
      state_root="$2"
      shift 2
      ;;
    --run-id)
      http_inspector_require_value "$1" "${2:-}"
      expected_run_id="$2"
      shift 2
      ;;
    --json)
      json_output=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      http_inspector_die "Unsupported option: $1"
      ;;
  esac
done

[[ -n "$receipt_path" || -n "$project_root" ]] || { usage; http_inspector_die "--receipt or --project is required."; }

no_active_integration() {
  if [[ $json_output -eq 1 ]]; then
    printf '{"ok":true,"active":false,"projectRoot":"%s","integrationId":"","runId":"","state":"clean"}\n' "$(http_inspector_json_escape "$project_root")"
  else
    echo "No active temporary integration was found."
  fi
  exit 0
}

if [[ -n "$receipt_path" ]]; then
  if [[ ! -f "$receipt_path" ]]; then
    no_active_integration
  fi
  receipt_path="$(http_inspector_canonical_file "$receipt_path")"
  http_inspector_receipt_load "$receipt_path" || http_inspector_die "Integration receipt is invalid: $receipt_path"
  project_root="$RECEIPT_PROJECT_ROOT"
  project_state="$RECEIPT_PROJECT_STATE"
else
  project_root="$(http_inspector_canonical_directory "$project_root")"
  state_root="${state_root:-$(http_inspector_default_state_root)}"
  if [[ ! -d "$state_root" ]]; then
    no_active_integration
  fi
  state_root="$(http_inspector_canonical_directory "$state_root")"
  http_inspector_ensure_separate_roots "$project_root" "$state_root"
  project_state="$state_root/integrations/$(http_inspector_project_key "$project_root")"
  if ! receipt_path="$(http_inspector_active_receipt "$project_state")"; then
    no_active_integration
  fi
  [[ -f "$receipt_path" ]] || http_inspector_die "The active integration receipt is missing: $receipt_path"
  http_inspector_receipt_load "$receipt_path" || http_inspector_die "Integration receipt is invalid: $receipt_path"
fi

[[ -z "$expected_run_id" || "$RECEIPT_RUN_ID" == "$expected_run_id" ]] || http_inspector_die "Active run ID is $RECEIPT_RUN_ID, not $expected_run_id."
http_inspector_acquire_lock "$project_state"
trap 'http_inspector_release_lock' EXIT INT TERM
cleanup_status=0
if [[ $json_output -eq 1 ]]; then
  http_inspector_cleanup_receipt "$receipt_path" "$project_root" >&2 || cleanup_status=$?
else
  http_inspector_cleanup_receipt "$receipt_path" "$project_root" || cleanup_status=$?
fi
http_inspector_release_lock
trap - EXIT INT TERM
if [[ $json_output -eq 1 ]]; then
  if [[ $cleanup_status -eq 0 ]]; then
    printf '{"ok":true,"active":false,"projectRoot":"%s","integrationId":"%s","runId":"%s","state":"clean"}\n' \
      "$(http_inspector_json_escape "$project_root")" "$(http_inspector_json_escape "dotnet-httpclient:$RECEIPT_RUN_ID")" "$(http_inspector_json_escape "$RECEIPT_RUN_ID")"
  else
    printf '{"ok":false,"active":true,"state":"cleanupRequired","projectRoot":"%s","integrationId":"%s","runId":"%s"}\n' \
      "$(http_inspector_json_escape "$project_root")" "$(http_inspector_json_escape "dotnet-httpclient:$RECEIPT_RUN_ID")" "$(http_inspector_json_escape "$RECEIPT_RUN_ID")"
  fi
fi
exit "$cleanup_status"
