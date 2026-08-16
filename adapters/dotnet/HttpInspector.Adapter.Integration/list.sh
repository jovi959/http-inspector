#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
state_root=""

source "$script_dir/lib/common.sh"
source "$script_dir/lib/receipt-manager.sh"

usage() {
  echo "Usage: $0 [--state-root <external-path>] --json" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state-root) http_inspector_require_value "$1" "${2:-}"; state_root="$2"; shift 2 ;;
    --json) shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; http_inspector_die "Unsupported option: $1" ;;
  esac
done

state_root="${state_root:-$(http_inspector_default_state_root)}"
if [[ ! -d "$state_root" ]]; then
  printf '{"ok":true,"integrations":[]}\n'
  exit 0
fi
state_root="$(http_inspector_canonical_directory "$state_root")"
printf '{"ok":true,"integrations":['
separator=""
while IFS= read -r pointer; do
  receipt_path="$(sed -n '1p' "$pointer")"
  project_state="$(dirname "$pointer")"
  validity="valid"
  active=true
  state="missingReceipt"
  project_root=""
  run_id=""
  strategy=""
  payload_root=""
  payload_digest=""
  payload_available=false
  case "$receipt_path" in
    "$project_state"/runs/*/integration-receipt.env) ;;
    *) validity="invalidReceipt" ;;
  esac
  if [[ "$validity" == "valid" && -f "$receipt_path" ]] && http_inspector_receipt_load "$receipt_path"; then
    project_root="$RECEIPT_PROJECT_ROOT"
    run_id="$RECEIPT_RUN_ID"
    state="$RECEIPT_STATE"
    strategy="$RECEIPT_STRATEGY"
    payload_root="$RECEIPT_PAYLOAD_ROOT"
    payload_digest="$RECEIPT_PAYLOAD_DIGEST"
    [[ -n "$strategy" ]] || strategy="dotnet-ihttpclientfactory-bash-v2"
    if [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" && -f "$RECEIPT_ADAPTER_BINARY" ]]; then
      payload_available=true
    elif [[ ( "$RECEIPT_SPEC_VERSION" == "3.0.0" || "$RECEIPT_SPEC_VERSION" == "4.0.0" ) && -f "$RECEIPT_PACKAGE_FILE" ]]; then
      payload_available=true
    fi
    [[ -d "$project_root" ]] || state="missingProject"
  else
    validity="invalidReceipt"
  fi
  printf '%s{"integrationId":"%s","projectRoot":"%s","runId":"%s","state":"%s","strategy":"%s","receiptStatus":"%s","active":%s,"payloadAvailable":%s,"payloadRoot":"%s","payloadDigest":"%s"}' \
    "$separator" "$(http_inspector_json_escape "dotnet-httpclient:$run_id")" "$(http_inspector_json_escape "$project_root")" \
    "$(http_inspector_json_escape "$run_id")" "$(http_inspector_json_escape "$state")" "$(http_inspector_json_escape "$strategy")" \
    "$(http_inspector_json_escape "$validity")" "$active" "$payload_available" \
    "$(http_inspector_json_escape "$payload_root")" "$(http_inspector_json_escape "$payload_digest")"
  separator=","
done < <(find "$state_root/integrations" -mindepth 2 -maxdepth 2 -type f -name active-receipt 2>/dev/null | LC_ALL=C sort)
printf ']}\n'
