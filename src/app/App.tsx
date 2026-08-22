import { useEffect, useState } from "react";

import { AppShell } from "@/app/AppShell";
import { AppErrorBoundary } from "@/app/AppErrorBoundary";
import { useAppShortcuts } from "@/app/useAppShortcuts";
import { CaptureStatusBar } from "@/features/capture/CaptureStatusBar";
import { CaptureToolbar } from "@/features/capture/CaptureToolbar";
import { getExchangeStoreKey } from "@/domain/display/exchangeKey";
import { Inspector } from "@/features/inspector/Inspector";
import { SequenceView } from "@/features/sequence/SequenceView";
import { StructureView } from "@/features/structure/StructureView";
import { DatabaseCommandInspector, DatabaseWorkspace } from "@/features/database/DatabaseWorkspace";
import { RecomposeContextMenu } from "@/features/recompose/RecomposeContextMenu";
import { createRecomposeDraft } from "@/features/recompose/recomposeDraft";
import { exportExchange } from "@/features/export/exchangeExport";
import { parseExchangeImport } from "@/features/import/exchangeImport";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { DatabaseCaptureDataSource } from "@/data/ports/DatabaseCaptureDataSource";
import type { ProjectIntegrationService } from "@/data/ports/ProjectIntegrationService";
import type { DatabaseCommand, HttpExchange } from "@/generated/contracts";
import { useCaptureStore } from "@/state/capture/captureStore";
import { ProjectIntegrationsDialog } from "@/features/projectIntegration/ProjectIntegrationsDialog";

interface AppProps {
  readonly dataSource: CaptureDataSource;
  readonly databaseDataSource: DatabaseCaptureDataSource | null;
  readonly projectIntegration: ProjectIntegrationService;
  readonly isImported?: boolean;
  onImportedExchange?(exchange: HttpExchange): void;
  onReturnToLiveCapture?(): void;
}

interface RecomposeMenuState {
  readonly exchange: HttpExchange;
  readonly x: number;
  readonly y: number;
}

