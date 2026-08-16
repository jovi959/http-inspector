import { Channel, invoke } from "@tauri-apps/api/core";

import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { ReplayExecutionReceipt, ReplayRequest } from "@/data/ports/CaptureController";
import type { CaptureListenerController, CaptureListenerSettings, CaptureListenerStatus } from "@/data/ports/CaptureListener";
import type { CaptureBodyChunk, CaptureBodyChunkRequest, CaptureSnapshot, CaptureStatus } from "@/data/ports/CaptureReader";
import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import type { CaptureUiDelta, ExchangeKey, HttpExchange, HttpExchangeSummary } from "@/generated/contracts";

interface NativeStatusResponse {
  readonly sessionId: string;
  readonly recording: boolean;
  readonly connectedSources: number;
  readonly droppedCount: number;
  readonly rejectedCount: number;
  readonly retentionBlockedByInFlight: boolean;
}

/** Uses narrow native commands and a Tauri channel while preserving the shared capture port. */
export class TauriCaptureDataSource implements CaptureDataSource {
  readonly listener: CaptureListenerController = new TauriCaptureListenerController();
  private retryActiveConnection: (() => void) | null = null;

  async getStatus(): Promise<CaptureStatus> {
    return statusFromResponse(await invoke<NativeStatusResponse>("capture_status"), "connected");
  }

  async getInitialSnapshot(): Promise<CaptureSnapshot> {
    const [status, summaries] = await Promise.all([
      this.getStatus(),
      invoke<readonly HttpExchangeSummary[]>("capture_snapshot"),
    ]);
    const exchanges = await Promise.all(summaries.map((summary) => this.getExchange(summary.key)));
    return { exchanges: exchanges.filter((exchange): exchange is HttpExchange => exchange !== null), status };
  }

  getExchange(key: ExchangeKey): Promise<HttpExchange | null> {
    return invoke<HttpExchange | null>("capture_exchange", { sourceInstanceId: key.sourceInstanceId, exchangeId: key.exchangeId });
  }

  async getBodyChunk(request: CaptureBodyChunkRequest): Promise<CaptureBodyChunk> {
    return invoke<CaptureBodyChunk>("capture_body_chunk", {
      sourceInstanceId: request.key.sourceInstanceId,
      exchangeId: request.key.exchangeId,
      part: request.part,
      offset: request.offset,
      maximumBytes: request.maximumBytes,
    });
  }

  subscribe(listener: (deltas: readonly CaptureDelta[]) => void): () => void {
    let disposed = false;
    let subscribed = false;
    let status: CaptureStatus = disconnectedStatus();
    const channel = new Channel<readonly CaptureUiDelta[]>((deltas) => {
      if (disposed) return;
      void this.translateDeltas(deltas, listener, status).catch((error: unknown) => {
        listener([{ kind: "status", status: errorStatus(error, status) }]);
      });
    });
    const connect = () => {
      if (subscribed) {
        subscribed = false;
      }
      void invoke("subscribe_capture_deltas", { channel }).then(async () => {
        subscribed = true;
        status = await this.getStatus();
        listener([{ kind: "status", status }]);
      }).catch((error: unknown) => listener([{ kind: "status", status: errorStatus(error, status) }]));
    };
    this.retryActiveConnection = connect;
    connect();
    return () => {
      disposed = true;
      if (this.retryActiveConnection === connect) this.retryActiveConnection = null;
    };
  }

  async clearSession(): Promise<void> {
    await invoke("clear_capture_session");
  }

  async setRecording(recording: boolean): Promise<void> {
    await invoke("set_capture_recording", { recording });
  }

  executeReplay(request: ReplayRequest): Promise<ReplayExecutionReceipt> {
    return invoke<ReplayExecutionReceipt>("replay_request", { request });
  }

  retryConnection(): void {
    this.retryActiveConnection?.();
  }

  private async translateDeltas(deltas: readonly CaptureUiDelta[], listener: (deltas: readonly CaptureDelta[]) => void, currentStatus: CaptureStatus): Promise<void> {
    const translated = await Promise.all(deltas.map((delta) => this.translateDelta(delta, currentStatus)));
    listener(translated.flatMap((delta) => delta ?? []));
  }

  private async translateDelta(delta: CaptureUiDelta, currentStatus: CaptureStatus): Promise<readonly CaptureDelta[] | null> {
    if (delta.kind === "upsert" || delta.kind === "detailInvalidated") {
      const key = delta.kind === "upsert" ? delta.summary.key : delta.key;
      const exchange = await this.getExchange(key);
      return exchange ? [{ kind: "upsert", exchange }] : [{ kind: "remove", key, reason: "The exchange was evicted before its detail could be read." }];
    }
    if (delta.kind === "remove") return [{ kind: "remove", key: delta.key, reason: delta.reason }];
    if (delta.kind === "reset") {
      const exchanges = await Promise.all(delta.summaries.map((summary) => this.getExchange(summary.key)));
      return [{ kind: "reset", sessionId: delta.sessionId, exchanges: exchanges.filter((exchange): exchange is HttpExchange => exchange !== null) }];
    }
    return [{ kind: "status", status: { ...currentStatus, recording: delta.recording, connectedSources: delta.connectedSources, droppedCount: delta.droppedCount, rejectedCount: delta.rejectedCount } }];
  }
}

/** Keeps Tauri listener lifecycle commands out of shared capture-state APIs. */
class TauriCaptureListenerController implements CaptureListenerController {
  getListenerStatus(): Promise<CaptureListenerStatus> {
    return invoke<CaptureListenerStatus>("capture_listener_status");
  }

  startListener(settings: CaptureListenerSettings): Promise<CaptureListenerStatus> {
    return invoke<CaptureListenerStatus>("start_capture_listener", { settings });
  }

  stopListener(): Promise<CaptureListenerStatus> {
    return invoke<CaptureListenerStatus>("stop_capture_listener");
  }
}

function statusFromResponse(response: NativeStatusResponse, connectionState: CaptureStatus["connectionState"]): CaptureStatus {
  return { ...response, connectionState, errorMessage: null };
}

function disconnectedStatus(): CaptureStatus {
  return { sessionId: null, recording: false, connectionState: "disconnected", connectedSources: 0, droppedCount: 0, rejectedCount: 0, retentionBlockedByInFlight: false, errorMessage: "Connecting to the native capture runtime…" };
}

function errorStatus(error: unknown, status: CaptureStatus): CaptureStatus {
  const message = error instanceof Error ? error.message : "The native capture runtime is unavailable.";
  return { ...status, connectionState: "error", connectedSources: 0, errorMessage: message };
}
