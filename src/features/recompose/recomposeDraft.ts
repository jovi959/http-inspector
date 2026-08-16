import { getInlineText } from "@/domain/body-presentation/bodyRendererRegistry";
import type { ReplayBody, ReplayProtocol } from "@/data/ports/CaptureController";
import { getExchangeStoreKey } from "@/domain/display/exchangeKey";
import type { HttpExchange } from "@/generated/contracts";
import type { RecomposeDraft, RecomposeHeaderRow, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

import { parseRecomposeUrl } from "./recomposeUrl";

/** Creates an editable replay request without changing the captured exchange. */
export function createRecomposeDraft(exchange: HttpExchange): RecomposeDraft {
  const content = exchange.request.body?.content;
  const body: ReplayBody | null = content?.kind === "inlineBase64"
    ? { kind: "base64", value: content.value }
    : content?.kind === "inlineText"
      ? { kind: "text", value: content.value }
      : null;
  const parsedUrl = parseRecomposeUrl(exchange.request.url);
  const baseline: RecomposeWorkingCopy = {
    method: exchange.request.method,
    ...parsedUrl,
    protocol: replayProtocol(exchange.request.protocol),
    headers: exchange.request.headers.map<RecomposeHeaderRow>((header) => ({ id: crypto.randomUUID(), name: header.name, value: header.value })),
    body,
    bodyUnavailable: exchange.request.body !== null && getInlineText(exchange.request.body) === null && content?.kind !== "inlineBase64",
  };
  return {
    id: crypto.randomUUID(),
    sourceExchangeId: getExchangeStoreKey(exchange),
    baseline,
    working: baseline,
    selectedMode: "url",
    rawText: null,
    rawError: null,
    dirty: false,
    hasExecuted: false,
    pending: false,
    error: baseline.bodyUnavailable ? "The captured body is unavailable. Supply or clear it before executing." : null,
    latestExecution: null,
  };
}

function replayProtocol(protocol: string | null): ReplayProtocol {
  if (protocol?.toUpperCase().includes("2")) return "http2";
  if (protocol?.toUpperCase().includes("1.1")) return "http11";
  return "auto";
}
