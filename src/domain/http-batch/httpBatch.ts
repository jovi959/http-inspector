import type { HeaderEntry, HttpRequest } from "@/generated/contracts";

export type BatchCorrelation = "contentId" | "batchOrder" | "unavailable";

export interface HttpBatchRequestOperation {
  readonly id: string;
  readonly index: number;
  readonly method: string;
  readonly url: string;
  readonly headers: readonly HeaderEntry[];
  readonly body: string | null;
  readonly warnings: readonly string[];
}

export interface HttpBatchResponseOperation {
  readonly contentId: string | null;
  readonly statusCode: number;
  readonly reasonPhrase: string | null;
  readonly protocol: string | null;
  readonly headers: readonly HeaderEntry[];
  readonly body: string;
}

export interface HttpBatchOperation {
  readonly request: HttpBatchRequestOperation;
  readonly response: HttpBatchResponseOperation | null;
  readonly correlation: BatchCorrelation;
}

export interface HttpBatchInspection {
  readonly operations: readonly HttpBatchOperation[];
  readonly warnings: readonly string[];
}

interface HttpBatchRequestParse {
  readonly isBatch: boolean;
  readonly operations: readonly HttpBatchRequestOperation[];
  readonly warnings: readonly string[];
}

interface MultipartParse {
  readonly responses: readonly HttpBatchResponseOperation[];
  readonly warnings: readonly string[];
}

/** Detects Dataverse-style JSON batch envelopes without coupling the UI to a specific service host. */
export function isHttpBatchRequest(request: HttpRequest): boolean {
  if (request.method.toUpperCase() !== "POST" || !isBatchPath(request.url) || request.body?.content?.kind !== "inlineText") return false;
  return parseHttpBatchRequest(request.body.content.value).isBatch;
}

/** Parses only the documented JSON requests array and preserves undecidable input as warnings. */
export function parseHttpBatchRequest(text: string | null): HttpBatchRequestParse {
  if (text === null) return { isBatch: false, operations: [], warnings: [] };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !Array.isArray(parsed.requests)) return { isBatch: false, operations: [], warnings: [] };
    const warnings: string[] = [];
    const operations = parsed.requests.flatMap((value, index) => {
      const operation = parseRequestOperation(value, index);
      if (operation === null) {
        warnings.push(`Request item ${index + 1} does not contain an ID, method, and URL.`);
        return [];
      }
      return [operation];
    });
    return { isBatch: true, operations, warnings };
  } catch {
    return { isBatch: false, operations: [], warnings: [] };
  }
}

/** Parses captured multipart bytes after the inspector's body decoder has made them readable text. */
export function createHttpBatchInspection(requestText: string | null, responseContentType: string | null, responseText: string | null): HttpBatchInspection {
  const request = parseHttpBatchRequest(requestText);
  if (!request.isBatch) return { operations: [], warnings: request.warnings };
  if (responseText === null) return {
    operations: request.operations.map((operation) => ({ request: operation, response: null, correlation: "unavailable" })),
    warnings: [...request.warnings, "The outer response body was not captured."],
  };
  const response = parseMultipartHttpResponse(responseContentType, responseText);
  const correlated = correlateResponses(request.operations, response.responses);
  return { operations: correlated.operations, warnings: [...request.warnings, ...response.warnings, ...correlated.warnings] };
}

function parseRequestOperation(value: unknown, index: number): HttpBatchRequestOperation | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.method) || !isString(value.url)) return null;
  const warnings: string[] = [];
  const headers = parseRequestHeaders(value.headers, index, warnings);
  return { id: value.id, index, method: value.method, url: value.url, headers, body: formatRequestBody(value.body), warnings };
}

function parseRequestHeaders(value: unknown, index: number, warnings: string[]): readonly HeaderEntry[] {
  if (value === undefined) return [];
  if (!isRecord(value)) {
    warnings.push(`Request item ${index + 1} has headers that are not an object.`);
    return [];
  }
  return Object.entries(value).flatMap(([name, headerValue]) => {
    if (typeof headerValue === "string") return [{ name, value: headerValue, provenance: "exact" as const }];
    if (Array.isArray(headerValue) && headerValue.every(isString)) return headerValue.map((item) => ({ name, value: item, provenance: "exact" as const }));
    warnings.push(`Request item ${index + 1} has a non-text ${name} header.`);
    return [];
  });
}

