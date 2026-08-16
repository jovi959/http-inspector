import type { DataverseRecordValueKind } from "@/domain/dataverse/dataverseRecordValuePresentation";

const numberValue = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Identifies a JSON value from its already-rendered Dataverse member label. */
export function getDataverseDiagramValueKind(value: string): Extract<DataverseRecordValueKind, "string" | "number" | "boolean" | "null"> | null {
  if (value.startsWith('"') && value.endsWith('"')) return "string";
  if (value === "null") return "null";
  if (value === "true" || value === "false") return "boolean";
  return numberValue.test(value) ? "number" : null;
}
