import type { CaptureStatus } from "@/data/ports/CaptureReader";

interface CaptureEmptyStateProps {
  readonly hasActiveFilter: boolean;
  readonly status: CaptureStatus;
  readonly view: "Structure" | "Sequence";
}

/** Distinguishes an empty session, an empty filter, and capture connectivity without hiding details. */
export function CaptureEmptyState({ hasActiveFilter, status, view }: CaptureEmptyStateProps) {
  if (hasActiveFilter) return <p className="capture-empty-state">No requests match the current {view} filter.</p>;
  if (status.connectionState === "error") return <p className="capture-empty-state">Capture service error: {status.errorMessage ?? "The service did not provide a detail."}</p>;
  if (status.connectionState === "disconnected") return <p className="capture-empty-state">Capture source disconnected. {status.errorMessage ?? "Reconnection is pending."}</p>;
  if (status.sessionId === null) return <p className="capture-empty-state">Waiting to establish a capture session.</p>;
  return <p className="capture-empty-state">No traffic has been captured in this session yet.</p>;
}