function formatRequestBody(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseMultipartHttpResponse(contentType: string | null, text: string): MultipartParse {
  const boundary = extractBoundary(contentType);
  if (boundary === null) return { responses: [], warnings: ["The outer response is not multipart, so individual batch responses are unavailable."] };
  return parseMultipart(text, boundary, 0);
}

function parseMultipart(text: string, boundary: string, depth: number): MultipartParse {
  if (depth > 4) return { responses: [], warnings: ["Nested multipart depth exceeded the safe parser limit."] };
  const warnings: string[] = [];
  const responses: HttpBatchResponseOperation[] = [];
  const parts = splitMultipartParts(text, boundary);
  if (parts.length === 0) return { responses: [], warnings: ["No multipart response parts matched the declared boundary."] };
  for (const part of parts) {
    const mime = splitHeaders(part);
    const nestedBoundary = extractBoundary(headerValue(mime.headers, "content-type"));
    if (nestedBoundary !== null) {
      const nested = parseMultipart(mime.body, nestedBoundary, depth + 1);
      responses.push(...nested.responses);
      warnings.push(...nested.warnings);
      continue;
    }
    const parsed = parseEmbeddedHttpResponse(mime.body, headerValue(mime.headers, "content-id"));
    if (parsed === null) {
      warnings.push("A multipart part did not contain an embedded HTTP response.");
      continue;
    }
    responses.push(parsed);
    if (responses.length >= 100) {
      warnings.push("Batch response parsing stopped after 100 operations.");
      break;
    }
  }
  return { responses, warnings };
}

function splitMultipartParts(text: string, boundary: string): readonly string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const marker = line.trimEnd();
    if (marker === delimiter || marker === `${delimiter}--`) {
      if (current !== null) parts.push(current.join("\n").replace(/^\n/, ""));
      current = marker === `${delimiter}--` ? null : [];
      if (marker === `${delimiter}--`) break;
      continue;
    }
    current?.push(line);
  }
  return parts;
}

function parseEmbeddedHttpResponse(text: string, contentId: string | null): HttpBatchResponseOperation | null {
  const source = text.replace(/^\s+/, "");
  const firstLineEnd = source.indexOf("\n");
  const statusLine = (firstLineEnd < 0 ? source : source.slice(0, firstLineEnd)).trim();
  const match = /^HTTP\/(\d+(?:\.\d+)?)\s+(\d{3})(?:\s+(.*))?$/i.exec(statusLine);
  if (match === null) return null;
  const remainder = firstLineEnd < 0 ? "" : source.slice(firstLineEnd + 1);
  const http = splitHeaders(remainder);
  return {
    contentId: contentId ?? headerValue(http.headers, "content-id"),
    statusCode: Number(match[2]),
    reasonPhrase: match[3]?.trim() || null,
    protocol: `HTTP/${match[1]}`,
    headers: http.headers,
    body: http.body,
  };
}

function splitHeaders(text: string): { readonly headers: readonly HeaderEntry[]; readonly body: string } {
  const divider = text.indexOf("\n\n");
  const headerText = divider < 0 ? text : text.slice(0, divider);
  const headers = headerText.split("\n").flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator < 1) return [];
    return [{ name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim(), provenance: "exact" as const }];
  });
  return { headers, body: divider < 0 ? "" : text.slice(divider + 2) };
}

function correlateResponses(requests: readonly HttpBatchRequestOperation[], responses: readonly HttpBatchResponseOperation[]): { readonly operations: readonly HttpBatchOperation[]; readonly warnings: readonly string[] } {
  const warnings: string[] = [];
  const unmatched = new Set(responses.map((_, index) => index));
  const operations = requests.map((request) => {
    const contentIdIndex = responses.findIndex((response, responseIndex) => unmatched.has(responseIndex) && response.contentId === request.id);
    const responseIndex = contentIdIndex >= 0 ? contentIdIndex : [...unmatched][0] ?? -1;
    if (responseIndex < 0) return { request, response: null, correlation: "unavailable" as const };
    unmatched.delete(responseIndex);
    return { request, response: responses[responseIndex]!, correlation: contentIdIndex >= 0 ? "contentId" as const : "batchOrder" as const };
  });
  if (responses.length !== requests.length) warnings.push(`Only ${Math.min(responses.length, requests.length)} of ${requests.length} batch operations had a captured response.`);
  if (unmatched.size > 0) warnings.push(`${unmatched.size} captured batch response${unmatched.size === 1 ? " was" : "s were"} not matched to a request.`);
  return { operations, warnings };
}

function extractBoundary(contentType: string | null): string | null {
  if (contentType === null || !/^multipart\/mixed\b/i.test(contentType)) return null;
  const match = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match?.[1] ?? match?.[2] ?? null;
}

function headerValue(headers: readonly HeaderEntry[], name: string): string | null {
  return headers.find((header) => header.name.toLowerCase() === name)?.value ?? null;
}

function isBatchPath(url: string): boolean {
  try {
    return new URL(url, "https://inspector.invalid").pathname.toLowerCase().endsWith("/$batch");
  } catch {
    return url.split("?", 1)[0]?.toLowerCase().endsWith("/$batch") ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
