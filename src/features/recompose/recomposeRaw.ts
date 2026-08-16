import type { ReplayProtocol } from "@/data/ports/CaptureController";
import type { RecomposeHeaderRow, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

import { buildReplayUrl, parseRecomposeUrl } from "./recomposeUrl";

export type RawParseResult =
  | { readonly ok: true; readonly working: RecomposeWorkingCopy }
  | { readonly ok: false; readonly error: string };

export function buildEditableRawRequest(working: RecomposeWorkingCopy): string {
  let target = buildReplayUrl(working);
  try {
    const url = new URL(target);
    target = `${url.pathname}${url.search}${url.hash}` || "/";
  } catch { /* Validation belongs to Execute; preserve the developer's URL text here. */ }
  const startLine = `${working.method} ${target} ${protocolText(working.protocol)}`;
  const headers = working.headers.map((header) => `${header.name}: ${header.value}`).join("\r\n");
  const body = working.body?.value ?? "";
  return `${startLine}\r\n${headers}${headers ? "\r\n" : ""}\r\n${body}`;
}

export function parseEditableRawRequest(raw: string, current: RecomposeWorkingCopy): RawParseResult {
  const separator = raw.search(/\r?\n\r?\n/);
  if (separator < 0) return { ok: false, error: "Raw request requires a blank line between headers and body." };
  const separatorLength = raw.slice(separator).startsWith("\r\n\r\n") ? 4 : 2;
  const head = raw.slice(0, separator);
  const bodyText = raw.slice(separator + separatorLength);
  const lines = head.split(/\r?\n/);
  const start = lines.shift()?.match(/^(\S+)\s+(\S+)\s+(HTTP\/(?:1\.0|1\.1|2))$/i);
  if (!start) return { ok: false, error: "Raw line 1 must contain METHOD, request target, and HTTP/1.1 or HTTP/2." };
  const headers: RecomposeHeaderRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const colon = line.indexOf(":");
    if (colon <= 0) return { ok: false, error: `Raw line ${index + 2} must contain a non-empty header name followed by a colon.` };
    headers.push({ id: crypto.randomUUID(), name: line.slice(0, colon), value: line.slice(colon + 1).replace(/^\s/, "") });
  }
  let completeUrl: string;
  try { completeUrl = new URL(start[2]!, buildReplayUrl(current)).toString(); } catch { return { ok: false, error: "Raw request target could not be resolved against the current URL." }; }
  return { ok: true, working: {
    ...current,
    method: start[1]!,
    ...parseRecomposeUrl(completeUrl),
    protocol: parseProtocol(start[3]!),
    headers,
    body: bodyText || current.body !== null ? { kind: "text", value: bodyText } : null,
    bodyUnavailable: false,
  } };
}

function protocolText(protocol: ReplayProtocol): string {
  return protocol === "http2" ? "HTTP/2" : "HTTP/1.1";
}

function parseProtocol(value: string): ReplayProtocol {
  return value.toUpperCase() === "HTTP/2" ? "http2" : "http11";
}
