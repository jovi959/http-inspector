import { useEffect, useMemo } from "react";

import { SequenceFilterBar } from "@/features/sequence/SequenceFilterBar";
import { SequenceGrid } from "@/features/sequence/SequenceGrid";
import { CaptureEmptyState } from "@/features/capture/CaptureEmptyState";
import { useCaptureStore } from "@/state/capture/captureStore";
import { selectFilteredExchangeIds } from "@/state/sequence/filterSelectors";
import { selectSequenceExchangeIds } from "@/state/sequence/sequenceSelectors";
import { structureGroups } from "@/state/structure/treeIndex";
import type { StructureGroup } from "@/state/structure/treeIndex";
import type { HttpExchange } from "@/generated/contracts";

/** Chronological projection shares filters, selection, and entity state with Structure. */
export function SequenceView({ onRecompose }: { readonly onRecompose: (exchange: HttpExchange, x: number, y: number) => void }) {
  const detailById = useCaptureStore((state) => state.detailById);
  const arrivalOrder = useCaptureStore((state) => state.arrivalOrder);
  const summaries = useCaptureStore((state) => state.summaryById);
  const treeIndex = useCaptureStore((state) => state.structureTree);
  const selectedExchangeId = useCaptureStore((state) => state.selectedExchangeId);
  const selectedGroupId = useCaptureStore((state) => state.selectedGroupId);
  const filterInput = useCaptureStore((state) => state.filterInput);
  const captureFilter = useCaptureStore((state) => state.captureFilter);
  const filterError = useCaptureStore((state) => state.filterError);
  const focusedGroupId = useCaptureStore((state) => state.focusedGroupId);
  const sequenceSort = useCaptureStore((state) => state.sequenceSort);
  const sequenceColumnOrder = useCaptureStore((state) => state.sequenceColumnOrder);
  const sequenceColumnWidths = useCaptureStore((state) => state.sequenceColumnWidths);
  const sequenceAtLiveEdge = useCaptureStore((state) => state.sequenceAtLiveEdge);
  const captureStatus = useCaptureStore((state) => state.captureStatus);
  const setFilterInput = useCaptureStore((state) => state.setFilterInput);
  const setFocusedGroupId = useCaptureStore((state) => state.setFocusedGroupId);
  const setSequenceSort = useCaptureStore((state) => state.setSequenceSort);
  const setSequenceColumnWidths = useCaptureStore((state) => state.setSequenceColumnWidths);
  const setSequenceColumnOrder = useCaptureStore((state) => state.setSequenceColumnOrder);
  const setSequenceAtLiveEdge = useCaptureStore((state) => state.setSequenceAtLiveEdge);
  const selectExchange = useCaptureStore((state) => state.selectExchange);
  const setSelectionVisibility = useCaptureStore((state) => state.setSelectionVisibility);
  const visibleIds = useMemo(
    () => selectFilteredExchangeIds(summaries, arrivalOrder, captureFilter, treeIndex, focusedGroupId),
    [arrivalOrder, captureFilter, focusedGroupId, summaries, treeIndex],
  );
  const sequenceIds = useMemo(() => selectSequenceExchangeIds(visibleIds, summaries, sequenceSort), [sequenceSort, summaries, visibleIds]);
  const entries = useMemo(
    () => sequenceIds.flatMap((id) => detailById[id] ? [{ id, exchange: detailById[id] }] : []),
    [detailById, sequenceIds],
  );

  useEffect(() => {
    setSelectionVisibility(new Set(visibleIds), new Set(groupIds(structureGroups(treeIndex, new Set(visibleIds)))));
  }, [setSelectionVisibility, treeIndex, visibleIds]);

  return (
    <section className="sequence-panel panel" aria-label="Sequence view">
      <div className="panel-heading">
        <div><p className="eyebrow">Sequence</p><h2>Chronological capture</h2></div>
      </div>
      <SequenceFilterBar
        filterError={filterError}
        filterInput={filterInput}
        focusedGroupId={focusedGroupId}
        selectedGroupId={selectedGroupId}
        totalCount={arrivalOrder.length}
        visibleCount={visibleIds.length}
        onClearFilter={() => setFilterInput("")}
        onFilterInputChange={setFilterInput}
        onToggleFocused={() => setFocusedGroupId(focusedGroupId ? null : selectedGroupId)}
      />
      {entries.length === 0 ? <CaptureEmptyState hasActiveFilter={filterInput.trim().length > 0 || focusedGroupId !== null} status={captureStatus} view="Sequence" /> : <SequenceGrid columnOrder={sequenceColumnOrder} columnWidths={sequenceColumnWidths} entries={entries} isAtLiveEdge={sequenceAtLiveEdge} selectedExchangeId={selectedExchangeId} sequenceSort={sequenceSort} onColumnOrderChange={setSequenceColumnOrder} onColumnWidthsChange={setSequenceColumnWidths} onLiveEdgeChange={setSequenceAtLiveEdge} onRecompose={onRecompose} onSelectExchange={selectExchange} onSetSequenceSort={setSequenceSort} />}
    </section>
  );
}

function groupIds(groups: readonly StructureGroup[]): readonly string[] {
  return groups.flatMap((group) => [group.id, ...groupIds(group.children)]);
}
