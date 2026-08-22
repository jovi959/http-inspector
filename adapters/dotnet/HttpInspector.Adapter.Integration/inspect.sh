#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
project_root=""
project_file=""
endpoint="ws://127.0.0.1:53662/v1/capture"
state_root=""
database_result_capture=0

source "$script_dir/lib/common.sh"

usage() {
  echo "Usage: $0 --project <path> [--project-file <relative.csproj>] [--endpoint ws://127.0.0.1:53662/v1/capture] [--state-root <external-path>] [--database-result-capture] --json" >&2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) http_inspector_require_value "$1" "${2:-}"; project_root="$2"; shift 2 ;;
    --project-file) http_inspector_require_value "$1" "${2:-}"; project_file="$2"; shift 2 ;;
    --endpoint) http_inspector_require_value "$1" "${2:-}"; endpoint="$2"; shift 2 ;;
    --state-root) http_inspector_require_value "$1" "${2:-}"; state_root="$2"; shift 2 ;;
    --database-result-capture) database_result_capture=1; shift ;;
    --json) shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; http_inspector_die "Unsupported option: $1" ;;
  esac
done

[[ -n "$project_root" ]] || { usage; http_inspector_die "--project is required."; }
project_root="$(http_inspector_canonical_directory "$project_root")"
if [[ -z "$project_file" ]]; then
  project_choices=()
  while IFS= read -r candidate; do
    project_choices+=("$candidate")
  done < <(find "$project_root" \( -type d \( -name bin -o -name obj -o -name .git \) -prune \) -o -type f -name '*.csproj' -print | LC_ALL=C sort)
  if [[ ${#project_choices[@]} -gt 1 ]]; then
    printf '{"ok":true,"choiceRequired":true,"projectRoot":"%s","choices":[' "$(http_inspector_json_escape "$project_root")"
    separator=""
    for candidate in "${project_choices[@]}"; do
      relative="${candidate#"$project_root"/}"
      printf '%s{"projectFile":"%s","label":"%s"}' "$separator" "$(http_inspector_json_escape "$relative")" "$(http_inspector_json_escape "$relative")"
      separator="," 
    done
    printf ']}\n'
    exit 0
  fi
fi

arguments=(--project "$project_root" --endpoint "$endpoint" --dry-run --json)
[[ -z "$project_file" ]] || arguments+=(--project-file "$project_file")
[[ -z "$state_root" ]] || arguments+=(--state-root "$state_root")
[[ $database_result_capture -eq 0 ]] || arguments+=(--database-result-capture)
exec "$script_dir/pre-run.sh" "${arguments[@]}"
