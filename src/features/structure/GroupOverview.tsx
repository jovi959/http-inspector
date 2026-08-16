import { formatBytes } from "@/domain/display/bytePresentation";
import { formatDuration } from "@/domain/display/timingPresentation";
import type { CaptureStatus } from "@/data/ports/CaptureReader";
import type { StructureNode } from "@/state/structure/treeIndex";

interface GroupOverviewProps {
  readonly group: StructureNode;
  readonly captureStatus: CaptureStatus;
}

/** Presents summary-only group aggregates without expanding capture bodies or metadata. */
export function GroupOverview({ group, captureStatus }: GroupOverviewProps) {
  const averageDuration = group.aggregate.knownDurationCount === 0
    ? null
    : Math.round(group.aggregate.knownDurationTotalMs / group.aggregate.knownDurationCount);
  const entries = [
    ["Identity", group.label],
    ["Requests", `${group.aggregate.exchangeCount} total; ${group.aggregate.inFlightCount} in flight; ${group.aggregate.errorCount} error`],
    ["Timing", averageDuration === null ? "No captured durations" : `${formatDuration(averageDuration)} average across ${group.aggregate.knownDurationCount} captured durations`],
    ["Size", formatBytes(group.aggregate.knownTotalBytes)],
    ["Sources", Object.entries(group.aggregate.sourceCounts).map(([source, count]) => `${source} (${count})`).join(", ") || "—"],
    ["Capture diagnostics", `${captureStatus.droppedCount} dropped; ${captureStatus.rejectedCount} rejected`],
  ] as const;
  return (
    <section className="group-overview" aria-label={`${group.label} overview`}>
      <div className="inspector-tabs"><span>Overview</span></div>
      <dl className="overview-list">
        {entries.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
  );
}
