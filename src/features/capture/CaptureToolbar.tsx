import { useRef } from "react";

import type { AppTheme } from "@/state/preferences/displayPreferences";

interface CaptureToolbarProps {
  readonly recording: boolean;
  readonly totalCount: number;
  readonly theme: AppTheme;
  readonly activeIntegrationCount: number;
  readonly importError: string | null;
  readonly isImported: boolean;
  onClearSession(): void;
  onImportExchange(file: File): void;
  onRecordingChange(recording: boolean): void;
  onThemeChange(theme: AppTheme): void;
  onManageIntegrations(): void;
  onReturnToLiveCapture(): void;
}

/** Displays capture state without coupling the visual control to a concrete runtime adapter. */
export function CaptureToolbar({ recording, theme, totalCount, activeIntegrationCount, importError, isImported, onClearSession, onImportExchange, onManageIntegrations, onRecordingChange, onReturnToLiveCapture, onThemeChange }: CaptureToolbarProps) {
  const importInput = useRef<HTMLInputElement>(null);

  return (
    <header className="capture-toolbar">
      <div>
        <p className="eyebrow">HTTP Inspector</p>
        <h1>Live capture, without guessing.</h1>
      </div>
      <div className="toolbar-actions">
        <span className={`recording-status ${recording ? "is-recording" : "is-stopped"}`}>
          <span aria-hidden="true" />
          {recording ? "Recording" : "Stopped"}
        </span>
        <span className="capture-count">{totalCount} exchanges</span>
        <input ref={importInput} aria-label="Import an exchange export" hidden accept="application/json,.json" type="file" onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) onImportExchange(file);
          event.currentTarget.value = "";
        }} />
        <button className="toolbar-button" type="button" onClick={() => importInput.current?.click()}>Import exchange</button>
        {isImported && <button className="toolbar-button" type="button" onClick={onReturnToLiveCapture}>Live capture</button>}
        <button className="toolbar-button" type="button" onClick={onManageIntegrations}>Integrations{activeIntegrationCount > 0 ? ` (${activeIntegrationCount})` : ""}</button>
        <button className="toolbar-button" type="button" onClick={() => onThemeChange(nextTheme(theme))}>Theme: {theme}</button>
        <button className="toolbar-button" disabled={totalCount === 0} type="button" onClick={onClearSession}>Clear session</button>
        <button className="primary-button" type="button" onClick={() => onRecordingChange(!recording)}>
          {recording ? "Stop recording" : "Start recording"}
        </button>
        {importError && <span className="toolbar-import-error" role="alert">Import failed: {importError}</span>}
      </div>
    </header>
  );
}

function nextTheme(theme: AppTheme): AppTheme {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}
