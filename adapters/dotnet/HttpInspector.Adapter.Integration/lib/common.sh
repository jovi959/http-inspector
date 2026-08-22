#!/usr/bin/env bash

http_inspector_die() {
  echo "Error: $*" >&2
  exit 1
}

http_inspector_require_value() {
  [[ $# -ge 2 && -n "$2" ]] || http_inspector_die "$1 requires a value."
}

http_inspector_reject_multiline() {
  case "$2" in
    *$'\n'*|*$'\r'*) http_inspector_die "$1 cannot contain a line break." ;;
  esac
}

http_inspector_canonical_directory() {
  local path="$1"
  [[ -d "$path" ]] || http_inspector_die "Directory does not exist: $path"
  (cd "$path" 2>/dev/null && pwd -P) || http_inspector_die "Cannot resolve directory: $path"
}

http_inspector_canonical_file() {
  local path="$1"
  local directory
  [[ -f "$path" ]] || http_inspector_die "File does not exist: $path"
  directory="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || http_inspector_die "Cannot resolve file: $path"
  printf '%s/%s\n' "$directory" "$(basename "$path")"
}

http_inspector_default_state_root() {
  if [[ "${OSTYPE:-}" == darwin* ]]; then
    printf '%s\n' "${HOME:?}/Library/Application Support/HTTP Inspector"
    return
  fi

  if [[ -n "${LOCALAPPDATA:-}" ]]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -u "$LOCALAPPDATA/HTTP Inspector"
    else
      printf '%s\n' "$LOCALAPPDATA/HTTP Inspector"
    fi
    return
  fi

  printf '%s\n' "${XDG_STATE_HOME:-${HOME:?}/.local/state}/http-inspector"
}

http_inspector_is_within() {
  local candidate="${1%/}"
  local root="${2%/}"
  [[ "$candidate" == "$root" ]] && return 0
  case "$candidate" in
    "$root"/*) return 0 ;;
  esac
  return 1
}

http_inspector_ensure_separate_roots() {
  local project_root="${1%/}"
  local state_root="${2%/}"
  [[ -n "$project_root" && -n "$state_root" ]] || http_inspector_die "Project and state roots are required."
  [[ "$project_root" != "/" && "$state_root" != "/" ]] || http_inspector_die "Project and state roots cannot be filesystem roots."
  if http_inspector_is_within "$project_root" "$state_root" || http_inspector_is_within "$state_root" "$project_root"; then
    http_inspector_die "Integration state must be outside the project and must not be an ancestor of it."
  fi
}

http_inspector_sha256_stream() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}'
  else
    http_inspector_die "A SHA-256 command is required (sha256sum, shasum, or openssl)."
  fi
}

http_inspector_sha256_file() {
  [[ -f "$1" ]] || http_inspector_die "Cannot hash missing file: $1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    http_inspector_die "A SHA-256 command is required (sha256sum, shasum, or openssl)."
  fi
}

http_inspector_project_key() {
  printf '%s' "$1" | http_inspector_sha256_stream
}

http_inspector_generate_run_id() {
  local value digest
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
    return
  fi
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid
    return
  fi
  value="$(date -u '+%Y%m%d%H%M%S'):${PPID}:$$:${RANDOM}:${RANDOM}"
  digest="$(printf '%s' "$value" | http_inspector_sha256_stream)"
  printf '%s-%s-%s-%s-%s\n' "${digest:0:8}" "${digest:8:4}" "${digest:12:4}" "${digest:16:4}" "${digest:20:12}"
}

http_inspector_detect_newline() {
  local line carriage_return=$'\r'
  # Git Bash tools can transparently translate CRLF to LF before grep/awk sees it. Bash's
  # `read -r` preserves the carriage return, so use it for a stable cross-platform result.
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == *"$carriage_return" ]]; then
      printf 'crlf\n'
      return
    fi
  done < "$1"
  printf 'lf\n'
}

http_inspector_msbuild_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s\n' "$1"
  fi
}

http_inspector_xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s\n' "$value"
}

http_inspector_atomic_copy() {
  local source="$1"
  local target="$2"
  local temporary
  temporary="$(dirname "$target")/.http-inspector.$$.tmp"
  cp "$source" "$temporary"
  mv -f "$temporary" "$target"
}

http_inspector_write_pointer() {
  local target="$1"
  local value="$2"
  local temporary="${target}.tmp.$$"
  printf '%s\n' "$value" > "$temporary"
  mv -f "$temporary" "$target"
}

http_inspector_acquire_lock() {
  local project_state="$1"
  local lock_directory="$project_state/lock"
  local existing_pid=""
  mkdir -p "$project_state"
  if ! mkdir "$lock_directory" 2>/dev/null; then
    [[ -f "$lock_directory/pid" ]] && existing_pid="$(sed -n '1p' "$lock_directory/pid")"
    if [[ -n "$existing_pid" ]] && ! kill -0 "$existing_pid" 2>/dev/null; then
      rm -f "$lock_directory/pid"
      rmdir "$lock_directory" 2>/dev/null || true
      mkdir "$lock_directory" 2>/dev/null || http_inspector_die "Another integration operation is active."
    else
      http_inspector_die "Another integration operation is active."
    fi
  fi
  printf '%s\n' "$$" > "$lock_directory/pid"
  HTTP_INSPECTOR_LOCK_DIRECTORY="$lock_directory"
}

http_inspector_release_lock() {
  if [[ -n "${HTTP_INSPECTOR_LOCK_DIRECTORY:-}" ]]; then
    rm -f "$HTTP_INSPECTOR_LOCK_DIRECTORY/pid"
    rmdir "$HTTP_INSPECTOR_LOCK_DIRECTORY" 2>/dev/null || true
    HTTP_INSPECTOR_LOCK_DIRECTORY=""
  fi
}

http_inspector_safe_remove_run_directory() {
  local run_directory="${1%/}"
  local project_state="${2%/}"
  case "$run_directory" in
    "$project_state"/runs/*) rm -rf "$run_directory" ;;
    *) http_inspector_die "Refusing to remove an unsafe integration directory: $run_directory" ;;
  esac
}

http_inspector_json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}
