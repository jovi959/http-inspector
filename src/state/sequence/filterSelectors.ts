import type { HttpExchangeSummary } from "@/generated/contracts";
import type { StructureTreeIndex } from "@/state/structure/treeIndex";

import type { CaptureFilter, FilterTerm } from "./filterParser";

/** Shares one summary-only predicate between Sequence rows and Structure leaves. */
export function selectFilteredExchangeIds(
  summaries: Readonly<Record<string, HttpExchangeSummary>>,
  arrivalOrder: readonly string[],
  filter: CaptureFilter,
  tree: StructureTreeIndex,
  focusedGroupId: string | null,
): readonly string[] {
  const focusedIds = focusedGroupId ? exchangeIdsUnderGroup(tree, focusedGroupId) : null;
  return arrivalOrder.filter((key) => {
    const summary = summaries[key];
    return Boolean(summary && (!focusedIds || focusedIds.has(key)) && matchesCaptureFilter(summary, filter));
  });
}

export function matchesCaptureFilter(summary: HttpExchangeSummary, filter: CaptureFilter): boolean {
  return filter.terms.every((term) => matchesTerm(summary, term));
}

/** Computes the Focused set from the maintained tree index rather than URL-string prefixes. */
export function exchangeIdsUnderGroup(tree: StructureTreeIndex, groupId: string): ReadonlySet<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    const node = tree.nodesById[id];
    if (!node) return;
    node.exchangeIds.forEach((exchangeId) => result.add(exchangeId));
    node.childIds.forEach(visit);
  };
  visit(groupId);
  return result;
}

function matchesTerm(summary: HttpExchangeSummary, term: FilterTerm): boolean {
  if (term.kind === "method") return summary.method.toLocaleUpperCase() === term.value;
  if (term.kind === "status") return summary.statusCode !== null && summary.statusCode >= term.minimum && summary.statusCode <= term.maximum;
  if (term.kind === "host") return summary.host?.toLocaleLowerCase().includes(term.value) ?? false;
  if (term.kind === "source") return summary.sourceName.toLocaleLowerCase().includes(term.value);
  if (term.kind === "state") return summary.lifecycle.state === term.value;
  if (term.kind === "duration") return matchesDuration(summary.durationMs, term);
  const searchable = [summary.method, summary.url, summary.host, summary.path, summary.sourceName, summary.statusCode?.toString(), summary.info]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLocaleLowerCase();
  return searchable.includes(term.value);
}

function matchesDuration(value: number | null, term: Extract<FilterTerm, { readonly kind: "duration" }>): boolean {
  if (value === null) return false;
  if (term.operator === ">") return value > term.milliseconds;
  if (term.operator === ">=") return value >= term.milliseconds;
  if (term.operator === "<") return value < term.milliseconds;
  if (term.operator === "<=") return value <= term.milliseconds;
  return value === term.milliseconds;
}
