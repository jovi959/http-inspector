#!/usr/bin/env bash

http_inspector_cleanup_file() {
  local kind="$1"
  local target="$2"
  local backup="$3"
  local before_hash="$4"
  local after_hash="$5"
  local owned_hash="$6"
  local owned_count="$7"
  local run_id="$8"
  local work_directory="$9"
  local current_hash extracted count_file actual_count actual_owned_hash cleaned newline_style

  [[ -f "$target" ]] || return 2
  current_hash="$(http_inspector_sha256_file "$target")"
  if [[ "$current_hash" == "$before_hash" ]]; then
    return 0
  fi
  if [[ "$current_hash" == "$after_hash" ]]; then
    [[ -f "$backup" && "$(http_inspector_sha256_file "$backup")" == "$before_hash" ]] || return 3
    http_inspector_atomic_copy "$backup" "$target"
    return 0
  fi

  extracted="$work_directory/${kind}-owned-current.txt"
  count_file="$work_directory/${kind}-owned-current.count"
  if ! http_inspector_extract_owned_blocks "$target" "$extracted" "$count_file" "$run_id"; then
    return 4
  fi
  actual_count="$(sed -n '1p' "$count_file")"
  actual_owned_hash="$(http_inspector_sha256_file "$extracted")"
  [[ "$actual_count" == "$owned_count" && "$actual_owned_hash" == "$owned_hash" ]] || return 4

  cleaned="$work_directory/${kind}-cleaned"
  if [[ "$kind" == "project" ]]; then
    http_inspector_remove_project_blocks "$target" "$cleaned" "$run_id" || return 4
  elif [[ "$RECEIPT_STRATEGY" == "dotnet-multiclient-nuget-bash-v4" ]]; then
    http_inspector_remove_service_registration_blocks "$target" "$cleaned" "$run_id" "$owned_count" || return 4
  else
    newline_style="$(http_inspector_detect_newline "$target")"
    http_inspector_remove_composition_blocks "$target" "$cleaned" "$run_id" "$owned_count" "$newline_style" || return 4
  fi
  http_inspector_atomic_copy "$cleaned" "$target"
  return 0
}

http_inspector_cleanup_receipt() {
  local receipt_path="$1"
  local expected_project_root="${2:-}"
  local project_result=0
  local composition_result=0
  local pointer active_value

  if ! http_inspector_receipt_load "$receipt_path"; then
    echo "No active temporary integration was found."
    return 0
  fi
  http_inspector_receipt_validate "$receipt_path" "$expected_project_root"
  RECEIPT_STATE="cleaning"
  http_inspector_receipt_write "$receipt_path"

  http_inspector_cleanup_file project "$RECEIPT_PROJECT_FILE" "$RECEIPT_PROJECT_BACKUP" "$RECEIPT_PROJECT_BEFORE_HASH" "$RECEIPT_PROJECT_AFTER_HASH" "$RECEIPT_PROJECT_OWNED_HASH" "$RECEIPT_PROJECT_OWNED_COUNT" "$RECEIPT_RUN_ID" "$RECEIPT_STATE_DIRECTORY" || project_result=$?
  http_inspector_cleanup_file composition "$RECEIPT_COMPOSITION_FILE" "$RECEIPT_COMPOSITION_BACKUP" "$RECEIPT_COMPOSITION_BEFORE_HASH" "$RECEIPT_COMPOSITION_AFTER_HASH" "$RECEIPT_COMPOSITION_OWNED_HASH" "$RECEIPT_COMPOSITION_OWNED_COUNT" "$RECEIPT_RUN_ID" "$RECEIPT_STATE_DIRECTORY" || composition_result=$?

  if [[ $project_result -ne 0 || $composition_result -ne 0 ]]; then
    RECEIPT_STATE="cleanupRequired"
    http_inspector_receipt_write "$receipt_path"
    echo "Cleanup requires attention. No ambiguous developer changes were overwritten." >&2
    [[ $project_result -eq 0 ]] || echo "- Project integration block changed or could not be restored: $RECEIPT_PROJECT_FILE" >&2
    [[ $composition_result -eq 0 ]] || echo "- Composition integration block changed or could not be restored: $RECEIPT_COMPOSITION_FILE" >&2
    echo "Receipt retained at: $receipt_path" >&2
    return 1
  fi

  [[ -f "$RECEIPT_ARTIFACT_BASELINE" ]] && http_inspector_cleanup_new_artifacts "$RECEIPT_PROJECT_ROOT" "$RECEIPT_ARTIFACT_BASELINE"
  RECEIPT_STATE="clean"
  http_inspector_receipt_write "$receipt_path"
  pointer="$RECEIPT_PROJECT_STATE/active-receipt"
  if [[ -f "$pointer" ]]; then
    active_value="$(sed -n '1p' "$pointer")"
    [[ "$active_value" != "$receipt_path" ]] || rm -f "$pointer"
  fi
  http_inspector_safe_remove_run_directory "$RECEIPT_STATE_DIRECTORY" "$RECEIPT_PROJECT_STATE"
  echo "Temporary HTTP Inspector integration was removed. Restored the recorded project and composition files."
}
