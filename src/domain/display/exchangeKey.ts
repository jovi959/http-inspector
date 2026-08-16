import type { ExchangeKey, HttpExchange } from "@/generated/contracts";

/** Uses the canonical process-instance and adapter-ID pair for all in-memory UI entity keys. */
export function getExchangeStoreKey(exchange: Pick<HttpExchange, "id" | "source">): string {
  return `${exchange.source.instanceId}::${exchange.id}`;
}

export function getExchangeStoreKeyFromContract(key: ExchangeKey): string {
  return `${key.sourceInstanceId}::${key.exchangeId}`;
}
