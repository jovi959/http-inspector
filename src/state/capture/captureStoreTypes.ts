import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import type { CaptureSnapshot, CaptureStatus } from "@/data/ports/CaptureReader";
import type { HttpExchange, HttpExchangeSummary } from "@/generated/contracts";
import type { StructureTreeIndex } from "@/state/structure/treeIndex";
import type { CaptureFilter } from "@/state/sequence/filterParser";
import type { SequenceSort } from "@/state/sequence/sequenceSelectors";
import type { AppTheme, SequenceColumnId, SequenceColumnWidths, WorkspacePaneLayout, WorkspaceView } from "@/state/preferences/displayPreferences";
import type { RecomposeSlice } from "@/state/recompose/recomposeTypes";

export type { WorkspaceView } from "@/state/preferences/displayPreferences";

/** Entity concerns intentionally exclude selection and user-preference state. */
export interface CaptureEntitiesSlice {
  readonly summaryById: Readonly<Record<string, HttpExchangeSummary>>;
  readonly detailById: Readonly<Record<string, HttpExchange>>;
  readonly arrivalOrder: readonly string[];
  readonly structureTree: StructureTreeIndex;
  readonly captureStatus: CaptureStatus;
  applyDeltas(deltas: readonly CaptureDelta[]): void;
  replaceSnapshot(snapshot: CaptureSnapshot): void;
}

/** Selection remains independent so filtered views can share it safely. */
export interface CaptureSelectionSlice {
  readonly selectedExchangeId: string | null;
  readonly selectedGroupId: string | null;
  readonly selectedExchangeHidden: boolean;
  readonly selectedExchangeEvicted: boolean;
  selectExchange(id: string | null): void;
  selectGroup(id: string | null): void;
  setSelectionVisibility(visibleExchangeIds: ReadonlySet<string>, visibleGroupIds: ReadonlySet<string>): void;
}

/** Display preferences persist separately from session-owned capture content. */
export interface CapturePreferencesSlice {
  readonly workspaceView: WorkspaceView;
  readonly theme: AppTheme;
  readonly paneLayout: WorkspacePaneLayout;
  readonly sequenceColumnOrder: readonly SequenceColumnId[];
  readonly sequenceColumnWidths: SequenceColumnWidths;
  readonly sequenceAtLiveEdge: boolean;
  readonly filterInput: string;
  readonly captureFilter: CaptureFilter;
  readonly filterError: string | null;
  readonly focusedGroupId: string | null;
  readonly sequenceSort: SequenceSort | null;
  readonly expandedStructureNodeIds: ReadonlySet<string>;
  readonly knownStructureNodeIds: ReadonlySet<string>;
  setWorkspaceView(view: WorkspaceView): void;
  setTheme(theme: AppTheme): void;
  setPaneLayout(layout: WorkspacePaneLayout): void;
  setSequenceColumnOrder(order: readonly SequenceColumnId[]): void;
  setSequenceColumnWidths(widths: SequenceColumnWidths): void;
  setSequenceAtLiveEdge(isAtLiveEdge: boolean): void;
  setFilterInput(input: string): void;
  setFocusedGroupId(id: string | null): void;
  setSequenceSort(sort: SequenceSort | null): void;
  observeStructureNodes(ids: readonly string[]): void;
  toggleStructureNode(id: string): void;
}

export type CaptureStore = CaptureEntitiesSlice & CaptureSelectionSlice & CapturePreferencesSlice & RecomposeSlice;
