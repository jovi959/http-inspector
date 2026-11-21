/** A constant or enum member in the user's source code that holds a GUID or integer value. */
export interface DataverseValueName {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

/** Index built by scanning the integrated projects' source; keys are normalized values. */
export interface DataverseValueNameIndex {
  readonly roots: readonly string[];
  readonly scannedAtEpochSeconds: number;
  readonly filesScanned: number;
  readonly entries: Readonly<Record<string, readonly DataverseValueName[]>>;
}

/** Returns the source names for a filter value, best match for the field first. */
export type DataverseValueDescriber = (field: string, value: string) => readonly string[];

const guidPattern = /^\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?$/i;
const integerPattern = /^-?\d+$/;
const smallNumberLimit = 1000;

export function normalizeDataverseValue(value: string): string | null {
  const text = value.trim();
  const guid = guidPattern.exec(text)?.[1];
  if (guid) return guid.toLowerCase();
  if (!integerPattern.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? String(number) : text.replace(/^(-?)0+(?=\d)/, "$1");
}

export function createDataverseValueDescriber(index: DataverseValueNameIndex): DataverseValueDescriber {
  return (field, value) => {
    const key = normalizeDataverseValue(value);
    const candidates = key ? index.entries[key] ?? [] : [];
    if (candidates.length === 0) return [];
    const fieldText = normalizeField(field);
    const ranked = [...new Set(candidates.map((candidate) => candidate.name))]
      .map((name) => ({ name, score: fieldMatchScore(name, fieldText), isTest: isTestConstant(name) }))
      .sort((left, right) => right.score - left.score || Number(left.isTest) - Number(right.isTest) || left.name.localeCompare(right.name));
    // Small numbers (0, 1, 2…) are named all over a codebase; only trust a name that matches the field.
    const isSmall = Math.abs(Number(key)) < smallNumberLimit;
    return ranked.filter((candidate) => !isSmall || candidate.score > 0).map((candidate) => candidate.name);
  };
}

/** One name per value keeps the map readable; names are already ranked best-first. */
export function formatDataverseValueLabel(value: string, names: readonly string[]): string {
  const best = names[0];
  return best ? `${value} · ${best}` : value;
}

// Test classes often copy real values; prefer the production constant on a tie.
function isTestConstant(name: string): boolean {
  return /Tests?$/.test(name.split(".")[0] ?? "");
}

function normalizeField(field: string): string {
  return field.toLowerCase().replace(/^_/, "").replace(/_value$/, "").replace(/[^a-z0-9]/g, "");
}

// Counts the name's words (by their first six letters) that appear in the field, e.g. "AssignedTo" ~ "wsbc_armsassignto".
function fieldMatchScore(name: string, fieldText: string): number {
  const words = name.split(".").flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/)).map((word) => word.toLowerCase()).filter((word) => word.length >= 3);
  return words.filter((word) => fieldText.includes(word.slice(0, 6))).length;
}
