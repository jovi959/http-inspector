import type { StateCreator } from "zustand";

import type { CapturePreferencesSlice, CaptureStore } from "@/state/capture/captureStoreTypes";
import { parseCaptureFilter } from "@/state/sequence/filterParser";
import { loadDisplayPreferences, saveDisplayPreferences } from "@/state/preferences/displayPreferences";
import type { StoredDisplayPreferences } from "@/state/preferences/displayPreferences";

const saved = loadDisplayPreferences();

/** Keeps display preferences out of session reset and delta processing. */
export const createCapturePreferencesSlice: StateCreator<CaptureStore, [], [], CapturePreferencesSlice> = (set) => ({
  workspaceView: saved.workspaceView,
  theme: saved.theme,
  paneLayout: saved.paneLayout,
  sequenceColumnOrder: saved.sequenceColumnOrder,
  sequenceColumnWidths: saved.sequenceColumnWidths,
  sequenceAtLiveEdge: true,
  filterInput: "",
  captureFilter: { terms: [] },
  filterError: null,
  focusedGroupId: null,
  sequenceSort: null,
  expandedStructureNodeIds: new Set(),
  knownStructureNodeIds: new Set(),
  setWorkspaceView: (workspaceView) => set((state) => saveAndReturn(state, { workspaceView })),
  setTheme: (theme) => set((state) => saveAndReturn(state, { theme })),
  setPaneLayout: (paneLayout) => set((state) => saveAndReturn(state, { paneLayout })),
  setSequenceColumnOrder: (sequenceColumnOrder) => set((state) => saveAndReturn(state, { sequenceColumnOrder })),
  setSequenceColumnWidths: (sequenceColumnWidths) => set((state) => saveAndReturn(state, { sequenceColumnWidths })),
  setSequenceAtLiveEdge: (sequenceAtLiveEdge) => set({ sequenceAtLiveEdge }),
  setFilterInput: (filterInput) => set(() => {
    const parsed = parseCaptureFilter(filterInput);
    return parsed.error ? { filterInput, filterError: parsed.error } : { filterInput, captureFilter: parsed.filter, filterError: null };
  }),
  setFocusedGroupId: (focusedGroupId) => set({ focusedGroupId }),
  setSequenceSort: (sequenceSort) => set({ sequenceSort }),
  observeStructureNodes: (ids) => set((state) => {
    const knownStructureNodeIds = new Set(state.knownStructureNodeIds);
    const expandedStructureNodeIds = new Set(state.expandedStructureNodeIds);
    for (const id of ids) {
      if (!knownStructureNodeIds.has(id)) expandedStructureNodeIds.add(id);
      knownStructureNodeIds.add(id);
    }
    return { knownStructureNodeIds, expandedStructureNodeIds };
  }),
  toggleStructureNode: (id) => set((state) => {
    const expandedStructureNodeIds = new Set(state.expandedStructureNodeIds);
    if (expandedStructureNodeIds.has(id)) expandedStructureNodeIds.delete(id);
    else expandedStructureNodeIds.add(id);
    return { expandedStructureNodeIds };
  }),
});

function saveAndReturn(state: CapturePreferencesSlice, change: Partial<StoredDisplayPreferences>): Partial<CapturePreferencesSlice> {
  const preferences: StoredDisplayPreferences = {
    theme: change.theme ?? state.theme,
    workspaceView: change.workspaceView ?? state.workspaceView,
    paneLayout: change.paneLayout ?? state.paneLayout,
    sequenceColumnOrder: change.sequenceColumnOrder ?? state.sequenceColumnOrder,
    sequenceColumnWidths: change.sequenceColumnWidths ?? state.sequenceColumnWidths,
  };
  saveDisplayPreferences(preferences);
  return change;
}
