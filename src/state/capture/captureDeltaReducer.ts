import type { CaptureDelta } from "@/data/ports/CaptureSubscription";
import type { CaptureSnapshot, CaptureStatus } from "@/data/ports/CaptureReader";
import { getExchangeStoreKey } from "@/domain/display/exchangeKey";
import type { HttpExchange, HttpExchangeSummary } from "@/generated/contracts";
import { emptyStructureTreeIndex, removeStructureSummary, upsertStructureSummary } from "@/state/structure/treeIndex";
import type { StructureTreeIndex } from "@/state/structure/treeIndex";

export interface CaptureEntityState {
  readonly summaryById: Readonly<Record<string, HttpExchangeSummary>>;
  readonly detailById: Readonly<Record<string, HttpExchange>>;
  readonly arrivalOrder: readonly string[];
  readonly structureTree: StructureTreeIndex;
  readonly captureStatus: CaptureStatus;
}

/** Reduces one coalesced batch atomically so live renderers never observe a half-applied transport burst. */
export function reduceCaptureDeltas(state: CaptureEntityState, deltas: readonly CaptureDelta[]): CaptureEntityState {
  let next = state;
  for (const delta of coalesceCaptureDeltas(deltas)) next = reduceCaptureDelta(next, delta);
  return next;
}

/** Builds a stable arrival index for initial reads and session resets without mixing in selection state. */
export function fromSnapshot(snapshot: CaptureSnapshot): CaptureEntityState {
  let state: CaptureEntityState = {
    summaryById: {},
    detailById: {},
    arrivalOrder: [],
    structureTree: emptyStructureTreeIndex,
    captureStatus: snapshot.status,
  };
  for (const exchange of [...snapshot.exchanges].sort(compareArrival)) state = reduceCaptureDelta(state, { kind: "upsert", exchange });
  return state;
}

function reduceCaptureDelta(state: CaptureEntityState, delta: CaptureDelta): CaptureEntityState {
  if (delta.kind === "reset") return fromSnapshot({
    exchanges: delta.exchanges,
    status: { ...state.captureStatus, sessionId: delta.sessionId },
  });
  if (delta.kind === "status") return { ...state, captureStatus: delta.status };
  if (delta.kind === "detailInvalidated") return state;
  if (delta.kind === "remove") return removeExchange(state, `${delta.key.sourceInstanceId}::${delta.key.exchangeId}`);

  const key = getExchangeStoreKey(delta.exchange);
  const current = state.summaryById[key];
  if (current && current.revision >= delta.exchange.revision) return state;
  const summary = summaryFromExchange(delta.exchange);
  return {
    ...state,
    summaryById: { ...state.summaryById, [key]: summary },
    detailById: { ...state.detailById, [key]: delta.exchange },
    arrivalOrder: current ? state.arrivalOrder : insertArrival(state.arrivalOrder, key, summary, state.summaryById),
    structureTree: upsertStructureSummary(state.structureTree, key, current, summary),
  };
}

function removeExchange(state: CaptureEntityState, key: string): CaptureEntityState {
  if (!state.summaryById[key]) return state;
  const { [key]: removedSummary, ...summaryById } = state.summaryById;
  const { [key]: removedDetail, ...detailById } = state.detailById;
  void removedSummary;
  void removedDetail;
  return {
    ...state,
    summaryById,
    detailById,
    arrivalOrder: state.arrivalOrder.filter((value) => value !== key),
    structureTree: removeStructureSummary(state.structureTree, key, state.summaryById[key]!),
  };
}

/** Keeps only the last meaningful change per exchange in a transport batch while retaining reset ordering. */
function coalesceCaptureDeltas(deltas: readonly CaptureDelta[]): readonly CaptureDelta[] {
  const result: CaptureDelta[] = [];
  const lastByExchange = new Map<string, number>();
  let lastStatusIndex: number | null = null;
  for (const delta of deltas) {
    if (delta.kind === "reset") {
      result.length = 0;
      lastByExchange.clear();
      lastStatusIndex = null;
      result.push(delta);
      continue;
    }
    if (delta.kind === "status") {
      if (lastStatusIndex !== null) result[lastStatusIndex] = delta;
      else {
        lastStatusIndex = result.length;
        result.push(delta);
      }
      continue;
    }
    const key = delta.kind === "upsert" ? getExchangeStoreKey(delta.exchange) : `${delta.key.sourceInstanceId}::${delta.key.exchangeId}`;
    const previousIndex = lastByExchange.get(key);
    if (previousIndex !== undefined) result[previousIndex] = delta;
    else {
      lastByExchange.set(key, result.length);
      result.push(delta);
    }
  }
  return result;
}

function summaryFromExchange(exchange: HttpExchange): HttpExchangeSummary {
  return {
    key: { sourceInstanceId: exchange.source.instanceId, exchangeId: exchange.id },
    revision: exchange.revision,
    arrivalSequence: exchange.arrivalSequence,
    lifecycle: exchange.lifecycle,
    method: exchange.request.method,
    url: exchange.request.url,
    scheme: exchange.request.scheme,
    host: exchange.request.host,
    port: exchange.request.port,
    path: exchange.request.path,
    statusCode: exchange.response?.statusCode ?? null,
    sourceName: exchange.source.applicationName,
    durationMs: exchange.timing.total.milliseconds,
    totalBytes: exchange.sizes.total.bytes,
    tags: exchange.tags,
    info: exchange.failure?.message ?? null,
  };
}

function insertArrival(
  arrivalOrder: readonly string[],
  key: string,
  summary: HttpExchangeSummary,
  summaries: Readonly<Record<string, HttpExchangeSummary>>,
): readonly string[] {
  const index = arrivalOrder.findIndex((value) => compareArrivalSummaries(summary, summaries[value]) < 0);
  if (index === -1) return [...arrivalOrder, key];
  return [...arrivalOrder.slice(0, index), key, ...arrivalOrder.slice(index)];
}

function compareArrival(left: HttpExchange, right: HttpExchange): number {
  return compareArrivalSummaries(summaryFromExchange(left), summaryFromExchange(right));
}

function compareArrivalSummaries(left: HttpExchangeSummary, right: HttpExchangeSummary | undefined): number {
  if (!right) return -1;
  if (left.arrivalSequence !== right.arrivalSequence) return left.arrivalSequence - right.arrivalSequence;
  return `${left.key.sourceInstanceId}::${left.key.exchangeId}`.localeCompare(`${right.key.sourceInstanceId}::${right.key.exchangeId}`);
}
