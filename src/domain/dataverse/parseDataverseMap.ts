import type { DataverseComparisonOperator, DataverseExpansion, DataverseFilter, DataverseMap, DataverseRequest } from "@/domain/dataverse/dataverseMapTypes";

const syntheticOrigin = "https://http-inspector.invalid";
const versionSegment = /^v\d+(?:\.\d+)*$/i;
const comparisonOperatorByOData: Readonly<Record<string, DataverseComparisonOperator>> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  ge: ">=",
  lt: "<",
  le: "<=",
};

/** Identifies the versioned OData shape used by Dataverse without trusting its host name. */
export function isDataverseRequest(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && parsed.searchParams.has("$select") && parsed.pathname.split("/").some((segment) => versionSegment.test(segment));
}

/** Parses only URL semantics so the generated map stays independent of React and Mermaid. */
export function createDataverseMap(request: DataverseRequest): DataverseMap | null {
  const parsed = parseUrl(request.url);
  if (!parsed || !isDataverseRequest(request.url)) return null;

  const entityName = parsed.pathname.split("/").filter(Boolean).at(-1);
  const selectedColumns = splitTopLevel(parsed.searchParams.get("$select") ?? ",", ",");
  if (!entityName || selectedColumns.length === 0) return null;

  const filters = sortFilters(parseFilters(parsed.searchParams.get("$filter") ?? ""));
  const expansions = parseExpansions(parsed.searchParams.get("$expand") ?? "");
  return {
    requestLabel: `${request.method.toUpperCase()} ${parsed.pathname}`,
    entityName,
    selectedColumns,
    filters,
    expansions,
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value, syntheticOrigin);
  } catch {
    return null;
  }
}

function parseFilters(value: string): readonly DataverseFilter[] {
  if (!value.trim()) return [];
  return splitTopLevel(value, " and ").flatMap((part) => {
    // A parenthesised AND group, e.g. "(a eq 1 and b ne null)", is the same filter list one level down.
    const inner = removeOuterParentheses(part);
    return inner !== part && splitTopLevel(inner, " and ").length > 1 ? parseFilters(inner) : [parseFilter(part)];
  });
}

function parseFilter(expression: string): DataverseFilter {
  const normalized = removeOuterParentheses(expression.trim());
  const any = parseAny(normalized);
  if (any) return any;

  const textMatch = parseTextMatch(normalized);
  if (textMatch) return textMatch;

  const anyOf = parseAnyOf(normalized);
  if (anyOf) return anyOf;

  const orGroup = parseOrGroup(normalized);
  if (orGroup) return orGroup;

  const comparison = parseComparison(normalized);
  return comparison ?? { kind: "unsupported", expression: normalized };
}

function parseOrGroup(expression: string): Extract<DataverseFilter, { readonly kind: "or" }> | null {
  const branches = splitTopLevel(expression, " or ");
  return branches.length < 2 ? null : { kind: "or", branches: branches.map((branch) => sortFilters(parseFilters(branch))) };
}

function parseAny(expression: string): DataverseFilter | null {
  const match = /^(not\s+)?(.+)\/any\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)\s*\)$/i.exec(expression);
  if (!match) return null;

  const negated = Boolean(match[1]);
  const relationship = match[2]?.trim();
  const alias = match[3];
  const predicate = match[4]?.trim();
  if (!relationship || !alias || !predicate || !predicate.startsWith(`${alias}/`)) return null;
  // A relationship is a navigation path; anything else means the greedy match spanned several clauses.
  if (!/^[A-Za-z0-9_./]+$/.test(relationship)) return null;

  const comparison = parseComparison(predicate.slice(alias.length + 1));
  if (!comparison) return null;
  return {
    kind: negated ? "notAny" : "any",
    relationship,
    field: comparison.field,
    operator: comparison.operator,
    value: comparison.value,
  };
}

const textMatchKindByFunction: Readonly<Record<string, "contains" | "startsWith" | "endsWith">> = {
  contains: "contains",
  startswith: "startsWith",
  endswith: "endsWith",
};

