import type { ReactNode } from "react";

import { Group, Panel, Separator } from "react-resizable-panels";

import type { WorkspacePaneLayout } from "@/state/preferences/displayPreferences";

interface AppShellProps {
  readonly toolbar: ReactNode;
  readonly workspaceSwitch: ReactNode;
  readonly primaryView: ReactNode;
  readonly inspector: ReactNode;
  readonly statusBar: ReactNode;
  readonly paneLayout: WorkspacePaneLayout;
  onPaneLayoutChange(layout: WorkspacePaneLayout): void;
}

/** Keeps top-level layout composition separate from capture state and feature rendering. */
export function AppShell({ toolbar, workspaceSwitch, primaryView, inspector, paneLayout, statusBar, onPaneLayoutChange }: AppShellProps) {
  return (
    <main className="app-shell">
      {toolbar}
      <div className="workspace-switch-wrap">{workspaceSwitch}</div>
      <Group className="workspace-panels" defaultLayout={{ "capture-primary": paneLayout.primary, "capture-inspector": paneLayout.inspector }} id="inspector-workspace" orientation="horizontal" onLayoutChanged={(layout) => onPaneLayoutChange({ primary: layout["capture-primary"] ?? paneLayout.primary, inspector: layout["capture-inspector"] ?? paneLayout.inspector })}>
        <Panel className="primary-view" id="capture-primary" minSize="350px">{primaryView}</Panel>
        <Separator className="workspace-resize-handle" />
        <Panel id="capture-inspector" minSize="460px">{inspector}</Panel>
      </Group>
      {statusBar}
    </main>
  );
}
