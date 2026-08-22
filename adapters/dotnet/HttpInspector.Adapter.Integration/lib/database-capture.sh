#!/usr/bin/env bash

# The database result path is deliberately narrow. It changes only verified Dapper scopes and
# verified terminal raw ADO.NET calls owned by a conventional DBFactory.

DATABASE_CAPTURE_PROJECT_FILE=""
DATABASE_CAPTURE_FACTORY_FILE=""
DATABASE_CAPTURE_FACTORY_CLASS=""
DATABASE_CAPTURE_FACTORY_INTERFACE=""
DATABASE_CAPTURE_FACTORY_NAMESPACE=""
DATABASE_CAPTURE_CONSTRUCTOR_TYPE=""
DATABASE_CAPTURE_CONSTRUCTOR_NAME=""
DATABASE_CAPTURE_FACTORY_USINGS=()
DATABASE_CAPTURE_DAPPER_FILES=()
DATABASE_CAPTURE_DAPPER_LOCATIONS=()
DATABASE_CAPTURE_RAW_ADO_NET_FILES=()
DATABASE_CAPTURE_RAW_ADO_NET_LOCATIONS=()
DATABASE_CAPTURE_RAW_ADO_NET_UNSUPPORTED_LOCATIONS=()
DATABASE_CAPTURE_REUSE_AVAILABLE=0
DATABASE_CAPTURE_DAPPER_REQUESTED=0
DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED=0

http_inspector_database_capture_reset() {
  DATABASE_CAPTURE_PROJECT_FILE=""
  DATABASE_CAPTURE_FACTORY_FILE=""
  DATABASE_CAPTURE_FACTORY_CLASS=""
  DATABASE_CAPTURE_FACTORY_INTERFACE=""
  DATABASE_CAPTURE_FACTORY_NAMESPACE=""
  DATABASE_CAPTURE_CONSTRUCTOR_TYPE=""
  DATABASE_CAPTURE_CONSTRUCTOR_NAME=""
  DATABASE_CAPTURE_FACTORY_USINGS=()
  DATABASE_CAPTURE_DAPPER_FILES=()
  DATABASE_CAPTURE_DAPPER_LOCATIONS=()
  DATABASE_CAPTURE_RAW_ADO_NET_FILES=()
  DATABASE_CAPTURE_RAW_ADO_NET_LOCATIONS=()
  DATABASE_CAPTURE_RAW_ADO_NET_UNSUPPORTED_LOCATIONS=()
  DATABASE_CAPTURE_REUSE_AVAILABLE=0
}

