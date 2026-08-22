import type {
  CaptureBodyChunk,
  CaptureBodyChunkRequest,
  CaptureSnapshot,
  CaptureStatus,
} from "@/data/ports/CaptureReader";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { ReplayExecutionReceipt, ReplayRequest } from "@/data/ports/CaptureController";
import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import type { CaptureUiDelta, ExchangeKey, HttpBody, HttpExchange, HttpExchangeSummary } from "@/generated/contracts";

interface BrowserStatusResponse {
  readonly sessionId: string;
  readonly captureEndpoint?: string;
  readonly recording: boolean;
  readonly connectedSources: number;
  readonly droppedCount?: number;
  readonly rejectedCount?: number;
  readonly retentionBlockedByInFlight: boolean;
}

/** Hosted mode uses Vite's same-origin proxy; the browser never connects directly to capture ingress. */
export class BrowserCaptureDataSource implements CaptureDataSource {
  private retryActiveConnection: (() => void) | null = null;

  async getStatus(): Promise<CaptureStatus> {
    const response = await this.request<BrowserStatusResponse>("/api/status");
    return statusFromResponse(response, "connected");
  }

  /** Reads the service-owned listener address so hosted integration never assumes the default port. */
  async getIntegrationEndpoint(): Promise<string | null> {
    const response = await this.request<BrowserStatusResponse>("/api/status");
    return response.captureEndpoint ?? null;
  }

  async getInitialSnapshot(): Promise<CaptureSnapshot> {
    const [status, summaries] = await Promise.all([
      this.getStatus(),
      this.request<readonly HttpExchangeSummary[]>("/api/exchanges"),
    ]);
    const exchanges = await Promise.all(summaries.map((summary) => this.getExchange(summary.key)));
    return {
      exchanges: exchanges.filter((exchange): exchange is HttpExchange => exchange !== null),
      status,
    };
  }

  async getExchange(key: ExchangeKey): Promise<HttpExchange | null> {
    const path = `/api/exchanges/${encodeURIComponent(key.sourceInstanceId)}/${encodeURIComponent(key.exchangeId)}`;
    const response = await fetch(path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP Inspector service returned ${response.status}`);
    return response.json() as Promise<HttpExchange>;
  }

  async getBodyChunk(request: CaptureBodyChunkRequest): Promise<CaptureBodyChunk> {
    const exchange = await this.getExchange(request.key);
    return { body: exchange ? bodyAt(exchange, request.part) : null, offset: request.offset, nextOffset: null, complete: true };
  }

  subscribe(listener: (deltas: readonly CaptureDelta[]) => void): () => void {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    let status: CaptureStatus = disconnectedStatus();
    let connectionAttempt = 0;
    const emitStatus = (nextStatus: CaptureStatus) => {
      status = nextStatus;
      listener([{ kind: "status", status }]);
    };
    const scheduleReconnect = () => {
      if (disposed || retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, 1_000);
    };
    const connect = () => {
      if (disposed) return;
      const attempt = ++connectionAttempt;
      socket?.close();
      emitStatus({ ...status, connectionState: "connecting", errorMessage: null });
      const nextSocket = new WebSocket(this.uiSocketUrl());
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        if (disposed || attempt !== connectionAttempt) return;
        void this.request<BrowserStatusResponse>("/api/status")
          .then((response) => emitStatus(statusFromResponse(response, "connected")))
          .catch((error: unknown) => emitStatus(errorStatus(error, status)));
      });
      nextSocket.addEventListener("message", (event) => {
        if (disposed || attempt !== connectionAttempt || typeof event.data !== "string") return;
        void this.translateDeltas(event.data, listener, status)
          .catch((error: unknown) => {
            emitStatus(errorStatus(error, status));
            nextSocket.close();
          });
      });
      nextSocket.addEventListener("error", () => {
        if (!disposed && attempt === connectionAttempt) emitStatus({ ...status, connectionState: "error", errorMessage: "The capture service connection failed." });
      });
      nextSocket.addEventListener("close", () => {
        if (disposed || attempt !== connectionAttempt) return;
        emitStatus({ ...status, connectionState: "disconnected", connectedSources: 0, errorMessage: "Reconnecting to the capture service…" });
        scheduleReconnect();
      });
    };
    this.retryActiveConnection = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
      connect();
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (this.retryActiveConnection) this.retryActiveConnection = null;
      socket?.close();
    };
  }

  async clearSession(): Promise<void> {
    await this.request("/api/clear", { method: "POST" });
  }

  async setRecording(recording: boolean): Promise<void> {
    await this.request("/api/recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recording }),
    });
  }

  executeReplay(request: ReplayRequest): Promise<ReplayExecutionReceipt> {
    return this.request<ReplayExecutionReceipt>("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  retryConnection(): void {
    this.retryActiveConnection?.();
  }

  private async translateDeltas(
    serializedDeltas: string,
    listener: (deltas: readonly CaptureDelta[]) => void,
    currentStatus: CaptureStatus,
  ): Promise<void> {
    const deltas = JSON.parse(serializedDeltas) as readonly CaptureUiDelta[];
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
    return [{ kind: "status", status: {
      ...currentStatus,
      recording: delta.recording,
      connectedSources: delta.connectedSources,
      droppedCount: delta.droppedCount,
      rejectedCount: delta.rejectedCount,
    } }];
  }

  private async request<T = void>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    if (!response.ok) throw new Error(`HTTP Inspector service returned ${response.status}`);
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  private uiSocketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/ui`;
  }
}

function bodyAt(exchange: HttpExchange, part: CaptureBodyChunkRequest["part"]): HttpBody | null {
  if (part === "requestBody") return exchange.request.body;
  if (part === "requestRaw") return exchange.request.raw;
  if (part === "responseBody") return exchange.response?.body ?? null;
  return exchange.response?.raw ?? null;
}

function statusFromResponse(response: BrowserStatusResponse, connectionState: CaptureStatus["connectionState"]): CaptureStatus {
  return {
    sessionId: response.sessionId,
    recording: response.recording,
    connectionState,
    connectedSources: response.connectedSources,
    droppedCount: response.droppedCount ?? 0,
    rejectedCount: response.rejectedCount ?? 0,
    retentionBlockedByInFlight: response.retentionBlockedByInFlight,
    errorMessage: null,
  };
}

function disconnectedStatus(): CaptureStatus {
  return {
    sessionId: null,
    recording: false,
    connectionState: "disconnected",
    connectedSources: 0,
    droppedCount: 0,
    rejectedCount: 0,
    retentionBlockedByInFlight: false,
    errorMessage: "Connecting to the capture service…",
  };
}

function errorStatus(error: unknown, status: CaptureStatus): CaptureStatus {
  const message = error instanceof Error ? error.message : "The capture service is unavailable.";
  return { ...status, connectionState: "error", connectedSources: 0, errorMessage: message };
}
