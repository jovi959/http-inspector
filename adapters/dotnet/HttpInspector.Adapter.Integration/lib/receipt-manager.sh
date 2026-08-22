#!/usr/bin/env bash

http_inspector_reset_receipt() {
  RECEIPT_SPEC_VERSION=""
  RECEIPT_RUN_ID=""
  RECEIPT_STATE=""
  RECEIPT_PROJECT_ROOT=""
  RECEIPT_PROJECT_STATE=""
  RECEIPT_STATE_DIRECTORY=""
  RECEIPT_PROJECT_FILE=""
  RECEIPT_COMPOSITION_FILE=""
  RECEIPT_ADAPTER_BINARY=""
  RECEIPT_ADAPTER_ID=""
  RECEIPT_ADAPTER_VERSION=""
  RECEIPT_STRATEGY=""
  RECEIPT_INTEGRATION_PROTOCOL_VERSION=""
  RECEIPT_PAYLOAD_ROOT=""
  RECEIPT_PAYLOAD_DIGEST=""
  RECEIPT_PACKAGE_ID=""
  RECEIPT_PACKAGE_VERSION=""
  RECEIPT_PACKAGE_FILE=""
  RECEIPT_PACKAGE_DIGEST=""
  RECEIPT_PACKAGE_FEED=""
  RECEIPT_ENDPOINT=""
  RECEIPT_COVERAGE_JSON=""
  RECEIPT_CREATED_AT=""
  RECEIPT_PROJECT_BEFORE_HASH=""
  RECEIPT_PROJECT_AFTER_HASH=""
  RECEIPT_PROJECT_BACKUP=""
  RECEIPT_PROJECT_OWNED_HASH=""
  RECEIPT_PROJECT_OWNED_COUNT=""
  RECEIPT_COMPOSITION_BEFORE_HASH=""
  RECEIPT_COMPOSITION_AFTER_HASH=""
  RECEIPT_COMPOSITION_BACKUP=""
  RECEIPT_COMPOSITION_OWNED_HASH=""
  RECEIPT_COMPOSITION_OWNED_COUNT=""
  RECEIPT_ARTIFACT_BASELINE=""
  RECEIPT_DATABASE_CAPTURE_ENABLED=""
  RECEIPT_DATABASE_ADOPTION_ROOT=""
  RECEIPT_DATABASE_CAPTURE_REUSED=""
}

http_inspector_receipt_write() {
  local receipt_path="$1"
  local temporary="${receipt_path}.tmp.$$"
  {
    printf 'spec_version=%s\n' "$RECEIPT_SPEC_VERSION"
    printf 'run_id=%s\n' "$RECEIPT_RUN_ID"
    printf 'state=%s\n' "$RECEIPT_STATE"
    printf 'project_root=%s\n' "$RECEIPT_PROJECT_ROOT"
    printf 'project_state=%s\n' "$RECEIPT_PROJECT_STATE"
    printf 'state_directory=%s\n' "$RECEIPT_STATE_DIRECTORY"
    printf 'project_file=%s\n' "$RECEIPT_PROJECT_FILE"
    printf 'composition_file=%s\n' "$RECEIPT_COMPOSITION_FILE"
    printf 'adapter_binary=%s\n' "$RECEIPT_ADAPTER_BINARY"
    printf 'adapter_id=%s\n' "$RECEIPT_ADAPTER_ID"
    printf 'adapter_version=%s\n' "$RECEIPT_ADAPTER_VERSION"
    printf 'strategy=%s\n' "$RECEIPT_STRATEGY"
    printf 'integration_protocol_version=%s\n' "$RECEIPT_INTEGRATION_PROTOCOL_VERSION"
    printf 'payload_root=%s\n' "$RECEIPT_PAYLOAD_ROOT"
    printf 'payload_digest=%s\n' "$RECEIPT_PAYLOAD_DIGEST"
    printf 'package_id=%s\n' "$RECEIPT_PACKAGE_ID"
    printf 'package_version=%s\n' "$RECEIPT_PACKAGE_VERSION"
    printf 'package_file=%s\n' "$RECEIPT_PACKAGE_FILE"
    printf 'package_digest=%s\n' "$RECEIPT_PACKAGE_DIGEST"
    printf 'package_feed=%s\n' "$RECEIPT_PACKAGE_FEED"
    printf 'endpoint=%s\n' "$RECEIPT_ENDPOINT"
    printf 'coverage_json=%s\n' "$RECEIPT_COVERAGE_JSON"
    printf 'created_at=%s\n' "$RECEIPT_CREATED_AT"
    printf 'project_before_hash=%s\n' "$RECEIPT_PROJECT_BEFORE_HASH"
    printf 'project_after_hash=%s\n' "$RECEIPT_PROJECT_AFTER_HASH"
    printf 'project_backup=%s\n' "$RECEIPT_PROJECT_BACKUP"
    printf 'project_owned_hash=%s\n' "$RECEIPT_PROJECT_OWNED_HASH"
    printf 'project_owned_count=%s\n' "$RECEIPT_PROJECT_OWNED_COUNT"
    printf 'composition_before_hash=%s\n' "$RECEIPT_COMPOSITION_BEFORE_HASH"
    printf 'composition_after_hash=%s\n' "$RECEIPT_COMPOSITION_AFTER_HASH"
    printf 'composition_backup=%s\n' "$RECEIPT_COMPOSITION_BACKUP"
    printf 'composition_owned_hash=%s\n' "$RECEIPT_COMPOSITION_OWNED_HASH"
    printf 'composition_owned_count=%s\n' "$RECEIPT_COMPOSITION_OWNED_COUNT"
    printf 'artifact_baseline=%s\n' "$RECEIPT_ARTIFACT_BASELINE"
    printf 'database_capture_enabled=%s\n' "$RECEIPT_DATABASE_CAPTURE_ENABLED"
    printf 'database_adoption_root=%s\n' "$RECEIPT_DATABASE_ADOPTION_ROOT"
    printf 'database_capture_reused=%s\n' "$RECEIPT_DATABASE_CAPTURE_REUSED"
  } > "$temporary"
  mv -f "$temporary" "$receipt_path"
}

