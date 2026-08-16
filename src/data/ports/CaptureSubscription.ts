import type { ExchangeKey, HttpExchange } from "@/generated/contracts";

import type { CaptureStatus } from "@/data/ports/CaptureReader";

export type CaptureDelta =
  | { readonly kind: "upsert"; readonly exchange: HttpExchange }
  | { readonly kind: "remove"; readonly key: ExchangeKey; readonly reason: string }
  | { readonly kind: "reset"; readonly sessionId: string; readonly exchanges: readonly HttpExchange[] }
  | { readonly kind: "status"; readonly status: CaptureStatus }
  | { readonly kind: "detailInvalidated"; readonly key: ExchangeKey; readonly revision: number };

/** Streams incremental capture changes with a cleanup function for the caller. */
export interface CaptureSubscription {
  subscribe(listener: (deltas: readonly CaptureDelta[]) => void): () => void;
}
