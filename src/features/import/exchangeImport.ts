import { exchangeExportFormat, exchangeExportVersion, type ExchangeExportEnvelope } from "@/features/export/exchangeExport";

/** Parses an exchange exported by this application without weakening capture data or its original bytes. */
export function parseExchangeImport(serialized: string): ExchangeExportEnvelope {
  let candidate: unknown;
  try {
    candidate = JSON.parse(serialized);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  if (!isExchangeExport(candidate)) throw new Error("The selected file is not an HTTP Inspector exchange export.");
  return candidate;
}

function isExchangeExport(candidate: unknown): candidate is ExchangeExportEnvelope {
  if (!isRecord(candidate) || candidate.format !== exchangeExportFormat || candidate.version !== exchangeExportVersion || typeof candidate.exportedAt !== "string") return false;
  const exchange = candidate.exchange;
  return isRecord(exchange)
    && typeof exchange.id === "string"
    && isRecord(exchange.source)
    && typeof exchange.source.instanceId === "string"
    && isRecord(exchange.request)
    && typeof exchange.request.method === "string"
    && typeof exchange.request.url === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
