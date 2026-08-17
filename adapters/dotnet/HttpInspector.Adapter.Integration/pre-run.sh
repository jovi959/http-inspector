#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
package_id="HttpInspector.Adapter"
package_version="1.3.3"
package_feed="$script_dir/../HttpInspector.Adapter/bundle/nuget-feed"
package_file="$package_feed/$package_id.$package_version.nupkg"
package_digest_file="$package_file.sha256"
payload_root="$(cd "$script_dir/.." && pwd -P)"
payload_digest=""
project_root=""
selection_root=""
project_file_option=""
endpoint="ws://127.0.0.1:53662/v1/capture"
state_root=""
dry_run=0
json_output=0
completed=0
active_receipt=""
current_run_directory=""

source "$script_dir/lib/common.sh"
source "$script_dir/lib/receipt-manager.sh"
source "$script_dir/lib/project-discovery.sh"
source "$script_dir/lib/mutation-planner.sh"
source "$script_dir/lib/cleanup-engine.sh"

usage() {
  echo "Usage: $0 --project <path> [--project-file <relative.csproj>] [--endpoint ws://127.0.0.1:53662/v1/capture] [--state-root <external-path>] [--package-file <path>] [--package-id <id>] [--package-version <version>] [--payload-root <path>] [--payload-digest <sha256>] [--dry-run] [--json]" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      http_inspector_require_value "$1" "${2:-}"
      project_root="$2"
      shift 2
      ;;
    --project-file)
      http_inspector_require_value "$1" "${2:-}"
      project_file_option="$2"
      shift 2
      ;;
    --endpoint)
      http_inspector_require_value "$1" "${2:-}"
      endpoint="$2"
      shift 2
      ;;
    --state-root)
      http_inspector_require_value "$1" "${2:-}"
      state_root="$2"
      shift 2
      ;;
    --package-file)
      http_inspector_require_value "$1" "${2:-}"
      package_file="$2"
      package_digest_file="$2.sha256"
      shift 2
      ;;
    --package-id)
      http_inspector_require_value "$1" "${2:-}"
      package_id="$2"
      shift 2
      ;;
    --package-version)
      http_inspector_require_value "$1" "${2:-}"
      package_version="$2"
      shift 2
      ;;
    --payload-root)
      http_inspector_require_value "$1" "${2:-}"
      payload_root="$2"
      shift 2
      ;;
    --payload-digest)
      http_inspector_require_value "$1" "${2:-}"
      payload_digest="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --json)
      json_output=1
      shift
      ;;
    --skip-build)
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

[[ -n "$project_root" ]] || { usage; http_inspector_die "--project is required."; }
http_inspector_reject_multiline "Endpoint" "$endpoint"
case "$endpoint" in
  ws://*|wss://*) ;;
  *) http_inspector_die "Endpoint must use ws:// or wss://." ;;
esac

selection_root="$(http_inspector_canonical_directory "$project_root")"
[[ -f "$package_file" ]] || http_inspector_die "Bundled adapter package is missing. Build the HTTP Inspector distribution on the packaging machine."
[[ -f "$package_digest_file" ]] || http_inspector_die "Bundled adapter package digest is missing: $package_digest_file"
package_file="$(http_inspector_canonical_file "$package_file")"
package_feed="$(http_inspector_canonical_directory "$(dirname "$package_file")")"
payload_root="$(http_inspector_canonical_directory "$payload_root")"
package_digest="$(sed -n '1{s/[[:space:]].*$//;p;}' "$package_digest_file")"
[[ -n "$package_digest" && "$(http_inspector_sha256_file "$package_file")" == "$package_digest" ]] || http_inspector_die "Bundled adapter package digest does not match."
[[ -n "$payload_digest" ]] || payload_digest="$(printf '%s' "$package_digest:$package_id:$package_version" | http_inspector_sha256_stream)"
! http_inspector_is_within "$package_file" "$selection_root" || http_inspector_die "Bundled adapter package must remain outside the consuming project."
project_file="$(http_inspector_resolve_project_file "$selection_root" "$project_file_option")"
project_root="$(http_inspector_project_directory "$project_file")"
http_inspector_validate_target_framework "$project_file"
composition_file="$(http_inspector_resolve_composition_file "$project_root")"
http_inspector_validate_unintegrated_project "$project_file" "$composition_file"
coverage="$(http_inspector_coverage_inventory "$project_root")"
run_id="$(http_inspector_generate_run_id)"
package_feed_msbuild_path="$(http_inspector_msbuild_path "$package_feed")"
package_feed_msbuild_path="$(http_inspector_xml_escape "$package_feed_msbuild_path")"

