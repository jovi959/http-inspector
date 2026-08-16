#!/usr/bin/env bash

http_inspector_render_template() {
  local template="$1"
  local output="$2"
  local newline="$3"
  local run_id="$4"
  local adapter_binary="${5:-}"
  local indentation="${6:-}"
  local package_feed="${7:-}"
  local package_id="${8:-}"
  local package_version="${9:-}"
  local line
  : > "$output"
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//'{{RUN_ID}}'/$run_id}"
    line="${line//'{{ADAPTER_BINARY}}'/$adapter_binary}"
    line="${line//'{{INDENT}}'/$indentation}"
    line="${line//'{{PACKAGE_FEED}}'/$package_feed}"
    line="${line//'{{PACKAGE_ID}}'/$package_id}"
    line="${line//'{{PACKAGE_VERSION}}'/$package_version}"
    printf '%s%s' "$line" "$newline" >> "$output"
  done < "$template"
}

http_inspector_inject_project_reference() {
  local source="$1"
  local output="$2"
  local block="$3"
  awk -v insertion="$block" '
    /<\/Project>/ {
      closing_count++
      while ((getline injected_line < insertion) > 0) {
        print injected_line
      }
      close(insertion)
    }
    { print }
    END {
      if (closing_count != 1) {
        exit 42
      }
    }
  ' "$source" > "$output" || http_inspector_die "The selected .csproj must contain exactly one closing Project element."
}