/** Loads the injected source once and renders the two synchronized capture projections. */
export function App({ dataSource, databaseDataSource, isImported = false, onImportedExchange, onReturnToLiveCapture, projectIntegration }: AppProps) {
  const [recomposeMenu, setRecomposeMenu] = useState<RecomposeMenuState | null>(null);
  const [integrationDialogOpen, setIntegrationDialogOpen] = useState(false);
  const [activeIntegrationCount, setActiveIntegrationCount] = useState(0);
  const [captureEndpoint, setCaptureEndpoint] = useState("ws://127.0.0.1:53662/v1/capture");
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedDatabaseCommand, setSelectedDatabaseCommand] = useState<DatabaseCommand | null>(null);
  const [collapsedDatabaseNodeIds, setCollapsedDatabaseNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const recording = useCaptureStore((state) => state.captureStatus.recording);
  const captureStatus = useCaptureStore((state) => state.captureStatus);
  const totalCount = useCaptureStore((state) => state.arrivalOrder.length);
  const workspaceView = useCaptureStore((state) => state.workspaceView);
  const theme = useCaptureStore((state) => state.theme);
  const paneLayout = useCaptureStore((state) => state.paneLayout);
  const replaceSnapshot = useCaptureStore((state) => state.replaceSnapshot);
  const applyDeltas = useCaptureStore((state) => state.applyDeltas);
  const selectExchange = useCaptureStore((state) => state.selectExchange);
  const selectGroup = useCaptureStore((state) => state.selectGroup);
  const setWorkspaceView = useCaptureStore((state) => state.setWorkspaceView);
  const setTheme = useCaptureStore((state) => state.setTheme);
  const setPaneLayout = useCaptureStore((state) => state.setPaneLayout);
  const openRecomposeDraft = useCaptureStore((state) => state.openRecomposeDraft);

  useAppShortcuts({ workspaceView, setWorkspaceView, clearSelection: () => {
    selectExchange(null);
    selectGroup(null);
  } });

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: () => void = () => {};

    void dataSource.getInitialSnapshot().then((snapshot) => {
      if (disposed) return;
      replaceSnapshot(snapshot);
      selectExchange(snapshot.exchanges[0] ? getExchangeStoreKey(snapshot.exchanges[0]) : null);
      unsubscribe = dataSource.subscribe(applyDeltas);
    }).catch((error: unknown) => {
      if (disposed) return;
      const errorMessage = error instanceof Error ? error.message : "The capture service is unavailable.";
      applyDeltas([{ kind: "status", status: {
        sessionId: null, recording: false, connectionState: "error", connectedSources: 0,
        droppedCount: 0, rejectedCount: 0, retentionBlockedByInFlight: false, errorMessage,
      } }]);
      unsubscribe = dataSource.subscribe(applyDeltas);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [applyDeltas, dataSource, replaceSnapshot, selectExchange]);

  useEffect(() => {
    void projectIntegration.capabilities().then((capabilities) => capabilities.available ? projectIntegration.list() : { integrations: [] }).then((catalog) => setActiveIntegrationCount(catalog.integrations.filter((record) => record.active).length)).catch(() => setActiveIntegrationCount(0));
  }, [projectIntegration]);

  const handleRecordingChange = (nextRecording: boolean) => {
    void dataSource.setRecording(nextRecording).catch(() => dataSource.retryConnection());
  };
  const handleClearSession = () => {
    void dataSource.clearSession().catch(() => dataSource.retryConnection());
  };
  const handleImportExchange = (file: File) => {
    void file.text().then((serialized) => {
      const imported = parseExchangeImport(serialized);
      if (!onImportedExchange) throw new Error("Exchange import is unavailable in this runtime.");
      onImportedExchange(imported.exchange);
      setImportError(null);
    }).catch((error: unknown) => setImportError(error instanceof Error ? error.message : "The exchange could not be imported."));
  };
  const openRecomposeMenu = (exchange: HttpExchange, x: number, y: number) => {
    selectExchange(getExchangeStoreKey(exchange));
    setRecomposeMenu({ exchange, x, y });
  };
  const openIntegrations = () => {
    void (async () => {
      try {
        // Browser-hosted mode supplies this directly; Tauri retains its existing listener status path.
        const endpoint = await dataSource.getIntegrationEndpoint?.();
        if (endpoint) setCaptureEndpoint(endpoint);
        else {
          const status = await dataSource.listener?.getListenerStatus();
          if (status?.endpoint) setCaptureEndpoint(status.endpoint);
        }
      } catch { /* The integration service reports a stopped or changed listener explicitly. */ }
      setIntegrationDialogOpen(true);
    })();
  };
  const setDatabaseNodeCollapsed = (id: string, collapsed: boolean) => setCollapsedDatabaseNodeIds((current) => {
    const next = new Set(current);
    if (collapsed) next.add(id);
    else next.delete(id);
    return next;
  });

  const workspaceSwitch = (
    <nav className="workspace-switch" aria-label="Capture workspace">
      <button aria-keyshortcuts="Control+1 Meta+1" className={workspaceView === "structure" ? "is-active" : ""} type="button" onClick={() => setWorkspaceView("structure")}>Structure</button>
      <button aria-keyshortcuts="Control+2 Meta+2" className={workspaceView === "sequence" ? "is-active" : ""} type="button" onClick={() => setWorkspaceView("sequence")}>Sequence</button>
      <button aria-keyshortcuts="Control+3 Meta+3" className={workspaceView === "database" ? "is-active" : ""} type="button" onClick={() => setWorkspaceView("database")}>Database</button>
    </nav>
  );

  return (
    <AppErrorBoundary>
      <AppShell
        toolbar={<CaptureToolbar recording={recording} theme={theme} totalCount={totalCount} activeIntegrationCount={activeIntegrationCount} importError={importError} isImported={isImported} onClearSession={handleClearSession} onImportExchange={handleImportExchange} onManageIntegrations={openIntegrations} onRecordingChange={handleRecordingChange} onReturnToLiveCapture={() => onReturnToLiveCapture?.()} onThemeChange={setTheme} />}
        workspaceSwitch={workspaceSwitch}
        primaryView={workspaceView === "structure" ? <StructureView onRecompose={openRecomposeMenu} /> : workspaceView === "sequence" ? <SequenceView onRecompose={openRecomposeMenu} /> : <DatabaseWorkspace collapsedNodeIds={collapsedDatabaseNodeIds} dataSource={databaseDataSource} onCommandSelected={setSelectedDatabaseCommand} onNodeCollapsedChange={setDatabaseNodeCollapsed} />}
        inspector={workspaceView === "database" ? <DatabaseCommandInspector command={selectedDatabaseCommand} /> : <Inspector dataSource={dataSource} />}
        paneLayout={paneLayout}
        statusBar={<CaptureStatusBar status={captureStatus} listener={dataSource.listener} onRetry={() => dataSource.retryConnection()} />}
        onPaneLayoutChange={setPaneLayout}
      />
      {recomposeMenu && <RecomposeContextMenu exchange={recomposeMenu.exchange} x={recomposeMenu.x} y={recomposeMenu.y} onClose={() => setRecomposeMenu(null)} onExport={(exchange) => {
        void exportExchange(dataSource, exchange);
        setRecomposeMenu(null);
      }} onRecompose={(exchange) => {
        openRecomposeDraft(createRecomposeDraft(exchange));
        setWorkspaceView("structure");
        setRecomposeMenu(null);
      }} />}
      {integrationDialogOpen && <ProjectIntegrationsDialog service={projectIntegration} endpoint={captureEndpoint} onActiveCountChange={setActiveIntegrationCount} onClose={() => setIntegrationDialogOpen(false)} />}
    </AppErrorBoundary>
  );
}
