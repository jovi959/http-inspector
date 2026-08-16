import type { RecomposeQueryRow, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

/** Splits URL presentation from ordered raw query components without URLSearchParams reserialization. */
export function parseRecomposeUrl(url: string): Pick<RecomposeWorkingCopy, "baseUrl" | "fragment" | "query"> {
  const fragmentIndex = url.indexOf("#");
  const fragment = fragmentIndex >= 0 ? url.slice(fragmentIndex + 1) : null;
  const withoutFragment = fragmentIndex >= 0 ? url.slice(0, fragmentIndex) : url;
  const queryIndex = withoutFragment.indexOf("?");
  const baseUrl = queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
  const rawQuery = queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : "";
  const query = rawQuery === "" ? [] : rawQuery.split("&").map(parseQueryComponent);
  return { baseUrl, fragment, query };
}

export function buildReplayUrl(working: RecomposeWorkingCopy): string {
  const query = working.query.map(serializeQueryRow).join("&");
  return `${working.baseUrl}${query ? `?${query}` : ""}${working.fragment === null ? "" : `#${working.fragment}`}`;
}

export function createQueryRow(): RecomposeQueryRow {
  return { id: crypto.randomUUID(), name: "", value: "", encodedName: null, encodedValue: null, edited: true };
}

function parseQueryComponent(component: string): RecomposeQueryRow {
  const equalsIndex = component.indexOf("=");
  const encodedName = equalsIndex >= 0 ? component.slice(0, equalsIndex) : component;
  const encodedValue = equalsIndex >= 0 ? component.slice(equalsIndex + 1) : null;
  return {
    id: crypto.randomUUID(),
    name: decodeComponent(encodedName),
    value: encodedValue === null ? null : decodeComponent(encodedValue),
    encodedName,
    encodedValue,
    edited: false,
  };
}

function serializeQueryRow(row: RecomposeQueryRow): string {
  const name = row.edited ? encodeURIComponent(row.name) : (row.encodedName ?? encodeURIComponent(row.name));
  if (row.value === null) return name;
  const value = row.edited ? encodeURIComponent(row.value) : (row.encodedValue ?? encodeURIComponent(row.value));
  return `${name}=${value}`;
}

function decodeComponent(value: string): string {
  try { return decodeURIComponent(value.replaceAll("+", " ")); } catch { return value; }
}
