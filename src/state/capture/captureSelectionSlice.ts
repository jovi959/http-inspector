import type { StateCreator } from "zustand";

import type { CaptureSelectionSlice, CaptureStore } from "@/state/capture/captureStoreTypes";

/** Owns shared exchange selection for both Structure and Sequence projections. */
export const createCaptureSelectionSlice: StateCreator<CaptureStore, [], [], CaptureSelectionSlice> = (set) => ({
  selectedExchangeId: null,
  selectedGroupId: null,
  selectedExchangeHidden: false,
  selectedExchangeEvicted: false,
  selectExchange: (selectedExchangeId) => set({ selectedExchangeId, selectedGroupId: null, selectedRecomposeDraftId: null, selectedExchangeHidden: false, selectedExchangeEvicted: false }),
  selectGroup: (selectedGroupId) => set({ selectedGroupId, selectedExchangeId: null, selectedRecomposeDraftId: null, selectedExchangeHidden: false, selectedExchangeEvicted: false }),
  setSelectionVisibility: (visibleExchangeIds, visibleGroupIds) => set((state) => ({
    selectedExchangeHidden: Boolean(
      (state.selectedExchangeId && !visibleExchangeIds.has(state.selectedExchangeId))
      || (state.selectedGroupId && !visibleGroupIds.has(state.selectedGroupId)),
    ),
  })),
});