echo "HTTP Inspector temporary integration $([[ $dry_run -eq 1 ]] && printf 'dry run' || printf 'plan'):" >&2
echo "- Detected .NET project: $project_file" >&2
echo "- Detected executable service-registration root: $composition_file" >&2
echo "- Selected strategy: dotnet-multiclient-nuget-bash-v4" >&2
echo "- Bundled adapter package: $package_file" >&2
echo "- Private package feed: $package_feed" >&2
echo "- Endpoint: $endpoint" >&2
echo "- Modify: $project_file" >&2
echo "  <PackageReference Include=\"$package_id\" Version=\"$package_version\" PrivateAssets=\"all\" />" >&2
echo "- Modify: $composition_file" >&2
echo "  using HttpInspector.Adapter;" >&2
echo "  services.AddHttpInspectorAdapter(); or builder.Services.AddHttpInspectorAdapter();" >&2

if [[ $dry_run -eq 1 ]]; then
  echo "Dry run complete. No project or integration-state bytes were changed." >&2
  if [[ $json_output -eq 1 ]]; then
    printf '{"ok":true,"dryRun":true,"projectRoot":"%s","projectFile":"%s","compositionFile":"%s","strategy":"dotnet-multiclient-nuget-bash-v4","coverage":%s,"package":{"id":"%s","version":"%s","file":"%s","digest":"%s","feed":"%s"}}\n' \
      "$(http_inspector_json_escape "$project_root")" "$(http_inspector_json_escape "$project_file")" "$(http_inspector_json_escape "$composition_file")" \
      "$coverage" \
      "$(http_inspector_json_escape "$package_id")" "$(http_inspector_json_escape "$package_version")" "$(http_inspector_json_escape "$package_file")" \
      "$(http_inspector_json_escape "$package_digest")" "$(http_inspector_json_escape "$package_feed")"
  fi
  exit 0
fi

state_root="${state_root:-$(http_inspector_default_state_root)}"
http_inspector_reject_multiline "State root" "$state_root"
mkdir -p "$state_root"
state_root="$(http_inspector_canonical_directory "$state_root")"
http_inspector_ensure_separate_roots "$project_root" "$state_root"
project_state="$state_root/integrations/$(http_inspector_project_key "$project_root")"
mkdir -p "$project_state/runs"
http_inspector_acquire_lock "$project_state"

cleanup_on_exit() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  if [[ $completed -eq 0 && -n "$active_receipt" && -f "$active_receipt" ]]; then
    echo "Pre-run failed. Restoring the recorded source files." >&2
    http_inspector_cleanup_receipt "$active_receipt" "$project_root" >&2
  elif [[ $completed -eq 0 && -n "$current_run_directory" && -d "$current_run_directory" ]]; then
    http_inspector_safe_remove_run_directory "$current_run_directory" "$project_state"
  fi
  http_inspector_release_lock
  exit "$status"
}
trap cleanup_on_exit EXIT INT TERM

if previous_receipt="$(http_inspector_active_receipt "$project_state")"; then
  echo "Recovering previous temporary integration: $previous_receipt" >&2
  if [[ -f "$previous_receipt" ]]; then
    http_inspector_cleanup_receipt "$previous_receipt" "$project_root" >&2
  else
    rm -f "$project_state/active-receipt"
  fi
  composition_file="$(http_inspector_resolve_composition_file "$project_root")"
  http_inspector_validate_unintegrated_project "$project_file" "$composition_file"
fi

run_directory="$project_state/runs/$run_id"
current_run_directory="$run_directory"
backups_directory="$run_directory/backups"
mkdir -p "$backups_directory"
project_backup="$backups_directory/project.backup"
composition_backup="$backups_directory/composition.backup"
cp "$project_file" "$project_backup"
cp "$composition_file" "$composition_backup"

project_newline_style="$(http_inspector_detect_newline "$project_file")"
composition_newline_style="$(http_inspector_detect_newline "$composition_file")"
project_newline=$'\n'
composition_newline=$'\n'
[[ "$project_newline_style" != "crlf" ]] || project_newline=$'\r\n'
[[ "$composition_newline_style" != "crlf" ]] || composition_newline=$'\r\n'

project_block="$run_directory/project-block.txt"
project_injected="$run_directory/project.injected"
registration_injected="$run_directory/composition.registered"
registration_count_file="$run_directory/registration.count"
import_block="$run_directory/import-block.txt"
composition_injected="$run_directory/composition.injected"
http_inspector_render_template "$script_dir/templates/nuget-package-reference.xml" "$project_block" "$project_newline" "$run_id" "" "" "$package_feed_msbuild_path" "$package_id" "$package_version"
http_inspector_inject_project_reference "$project_backup" "$project_injected" "$project_block"
http_inspector_inject_service_registration "$composition_backup" "$registration_injected" "$registration_count_file" "$run_id" "$composition_newline_style"
http_inspector_render_template "$script_dir/templates/import.cs.txt" "$import_block" "$composition_newline" "$run_id"
http_inspector_prepend_file "$import_block" "$registration_injected" "$composition_injected"

