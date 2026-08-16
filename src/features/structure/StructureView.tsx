import { useEffect, useMemo } from "react";

import { StructureTree } from "@/features/structure/StructureTree";
import { CaptureEmptyState } from "@/features/capture/CaptureEmptyState";
import { useCaptureStore } from "@/state/capture/captureStore";
import { structureGroups } from "@/state/structure/treeIndex";
import type { StructureGroup } from "@/state/structure/treeIndex";
import type { HttpExchange } from "@/generated/contracts";
import { selectFilteredExchangeIds } from "@/state/sequence/filterSelectors";

/** Translates normalized entities into a host/path navigation projection. */
export function StructureView({ onRecompose }: { readonly onRecompose: (exchange: HttpExchange, x: number, y: number) => void }) {
  const detailById = useCaptureStore((state) => state.detailById);
  const arrivalOrder = useCaptureStore((state) => state.arrivalOrder);
  const treeIndex = useCaptureStore((state) => state.structureTree);
  const summaries = useCaptureStore((state) => state.summaryById);
  const captureFilter = useCaptureStore((state) => state.captureFilter);
  const focusedGroupId = useCaptureStore((state) => state.focusedGroupId);
  const captureStatus = useCaptureStore((state) => state.captureStatus);
  const selectedExchangeId = useCaptureStore((state) => state.selectedExchangeId);
  const selectedGroupId = useCaptureStore((state) => state.selectedGroupId);
  const draft = useCaptureStore((state) => state.activeRecomposeDraft);
  const selectedDraftId = useCaptureStore((state) => state.selectedRecomposeDraftId);
  const selectExchange = useCaptureStore((state) => state.selectExchange);
  const selectGroup = useCaptureStore((state) => state.selectGroup);
  const selectDraft = useCaptureStore((state) => state.selectRecomposeDraft);
  const setSelectionVisibility = useCaptureStore((state) => state.setSelectionVisibility);
  const exchanges = useMemo(() => arrivalOrder.flatMap((id) => detailById[id] ? [detailById[id]] : []), [arrivalOrder, detailById]);
  const visibleIds = useMemo(
    () => selectFilteredExchangeIds(summaries, arrivalOrder, captureFilter, treeIndex, focusedGroupId),
    [arrivalOrder, captureFilter, focusedGroupId, summaries, treeIndex],
  );
  const groups = useMemo(() => structureGroups(treeIndex, new Set(visibleIds)), [treeIndex, visibleIds]);

  useEffect(() => {
    setSelectionVisibility(new Set(visibleIds), new Set(groupIds(groups)));
  }, [groups, setSelectionVisibility, visibleIds]);

  return (
    <section className="structure-panel panel" aria-label="Structure view">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Structure</p>
          <h2>Hosts and paths</h2>
        </div>
        <span>{visibleIds.length}/{exchanges.length} requests</span>
      </div>
      {visibleIds.length === 0 ? <CaptureEmptyState hasActiveFilter={captureFilter.terms.length > 0 || focusedGroupId !== null} status={captureStatus} view="Structure" /> : <StructureTree
        groups={groups}
        draft={draft}
        exchangeById={detailById}
        forcedExpandedNodeIds={captureFilter.terms.length > 0 || focusedGroupId !== null ? new Set(groupIds(groups)) : new Set()}
        selectedExchangeId={selectedExchangeId}
        selectedGroupId={selectedGroupId}
        selectedDraftId={selectedDraftId}
        onRecompose={onRecompose}
        onSelectExchange={selectExchange}
        onSelectGroup={selectGroup}
        onSelectDraft={selectDraft}
      />}
    </section>
  );
}

function groupIds(groups: readonly StructureGroup[]): readonly string[] {
  return groups.flatMap((group) => [group.id, ...groupIds(group.children)]);
}
