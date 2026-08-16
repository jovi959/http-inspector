import type { AppTheme } from "@/state/preferences/displayPreferences";

interface CaptureToolbarProps {
  readonly recording: boolean;
  readonly totalCount: number;
  readonly theme: AppTheme;
  readonly activeIntegrationCount: number;
  onClearSession(): void;
  onRecordingChange(recording: boolean): void;
  onThemeChange(theme: AppTheme): void;
  onManageIntegrations(): void;
}

/** Displays capture state without coupling the visual control to a concrete runtime adapter. */
export function CaptureToolbar({ recording, theme, totalCount, activeIntegrationCount, onClearSession, onManageIntegrations, onRecordingChange, onThemeChange }: CaptureToolbarProps) {
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
        <button className="toolbar-button" type="button" onClick={onManageIntegrations}>Integrations{activeIntegrationCount > 0 ? ` (${activeIntegrationCount})` : ""}</button>
        <button className="toolbar-button" type="button" onClick={() => onThemeChange(nextTheme(theme))}>Theme: {theme}</button>
        <button className="toolbar-button" disabled={totalCount === 0} type="button" onClick={onClearSession}>Clear session</button>
        <button className="primary-button" type="button" onClick={() => onRecordingChange(!recording)}>
          {recording ? "Stop recording" : "Start recording"}
        </button>
      </div>
    </header>
  );
}

function nextTheme(theme: AppTheme): AppTheme {
  return theme === "system" ? "light" : theme === "light" ? "dark" : "system";
}