http_inspector_database_capture_project_closure() {
  local root_project="$1"
  local queue=("$root_project")
  local visited=""
  local project directory reference candidate

  while [[ ${#queue[@]} -gt 0 ]]; do
    project="${queue[0]}"
    queue=("${queue[@]:1}")
    if printf '%s' "$visited" | LC_ALL=C grep -Fqx "$project"; then
      continue
    fi
    visited+="$project"$'\n'
    printf '%s\n' "$project"
    directory="$(dirname "$project")"
    while IFS= read -r reference; do
      [[ -n "$reference" ]] || continue
      # MSBuild accepts backslash references on every platform; Bash must normalize them before file lookup.
      reference="${reference//\\//}"
      candidate="$reference"
      [[ "$candidate" == /* ]] || candidate="$directory/$candidate"
      [[ -f "$candidate" ]] || continue
      candidate="$(http_inspector_canonical_file "$candidate")"
      queue+=("$candidate")
    # Project files can use CRLF. Strip the trailing carriage return before resolving a relative reference.
    done < <(LC_ALL=C sed -n -E 's/.*<ProjectReference[[:space:]]+Include="([^"]+)".*/\1/p' "$project" | LC_ALL=C tr -d '\r')
  done
}

http_inspector_database_capture_prepare_dapper_file() {
  local source="$1"
  local output="$2"
  # Scan source as bytes so an existing legacy non-UTF8 comment cannot disrupt discovery.
  LC_ALL=C awk '
    {
      lines[NR] = $0
      before[NR] = depth
      code = $0
      gsub(/"([^"\\]|\\.)*"/, "", code)
      opens = gsub(/\{/, "{", code)
      closes = gsub(/\}/, "}", code)
      depth += opens - closes
      after[NR] = depth
    }
    END {
      for (i = 1; i <= NR; i++) {
        if (lines[i] !~ /GetConnection[[:space:]]*\([[:space:]]*\)/ || lines[i] !~ /connection/ || lines[i] ~ /SqlConnection/) continue
        contains_dapper = 0
        contains_raw_ado = 0
        for (j = i; j <= NR; j++) {
          if (j > i && before[j] < before[i]) break
          if (lines[j] ~ /connection[[:space:]]*\.[[:space:]]*(Query|QueryAsync|QueryFirst|QueryFirstAsync|QuerySingle|QuerySingleAsync|Execute|ExecuteAsync|ExecuteScalar|ExecuteScalarAsync)[^\(]*\(/) contains_dapper = 1
          if (lines[j] ~ /new[[:space:]]+SqlCommand|connection[[:space:]]*\.[[:space:]]*(CreateCommand|BeginTransaction)[[:space:]]*\(/) contains_raw_ado = 1
        }
        if (contains_dapper && !contains_raw_ado) patch[i] = 1
      }
      for (i = 1; i <= NR; i++) {
        if (patch[i]) sub(/GetConnection[[:space:]]*\([[:space:]]*\)/, "GetDapperConnection()", lines[i])
        print lines[i]
      }
    }
  ' "$source" > "$output"
}

http_inspector_database_capture_prepare_raw_ado_file() {
  local source="$1"
  local output="$2"
  # This is intentionally conservative: only commands constructed with a connection from the
  # file's single IDBFactory field and no-argument terminal async calls are eligible.
  LC_ALL=C awk '
    function identifier_before_equals(value, left, parts, count) {
      left = value
      sub(/=.*/, "", left)
      gsub(/[^[:alnum:]_]/, " ", left)
      count = split(left, parts, /[[:space:]]+/)
      while (count > 0 && parts[count] == "") count--
      return count > 0 ? parts[count] : ""
    }
    {
      lines[NR] = $0
      code = $0
      gsub(/"([^"\\]|\\.)*"/, "", code)
      line_static[NR] = static_scope_depth > 0
      if (code ~ /(^|[[:space:]])static[[:space:]]/ && code ~ /[(]/) pending_static_scope = 1
      opened = gsub(/{/, "{", code)
      closed = gsub(/}/, "}", code)
      depth += opened - closed
      if (pending_static_scope && opened > 0) {
        static_scope_depth = depth
        pending_static_scope = 0
      }
      if (static_scope_depth > 0 && depth < static_scope_depth) static_scope_depth = 0
      if ($0 ~ /private[[:space:]]+readonly[[:space:]]+IDBFactory[[:space:]]+/) {
        candidate = $0
        sub(/^.*IDBFactory[[:space:]]+/, "", candidate)
        sub(/[^[:alnum:]_].*$/, "", candidate)
        factory_count++
        factory = candidate
      }
    }
    END {
      if (factory_count != 1 || factory == "") {
        for (i = 1; i <= NR; i++) print lines[i]
        exit
      }
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ factory "[.]GetConnection[[:space:]]*[(]") {
          connection = identifier_before_equals(lines[i])
          if (connection != "") factory_connection[connection] = 1
        }
        if (lines[i] ~ /new[[:space:]]+SqlCommand|=[[:space:]]*new[[:space:]]*\(/) {
          for (connection in factory_connection) {
            if (lines[i] ~ "[,[:space:]]" connection "[[:space:],)]") {
              command = identifier_before_equals(lines[i])
              if (command != "") factory_command[command] = 1
            }
          }
        }
      }
      for (i = 1; i <= NR; i++) {
        for (command in factory_command) {
          if (line_static[i]) {
            continue
          }
          if (lines[i] ~ command "[.]ExecuteReaderAsync[[:space:]]*[(][[:space:]]*[)]") {
            if (lines[i] ~ "^[[:space:]]*await[[:space:]]+" command "[.]ExecuteReaderAsync[[:space:]]*[(][[:space:]]*[)][[:space:]]*;") {
              unsupported[i] = 1
            } else {
              gsub(command "[.]ExecuteReaderAsync[[:space:]]*[(][[:space:]]*[)]", factory ".ExecuteCapturedReaderAsync(" command ")", lines[i])
              reader_capture = 1
              changed[i] = 1
            }
          }
          if (lines[i] ~ command "[.]ExecuteScalarAsync[[:space:]]*[(][[:space:]]*[)]") {
            gsub(command "[.]ExecuteScalarAsync[[:space:]]*[(][[:space:]]*[)]", factory ".ExecuteCapturedScalarAsync(" command ")", lines[i])
            changed[i] = 1
          }
          if (lines[i] ~ command "[.]ExecuteNonQueryAsync[[:space:]]*[(][[:space:]]*[)]") {
            gsub(command "[.]ExecuteNonQueryAsync[[:space:]]*[(][[:space:]]*[)]", factory ".ExecuteCapturedNonQueryAsync(" command ")", lines[i])
            changed[i] = 1
          }
        }
      }
      if (reader_capture) {
        for (i = 1; i <= NR; i++) gsub(/SqlDataReader/, "System.Data.Common.DbDataReader", lines[i])
      }
      for (i = 1; i <= NR; i++) print lines[i]
    }
  ' "$source" > "$output"
}

http_inspector_database_capture_raw_source_has_unsupported_reader() {
  local source="$1"
  LC_ALL=C awk '
    function identifier_before_equals(value, left, parts, count) {
      left = value
      sub(/=.*/, "", left)
      gsub(/[^[:alnum:]_]/, " ", left)
      count = split(left, parts, /[[:space:]]+/)
      while (count > 0 && parts[count] == "") count--
      return count > 0 ? parts[count] : ""
    }
    {
      lines[NR] = $0
      code = $0
      gsub(/"([^"\\]|\\.)*"/, "", code)
      line_static[NR] = static_scope_depth > 0
      if (code ~ /(^|[[:space:]])static[[:space:]]/ && code ~ /[(]/) pending_static_scope = 1
      opened = gsub(/{/, "{", code)
      closed = gsub(/}/, "}", code)
      depth += opened - closed
      if (pending_static_scope && opened > 0) {
        static_scope_depth = depth
        pending_static_scope = 0
      }
      if (static_scope_depth > 0 && depth < static_scope_depth) static_scope_depth = 0
      if ($0 ~ /private[[:space:]]+readonly[[:space:]]+IDBFactory[[:space:]]+/) {
        candidate = $0
        sub(/^.*IDBFactory[[:space:]]+/, "", candidate)
        sub(/[^[:alnum:]_].*$/, "", candidate)
        factory_count++
        factory = candidate
      }
    }
    END {
      if (factory_count != 1 || factory == "") exit
      for (i = 1; i <= NR; i++) {
        if (lines[i] ~ factory "[.]GetConnection[[:space:]]*[(]") {
          connection = identifier_before_equals(lines[i])
          if (connection != "") factory_connection[connection] = 1
        }
        if (lines[i] ~ /new[[:space:]]+SqlCommand|=[[:space:]]*new[[:space:]]*\(/) {
          for (connection in factory_connection) {
            if (lines[i] ~ "[,[:space:]]" connection "[[:space:],)]") {
              command = identifier_before_equals(lines[i])
              if (command != "") factory_command[command] = 1
            }
          }
        }
      }
      for (i = 1; i <= NR; i++) {
        for (command in factory_command) {
          if (line_static[i] && lines[i] ~ command "[.]Execute(Reader|Scalar|NonQuery)Async[[:space:]]*[(][[:space:]]*[)]") print i ": static command scope"
          else if (lines[i] ~ "^[[:space:]]*await[[:space:]]+" command "[.]ExecuteReaderAsync[[:space:]]*[(][[:space:]]*[)][[:space:]]*;") print i ": reader result is not consumed"
        }
      }
    }
  ' "$source"
}

http_inspector_database_capture_discover() {
  local host_project="$1"
  local project candidate project_directory factory_candidates=() source candidate_output
  local constructor_line constructor_arguments
  http_inspector_database_capture_reset

  while IFS= read -r project; do
    project_directory="$(dirname "$project")"
    while IFS= read -r candidate; do
      [[ -n "$candidate" ]] || continue
      if LC_ALL=C grep -Eq 'public[[:space:]]+(partial[[:space:]]+)?class[[:space:]]+[[:alnum:]_]*DBFactory[[:space:]]*:' "$candidate" && LC_ALL=C grep -Eq 'public[[:space:]]+SqlConnection[[:space:]]+GetConnection[[:space:]]*\(' "$candidate"; then
        factory_candidates+=("$candidate|$project")
      fi
    done < <(find "$project_directory" -maxdepth 2 -type f -name '*DBFactory.cs' -print | LC_ALL=C sort)
  done < <(http_inspector_database_capture_project_closure "$host_project")

  [[ ${#factory_candidates[@]} -eq 1 ]] || return 1
  DATABASE_CAPTURE_FACTORY_FILE="${factory_candidates[0]%%|*}"
  DATABASE_CAPTURE_PROJECT_FILE="${factory_candidates[0]#*|}"
  DATABASE_CAPTURE_FACTORY_CLASS="$(LC_ALL=C sed -n -E 's/.*public[[:space:]]+(partial[[:space:]]+)?class[[:space:]]+([[:alnum:]_]*DBFactory)[[:space:]]*:.*/\2/p' "$DATABASE_CAPTURE_FACTORY_FILE" | sed -n '1p')"
  DATABASE_CAPTURE_FACTORY_INTERFACE="$(LC_ALL=C sed -n -E 's/.*public[[:space:]]+(partial[[:space:]]+)?interface[[:space:]]+(I[[:alnum:]_]*DBFactory)[[:space:]]*.*/\2/p' "$DATABASE_CAPTURE_FACTORY_FILE" | sed -n '1p')"
  DATABASE_CAPTURE_FACTORY_NAMESPACE="$(LC_ALL=C sed -n -E 's/^[[:space:]]*namespace[[:space:]]+([[:alnum:]_.]+)[[:space:]]*([;{].*)?$/\1/p' "$DATABASE_CAPTURE_FACTORY_FILE" | sed -n '1p')"
  constructor_line="$(LC_ALL=C sed -n -E "s/^[[:space:]]*public[[:space:]]+${DATABASE_CAPTURE_FACTORY_CLASS}[[:space:]]*\\(([^)]*)\\).*/\\1/p" "$DATABASE_CAPTURE_FACTORY_FILE" | sed -n '1p')"
  constructor_arguments="$constructor_line"
  [[ -n "$DATABASE_CAPTURE_FACTORY_CLASS" && -n "$DATABASE_CAPTURE_FACTORY_INTERFACE" && -n "$DATABASE_CAPTURE_FACTORY_NAMESPACE" ]] || return 1
  [[ "$constructor_arguments" != *,* && "$constructor_arguments" =~ ^[[:alnum:]_.\<\>\?]+[[:space:]]+[[:alnum:]_]+$ ]] || return 1
  DATABASE_CAPTURE_CONSTRUCTOR_TYPE="${constructor_arguments% *}"
  DATABASE_CAPTURE_CONSTRUCTOR_NAME="${constructor_arguments##* }"
  while IFS= read -r using_directive; do
    [[ -n "$using_directive" && "$using_directive" != 'using HttpInspector.Adapter;' ]] || continue
    DATABASE_CAPTURE_FACTORY_USINGS+=("$using_directive")
  # Preserve the factory's own namespace imports in the generated partial. This keeps
  # constructor option types resolvable without guessing their project-specific namespace.
  done < <(LC_ALL=C sed '1s/^\xEF\xBB\xBF//' "$DATABASE_CAPTURE_FACTORY_FILE" | LC_ALL=C sed -n -E 's/^[[:space:]]*(global[[:space:]]+)?using[[:space:]]+([^;]+);[[:space:]]*$/using \2;/p')

  if [[ $DATABASE_CAPTURE_DAPPER_REQUESTED -eq 1 ]]; then
    while IFS= read -r source; do
      [[ -n "$source" ]] || continue
      LC_ALL=C grep -Eq 'using[[:space:]]+Dapper[[:space:]]*;' "$source" || continue
      LC_ALL=C grep -Eq 'GetConnection[[:space:]]*\(' "$source" || continue
      candidate_output="$(mktemp "${TMPDIR:-/tmp}/http-inspector-dapper.XXXXXX")"
      http_inspector_database_capture_prepare_dapper_file "$source" "$candidate_output"
      if ! cmp -s "$source" "$candidate_output"; then
        DATABASE_CAPTURE_DAPPER_FILES+=("$source")
        while IFS= read -r location; do
          [[ -n "$location" ]] && DATABASE_CAPTURE_DAPPER_LOCATIONS+=("${source#"$(dirname "$DATABASE_CAPTURE_PROJECT_FILE")"/}:$location")
        done < <(LC_ALL=C diff -u "$source" "$candidate_output" | LC_ALL=C sed -n -E 's/^\+[^+].*/changed/p')
      fi
      rm -f "$candidate_output"
    done < <(find "$(dirname "$DATABASE_CAPTURE_PROJECT_FILE")" -type f -name '*.cs' -print | LC_ALL=C sort)
  fi

  while IFS= read -r source; do
    [[ -n "$source" ]] || continue
    candidate_output="$(mktemp "${TMPDIR:-/tmp}/http-inspector-raw-ado.XXXXXX")"
    http_inspector_database_capture_prepare_raw_ado_file "$source" "$candidate_output"
    if ! cmp -s "$source" "$candidate_output"; then
      DATABASE_CAPTURE_RAW_ADO_NET_FILES+=("$source")
      DATABASE_CAPTURE_RAW_ADO_NET_LOCATIONS+=("${source#"$(dirname "$DATABASE_CAPTURE_PROJECT_FILE")"/}")
    fi
    rm -f "$candidate_output"
    while IFS= read -r line; do
      [[ -n "$line" ]] && DATABASE_CAPTURE_RAW_ADO_NET_UNSUPPORTED_LOCATIONS+=("${source#"$(dirname "$DATABASE_CAPTURE_PROJECT_FILE")"/}:$line")
    done < <(http_inspector_database_capture_raw_source_has_unsupported_reader "$source")
  done < <(find "$(dirname "$DATABASE_CAPTURE_PROJECT_FILE")" -type f -name '*.cs' -print | LC_ALL=C sort)

  if [[ ${#DATABASE_CAPTURE_DAPPER_FILES[@]} -eq 0 ]]; then
    local key
    key="$(printf '%s' "$DATABASE_CAPTURE_PROJECT_FILE" | http_inspector_sha256_stream)"
    if [[ -n "${DATABASE_CAPTURE_STATE_ROOT:-}" && -f "$DATABASE_CAPTURE_STATE_ROOT/database-adoptions/$key/active" ]]; then
      # A second host can safely join a verified shared adoption after the first host
      # has already changed its Dapper scopes from GetConnection to GetDapperConnection.
      DATABASE_CAPTURE_REUSE_AVAILABLE=1
    fi
  fi
  if [[ $DATABASE_CAPTURE_DAPPER_REQUESTED -eq 1 && ${#DATABASE_CAPTURE_DAPPER_FILES[@]} -eq 0 && $DATABASE_CAPTURE_REUSE_AVAILABLE -eq 0 ]]; then return 1; fi
  if [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 1 && ${#DATABASE_CAPTURE_RAW_ADO_NET_FILES[@]} -eq 0 ]]; then
    local key
    key="$(printf '%s' "$DATABASE_CAPTURE_PROJECT_FILE" | http_inspector_sha256_stream)"
    [[ -f "${DATABASE_CAPTURE_STATE_ROOT:-}/database-adoptions/$key/raw-ado-net-active" ]] || return 1
  fi
  [[ $DATABASE_CAPTURE_DAPPER_REQUESTED -eq 1 || $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 1 ]]
}

http_inspector_database_capture_preview_json() {
  local requested="$1"
  local raw_requested="$2"
  local separator="" location source
  if [[ "$requested" != "1" ]]; then
    printf '{"requested":false,"eligible":true,"reason":null,"databaseProjectFile":null,"factoryFile":null,"dapperLocations":[],"dapperFiles":[],"rawAdoNetResultCapture":{"requested":false,"eligible":true,"reason":null,"locations":[],"files":[],"unsupportedLocations":[]}}'
    return
  fi
  DATABASE_CAPTURE_DAPPER_REQUESTED="$requested"
  DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED="$raw_requested"
  if ! http_inspector_database_capture_discover "$project_file"; then
    printf '{"requested":true,"eligible":false,"reason":"No safe database factory pattern was found through the selected project reference graph.","databaseProjectFile":null,"factoryFile":null,"dapperLocations":[],"dapperFiles":[],"rawAdoNetResultCapture":{"requested":%s,"eligible":false,"reason":"No safe raw ADO.NET terminal command pattern was found through the selected project reference graph.","locations":[],"files":[],"unsupportedLocations":[]}}' "$([[ "$raw_requested" == "1" ]] && printf true || printf false)"
    return
  fi
  printf '{"requested":true,"eligible":true,"reason":null,"databaseProjectFile":"%s","factoryFile":"%s","dapperLocations":[' \
    "$(http_inspector_json_escape "$DATABASE_CAPTURE_PROJECT_FILE")" "$(http_inspector_json_escape "$DATABASE_CAPTURE_FACTORY_FILE")"
  for location in "${DATABASE_CAPTURE_DAPPER_LOCATIONS[@]-}"; do
    [[ -n "$location" ]] || continue
    printf '%s"%s"' "$separator" "$(http_inspector_json_escape "$location")"
    separator=","
  done
  printf '],"dapperFiles":['
  separator=""
  for source in "${DATABASE_CAPTURE_DAPPER_FILES[@]-}"; do
    [[ -n "$source" ]] || continue
    printf '%s"%s"' "$separator" "$(http_inspector_json_escape "$source")"
    separator=","
  done
  printf '],"rawAdoNetResultCapture":{"requested":%s,"eligible":%s,"reason":null,"locations":[' "$([[ "$raw_requested" == "1" ]] && printf true || printf false)" "$([[ "$raw_requested" == "1" ]] && printf true || printf false)"
  separator=""
  for location in "${DATABASE_CAPTURE_RAW_ADO_NET_LOCATIONS[@]-}"; do
    [[ -n "$location" ]] || continue
    printf '%s"%s"' "$separator" "$(http_inspector_json_escape "$location")"
    separator=","
  done
  printf '],"files":['
  separator=""
  for source in "${DATABASE_CAPTURE_RAW_ADO_NET_FILES[@]-}"; do
    [[ -n "$source" ]] || continue
    printf '%s"%s"' "$separator" "$(http_inspector_json_escape "$source")"
    separator=","
  done
  printf '],"unsupportedLocations":['
  separator=""
  for location in "${DATABASE_CAPTURE_RAW_ADO_NET_UNSUPPORTED_LOCATIONS[@]-}"; do
    [[ -n "$location" ]] || continue
    printf '%s"%s"' "$separator" "$(http_inspector_json_escape "$location")"
    separator=","
  done
  printf ']}}'
}

http_inspector_database_capture_record_file() {
  local manifest="$1"
  local target="$2"
  local candidate="$3"
  local backup_directory="$4"
  local ordinal="$5"
  local before_hash after_hash backup
  if [[ -f "$target" ]]; then
    backup="$backup_directory/$ordinal.backup"
    cp "$target" "$backup"
    before_hash="$(http_inspector_sha256_file "$target")"
  else
    backup=""
    before_hash="missing"
  fi
  after_hash="$(http_inspector_sha256_file "$candidate")"
  printf '%s\t%s\t%s\t%s\n' "$target" "$backup" "$before_hash" "$after_hash" >> "$manifest"
}

http_inspector_database_capture_render_partial_factory() {
  local output="$1"
  local run_id="$2"
  local using_directive
  printf '%s\n' "// HTTP_INSPECTOR_DATABASE_CAPTURE:${run_id}:BEGIN" > "$output"
  printf '%s\n\n' '#nullable enable' >> "$output"
  for using_directive in "${DATABASE_CAPTURE_FACTORY_USINGS[@]-}"; do
    [[ -n "$using_directive" ]] && printf '%s\n' "$using_directive" >> "$output"
  done
  printf '%s\n' 'using System.Data.Common;' >> "$output"
  printf '%s\n' 'using System.Threading.Tasks;' >> "$output"
  printf '%s\n\n' 'using HttpInspector.Adapter;' >> "$output"
  printf '%s\n' "namespace $DATABASE_CAPTURE_FACTORY_NAMESPACE" >> "$output"
  printf '%s\n' '{' >> "$output"
  printf '%s\n' "    public partial class $DATABASE_CAPTURE_FACTORY_CLASS" >> "$output"
  printf '%s\n' '    {' >> "$output"
  printf '%s\n' '        private readonly IHttpInspectorDatabaseCapture? _httpInspectorDatabaseCapture;' >> "$output"
  printf '%s\n' >> "$output"
  printf '%s\n' "        public $DATABASE_CAPTURE_FACTORY_CLASS($DATABASE_CAPTURE_CONSTRUCTOR_TYPE $DATABASE_CAPTURE_CONSTRUCTOR_NAME, IHttpInspectorDatabaseCapture httpInspectorDatabaseCapture)" >> "$output"
  printf '%s\n' "            : this($DATABASE_CAPTURE_CONSTRUCTOR_NAME)" >> "$output"
  printf '%s\n' '        {' >> "$output"
  printf '%s\n' '            _httpInspectorDatabaseCapture = httpInspectorDatabaseCapture;' >> "$output"
  printf '%s\n' '        }' >> "$output"
  printf '%s\n' >> "$output"
  if [[ $DATABASE_CAPTURE_DAPPER_REQUESTED -eq 1 ]]; then
    printf '%s\n' '        public DbConnection GetDapperConnection()' >> "$output"
    printf '%s\n' '        {' >> "$output"
    printf '%s\n' '            var connection = GetConnection();' >> "$output"
    printf '%s\n' '            return _httpInspectorDatabaseCapture?.Wrap(connection) ?? connection;' >> "$output"
    printf '%s\n' '        }' >> "$output"
    printf '%s\n' >> "$output"
  fi
  if [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 1 ]]; then
    printf '%s\n' '        public Task<DbDataReader> ExecuteCapturedReaderAsync(DbCommand command) => _httpInspectorDatabaseCapture?.ExecuteReaderAsync(command) ?? command.ExecuteReaderAsync();' >> "$output"
    printf '%s\n' '        public Task<object?> ExecuteCapturedScalarAsync(DbCommand command) => _httpInspectorDatabaseCapture?.ExecuteScalarAsync(command) ?? command.ExecuteScalarAsync();' >> "$output"
    printf '%s\n' '        public Task<int> ExecuteCapturedNonQueryAsync(DbCommand command) => _httpInspectorDatabaseCapture?.ExecuteNonQueryAsync(command) ?? command.ExecuteNonQueryAsync();' >> "$output"
  fi
  printf '%s\n' '    }' >> "$output"
  printf '%s\n' >> "$output"
  printf '%s\n' "    public partial interface $DATABASE_CAPTURE_FACTORY_INTERFACE" >> "$output"
  printf '%s\n' '    {' >> "$output"
  [[ $DATABASE_CAPTURE_DAPPER_REQUESTED -eq 0 ]] || printf '%s\n' '        DbConnection GetDapperConnection();' >> "$output"
  [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 0 ]] || printf '%s\n' '        Task<DbDataReader> ExecuteCapturedReaderAsync(DbCommand command);' >> "$output"
  [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 0 ]] || printf '%s\n' '        Task<object?> ExecuteCapturedScalarAsync(DbCommand command);' >> "$output"
  [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 0 ]] || printf '%s\n' '        Task<int> ExecuteCapturedNonQueryAsync(DbCommand command);' >> "$output"
  printf '%s\n' '    }' >> "$output"
  printf '%s\n' '}' >> "$output"
  printf '%s\n\n' '#nullable restore' >> "$output"
  printf '%s\n' "// HTTP_INSPECTOR_DATABASE_CAPTURE:${run_id}:END" >> "$output"
}

http_inspector_database_capture_contains_file() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do [[ "$candidate" != "$needle" ]] || return 0; done
  return 1
}

http_inspector_database_capture_prepare_source() {
  local source="$1"
  local output="$2"
  local candidate="$source"
  local temporary=""
  if http_inspector_database_capture_contains_file "$source" "${DATABASE_CAPTURE_DAPPER_FILES[@]-}"; then
    temporary="$(mktemp "${TMPDIR:-/tmp}/http-inspector-database-source.XXXXXX")"
    http_inspector_database_capture_prepare_dapper_file "$candidate" "$temporary"
    candidate="$temporary"
  fi
  if http_inspector_database_capture_contains_file "$source" "${DATABASE_CAPTURE_RAW_ADO_NET_FILES[@]-}"; then
    http_inspector_database_capture_prepare_raw_ado_file "$candidate" "$output"
  else
    cp "$candidate" "$output"
  fi
  [[ -z "$temporary" ]] || rm -f "$temporary"
}

http_inspector_database_capture_prepare_factory_file() {
  local input="$1"
  local output="$2"
  awk -v class_name="$DATABASE_CAPTURE_FACTORY_CLASS" -v interface_name="$DATABASE_CAPTURE_FACTORY_INTERFACE" '
    {
      if ($0 ~ "public class " class_name) sub("public class " class_name, "public partial class " class_name)
      if ($0 ~ "public interface " interface_name) sub("public interface " interface_name, "public partial interface " interface_name)
      print
    }
  ' "$input" > "$output"
}

http_inspector_database_capture_enable() {
  local state_root="$1"
  local project_state="$2"
  local run_id="$3"
  local run_directory="$4"
  local package_id="$5"
  local package_version="$6"
  local package_feed_msbuild_path="$7"
  local key adoption_root manifest backups_directory database_project_backup database_project_injected factory_injected generated_file generated_temp source output ordinal=0 mutation_failed=0 processed_sources=$'\n'

  http_inspector_database_capture_discover "$project_file" || http_inspector_die "Database result capture is not eligible for this project. Preview the integration again."
  key="$(printf '%s' "$DATABASE_CAPTURE_PROJECT_FILE" | http_inspector_sha256_stream)"
  DATABASE_CAPTURE_ADOPTION_ROOT="$state_root/database-adoptions/$key"
  DATABASE_CAPTURE_REUSED=0
  if [[ -f "$DATABASE_CAPTURE_ADOPTION_ROOT/active" ]]; then
    if [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 1 && ! -f "$DATABASE_CAPTURE_ADOPTION_ROOT/raw-ado-net-active" ]]; then
      http_inspector_die "Raw ADO.NET result capture cannot join an existing Dapper-only database adoption. Remove the existing project integration first, then integrate again with raw ADO.NET capture enabled."
    fi
    printf '%s\n' "$run_id" >> "$DATABASE_CAPTURE_ADOPTION_ROOT/participants"
    DATABASE_CAPTURE_REUSED=1
    return
  fi
  [[ ${#DATABASE_CAPTURE_DAPPER_FILES[@]} -gt 0 || ${#DATABASE_CAPTURE_RAW_ADO_NET_FILES[@]} -gt 0 ]] || http_inspector_die "Database result capture has no safe Dapper or raw ADO.NET scopes to adopt."

  mkdir -p "$DATABASE_CAPTURE_ADOPTION_ROOT/backups"
  backups_directory="$DATABASE_CAPTURE_ADOPTION_ROOT/backups"
  manifest="$DATABASE_CAPTURE_ADOPTION_ROOT/manifest.tsv"
  : > "$manifest"
  database_project_backup="$run_directory/database-project.backup"
  database_project_injected="$run_directory/database-project.injected"
  factory_injected="$run_directory/database-factory.injected"
  generated_file="$(dirname "$DATABASE_CAPTURE_FACTORY_FILE")/HttpInspectorDatabaseCaptureFactory.cs"
  generated_temp="$run_directory/HttpInspectorDatabaseCaptureFactory.cs"
  [[ ! -e "$generated_file" ]] || http_inspector_die "Database capture support file already exists: $generated_file"

  cp "$DATABASE_CAPTURE_PROJECT_FILE" "$database_project_backup"
  local database_project_newline_style="$(http_inspector_detect_newline "$DATABASE_CAPTURE_PROJECT_FILE")"
  local database_project_newline=$'\n'
  [[ "$database_project_newline_style" != "crlf" ]] || database_project_newline=$'\r\n'
  local database_project_block="$run_directory/database-project-block.txt"
  http_inspector_render_template "$script_dir/templates/nuget-package-reference.xml" "$database_project_block" "$database_project_newline" "$run_id" "" "" "$package_feed_msbuild_path" "$package_id" "$package_version"
  http_inspector_inject_project_reference "$database_project_backup" "$database_project_injected" "$database_project_block"
  http_inspector_database_capture_prepare_factory_file "$DATABASE_CAPTURE_FACTORY_FILE" "$factory_injected"
  http_inspector_database_capture_render_partial_factory "$generated_temp" "$run_id"

  ((ordinal += 1)); http_inspector_database_capture_record_file "$manifest" "$DATABASE_CAPTURE_PROJECT_FILE" "$database_project_injected" "$backups_directory" "$ordinal"
  ((ordinal += 1)); http_inspector_database_capture_record_file "$manifest" "$DATABASE_CAPTURE_FACTORY_FILE" "$factory_injected" "$backups_directory" "$ordinal"
  ((ordinal += 1)); http_inspector_database_capture_record_file "$manifest" "$generated_file" "$generated_temp" "$backups_directory" "$ordinal"
  printf '%s\n' "$run_id" > "$DATABASE_CAPTURE_ADOPTION_ROOT/participants"
  printf '%s\n' active > "$DATABASE_CAPTURE_ADOPTION_ROOT/active"
  http_inspector_atomic_copy "$database_project_injected" "$DATABASE_CAPTURE_PROJECT_FILE" || mutation_failed=1
  [[ $mutation_failed -ne 0 ]] || http_inspector_atomic_copy "$factory_injected" "$DATABASE_CAPTURE_FACTORY_FILE" || mutation_failed=1
  [[ $mutation_failed -ne 0 ]] || http_inspector_atomic_copy "$generated_temp" "$generated_file" || mutation_failed=1
  if [[ $mutation_failed -eq 0 ]]; then
    for source in "${DATABASE_CAPTURE_DAPPER_FILES[@]-}" "${DATABASE_CAPTURE_RAW_ADO_NET_FILES[@]-}"; do
      [[ -n "$source" ]] || continue
      if printf '%s' "$processed_sources" | LC_ALL=C grep -Fqx "$source"; then continue; fi
      processed_sources+="$source"$'\n'
      output="$run_directory/database-source-$ordinal.injected"
      if ! http_inspector_database_capture_prepare_source "$source" "$output" || ! ((ordinal += 1)) || ! http_inspector_database_capture_record_file "$manifest" "$source" "$output" "$backups_directory" "$ordinal" || ! http_inspector_atomic_copy "$output" "$source"; then
        mutation_failed=1
        break
      fi
    done
  fi
  if [[ $mutation_failed -ne 0 ]]; then
    # The manifest exists before the first mutation, so this can reverse a partial write safely.
    http_inspector_database_capture_remove_participant "$DATABASE_CAPTURE_ADOPTION_ROOT" "$run_id" || true
    return 1
  fi
  [[ $DATABASE_CAPTURE_RAW_ADO_NET_REQUESTED -eq 0 ]] || printf '%s\n' active > "$DATABASE_CAPTURE_ADOPTION_ROOT/raw-ado-net-active"
}

http_inspector_database_capture_remove_participant() {
  local adoption_root="$1"
  local run_id="$2"
  local manifest_line target backup before_hash after_hash remaining temporary
  [[ -n "$adoption_root" && -f "$adoption_root/active" ]] || return 0
  remaining="$adoption_root/participants.remaining"
  LC_ALL=C grep -Fvx "$run_id" "$adoption_root/participants" > "$remaining" || true
  if [[ -s "$remaining" ]]; then
    mv -f "$remaining" "$adoption_root/participants"
    return 0
  fi
  rm -f "$remaining"
  while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
    # Tabs are whitespace to Bash's read builtin, so use a non-whitespace delimiter
    # while unpacking the manifest to preserve an empty backup for generated files.
    IFS=$'\x1f' read -r target backup before_hash after_hash <<< "${manifest_line//$'\t'/$'\x1f'}"
    [[ -n "$target" ]] || continue
    if [[ "$before_hash" == "missing" ]]; then
      [[ ! -e "$target" || "$(http_inspector_sha256_file "$target")" == "$after_hash" ]] || return 1
    else
      [[ -f "$target" && -f "$backup" ]] || return 1
      # A prior write in this adoption may have failed before reaching this file; its original hash is safe to restore.
      [[ "$(http_inspector_sha256_file "$target")" == "$before_hash" || "$(http_inspector_sha256_file "$target")" == "$after_hash" ]] || return 1
    fi
  done < "$adoption_root/manifest.tsv"
  while IFS= read -r manifest_line || [[ -n "$manifest_line" ]]; do
    IFS=$'\x1f' read -r target backup before_hash after_hash <<< "${manifest_line//$'\t'/$'\x1f'}"
    [[ -n "$target" ]] || continue
    if [[ "$before_hash" == "missing" ]]; then rm -f "$target"; else http_inspector_atomic_copy "$backup" "$target"; fi
  done < "$adoption_root/manifest.tsv"
  rm -rf "$adoption_root"
}
