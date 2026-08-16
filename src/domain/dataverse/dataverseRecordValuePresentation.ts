import type { DataverseRecordValue } from "@/domain/dataverse/dataverseMapTypes";

export type DataverseRecordValueKind = "string" | "number" | "boolean" | "null" | "related" | "unavailable";

export interface DataverseRecordValuePresentation {
  readonly kind: DataverseRecordValueKind;
  readonly text: string;
}

/** Produces a compact JSON-faithful value label for a Dataverse entity member. */
export function createDataverseRecordValuePresentation(value: DataverseRecordValue | undefined): DataverseRecordValuePresentation {
  if (value === undefined) return { kind: "unavailable", text: "not returned" };
  if (value === null) return { kind: "null", text: "null" };
  if (typeof value === "string") return { kind: "string", text: JSON.stringify(truncate(value)) };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  if (typeof value === "boolean") return { kind: "boolean", text: String(value) };
  if (Array.isArray(value)) return { kind: "related", text: `${value.length} related record${value.length === 1 ? "" : "s"}` };
  return { kind: "related", text: "related record" };
}

function truncate(value: string): string {
  const limit = 72;
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
