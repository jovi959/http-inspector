import type { DataverseRecord, DataverseRecordValue, DataverseResponseRecords } from "@/domain/dataverse/dataverseMapTypes";

/** Reads only the OData collection already captured with the selected Dataverse response. */
export function createDataverseResponseRecords(bodyText: string | null): DataverseResponseRecords {
  if (!bodyText) return { records: [], error: "No captured Dataverse response is available." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { records: [], error: "The captured response is not valid JSON." };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.value)) return { records: [], error: "The captured response does not contain an OData value array." };
  return { records: parsed.value.filter(isRecord).map(asDataverseRecord), error: null };
}

function asDataverseRecord(value: Record<string, unknown>): DataverseRecord {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asDataverseValue(item)]));
}

function asDataverseValue(value: unknown): DataverseRecordValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(asDataverseValue);
  return isRecord(value) ? asDataverseRecord(value) : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