project_owned="$run_directory/project-owned.txt"
project_owned_count_file="$run_directory/project-owned.count"
composition_owned="$run_directory/composition-owned.txt"
composition_owned_count_file="$run_directory/composition-owned.count"
http_inspector_extract_owned_blocks "$project_injected" "$project_owned" "$project_owned_count_file" "$run_id"
http_inspector_extract_owned_blocks "$composition_injected" "$composition_owned" "$composition_owned_count_file" "$run_id"
artifact_baseline="$run_directory/artifacts-before.txt"
http_inspector_record_artifact_baseline "$project_root" "$artifact_baseline"

http_inspector_reset_receipt
RECEIPT_SPEC_VERSION="4.0.0"
RECEIPT_RUN_ID="$run_id"
RECEIPT_STATE="preparing"
RECEIPT_PROJECT_ROOT="$project_root"
RECEIPT_PROJECT_STATE="$project_state"
RECEIPT_STATE_DIRECTORY="$run_directory"
RECEIPT_PROJECT_FILE="$project_file"
RECEIPT_COMPOSITION_FILE="$composition_file"
RECEIPT_ADAPTER_ID="dotnet-httpclient"
RECEIPT_ADAPTER_VERSION="$package_version"
RECEIPT_STRATEGY="dotnet-multiclient-nuget-bash-v4"
RECEIPT_INTEGRATION_PROTOCOL_VERSION="1.0.0"
RECEIPT_PAYLOAD_ROOT="$payload_root"
RECEIPT_PAYLOAD_DIGEST="$payload_digest"
RECEIPT_PACKAGE_ID="$package_id"
RECEIPT_PACKAGE_VERSION="$package_version"
RECEIPT_PACKAGE_FILE="$package_file"
RECEIPT_PACKAGE_DIGEST="$package_digest"
RECEIPT_PACKAGE_FEED="$package_feed"
RECEIPT_ENDPOINT="$endpoint"
RECEIPT_COVERAGE_JSON="$coverage"
RECEIPT_CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
RECEIPT_PROJECT_BEFORE_HASH="$(http_inspector_sha256_file "$project_backup")"
RECEIPT_PROJECT_AFTER_HASH="$(http_inspector_sha256_file "$project_injected")"
RECEIPT_PROJECT_BACKUP="$project_backup"
RECEIPT_PROJECT_OWNED_HASH="$(http_inspector_sha256_file "$project_owned")"
RECEIPT_PROJECT_OWNED_COUNT="$(sed -n '1p' "$project_owned_count_file")"
RECEIPT_COMPOSITION_BEFORE_HASH="$(http_inspector_sha256_file "$composition_backup")"
RECEIPT_COMPOSITION_AFTER_HASH="$(http_inspector_sha256_file "$composition_injected")"
RECEIPT_COMPOSITION_BACKUP="$composition_backup"
RECEIPT_COMPOSITION_OWNED_HASH="$(http_inspector_sha256_file "$composition_owned")"
RECEIPT_COMPOSITION_OWNED_COUNT="$(sed -n '1p' "$composition_owned_count_file")"
RECEIPT_ARTIFACT_BASELINE="$artifact_baseline"
active_receipt="$run_directory/integration-receipt.env"
http_inspector_receipt_write "$active_receipt"
http_inspector_write_pointer "$project_state/active-receipt" "$active_receipt"

http_inspector_atomic_copy "$project_injected" "$project_file"
http_inspector_atomic_copy "$composition_injected" "$composition_file"
RECEIPT_STATE="active"
http_inspector_receipt_write "$active_receipt"
completed=1
http_inspector_release_lock
trap - EXIT INT TERM

echo "Temporary integration is active. Endpoint: $endpoint" >&2
echo "The integration script did not invoke dotnet or NuGet." >&2
echo "Cleanup command: $script_dir/post-run.sh --receipt \"$active_receipt\"" >&2
if [[ $json_output -eq 1 ]]; then
  printf '{"ok":true,"active":true,"projectRoot":"%s","integrationId":"%s","runId":"%s","state":"active","strategy":"%s","receipt":"%s"}\n' \
    "$(http_inspector_json_escape "$project_root")" "$(http_inspector_json_escape "dotnet-httpclient:$run_id")" "$(http_inspector_json_escape "$run_id")" \
    "$(http_inspector_json_escape "$RECEIPT_STRATEGY")" "$(http_inspector_json_escape "$active_receipt")"
else
  printf '%s\n' "$active_receipt"
fi
