export type AppTheme = "system" | "light" | "dark";
export type WorkspaceView = "structure" | "sequence";
export type SequenceColumnId = "status" | "method" | "host" | "path" | "source" | "arrival" | "duration";

export interface WorkspacePaneLayout {
  readonly primary: number;
  readonly inspector: number;
}

export type SequenceColumnWidths = Readonly<Partial<Record<SequenceColumnId, number>>>;

export interface StoredDisplayPreferences {
  readonly theme: AppTheme;
  readonly workspaceView: WorkspaceView;
  readonly paneLayout: WorkspacePaneLayout;
  readonly sequenceColumnOrder: readonly SequenceColumnId[];
  readonly sequenceColumnWidths: SequenceColumnWidths;
}

const storageKey = "http-inspector.display-preferences.v1";
export const defaultSequenceColumnOrder: readonly SequenceColumnId[] = ["status", "method", "host", "path", "source", "arrival", "duration"];
export const defaultDisplayPreferences: StoredDisplayPreferences = {
  theme: "system",
  workspaceView: "structure",
  paneLayout: { primary: 44, inspector: 56 },
  sequenceColumnOrder: defaultSequenceColumnOrder,
  sequenceColumnWidths: {},
};

/** Reads display-only preferences defensively; captures are never written to browser storage. */
export function loadDisplayPreferences(): StoredDisplayPreferences {
  if (typeof window === "undefined") return defaultDisplayPreferences;
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    return isStoredDisplayPreferences(value) ? value : defaultDisplayPreferences;
  } catch {
    return defaultDisplayPreferences;
  }
}

export function saveDisplayPreferences(preferences: StoredDisplayPreferences): void {
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify(preferences));
}

function isStoredDisplayPreferences(value: unknown): value is StoredDisplayPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredDisplayPreferences>;
  return (candidate.theme === "system" || candidate.theme === "light" || candidate.theme === "dark")
    && (candidate.workspaceView === "structure" || candidate.workspaceView === "sequence")
    && isPaneLayout(candidate.paneLayout)
    && isColumnOrder(candidate.sequenceColumnOrder)
    && isColumnWidths(candidate.sequenceColumnWidths);
}

function isColumnOrder(value: unknown): value is readonly SequenceColumnId[] {
  return Array.isArray(value)
    && value.length === defaultSequenceColumnOrder.length
    && value.every(isSequenceColumnId)
    && new Set(value).size === defaultSequenceColumnOrder.length;
}

function isPaneLayout(value: unknown): value is WorkspacePaneLayout {
  if (!value || typeof value !== "object") return false;
  const pane = value as Partial<WorkspacePaneLayout>;
  return typeof pane.primary === "number" && typeof pane.inspector === "number" && pane.primary > 0 && pane.inspector > 0;
}

function isColumnWidths(value: unknown): value is SequenceColumnWidths {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).every(([key, width]) => isSequenceColumnId(key) && typeof width === "number" && width > 0);
}

function isSequenceColumnId(value: unknown): value is SequenceColumnId {
  return typeof value === "string" && defaultSequenceColumnOrder.includes(value as SequenceColumnId);
}
