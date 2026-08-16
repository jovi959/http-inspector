import type { ExchangeKey, HttpBody, HttpExchange } from "@/generated/contracts";

export type CaptureConnectionState = "connecting" | "connected" | "disconnected" | "error";

/** Transport health is captured separately from exchanges so a disconnected UI is never mistaken for an empty session. */
export interface CaptureStatus {
  readonly sessionId: string | null;
  readonly recording: boolean;
  readonly connectionState: CaptureConnectionState;
  readonly connectedSources: number;
  readonly droppedCount: number;
  readonly rejectedCount: number;
  readonly retentionBlockedByInFlight: boolean;
  readonly errorMessage: string | null;
}

/** A single initial read keeps entities and capture health synchronized before subscription begins. */
export interface CaptureSnapshot {
  readonly exchanges: readonly HttpExchange[];
  readonly status: CaptureStatus;
}

export type CapturedBodyPart = "requestBody" | "responseBody" | "requestRaw" | "responseRaw";

export interface CaptureBodyChunkRequest {
  readonly key: ExchangeKey;
  readonly part: CapturedBodyPart;
  readonly offset: number;
  readonly maximumBytes: number;
}

export interface CaptureBodyChunk {
  readonly body: HttpBody | null;
  readonly offset: number;
  readonly nextOffset: number | null;
  readonly complete: boolean;
}

/** Reads a stable snapshot without exposing the concrete runtime transport. */
export interface CaptureReader {
  getStatus(): Promise<CaptureStatus>;
  getInitialSnapshot(): Promise<CaptureSnapshot>;
  getExchange(key: ExchangeKey): Promise<HttpExchange | null>;
  getBodyChunk(request: CaptureBodyChunkRequest): Promise<CaptureBodyChunk>;
}
