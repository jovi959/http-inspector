import type {
  CaptureBodyChunk,
  CaptureBodyChunkRequest,
  CaptureSnapshot,
  CaptureStatus,
} from "@/data/ports/CaptureReader";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { ReplayExecutionReceipt, ReplayRequest } from "@/data/ports/CaptureController";
import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import { getExchangeStoreKey } from "@/domain/display/exchangeKey";
import type { ExchangeKey, HttpBody, HttpExchange } from "@/generated/contracts";

import { fixtureExchanges } from "./fixtureExchanges";
import { exchangesForFixtureScenario, liveEdgeArrivalFixture, type FixtureScenario } from "./fixtureScenarios";

const fixtureSessionId = "11111111-2222-4333-8444-55555555a001";

interface FixtureCaptureDataSourceOptions {
  readonly scenario?: FixtureScenario;
}

/** Replays multi-source traffic, bursts, slow completion, stale delivery, reconnect, and reset without runtime I/O. */
export class FixtureCaptureDataSource implements CaptureDataSource {
  private readonly listeners = new Set<(deltas: readonly CaptureDelta[]) => void>();
  private readonly scenario: FixtureScenario;
  private readonly initialExchanges: readonly HttpExchange[];
  private exchangeById: Map<string, HttpExchange>;
  private replayTimers: number[] = [];
  private replayScheduled = false;
  private recording = true;
  private connectionState: CaptureStatus["connectionState"] = "connected";

  constructor({ scenario = "standard" }: FixtureCaptureDataSourceOptions = {}) {
    this.scenario = scenario;
    this.initialExchanges = exchangesForFixtureScenario(scenario);
    this.exchangeById = this.createExchangeMap();
  }

  async getStatus(): Promise<CaptureStatus> {
    return this.status();
  }

  async getInitialSnapshot(): Promise<CaptureSnapshot> {
    return { exchanges: this.snapshot(), status: this.status() };
  }

  async getExchange(key: ExchangeKey): Promise<HttpExchange | null> {
    return this.exchangeById.get(exchangeKey(key)) ?? null;
  }

  async getBodyChunk(request: CaptureBodyChunkRequest): Promise<CaptureBodyChunk> {
    const exchange = await this.getExchange(request.key);
    return { body: exchange ? bodyAt(exchange, request.part) : null, offset: request.offset, nextOffset: null, complete: true };
  }

