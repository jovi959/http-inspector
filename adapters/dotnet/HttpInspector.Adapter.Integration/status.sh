#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
project_root=""
state_root=""

source "$script_dir/lib/common.sh"
source "$script_dir/lib/receipt-manager.sh"

usage() {
  echo "Usage: $0 --project <path> [--state-root <external-path>]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

[[ -n "$project_root" ]] || { usage; http_inspector_die "--project is required."; }
project_root="$(http_inspector_canonical_directory "$project_root")"
state_root="${state_root:-$(http_inspector_default_state_root)}"
if [[ ! -d "$state_root" ]]; then
  printf '{"active":false,"projectRoot":"%s"}\n' "$(http_inspector_json_escape "$project_root")"
  exit 0
fi
state_root="$(http_inspector_canonical_directory "$state_root")"
project_state="$state_root/integrations/$(http_inspector_project_key "$project_root")"
if ! receipt_path="$(http_inspector_active_receipt "$project_state")" || [[ ! -f "$receipt_path" ]]; then
  printf '{"active":false,"projectRoot":"%s"}\n' "$(http_inspector_json_escape "$project_root")"
  exit 0
fi
http_inspector_receipt_load "$receipt_path" || http_inspector_die "Integration receipt is invalid: $receipt_path"
strategy="$RECEIPT_STRATEGY"
[[ -n "$strategy" ]] || strategy="dotnet-ihttpclientfactory-bash-v2"
payload_available=true
if [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" && ! -f "$RECEIPT_ADAPTER_BINARY" ]]; then
  payload_available=false
elif [[ ( "$RECEIPT_SPEC_VERSION" == "3.0.0" || "$RECEIPT_SPEC_VERSION" == "4.0.0" ) && ! -f "$RECEIPT_PACKAGE_FILE" ]]; then
  payload_available=false
fi
printf '{"active":true,"projectRoot":"%s","integrationId":"%s","runId":"%s","state":"%s","strategy":"%s","endpoint":"%s","receipt":"%s","payloadAvailable":%s,"package":{"id":"%s","version":"%s","file":"%s","digest":"%s","feed":"%s"}}\n' \
  "$(http_inspector_json_escape "$RECEIPT_PROJECT_ROOT")" \
  "$(http_inspector_json_escape "dotnet-httpclient:$RECEIPT_RUN_ID")" \
  "$(http_inspector_json_escape "$RECEIPT_RUN_ID")" \
  "$(http_inspector_json_escape "$RECEIPT_STATE")" \
  "$(http_inspector_json_escape "$strategy")" \
  "$(http_inspector_json_escape "$RECEIPT_ENDPOINT")" \
  "$(http_inspector_json_escape "$receipt_path")" \
  "$payload_available" \
  "$(http_inspector_json_escape "$RECEIPT_PACKAGE_ID")" \
  "$(http_inspector_json_escape "$RECEIPT_PACKAGE_VERSION")" \
  "$(http_inspector_json_escape "$RECEIPT_PACKAGE_FILE")" \
  "$(http_inspector_json_escape "$RECEIPT_PACKAGE_DIGEST")" \
  "$(http_inspector_json_escape "$RECEIPT_PACKAGE_FEED")"