function parseTextMatch(expression: string): Extract<DataverseFilter, { readonly kind: "contains" | "startsWith" | "endsWith" }> | null {
  const name = /^(contains|startswith|endswith)\(/i.exec(expression)?.[1];
  const kind = name ? textMatchKindByFunction[name.toLowerCase()] : undefined;
  if (!name || !kind) return null;
  // The call's own parentheses must wrap the rest, e.g. not "contains(a,'x') or b eq 1".
  const call = expression.slice(name.length);
  if (removeOuterParentheses(call) === call) return null;
  const parts = splitTopLevel(call.slice(1, -1), ",");
  if (parts.length !== 2) return null;
  const field = parts[0]?.trim();
  const value = parts[1] ? unquote(parts[1].trim()) : "";
  return field ? { kind, field, value } : null;
}

function parseAnyOf(expression: string): Extract<DataverseFilter, { readonly kind: "anyOf" }> | null {
  const comparisons = splitTopLevel(expression, " or ").map((part) => parseComparison(removeOuterParentheses(part)));
  if (comparisons.length < 2 || comparisons.some((comparison) => comparison === null)) return null;
  const first = comparisons[0];
  if (!first || comparisons.some((comparison) => comparison?.field !== first.field || comparison?.operator !== first.operator)) return null;
  return { kind: "anyOf", field: first.field, operator: first.operator, values: comparisons.map((comparison) => comparison!.value) };
}

function parseComparison(expression: string): Extract<DataverseFilter, { readonly kind: "comparison" }> | null {
  // One comparison only; a value containing "and"/"or" would swallow the rest of the filter.
  if (splitTopLevel(expression, " and ").length > 1 || splitTopLevel(expression, " or ").length > 1) return null;
  const match = /^(.+?)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i.exec(expression);
  const operator = match?.[2] ? comparisonOperatorByOData[match[2].toLowerCase()] : undefined;
  const field = match?.[1]?.trim();
  const value = match?.[3] ? unquote(match[3].trim()) : "";
  return field && operator ? { kind: "comparison", field, operator, value } : null;
}

function parseExpansions(value: string): readonly DataverseExpansion[] {
  if (!value.trim()) return [];
  return splitTopLevel(value, ",").map(parseExpansion).filter((expansion): expansion is DataverseExpansion => expansion !== null);
}

function parseExpansion(value: string): DataverseExpansion | null {
  const entry = value.trim();
  if (!entry) return null;
  const opening = entry.indexOf("(");
  if (opening === -1) return { name: entry, selectedColumns: [], expansions: [] };
  if (!entry.endsWith(")")) return null;

  const name = entry.slice(0, opening).trim();
  const options = splitTopLevel(entry.slice(opening + 1, -1), ";");
  const select = options.find((option) => option.trim().startsWith("$select="))?.trim().slice("$select=".length) ?? "";
  const expand = options.find((option) => option.trim().startsWith("$expand="))?.trim().slice("$expand=".length) ?? "";
  return name ? { name, selectedColumns: splitTopLevel(select, ","), expansions: parseExpansions(expand) } : null;
}

function sortFilters(filters: readonly DataverseFilter[]): readonly DataverseFilter[] {
  const rank: Readonly<Record<DataverseFilter["kind"], number>> = { comparison: 0, anyOf: 1, any: 2, notAny: 3, contains: 4, startsWith: 4, endsWith: 4, or: 5, unsupported: 6 };
  return filters.map((filter, index) => ({ filter, index })).sort((left, right) => rank[left.filter.kind] - rank[right.filter.kind] || left.index - right.index).map(({ filter }) => filter);
}

function splitTopLevel(value: string, delimiter: string): readonly string[] {
  if (!value.trim()) return [];
  const parts: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "'") {
      if (quote && value[index + 1] === "'") {
        index++;
        continue;
      }
      quote = !quote;
      continue;
    }
    if (quote) continue;
    if (character === "(") depth++;
    else if (character === ")") depth--;
    else if (depth === 0 && value.startsWith(delimiter, index)) {
      const part = value.slice(start, index).trim();
      if (part) parts.push(part);
      index += delimiter.length - 1;
      start = index + 1;
    }
  }
  const finalPart = value.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function removeOuterParentheses(value: string): string {
  if (!value.startsWith("(") || !value.endsWith(")")) return value;
  let depth = 0;
  let quote = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === "'") quote = !quote;
    if (quote) continue;
    if (character === "(") depth++;
    if (character === ")") depth--;
    if (depth === 0 && index < value.length - 1) return value;
  }
  return value.slice(1, -1).trim();
}

function unquote(value: string): string {
  return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value;
}
