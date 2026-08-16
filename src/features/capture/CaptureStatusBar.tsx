import type { CaptureStatus } from "@/data/ports/CaptureReader";
import type { CaptureListenerController } from "@/data/ports/CaptureListener";
import { getConnectionPresentation } from "@/domain/display/statusPresentation";
import { ListenerControls } from "@/features/capture/ListenerControls";

interface CaptureStatusBarProps {
  readonly status: CaptureStatus;
  readonly listener: CaptureListenerController | undefined;
  onRetry(): void;
}

/** Keeps transport health visible independently from the current projection's row count. */
export function CaptureStatusBar({ status, listener, onRetry }: CaptureStatusBarProps) {
  const connection = getConnectionPresentation(status.connectionState);
  const sourceLabel = status.connectedSources === 1 ? "1 source" : `${status.connectedSources} sources`;
  return (
    <footer className={`capture-status-bar state-${connection.tone}`} aria-live="polite">
      <span title={connection.tooltip}><i aria-hidden="true" />{connection.label}</span>
      <span>{sourceLabel}</span>
      <span>{status.recording ? "Recording" : "Recording paused"}</span>
      {status.droppedCount > 0 && <span title="The inspector dropped these messages because its bounded capture queue was full.">{status.droppedCount} dropped</span>}
      {status.rejectedCount > 0 && <span title="The inspector rejected these malformed or over-limit capture messages.">{status.rejectedCount} rejected</span>}
      {status.retentionBlockedByInFlight && <span title="Retention cannot evict active requests.">Retention is waiting for in-flight requests</span>}
      {status.errorMessage && <span className="status-error">{status.errorMessage}</span>}
      {(status.connectionState === "error" || status.connectionState === "disconnected") && <button className="status-retry-button" type="button" onClick={onRetry}>Retry</button>}
      {listener && <ListenerControls listener={listener} onChanged={onRetry} />}
    </footer>
  );
}