http_inspector_inject_http_client_registrations() {
  local source="$1"
  local output="$2"
  local count_file="$3"
  local run_id="$4"
  local newline_style="$5"
  awk -v run_id="$run_id" -v newline_style="$newline_style" -v count_file="$count_file" '
    BEGIN { output_newline = newline_style == "crlf" ? "\r\n" : "\n" }
    function emit(value) {
      printf "%s%s", value, output_newline
    }

    function sanitize(raw,    result,index_value,current,next_value,string_mode,char_mode,verbatim,escaped) {
      result = ""
      string_mode = 0
      char_mode = 0
      verbatim = 0
      escaped = 0
      for (index_value = 1; index_value <= length(raw); index_value++) {
        current = substr(raw, index_value, 1)
        next_value = substr(raw, index_value + 1, 1)
        if (block_comment) {
          result = result " "
          if (current == "*" && next_value == "/") {
            result = result " "
            index_value++
            block_comment = 0
          }
          continue
        }
        if (string_mode) {
          result = result " "
          if (verbatim && current == "\"" && next_value == "\"") {
            result = result " "
            index_value++
          } else if (verbatim && current == "\"") {
            string_mode = 0
            verbatim = 0
          } else if (!verbatim && escaped) {
            escaped = 0
          } else if (!verbatim && current == "\\") {
            escaped = 1
          } else if (!verbatim && current == "\"") {
            string_mode = 0
          }
          continue
        }
        if (char_mode) {
          result = result " "
          if (escaped) {
            escaped = 0
          } else if (current == "\\") {
            escaped = 1
          } else if (current == "\047") {
            char_mode = 0
          }
          continue
        }
        if (current == "/" && next_value == "*") {
          result = result "  "
          index_value++
          block_comment = 1
        } else if (current == "/" && next_value == "/") {
          while (length(result) < length(raw)) result = result " "
          break
        } else if (current == "@" && next_value == "\"") {
          result = result "  "
          index_value++
          string_mode = 1
          verbatim = 1
        } else if (current == "\"") {
          result = result " "
          string_mode = 1
        } else if (current == "\047") {
          result = result " "
          char_mode = 1
        } else {
          result = result current
        }
      }
      return result
    }

    {
      raw = $0
      sub(/\r$/, "", raw)
      code = sanitize(raw)
      scan_start = 1
      if (!active && match(code, /(^|[^[:alnum:]_])AddHttpClient[[:space:]]*(<[^(){};]*>)?[[:space:]]*\(/)) {
        active = 1
        parentheses = 0
        braces = 0
        brackets = 0
        scan_start = RSTART
      }

      semicolon = 0
      if (active) {
        for (character_index = scan_start; character_index <= length(code); character_index++) {
          character = substr(code, character_index, 1)
          if (character == "(") parentheses++
          else if (character == ")") parentheses--
          else if (character == "{") braces++
          else if (character == "}") braces--
          else if (character == "[") brackets++
          else if (character == "]") brackets--
          else if (character == ";" && parentheses == 0 && braces == 0 && brackets == 0) {
            semicolon = character_index
            break
          }
          if (parentheses < 0 || braces < 0 || brackets < 0) exit 43
        }
      }

      if (semicolon > 0) {
        prefix = substr(raw, 1, semicolon - 1)
        suffix = substr(raw, semicolon)
        match(raw, /^[ \t]*/)
        indentation = substr(raw, 1, RLENGTH)
        if (indentation == "") indentation = "    "
        marker = indentation "/* HTTP_INSPECTOR_INJECTION:" run_id ":BEGIN */.AddHttpInspectorAdapter()/* HTTP_INSPECTOR_INJECTION:" run_id ":END */"
        emit(prefix)
        emit(marker suffix)
        active = 0
        injection_count++
      } else {
        emit(raw)
      }
    }

    END {
      if (active || injection_count == 0 || block_comment) exit 44
      print injection_count > count_file
      close(count_file)
    }
  ' "$source" > "$output" || http_inspector_die "AddHttpClient discovery was ambiguous. The bounded strategy made no changes."
}

http_inspector_inject_service_registration() {
  local source="$1"
  local output="$2"
  local count_file="$3"
  local run_id="$4"
  local newline_style="$5"
  awk -v run_id="$run_id" -v newline_style="$newline_style" -v count_file="$count_file" '
    BEGIN { output_newline = newline_style == "crlf" ? "\r\n" : "\n" }
    function emit(value) { printf "%s%s", value, output_newline }

    function sanitize(raw,    result,index_value,current,next_value,string_mode,char_mode,verbatim,escaped) {
      result = ""
      string_mode = 0
      char_mode = 0
      verbatim = 0
      escaped = 0
      for (index_value = 1; index_value <= length(raw); index_value++) {
        current = substr(raw, index_value, 1)
        next_value = substr(raw, index_value + 1, 1)
        if (block_comment) {
          result = result " "
          if (current == "*" && next_value == "/") {
            result = result " "
            index_value++
            block_comment = 0
          }
          continue
        }
        if (string_mode) {
          result = result " "
          if (verbatim && current == "\"" && next_value == "\"") {
            result = result " "
            index_value++
          } else if (verbatim && current == "\"") {
            string_mode = 0
            verbatim = 0
          } else if (!verbatim && escaped) {
            escaped = 0
          } else if (!verbatim && current == "\\") {
            escaped = 1
          } else if (!verbatim && current == "\"") {
            string_mode = 0
          }
          continue
        }
        if (char_mode) {
          result = result " "
          if (escaped) {
            escaped = 0
          } else if (current == "\\") {
            escaped = 1
          } else if (current == "\047") {
            char_mode = 0
          }
          continue
        }
        if (current == "/" && next_value == "*") {
          result = result "  "
          index_value++
          block_comment = 1
        } else if (current == "/" && next_value == "/") {
          while (length(result) < length(raw)) result = result " "
          break
        } else if (current == "@" && next_value == "\"") {
          result = result "  "
          index_value++
          string_mode = 1
          verbatim = 1
        } else if (current == "\"") {
          result = result " "
          string_mode = 1
        } else if (current == "\047") {
          result = result " "
          char_mode = 1
        } else {
          result = result current
        }
      }
      return result
    }

    {
      raw = $0
      sub(/\r$/, "", raw)
      code = sanitize(raw)
      scan_start = 1
      if (!active && !injected) {
        if (match(code, /(^|[^[:alnum:]_])builder[[:space:]]*\.[[:space:]]*Services[[:space:]]*\.[[:space:]]*Add[[:alnum:]_]*[[:space:]]*\(/)) {
          active = 1
          service_target = "builder.Services"
          parentheses = 0
          braces = 0
          brackets = 0
          scan_start = RSTART
        } else if (match(code, /(^|[^[:alnum:]_])services[[:space:]]*\.[[:space:]]*Add[[:alnum:]_]*[[:space:]]*\(/)) {
          active = 1
          service_target = "services"
          parentheses = 0
          braces = 0
          brackets = 0
          scan_start = RSTART
        }
      }

      semicolon = 0
      if (active) {
        for (character_index = scan_start; character_index <= length(code); character_index++) {
          character = substr(code, character_index, 1)
          if (character == "(") parentheses++
          else if (character == ")") parentheses--
          else if (character == "{") braces++
          else if (character == "}") braces--
          else if (character == "[") brackets++
          else if (character == "]") brackets--
          else if (character == ";" && parentheses == 0 && braces == 0 && brackets == 0) {
            semicolon = character_index
            break
          }
          if (parentheses < 0 || braces < 0 || brackets < 0) exit 51
        }
      }

      if (semicolon > 0) {
        suffix = substr(raw, semicolon + 1)
        if (suffix !~ /^[[:space:]]*$/) exit 52
        match(raw, /^[ \t]*/)
        indentation = substr(raw, 1, RLENGTH)
        if (indentation == "") indentation = "    "
        emit(substr(raw, 1, semicolon))
        emit(indentation "/* HTTP_INSPECTOR_INJECTION:" run_id ":BEGIN */")
        emit(indentation service_target ".AddHttpInspectorAdapter();")
        emit(indentation "/* HTTP_INSPECTOR_INJECTION:" run_id ":END */")
        active = 0
        injected = 1
        injection_count++
      } else {
        emit(raw)
      }
    }

    END {
      if (active || injection_count != 1 || block_comment) exit 53
      print injection_count > count_file
      close(count_file)
    }
  ' "$source" > "$output" || http_inspector_die "Service-registration discovery was ambiguous. The bounded strategy made no changes."
}

http_inspector_prepend_file() {
  local prefix="$1"
  local source="$2"
  local output="$3"
  { cat "$prefix"; cat "$source"; } > "$output"
}

http_inspector_extract_owned_blocks() {
  local source="$1"
  local output="$2"
  local count_file="$3"
  local run_id="$4"
  awk -v begin_marker="HTTP_INSPECTOR_INJECTION:${run_id}:BEGIN" -v end_marker="HTTP_INSPECTOR_INJECTION:${run_id}:END" -v count_file="$count_file" '
    index($0, begin_marker) {
      if (inside) exit 45
      inside = 1
      count++
    }
    inside { print }
    index($0, end_marker) && inside { inside = 0 }
    END {
      if (inside || count == 0) exit 46
      print count > count_file
      close(count_file)
    }
  ' "$source" > "$output"
}

http_inspector_remove_project_blocks() {
  local source="$1"
  local output="$2"
  local run_id="$3"
  awk -v begin_marker="HTTP_INSPECTOR_INJECTION:${run_id}:BEGIN" -v end_marker="HTTP_INSPECTOR_INJECTION:${run_id}:END" '
    index($0, begin_marker) { inside = 1; removed++; next }
    inside && index($0, end_marker) { inside = 0; next }
    !inside { print }
    END { if (inside || removed != 1) exit 47 }
  ' "$source" > "$output"
}

http_inspector_remove_composition_blocks() {
  local source="$1"
  local output="$2"
  local run_id="$3"
  local expected_count="$4"
  local newline_style="$5"
  awk -v begin_marker="HTTP_INSPECTOR_INJECTION:${run_id}:BEGIN" -v end_marker="HTTP_INSPECTOR_INJECTION:${run_id}:END" -v expected_count="$expected_count" -v newline_style="$newline_style" '
    BEGIN { output_newline = newline_style == "crlf" ? "\r\n" : "\n" }
    function emit(value) { printf "%s%s", value, output_newline }
    function flush_previous() {
      if (has_previous) emit(previous)
      has_previous = 0
      previous = ""
    }
    {
      raw = $0
      sub(/\r$/, "", raw)
      begin_position = index(raw, begin_marker)
      end_position = index(raw, end_marker)
      if (inside) {
        removed++
        if (end_position) inside = 0
        next
      }
      if (begin_position && end_position) {
        if (!has_previous || previous !~ /\)[ \t]*$/) exit 48
        suffix = substr(raw, end_position + length(end_marker))
        previous = previous suffix
        removed++
        next
      }
      if (begin_position) {
        flush_previous()
        inside = 1
        removed++
        next
      }
      flush_previous()
      previous = raw
      has_previous = 1
    }
    END {
      if (inside || removed != expected_count) exit 49
      flush_previous()
    }
  ' "$source" > "$output"
}

http_inspector_remove_service_registration_blocks() {
  local source="$1"
  local output="$2"
  local run_id="$3"
  local expected_count="$4"
  awk -v begin_marker="HTTP_INSPECTOR_INJECTION:${run_id}:BEGIN" -v end_marker="HTTP_INSPECTOR_INJECTION:${run_id}:END" -v expected_count="$expected_count" '
    index($0, begin_marker) {
      if (inside) exit 54
      inside = 1
      removed++
      next
    }
    inside && index($0, end_marker) {
      inside = 0
      next
    }
    !inside { print }
    END { if (inside || removed != expected_count) exit 55 }
  ' "$source" > "$output"
}

http_inspector_record_artifact_baseline() {
  local project_root="$1"
  local output="$2"
  local artifact
  : > "$output"
  while IFS= read -r artifact; do
    http_inspector_reject_multiline "Artifact path" "$artifact"
    printf '%s\t%s\n' "$(http_inspector_sha256_file "$artifact")" "$artifact" >> "$output"
  done < <(find "$project_root" -type f \( -path '*/bin/*' -o -path '*/obj/*' \) -name 'HttpInspector.Adapter*' -print)
}

http_inspector_cleanup_new_artifacts() {
  local project_root="$1"
  local baseline="$2"
  local artifact
  while IFS= read -r artifact; do
    http_inspector_is_within "$artifact" "$project_root" || continue
    if ! LC_ALL=C grep -Fq "$artifact" "$baseline"; then
      rm -f "$artifact"
    fi
  done < <(find "$project_root" -type f \( -path '*/bin/*' -o -path '*/obj/*' \) -name 'HttpInspector.Adapter*' -print)
}
