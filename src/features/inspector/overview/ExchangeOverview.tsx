import { useState } from "react";

import { formatBytes } from "@/domain/display/bytePresentation";
import { getStatusPresentation } from "@/domain/display/statusPresentation";
import { formatDuration } from "@/domain/display/timingPresentation";
import type { HttpExchange } from "@/generated/contracts";

interface ExchangeOverviewProps {
  readonly exchange: HttpExchange;
}

interface OverviewEntry {
  readonly label: string;
  readonly value: string;
  readonly available: boolean;
}

interface OverviewSection {
  readonly title: string;
  readonly entries: readonly OverviewEntry[];
}

/** Shows typed exchange facts in stable sections without promoting arbitrary metadata into primary fields. */
export function ExchangeOverview({ exchange }: ExchangeOverviewProps) {
  const [showUnavailable, setShowUnavailable] = useState(false);
  const status = getStatusPresentation(exchange.lifecycle.state, exchange.response?.statusCode ?? null);
  const sections = overviewSections(exchange, status.label);
  const hasUnavailable = sections.some((section) => section.entries.some((entry) => !entry.available));
  return (
    <div className="exchange-overview">
      {hasUnavailable && <div className="overview-toolbar"><button type="button" onClick={() => setShowUnavailable((current) => !current)}>{showUnavailable ? "Hide unavailable" : "Show unavailable"}</button></div>}
      {sections.map((section) => {
        const entries = showUnavailable ? section.entries : section.entries.filter((entry) => entry.available);
        if (entries.length === 0) return null;
        return (
          <section key={section.title} className="overview-section">
            <h3>{section.title}</h3>
            <dl className="overview-list">
              {entries.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function overviewSections(exchange: HttpExchange, lifecycleLabel: string): readonly OverviewSection[] {
  const response = exchange.response;
  const correlation = exchange.correlation;
  return [
    { title: "Identity", entries: [
      requiredEntry("URL", exchange.request.url),
      requiredEntry("Method", exchange.request.method),
      optionalEntry("Request protocol", exchange.request.protocol),
      optionalEntry("Request content type", exchange.request.body?.mediaType),
      optionalEntry("Response code", response?.statusCode?.toString() ?? null),
      optionalEntry("Response protocol", response?.protocol ?? null),
      optionalEntry("Response content type", response?.body?.mediaType ?? null),
    ] },
    { title: "Lifecycle", entries: [
      requiredEntry("Lifecycle", lifecycleLabel),
      requiredEntry("Started", new Date(exchange.lifecycle.startedAt).toLocaleString()),
      requiredEntry("Received by inspector", new Date(exchange.lifecycle.receivedAt).toLocaleString()),
      requiredEntry("Last updated", new Date(exchange.lifecycle.lastUpdatedAt).toLocaleString()),
      optionalEntry("Failure", exchange.failure ? `${exchange.failure.category}: ${exchange.failure.message}` : null),
    ] },
    { title: "Timing", entries: [
      optionalDuration("DNS", exchange.timing.dns.milliseconds),
      optionalDuration("Connect", exchange.timing.connect.milliseconds),
      optionalDuration("TLS", exchange.timing.tls.milliseconds),
      optionalDuration("Queue", exchange.timing.queue.milliseconds),
      optionalDuration("Request write", exchange.timing.requestWrite.milliseconds),
      optionalDuration("Server wait", exchange.timing.serverWait.milliseconds),
      optionalDuration("Response read", exchange.timing.responseRead.milliseconds),
      optionalDuration("Total", exchange.timing.total.milliseconds),
    ] },
    { title: "Size", entries: [
      optionalBytes("Request headers", exchange.sizes.requestHeaders.bytes),
      optionalBytes("Request body", exchange.sizes.requestBody.bytes),
      optionalBytes("Response headers", exchange.sizes.responseHeaders.bytes),
      optionalBytes("Response body", exchange.sizes.responseBody.bytes),
      optionalBytes("Total", exchange.sizes.total.bytes),
    ] },
    { title: "Source and connection", entries: [
      requiredEntry("Source", `${exchange.source.applicationName} · ${exchange.source.serviceName}`),
      requiredEntry("Adapter", `${exchange.source.adapterName} ${exchange.source.adapterVersion}`),
      optionalEntry("Environment", exchange.source.environment),
      optionalEntry("Local address", exchange.request.localAddress?.value ?? null),
      optionalEntry("Remote address", exchange.request.remoteAddress?.value ?? null),
      optionalEntry("Transport", formatObject(exchange.transport)),
    ] },
    { title: "Correlation and capture", entries: [
      optionalEntry("Trace", correlation?.traceId ?? null),
      optionalEntry("Span", correlation?.spanId ?? null),
      optionalEntry("Operation", correlation?.operationId ?? null),
      optionalEntry("Capture bridge", metadataString(exchange, "captureBridge")),
      optionalEntry("Transport kind", metadataString(exchange, "transportKind")),
      optionalEntry("Replay capability", metadataString(exchange, "replayCapability")),
      optionalEntry("Capture note", metadataString(exchange, "fidelityNote")),
      optionalEntry("Tags", exchange.tags.length > 0 ? exchange.tags.join(", ") : null),
      requiredEntry("Request body capture", describeBodyCapture(exchange.request.body, exchange.capture.requestBody)),
      requiredEntry("Response body capture", response ? describeBodyCapture(response.body, exchange.capture.responseBody) : "No response yet"),
      requiredEntry("Request raw capture", describeRawCapture(exchange.request.raw, exchange.capture.requestRaw)),
      requiredEntry("Response raw capture", response ? describeRawCapture(response.raw, exchange.capture.responseRaw) : "No response yet"),
    ] },
  ];
}

function describeBodyCapture(body: HttpExchange["request"]["body"], fidelity: HttpExchange["capture"]["requestBody"]): string {
  if (!body) return "No body";
  const size = body.capturedByteLength === null ? "" : ` · ${formatBytes(body.capturedByteLength)}`;
  if (body.availability === "captured") return `${fidelity === "exact" ? "Captured exactly" : `Captured · ${fidelity}`}${size}`;
  if (body.availability === "empty") return "Empty body";
  if (body.availability === "pending") return "Pending";
  if (body.availability === "truncated") return `Truncated · ${fidelity}${size}`;
  return `Unavailable · ${fidelity}`;
}

function describeRawCapture(raw: HttpExchange["request"]["raw"], fidelity: HttpExchange["capture"]["requestRaw"]): string {
  if (!raw) return "Not supplied; Raw view is reconstructed";
  if (raw.availability === "captured") return fidelity === "exact" ? "Captured exactly" : `Captured · ${fidelity}`;
  if (raw.availability === "pending") return "Pending";
  if (raw.availability === "truncated") return `Truncated · ${fidelity}`;
  return `Unavailable · ${fidelity}; Raw view is reconstructed`;
}

function requiredEntry(label: string, value: string): OverviewEntry {
  return { label, value, available: true };
}

function optionalEntry(label: string, value: string | null | undefined): OverviewEntry {
  return { label, value: value ?? "—", available: value !== null && value !== undefined && value !== "" };
}

function optionalDuration(label: string, milliseconds: number | null): OverviewEntry {
  return { label, value: formatDuration(milliseconds), available: milliseconds !== null };
}

function optionalBytes(label: string, bytes: number | null): OverviewEntry {
  return { label, value: formatBytes(bytes), available: bytes !== null };
}

function formatObject(value: HttpExchange["transport"]): string | null {
  if (!value || Object.keys(value).length === 0) return null;
  return JSON.stringify(value);
}

/** Reads the adapter's extensible capture details without treating them as a second domain model. */
function metadataString(exchange: HttpExchange, key: string): string | null {
  const value = exchange.metadata[key];
  return typeof value === "string" ? value : null;
}