http_inspector_receipt_load() {
  local receipt_path="$1"
  local key value
  [[ -f "$receipt_path" ]] || return 1
  http_inspector_reset_receipt
  while IFS='=' read -r key value || [[ -n "$key" ]]; do
    case "$key" in
      spec_version) RECEIPT_SPEC_VERSION="$value" ;;
      run_id) RECEIPT_RUN_ID="$value" ;;
      state) RECEIPT_STATE="$value" ;;
      project_root) RECEIPT_PROJECT_ROOT="$value" ;;
      project_state) RECEIPT_PROJECT_STATE="$value" ;;
      state_directory) RECEIPT_STATE_DIRECTORY="$value" ;;
      project_file) RECEIPT_PROJECT_FILE="$value" ;;
      composition_file) RECEIPT_COMPOSITION_FILE="$value" ;;
      adapter_binary) RECEIPT_ADAPTER_BINARY="$value" ;;
      adapter_id) RECEIPT_ADAPTER_ID="$value" ;;
      adapter_version) RECEIPT_ADAPTER_VERSION="$value" ;;
      strategy) RECEIPT_STRATEGY="$value" ;;
      integration_protocol_version) RECEIPT_INTEGRATION_PROTOCOL_VERSION="$value" ;;
      payload_root) RECEIPT_PAYLOAD_ROOT="$value" ;;
      payload_digest) RECEIPT_PAYLOAD_DIGEST="$value" ;;
      package_id) RECEIPT_PACKAGE_ID="$value" ;;
      package_version) RECEIPT_PACKAGE_VERSION="$value" ;;
      package_file) RECEIPT_PACKAGE_FILE="$value" ;;
      package_digest) RECEIPT_PACKAGE_DIGEST="$value" ;;
      package_feed) RECEIPT_PACKAGE_FEED="$value" ;;
      endpoint) RECEIPT_ENDPOINT="$value" ;;
      coverage_json) RECEIPT_COVERAGE_JSON="$value" ;;
      created_at) RECEIPT_CREATED_AT="$value" ;;
      project_before_hash) RECEIPT_PROJECT_BEFORE_HASH="$value" ;;
      project_after_hash) RECEIPT_PROJECT_AFTER_HASH="$value" ;;
      project_backup) RECEIPT_PROJECT_BACKUP="$value" ;;
      project_owned_hash) RECEIPT_PROJECT_OWNED_HASH="$value" ;;
      project_owned_count) RECEIPT_PROJECT_OWNED_COUNT="$value" ;;
      composition_before_hash) RECEIPT_COMPOSITION_BEFORE_HASH="$value" ;;
      composition_after_hash) RECEIPT_COMPOSITION_AFTER_HASH="$value" ;;
      composition_backup) RECEIPT_COMPOSITION_BACKUP="$value" ;;
      composition_owned_hash) RECEIPT_COMPOSITION_OWNED_HASH="$value" ;;
      composition_owned_count) RECEIPT_COMPOSITION_OWNED_COUNT="$value" ;;
      artifact_baseline) RECEIPT_ARTIFACT_BASELINE="$value" ;;
      database_capture_enabled) RECEIPT_DATABASE_CAPTURE_ENABLED="$value" ;;
      database_adoption_root) RECEIPT_DATABASE_ADOPTION_ROOT="$value" ;;
      database_capture_reused) RECEIPT_DATABASE_CAPTURE_REUSED="$value" ;;
    esac
  done < "$receipt_path"
  [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" || "$RECEIPT_SPEC_VERSION" == "3.0.0" || "$RECEIPT_SPEC_VERSION" == "4.0.0" || "$RECEIPT_SPEC_VERSION" == "4.1.0" ]] && [[ -n "$RECEIPT_RUN_ID" && -n "$RECEIPT_PROJECT_ROOT" ]]
}

