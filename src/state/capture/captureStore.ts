import { create } from "zustand";

import { createCaptureEntitiesSlice } from "@/state/capture/captureEntitiesSlice";
import { createCapturePreferencesSlice } from "@/state/capture/capturePreferencesSlice";
import { createCaptureSelectionSlice } from "@/state/capture/captureSelectionSlice";
import type { CaptureStore } from "@/state/capture/captureStoreTypes";
import { createRecomposeDraftSlice } from "@/state/recompose/recomposeDraftSlice";

/** The store file is intentionally only a composition root for focused state slices. */
export const useCaptureStore = create<CaptureStore>()((...args) => ({
  ...createCaptureEntitiesSlice(...args),
  ...createCaptureSelectionSlice(...args),
  ...createCapturePreferencesSlice(...args),
  ...createRecomposeDraftSlice(...args),
}));
