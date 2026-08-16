import type { HttpExchangeSummary } from "@/generated/contracts";

export type SequenceSortColumn = "arrival" | "method" | "host" | "path" | "source" | "status" | "duration";
export type SequenceSortDirection = "ascending" | "descending";

export interface SequenceSort {
  readonly column: SequenceSortColumn;
  readonly direction: SequenceSortDirection;
}

/** Preserves inspector arrival order by default and gives every optional sort a deterministic arrival tie-breaker. */
export function selectSequenceExchangeIds(
  visibleIds: readonly string[],
  summaries: Readonly<Record<string, HttpExchangeSummary>>,
  sort: SequenceSort | null,
): readonly string[] {
  if (!sort) return visibleIds;
  if (sort.column === "arrival") return sort.direction === "ascending" ? visibleIds : [...visibleIds].reverse();
  const direction = sort.direction === "ascending" ? 1 : -1;
  return [...visibleIds].sort((left, right) => {
    const comparison = compareSummary(summaries[left]!, summaries[right]!, sort.column);
    return comparison === 0 ? summaries[left]!.arrivalSequence - summaries[right]!.arrivalSequence : comparison * direction;
  });
}

export function selectedSequenceIndex(exchangeIds: readonly string[], selectedExchangeId: string | null): number {
  return selectedExchangeId === null ? -1 : exchangeIds.indexOf(selectedExchangeId);
}

function compareSummary(left: HttpExchangeSummary, right: HttpExchangeSummary, column: SequenceSortColumn): number {
  if (column === "method") return left.method.localeCompare(right.method);
  if (column === "host") return (left.host ?? "").localeCompare(right.host ?? "");
  if (column === "path") return (left.path ?? "").localeCompare(right.path ?? "");
  if (column === "source") return left.sourceName.localeCompare(right.sourceName);
  if (column === "status") return (left.statusCode ?? -1) - (right.statusCode ?? -1);
  if (column === "duration") return (left.durationMs ?? -1) - (right.durationMs ?? -1);
  return left.arrivalSequence - right.arrivalSequence;
}
