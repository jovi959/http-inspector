import type { StateCreator } from "zustand";

import { fromSnapshot, reduceCaptureDeltas } from "@/state/capture/captureDeltaReducer";
import type { CaptureEntitiesSlice, CaptureStore } from "@/state/capture/captureStoreTypes";
import { emptyStructureTreeIndex } from "@/state/structure/treeIndex";

const initialStatus = {
  sessionId: null,
  recording: false,
  connectionState: "connecting" as const,
  connectedSources: 0,
  droppedCount: 0,
  rejectedCount: 0,
  retentionBlockedByInFlight: false,
  errorMessage: "Connecting to the capture service…",
};

/** Owns only normalized session entities, detail cache, arrival order, and capture health. */
export const createCaptureEntitiesSlice: StateCreator<CaptureStore, [], [], CaptureEntitiesSlice> = (set) => ({
  summaryById: {},
  detailById: {},
  arrivalOrder: [],
  structureTree: emptyStructureTreeIndex,
  captureStatus: initialStatus,
  applyDeltas: (deltas) => set((state) => {
    const next = reduceCaptureDeltas(state, deltas);
    const reset = deltas.some((delta) => delta.kind === "reset");
    const selectedExchangeEvicted = !reset && Boolean(state.selectedExchangeId && !next.summaryById[state.selectedExchangeId]);
    if (!reset) return { ...next, selectedExchangeEvicted };
    const selectedExchangeId = state.selectedExchangeId && next.summaryById[state.selectedExchangeId] ? state.selectedExchangeId : null;
    const selectedGroupId = selectedExchangeId || !state.selectedGroupId || !next.structureTree.nodesById[state.selectedGroupId] ? null : state.selectedGroupId;
    return { ...next, selectedExchangeId, selectedGroupId, activeRecomposeDraft: null, selectedRecomposeDraftId: null, selectedExchangeHidden: false, selectedExchangeEvicted: false };
  }),
  replaceSnapshot: (snapshot) => set((state) => ({
    ...fromSnapshot(snapshot),
    selectedExchangeId: state.selectedExchangeId && snapshot.exchanges.some((exchange) => state.selectedExchangeId === `${exchange.source.instanceId}::${exchange.id}`)
      ? state.selectedExchangeId
      : null,
    selectedExchangeEvicted: false,
    selectedExchangeHidden: false,
    activeRecomposeDraft: null,
    selectedRecomposeDraftId: null,
  })),
});
