import type { ExchangeState } from "@/generated/contracts";

export type FilterTerm =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "method"; readonly value: string }
  | { readonly kind: "status"; readonly minimum: number; readonly maximum: number }
  | { readonly kind: "host"; readonly value: string }
  | { readonly kind: "source"; readonly value: string }
  | { readonly kind: "state"; readonly value: ExchangeState }
  | { readonly kind: "duration"; readonly operator: ">" | ">=" | "<" | "<=" | "="; readonly milliseconds: number };

export interface CaptureFilter {
  readonly terms: readonly FilterTerm[];
}

export interface FilterParseResult {
  readonly filter: CaptureFilter;
  readonly error: string | null;
}

/** Parses only v1 structured tokens; ordinary unknown words deliberately remain full-text terms. */
export function parseCaptureFilter(input: string): FilterParseResult {
  const terms: FilterTerm[] = [];
  for (const rawToken of input.trim().split(/\s+/).filter(Boolean)) {
    const parsed = parseToken(rawToken);
    if (typeof parsed === "string") return { filter: { terms }, error: parsed };
    terms.push(parsed);
  }
  return { filter: { terms }, error: null };
}

function parseToken(rawToken: string): FilterTerm | string {
  const separator = rawToken.indexOf(":");
  if (separator === -1) return { kind: "text", value: rawToken.toLocaleLowerCase() };
  const key = rawToken.slice(0, separator).toLocaleLowerCase();
  const value = rawToken.slice(separator + 1);
  if (!["method", "status", "host", "source", "state", "duration"].includes(key)) return { kind: "text", value: rawToken.toLocaleLowerCase() };
  if (!value) return `${key}: requires a value`;
  if (key === "method") return { kind: "method", value: value.toLocaleUpperCase() };
  if (key === "host") return { kind: "host", value: value.toLocaleLowerCase() };
  if (key === "source") return { kind: "source", value: value.toLocaleLowerCase() };
  if (key === "status") return parseStatus(value);
  if (key === "state") return parseState(value);
  return parseDuration(value);
}

function parseStatus(value: string): FilterTerm | string {
  const match = /^(\d{3})(?:-(\d{3}))?$/.exec(value);
  if (!match) return "status: expects 200 or 400-499";
  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (minimum < 100 || maximum > 599 || minimum > maximum) return "status: must be between 100 and 599";
  return { kind: "status", minimum, maximum };
}

function parseState(value: string): FilterTerm | string {
  const normalized = value.replace("_", "").toLocaleLowerCase();
  const states: Readonly<Record<string, ExchangeState>> = {
    inflight: "inFlight", completed: "completed", failed: "failed", cancelled: "cancelled", incomplete: "incomplete",
  };
  const state = states[normalized];
  return state ? { kind: "state", value: state } : "state: expects in_flight, completed, failed, cancelled, or incomplete";
}

function parseDuration(value: string): FilterTerm | string {
  const match = /^(>=|<=|>|<|=)(\d+(?:\.\d+)?)(ms|s)$/.exec(value);
  if (!match) return "duration: expects >500ms, >=1s, <2s, or =20ms";
  const magnitude = Number(match[2]);
  if (!Number.isFinite(magnitude)) return "duration: must be finite";
  return {
    kind: "duration",
    operator: match[1] as ">" | ">=" | "<" | "<=" | "=",
    milliseconds: Math.round(magnitude * (match[3] === "s" ? 1_000 : 1)),
  };
}