http_inspector_receipt_validate() {
  local receipt_path="$1"
  local expected_project_root="${2:-}"
  [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" || "$RECEIPT_SPEC_VERSION" == "3.0.0" || "$RECEIPT_SPEC_VERSION" == "4.0.0" || "$RECEIPT_SPEC_VERSION" == "4.1.0" ]] || http_inspector_die "Unsupported integration receipt version."
  [[ -z "$expected_project_root" || "$RECEIPT_PROJECT_ROOT" == "$expected_project_root" ]] || http_inspector_die "Receipt belongs to another project."
  http_inspector_is_within "$receipt_path" "$RECEIPT_STATE_DIRECTORY" || http_inspector_die "Receipt is outside its recorded state directory."
  http_inspector_is_within "$RECEIPT_PROJECT_FILE" "$RECEIPT_PROJECT_ROOT" || http_inspector_die "Receipt contains an unsafe project path."
  http_inspector_is_within "$RECEIPT_COMPOSITION_FILE" "$RECEIPT_PROJECT_ROOT" || http_inspector_die "Receipt contains an unsafe composition path."
  http_inspector_is_within "$RECEIPT_PROJECT_BACKUP" "$RECEIPT_STATE_DIRECTORY" || http_inspector_die "Receipt contains an unsafe project backup."
  http_inspector_is_within "$RECEIPT_COMPOSITION_BACKUP" "$RECEIPT_STATE_DIRECTORY" || http_inspector_die "Receipt contains an unsafe composition backup."
  http_inspector_is_within "$RECEIPT_ARTIFACT_BASELINE" "$RECEIPT_STATE_DIRECTORY" || http_inspector_die "Receipt contains an unsafe artifact baseline."
  if [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" ]]; then
    [[ -n "$RECEIPT_ADAPTER_BINARY" ]] || http_inspector_die "Legacy receipt is missing its adapter path."
    ! http_inspector_is_within "$RECEIPT_ADAPTER_BINARY" "$RECEIPT_PROJECT_ROOT" || http_inspector_die "Bundled adapter must remain outside the consuming project."
  else
    if [[ "$RECEIPT_SPEC_VERSION" == "3.0.0" ]]; then
      [[ "$RECEIPT_STRATEGY" == "dotnet-ihttpclientfactory-nuget-bash-v3" ]] || http_inspector_die "Unsupported integration strategy."
    else
      [[ "$RECEIPT_STRATEGY" == "dotnet-multiclient-nuget-bash-v4" ]] || http_inspector_die "Unsupported integration strategy."
    fi
    [[ -n "$RECEIPT_PACKAGE_ID" && -n "$RECEIPT_PACKAGE_VERSION" && -n "$RECEIPT_PACKAGE_FILE" && -n "$RECEIPT_PACKAGE_FEED" ]] || http_inspector_die "Receipt is missing package identity."
    [[ "$RECEIPT_SPEC_VERSION" != "4.0.0" && "$RECEIPT_SPEC_VERSION" != "4.1.0" || -n "$RECEIPT_COVERAGE_JSON" ]] || http_inspector_die "Receipt is missing capture coverage inventory."
    ! http_inspector_is_within "$RECEIPT_PACKAGE_FILE" "$RECEIPT_PROJECT_ROOT" || http_inspector_die "Adapter package must remain outside the consuming project."
    ! http_inspector_is_within "$RECEIPT_PACKAGE_FEED" "$RECEIPT_PROJECT_ROOT" || http_inspector_die "Adapter package feed must remain outside the consuming project."
    http_inspector_is_within "$RECEIPT_PACKAGE_FILE" "$RECEIPT_PACKAGE_FEED" || http_inspector_die "Adapter package must be inside its recorded private feed."
  fi
  if [[ "$RECEIPT_DATABASE_CAPTURE_ENABLED" == "1" ]]; then
    [[ -n "$RECEIPT_DATABASE_ADOPTION_ROOT" ]] || http_inspector_die "Receipt is missing database adoption state."
    http_inspector_is_within "$RECEIPT_DATABASE_ADOPTION_ROOT" "$(dirname "$(dirname "$RECEIPT_PROJECT_STATE")")" || http_inspector_die "Receipt contains an unsafe database adoption path."
  fi
  http_inspector_ensure_separate_roots "$RECEIPT_PROJECT_ROOT" "$RECEIPT_PROJECT_STATE"
}

http_inspector_receipt_validate_runtime() {
  if [[ "$RECEIPT_SPEC_VERSION" == "2.1.0" ]]; then
    [[ -f "$RECEIPT_ADAPTER_BINARY" ]] || http_inspector_die "The recorded bundled adapter is missing: $RECEIPT_ADAPTER_BINARY"
  else
    [[ -f "$RECEIPT_PACKAGE_FILE" && -d "$RECEIPT_PACKAGE_FEED" ]] || http_inspector_die "The recorded adapter package or private feed is missing."
    [[ "$(http_inspector_sha256_file "$RECEIPT_PACKAGE_FILE")" == "$RECEIPT_PACKAGE_DIGEST" ]] || http_inspector_die "The recorded adapter package digest no longer matches."
  fi
}

http_inspector_active_receipt() {
  local pointer="$1/active-receipt"
  [[ -f "$pointer" ]] || return 1
  sed -n '1p' "$pointer"
}
