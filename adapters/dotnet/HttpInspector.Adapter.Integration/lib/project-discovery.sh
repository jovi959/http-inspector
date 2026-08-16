#!/usr/bin/env bash

http_inspector_resolve_project_file() {
  local project_root="$1"
  local requested="${2:-}"
  local candidate
  local projects=()

  if [[ -n "$requested" ]]; then
    candidate="$requested"
    [[ "$candidate" == /* ]] || candidate="$project_root/$candidate"
    candidate="$(http_inspector_canonical_file "$candidate")"
    [[ "$candidate" == *.csproj ]] || http_inspector_die "Selected project file is not a .csproj: $candidate"
    http_inspector_is_within "$candidate" "$project_root" || http_inspector_die "Selected project file is outside the project root."
    printf '%s\n' "$candidate"
    return
  fi

  while IFS= read -r candidate; do
    http_inspector_reject_multiline "Project path" "$candidate"
    projects+=("$candidate")
  done < <(find "$project_root" \( -type d \( -name bin -o -name obj -o -name .git \) -prune \) -o -type f -name '*.csproj' -print)

  [[ ${#projects[@]} -gt 0 ]] || http_inspector_die "No .NET project was found. This adapter did not modify the project."
  [[ ${#projects[@]} -eq 1 ]] || http_inspector_die "Multiple .NET projects were found. Select one with --project-file."
  http_inspector_canonical_file "${projects[0]}"
}

http_inspector_project_directory() {
  local project_file="$1"
  http_inspector_canonical_directory "$(dirname "$project_file")"
}

http_inspector_validate_target_framework() {
  local project_file="$1"
  local compact
  compact="$(LC_ALL=C tr -d '[:space:]' < "$project_file")"
  case "$compact" in
    *'<TargetFramework>net10.0</TargetFramework>'*|*'<TargetFrameworks>'*'net10.0'*'</TargetFrameworks>'*) ;;
    *) http_inspector_die "The current adapter targets net10.0. This strategy will not inject into a different target framework." ;;
  esac
}

http_inspector_resolve_composition_file() {
  local project_directory="$1"
  local candidate
  local candidates=()

  while IFS= read -r candidate; do
    if LC_ALL=C grep -Eq '(^|[^[:alnum:]_])(services|builder[[:space:]]*\.[[:space:]]*Services)[[:space:]]*\.[[:space:]]*Add[[:alnum:]_]*[[:space:]]*\(' "$candidate"; then
      candidates+=("$candidate")
    fi
  done < <(find "$project_directory" \( -type d \( -name bin -o -name obj -o -name .git \) -prune \) -o -type f \( -name 'Program.cs' -o -name 'Startup.cs' \) -print)

  [[ ${#candidates[@]} -gt 0 ]] || http_inspector_die "No conventional Program.cs or Startup.cs with an IServiceCollection registration was found in the selected project directory."
  [[ ${#candidates[@]} -eq 1 ]] || http_inspector_die "Multiple composition roots contain service registrations in the selected project directory. Select the executable host project; this bounded strategy made no changes."
  http_inspector_canonical_file "${candidates[0]}"
}

http_inspector_validate_unintegrated_project() {
  local project_file="$1"
  local composition_file="$2"
  if LC_ALL=C grep -Eq 'HttpInspector\.Adapter|HTTP_INSPECTOR_INJECTION:' "$project_file"; then
    http_inspector_die "The project file already contains HTTP Inspector integration or markers: $project_file"
  fi
  if LC_ALL=C grep -Eq 'HttpInspector\.Adapter|AddHttpInspectorAdapter|HTTP_INSPECTOR_INJECTION:' "$composition_file"; then
    http_inspector_die "The composition root already contains HTTP Inspector integration or markers: $composition_file"
  fi
  if LC_ALL=C grep -q '"""' "$composition_file"; then
    http_inspector_die "The bounded Bash strategy does not edit a composition root containing C# raw string literals."
  fi
}

http_inspector_emit_coverage_item() {
  local project_root="$1"
  local family="$2"
  local bridge="$3"
  local source_edits_required="$4"
  local note="$5"
  local expression="$6"
  local location relative separator="" count=0 locations_json="" listed_count=0

  while IFS= read -r location; do
    [[ -n "$location" ]] || continue
    relative="${location#"$project_root"/}"
    ((count += 1))
    # The preview stays readable on large solutions while its count still reports every matching call site.
    if [[ $listed_count -lt 20 ]]; then
      locations_json+="$separator\"$(http_inspector_json_escape "$relative")\""
      separator=","
      ((listed_count += 1))
    fi
  done < <(LC_ALL=C grep -r -n -E --include='*.cs' --exclude-dir=bin --exclude-dir=obj --exclude-dir=.git "$expression" "$project_root" 2>/dev/null || true)

  printf '{"family":"%s","bridge":"%s","sourceEditsRequired":%s,"count":%s,"locations":[' \
    "$(http_inspector_json_escape "$family")" "$(http_inspector_json_escape "$bridge")" "$source_edits_required" "$count"
  printf '%s],"note":"%s"}' "$locations_json" "$(http_inspector_json_escape "$note")"
}

http_inspector_coverage_inventory() {
  local project_root="$1"
  local separator=""
  local item
  local families=(
    'IHttpClientFactory|HttpClient factory filter|false|All named and typed factory clients are observed once after application handlers.|AddHttpClient|IHttpClientFactory'
    'Refit|HttpClient factory filter|false|Refit uses the HttpClient factory, so one host registration covers Refit clients.|AddRefitClient'
    'RestSharp|System.Net.Http diagnostic bridge|false|Direct RestSharp calls are observed without editing request methods.|RestClient|RestRequest'
    'Direct HttpClient|System.Net.Http diagnostic bridge|false|Direct HttpClient construction is observed without replacing individual calls.|new[[:space:]]+HttpClient'
    'WCF SOAP|HTTP diagnostic bridge or explicit WCF attach|true|HTTP WCF is covered by its underlying HTTP transport; non-HTTP WCF requires an explicit HttpInspectorWcf.Attach call and is listed for review.|ClientBase[[:space:]]*<|new[[:space:]]+[[:alnum:]_]*Client[[:space:]]*\\('
  )

  printf '['
  for item in "${families[@]}"; do
    IFS='|' read -r family bridge source_edits_required note expression <<< "$item"
    printf '%s' "$separator"
    http_inspector_emit_coverage_item "$project_root" "$family" "$bridge" "$source_edits_required" "$note" "$expression"
    separator=","
  done
  printf ']'
}
