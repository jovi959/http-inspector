import type { HeaderEntry, HttpRequest, HttpResponse } from "@/generated/contracts";

/** Builds an honest HTTP-shaped fallback when an adapter did not supply exact raw text. */
export function buildRawRequest(request: HttpRequest, bodyText: string | null): string {
  const parsedUrl = parseAbsoluteUrl(request.url);
  const requestTarget = getRequestTarget(request, parsedUrl);
  const headers = withDerivedHost(request.headers, parsedUrl);
  return joinRawMessage(`${request.method} ${requestTarget} ${request.protocol ?? "HTTP/1.1"}`, headers, bodyText);
}

/** Preserves the captured response line, ordered headers, and available inline body. */
export function buildRawResponse(response: HttpResponse, bodyText: string | null): string {
  const reasonPhrase = response.reasonPhrase ? ` ${response.reasonPhrase}` : "";
  return joinRawMessage(`${response.protocol ?? "HTTP/1.1"} ${response.statusCode}${reasonPhrase}`, response.headers, bodyText);
}

function getRequestTarget(request: HttpRequest, parsedUrl: URL | null): string {
  if (!parsedUrl) return request.url || "/";
  if (request.method.toUpperCase() === "CONNECT") return parsedUrl.host;
  return `${parsedUrl.pathname || "/"}${parsedUrl.search}`;
}

function withDerivedHost(headers: readonly HeaderEntry[], parsedUrl: URL | null): readonly HeaderEntry[] {
  if (!parsedUrl || headers.some((header) => header.name.toLowerCase() === "host")) return headers;
  return [{ name: "Host", value: parsedUrl.host, provenance: "derived" }, ...headers];
}

function joinRawMessage(startLine: string, headers: readonly HeaderEntry[], bodyText: string | null): string {
  const headerLines = headers.map((header) => `${header.name}: ${header.value}`);
  return `${[startLine, ...headerLines].join("\r\n")}\r\n\r\n${bodyText ?? ""}`;
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