  subscribe(listener: (deltas: readonly CaptureDelta[]) => void): () => void {
    this.listeners.add(listener);
    listener([{ kind: "status", status: this.status() }]);
    this.scheduleReplay();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopReplay();
    };
  }

  async clearSession(): Promise<void> {
    this.stopReplay();
    this.exchangeById = new Map();
    this.emit([{ kind: "reset", sessionId: fixtureSessionId, exchanges: [] }]);
  }

  async setRecording(recording: boolean): Promise<void> {
    this.recording = recording;
    this.emit([{ kind: "status", status: this.status() }]);
    if (recording) this.scheduleReplay();
    else this.stopReplay();
  }

  async executeReplay(_request: ReplayRequest): Promise<ReplayExecutionReceipt> {
    throw new Error("Replay is unavailable while using fixture data.");
  }

  retryConnection(): void {
    this.connectionState = "connecting";
    this.emit([{ kind: "status", status: this.status() }]);
    window.setTimeout(() => {
      this.connectionState = "connected";
      this.emit([{ kind: "status", status: this.status() }]);
      this.scheduleReplay();
    }, 120);
  }

  private scheduleReplay(): void {
    if (this.replayScheduled || !this.recording || this.listeners.size === 0) return;
    this.replayScheduled = true;
    if (this.scenario === "live-edge") {
      this.schedule(900, () => this.upsert(liveEdgeArrivalFixture));
      return;
    }
    if (this.scenario !== "standard") return;
    if (this.exchangeById.size === 0) {
      this.schedule(0, () => {
        this.exchangeById = this.createExchangeMap();
        this.emit([{ kind: "reset", sessionId: fixtureSessionId, exchanges: this.snapshot() }]);
      });
    }
    this.schedule(250, () => this.upsert(fixtureExchanges[4]!));
    this.schedule(250, () => this.upsert(fixtureExchanges[5]!));
    this.schedule(1_250, () => this.upsert(slowCompletion(fixtureExchanges[1]!, fixtureExchanges[5]!)));
    this.schedule(1_700, () => this.setConnectionState("disconnected"));
    this.schedule(2_100, () => this.setConnectionState("connecting"));
    this.schedule(2_350, () => this.setConnectionState("connected"));
    this.schedule(2_600, () => this.upsert(fixtureExchanges[1]!));
    this.schedule(3_000, () => this.emit([{ kind: "reset", sessionId: fixtureSessionId, exchanges: this.snapshot() }]));
  }

  private schedule(delay: number, callback: () => void): void {
    const timer = window.setTimeout(() => {
      this.replayTimers = this.replayTimers.filter((value) => value !== timer);
      if (this.recording) callback();
      if (this.replayTimers.length === 0) this.replayScheduled = false;
    }, delay);
    this.replayTimers.push(timer);
  }

  private stopReplay(): void {
    this.replayTimers.forEach((timer) => window.clearTimeout(timer));
    this.replayTimers = [];
    this.replayScheduled = false;
  }

  private upsert(exchange: HttpExchange): void {
    const key = getExchangeStoreKey(exchange);
    const current = this.exchangeById.get(key);
    if (current && current.revision >= exchange.revision) return;
    this.exchangeById.set(key, exchange);
    this.emit([{ kind: "upsert", exchange }]);
  }

  private setConnectionState(connectionState: CaptureStatus["connectionState"]): void {
    this.connectionState = connectionState;
    this.emit([{ kind: "status", status: this.status() }]);
  }

  private snapshot(): readonly HttpExchange[] {
    return [...this.exchangeById.values()].sort((left, right) => left.arrivalSequence - right.arrivalSequence);
  }

  private createExchangeMap(): Map<string, HttpExchange> {
    return new Map(this.initialExchanges.map((exchange) => [getExchangeStoreKey(exchange), exchange]));
  }

  private status(): CaptureStatus {
    return {
      sessionId: fixtureSessionId,
      recording: this.recording,
      connectionState: this.connectionState,
      connectedSources: this.connectionState === "connected" ? 2 : 0,
      droppedCount: 0,
      rejectedCount: 0,
      retentionBlockedByInFlight: false,
      errorMessage: this.connectionState === "disconnected" ? "Fixture source disconnected." : null,
    };
  }

  private emit(deltas: readonly CaptureDelta[]): void {
    this.listeners.forEach((listener) => listener(deltas));
  }
}

function exchangeKey(key: ExchangeKey): string {
  return `${key.sourceInstanceId}::${key.exchangeId}`;
}

function bodyAt(exchange: HttpExchange, part: CaptureBodyChunkRequest["part"]): HttpBody | null {
  if (part === "requestBody") return exchange.request.body;
  if (part === "requestRaw") return exchange.request.raw;
  if (part === "responseBody") return exchange.response?.body ?? null;
  return exchange.response?.raw ?? null;
}

function slowCompletion(inFlight: HttpExchange, responseSource: HttpExchange): HttpExchange {
  return {
    ...inFlight,
    revision: inFlight.revision + 1,
    lifecycle: { ...inFlight.lifecycle, state: "completed", lastUpdatedAt: "2026-08-13T20:40:31.000Z" },
    response: responseSource.response,
    timing: { ...inFlight.timing, total: { milliseconds: 20_000, provenance: "measured" }, exchangeEndedMs: 20_000 },
    sizes: { ...inFlight.sizes, total: { bytes: 100, provenance: "exact" } },
  };
}
