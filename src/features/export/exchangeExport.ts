import type { CaptureBodyChunkRequest, CapturedBodyPart } from "@/data/ports/CaptureReader";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { HttpBody, HttpExchange } from "@/generated/contracts";

export const exchangeExportFormat = "http-inspector.exchange-export";
export const exchangeExportVersion = 1;

export interface ExchangeExportEnvelope {
  readonly format: typeof exchangeExportFormat;
  readonly version: typeof exchangeExportVersion;
  readonly exportedAt: string;
  readonly exchange: HttpExchange;
}

/** Produces a stable, import-ready envelope without redacting captured values. */
export function createExchangeExport(exchange: HttpExchange, exportedAt = new Date().toISOString()): ExchangeExportEnvelope {
  return { format: exchangeExportFormat, version: exchangeExportVersion, exportedAt, exchange };
}

/** Exports the selected exchange, resolving attachment references when the capture runtime can provide them. */
export async function exportExchange(dataSource: CaptureDataSource, exchange: HttpExchange): Promise<void> {
  const hydrated = await hydrateExchange(dataSource, exchange);
  const payload = JSON.stringify(createExchangeExport(hydrated), null, 2);
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  link.href = objectUrl;
  link.download = exportFilename(hydrated);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

async function hydrateExchange(dataSource: CaptureDataSource, exchange: HttpExchange): Promise<HttpExchange> {
  const key = { sourceInstanceId: exchange.source.instanceId, exchangeId: exchange.id };
  let request = exchange.request;
  let response = exchange.response;
  for (const part of ["requestBody", "requestRaw"] as const) {
    request = { ...request, ...(part === "requestBody" ? { body: await resolveBody(dataSource, key, part, request.body) } : { raw: await resolveBody(dataSource, key, part, request.raw) }) };
  }
  if (response) {
    for (const part of ["responseBody", "responseRaw"] as const) {
      response = { ...response, ...(part === "responseBody" ? { body: await resolveBody(dataSource, key, part, response.body) } : { raw: await resolveBody(dataSource, key, part, response.raw) }) };
    }
  }
  return { ...exchange, request, response };
}

async function resolveBody(dataSource: CaptureDataSource, key: CaptureBodyChunkRequest["key"], part: CapturedBodyPart, body: HttpBody | null): Promise<HttpBody | null> {
  if (body?.content?.kind !== "attachmentRef") return body;
  try {
    const chunk = await dataSource.getBodyChunk({ key, part, offset: 0, maximumBytes: 1_048_576 });
    return chunk.body ?? body;
  } catch {
    return body;
  }
}

function exportFilename(exchange: HttpExchange): string {
  let endpoint = exchange.request.host ?? "exchange";
  try {
    const url = new URL(exchange.request.url);
    endpoint = `${url.host}${url.pathname}`;
  } catch {
    endpoint = exchange.request.url || endpoint;
  }
  const safeEndpoint = endpoint.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "exchange";
  return `http-inspector-${exchange.request.method.toLowerCase()}-${safeEndpoint}-${exchange.id}.json`;
}
