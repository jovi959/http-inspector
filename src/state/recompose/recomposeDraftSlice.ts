import type { StateCreator } from "zustand";

import type { CaptureStore } from "@/state/capture/captureStoreTypes";
import type { RecomposeSlice } from "@/state/recompose/recomposeTypes";

/** Owns the one session-scoped editable draft without inserting it into capture entities. */
export const createRecomposeDraftSlice: StateCreator<CaptureStore, [], [], RecomposeSlice> = (set) => ({
  activeRecomposeDraft: null,
  selectedRecomposeDraftId: null,
  openRecomposeDraft: (draft) => set((state) => {
    const current = state.activeRecomposeDraft;
    const retained = current && (current.dirty || current.hasExecuted) ? current : draft;
    return {
      activeRecomposeDraft: retained,
      selectedRecomposeDraftId: retained.id,
      selectedExchangeId: null,
      selectedGroupId: null,
      selectedExchangeHidden: false,
      selectedExchangeEvicted: false,
    };
  }),
  selectRecomposeDraft: () => set((state) => state.activeRecomposeDraft ? {
    selectedRecomposeDraftId: state.activeRecomposeDraft.id,
    selectedExchangeId: null,
    selectedGroupId: null,
    selectedExchangeHidden: false,
    selectedExchangeEvicted: false,
  } : {}),
  setRecomposeMode: (selectedMode) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, selectedMode },
  } : {}),
  setRecomposeWorking: (working) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: {
      ...state.activeRecomposeDraft,
      working,
      dirty: !workingCopiesEqual(working, state.activeRecomposeDraft.baseline),
      rawText: null,
      rawError: null,
      error: null,
    },
  } : {}),
  setRecomposeRawText: (rawText) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, rawText, rawError: null, dirty: true, error: null },
  } : {}),
  setRecomposeRawError: (rawError) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, rawError },
  } : {}),
  beginRecomposeExecution: () => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, pending: true, error: null },
  } : {}),
  completeRecomposeExecution: (latestExecution) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, pending: false, hasExecuted: true, latestExecution },
  } : {}),
  failRecomposeExecution: (error) => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: { ...state.activeRecomposeDraft, pending: false, error },
  } : {}),
  revertRecomposeDraft: () => set((state) => state.activeRecomposeDraft ? {
    activeRecomposeDraft: {
      ...state.activeRecomposeDraft,
      working: state.activeRecomposeDraft.baseline,
      selectedMode: "url",
      rawText: null,
      rawError: null,
      dirty: false,
      hasExecuted: false,
      pending: false,
      error: null,
      latestExecution: null,
    },
  } : {}),
  cancelRecomposeDraft: () => set((state) => ({
    activeRecomposeDraft: null,
    selectedRecomposeDraftId: null,
    selectedExchangeId: state.activeRecomposeDraft?.sourceExchangeId ?? null,
    selectedGroupId: null,
    selectedExchangeHidden: false,
    selectedExchangeEvicted: false,
  })),
});

function workingCopiesEqual(left: object, right: object): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
