import type { HttpExchangeSummary } from "@/generated/contracts";

/** Incremental group values track only summary data so Structure never needs to scan captured bodies. */
export interface StructureAggregate {
  readonly exchangeCount: number;
  readonly inFlightCount: number;
  readonly errorCount: number;
  readonly knownDurationTotalMs: number;
  readonly knownDurationCount: number;
  readonly knownTotalBytes: number;
  readonly sourceCounts: Readonly<Record<string, number>>;
}

export const emptyStructureAggregate: StructureAggregate = {
  exchangeCount: 0,
  inFlightCount: 0,
  errorCount: 0,
  knownDurationTotalMs: 0,
  knownDurationCount: 0,
  knownTotalBytes: 0,
  sourceCounts: {},
};

/** Adds or removes one summary contribution while preserving unavailable timing and size values. */
export function changeAggregate(
  aggregate: StructureAggregate,
  summary: HttpExchangeSummary,
  direction: 1 | -1,
): StructureAggregate {
  const currentSourceCount = aggregate.sourceCounts[summary.sourceName] ?? 0;
  const nextSourceCount = currentSourceCount + direction;
  const { [summary.sourceName]: removedSource, ...otherSources } = aggregate.sourceCounts;
  void removedSource;
  const sourceCounts = nextSourceCount > 0 ? { ...aggregate.sourceCounts, [summary.sourceName]: nextSourceCount } : otherSources;
  const duration = summary.durationMs ?? 0;
  const knownDuration = summary.durationMs === null ? 0 : 1;
  const totalBytes = summary.totalBytes ?? 0;
  return {
    exchangeCount: aggregate.exchangeCount + direction,
    inFlightCount: aggregate.inFlightCount + (summary.lifecycle.state === "inFlight" ? direction : 0),
    errorCount: aggregate.errorCount + (isError(summary) ? direction : 0),
    knownDurationTotalMs: aggregate.knownDurationTotalMs + (duration * direction),
    knownDurationCount: aggregate.knownDurationCount + (knownDuration * direction),
    knownTotalBytes: aggregate.knownTotalBytes + (totalBytes * direction),
    sourceCounts,
  };
}

function isError(summary: HttpExchangeSummary): boolean {
  return summary.lifecycle.state === "failed" || (summary.statusCode !== null && summary.statusCode >= 400);
}
