import { useEffect } from "react";

import type { WorkspaceView } from "@/state/preferences/displayPreferences";

interface AppShortcuts {
  readonly workspaceView: WorkspaceView;
  setWorkspaceView(view: WorkspaceView): void;
  clearSelection(): void;
}

/** Installs app shortcuts only when focus is outside editable controls and CodeMirror. */
export function useAppShortcuts({ workspaceView, setWorkspaceView, clearSelection }: AppShortcuts): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "1") {
        event.preventDefault();
        setWorkspaceView("structure");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "2") {
        event.preventDefault();
        setWorkspaceView("sequence");
      } else if ((event.metaKey || event.ctrlKey) && event.key === "3") {
        event.preventDefault();
        setWorkspaceView("database");
      } else if (event.key === "Escape" && workspaceView) {
        event.preventDefault();
        clearSelection();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, setWorkspaceView, workspaceView]);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']") || target.closest(".cm-editor") !== null;
}
