import type {
  CaptureBodyChunk,
  CaptureBodyChunkRequest,
  CaptureSnapshot,
  CaptureStatus,
} from "@/data/ports/CaptureReader";
import type { ReplayExecutionReceipt, ReplayRequest } from "@/data/ports/CaptureController";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import type { ExchangeKey, HttpBody, HttpExchange } from "@/generated/contracts";

const importedSessionId = "imported-exchange";

/** Presents a single exported exchange locally without sending it to a listener or changing its original capture bytes. */
export class ImportedCaptureDataSource implements CaptureDataSource {
  private readonly exchange: HttpExchange;
  private readonly listeners = new Set<(deltas: readonly CaptureDelta[]) => void>();

  constructor(exchange: HttpExchange) {
    this.exchange = exchange;
  }

  async getStatus(): Promise<CaptureStatus> {
    return this.status();
  }

  async getInitialSnapshot(): Promise<CaptureSnapshot> {
    return { exchanges: [this.exchange], status: this.status() };
  }

  async getExchange(key: ExchangeKey): Promise<HttpExchange | null> {
    return key.sourceInstanceId === this.exchange.source.instanceId && key.exchangeId === this.exchange.id ? this.exchange : null;
  }

  async getBodyChunk(request: CaptureBodyChunkRequest): Promise<CaptureBodyChunk> {
    const exchange = await this.getExchange(request.key);
    return { body: exchange ? bodyAt(exchange, request.part) : null, offset: request.offset, nextOffset: null, complete: true };
  }

  subscribe(listener: (deltas: readonly CaptureDelta[]) => void): () => void {
    this.listeners.add(listener);
    listener([{ kind: "status", status: this.status() }]);
    return () => this.listeners.delete(listener);
  }

  async clearSession(): Promise<void> {
    this.listeners.forEach((listener) => listener([{ kind: "reset", sessionId: importedSessionId, exchanges: [] }]));
  }

  async setRecording(_recording: boolean): Promise<void> {
    this.listeners.forEach((listener) => listener([{ kind: "status", status: this.status() }]));
  }

  async executeReplay(_request: ReplayRequest): Promise<ReplayExecutionReceipt> {
    throw new Error("Replay is unavailable while viewing an imported exchange.");
  }

  retryConnection(): void {
    this.listeners.forEach((listener) => listener([{ kind: "status", status: this.status() }]));
  }

  private status(): CaptureStatus {
    return {
      sessionId: importedSessionId,
      recording: false,
      connectionState: "connected",
      connectedSources: 1,
      droppedCount: 0,
      rejectedCount: 0,
      retentionBlockedByInFlight: false,
      errorMessage: null,
    };
  }
}

function bodyAt(exchange: HttpExchange, part: CaptureBodyChunkRequest["part"]): HttpBody | null {
  if (part === "requestBody") return exchange.request.body;
  if (part === "requestRaw") return exchange.request.raw;
  if (part === "responseBody") return exchange.response?.body ?? null;
  return exchange.response?.raw ?? null;
}
