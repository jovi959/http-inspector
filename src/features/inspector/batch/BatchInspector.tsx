import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import { createHttpBatchInspection, type HttpBatchOperation } from "@/domain/http-batch/httpBatch";
import { CodeBodyViewer } from "@/features/inspector/body/CodeBodyViewer";
import { useBodyTextPresentation } from "@/features/inspector/body/useBodyTextPresentation";
import { useCapturedBody } from "@/features/inspector/body/useCapturedBody";
import { HeadersViewer } from "@/features/inspector/headers/HeadersViewer";
import type { ExchangeKey, HttpRequest, HttpResponse } from "@/generated/contracts";

type BatchDetailView = "request" | "response" | "headers" | "raw";

// Keep the editor implementation in the same deferred chunk used by the ordinary message inspector.
const JsonBodyViewer = lazy(() => import("@/features/inspector/body/JsonBodyViewer"));

interface BatchInspectorProps {
  readonly dataSource: CaptureDataSource;
  readonly exchangeKey: ExchangeKey;
  readonly request: HttpRequest;
  readonly response: HttpResponse | null;
}

/** Presents embedded batch operations without changing the parent exchange's lifecycle or count. */
export function BatchInspector({ dataSource, exchangeKey, request, response }: BatchInspectorProps) {
  const requestBody = useCapturedBody(dataSource, exchangeKey, "requestBody", request.body);
  const responseBody = useCapturedBody(dataSource, exchangeKey, "responseBody", response?.body ?? null);
  const requestText = useBodyTextPresentation(requestBody.body);
  const responseText = useBodyTextPresentation(responseBody.body);
  const inspection = useMemo(() => createHttpBatchInspection(
    requestText.text,
    getHeaderValue(response?.headers ?? [], "content-type"),
    responseText.text,
  ), [requestText.text, response?.headers, responseText.text]);
  const [activeView, setActiveView] = useState<BatchDetailView>("request");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = inspection.operations[selectedIndex] ?? null;
  const counts = summarize(inspection.operations);

  useEffect(() => {
    setSelectedIndex(0);
    setActiveView("request");
  }, [exchangeKey.exchangeId, exchangeKey.sourceInstanceId]);

  useEffect(() => setSelectedIndex((current) => Math.min(current, Math.max(inspection.operations.length - 1, 0))), [inspection.operations.length]);

  return (
    <section className="batch-inspector" aria-label="Batch operations">
      <header className="batch-heading">
        <div><strong>Batch</strong><span>{formatOuterStatus(response)}</span></div>
        <span>{counts.total} operation{counts.total === 1 ? "" : "s"} · {counts.successful} successful · {counts.failed} failed · {counts.unavailable} unavailable</span>
      </header>
      {(requestBody.isLoading || responseBody.isLoading || requestText.isLoading || responseText.isLoading) && <p className="batch-notice">Loading captured batch body…</p>}
      {(requestBody.error || responseBody.error || requestText.error || responseText.error) && <p className="batch-notice is-error">{requestBody.error ?? responseBody.error ?? requestText.error ?? responseText.error}</p>}
      {inspection.warnings.length > 0 && <ul className="batch-warnings">{inspection.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <div className="batch-layout">
        <nav className="batch-operation-list" aria-label="Batch operations">
          {inspection.operations.map((operation, index) => (
            <button key={`${operation.request.id}-${operation.request.index}`} className={selectedIndex === index ? "is-active" : ""} type="button" onClick={() => setSelectedIndex(index)}>
              <span className={getStatusClass(operation)}>{getStatusLabel(operation)}</span>
              <strong>{operation.request.method}</strong>
              <span title={operation.request.url}>{operation.request.url}</span>
            </button>
          ))}
          {inspection.operations.length === 0 && <p className="empty-copy">No readable batch operations were captured.</p>}
        </nav>
        {selected && <article className="batch-operation-detail">
          <div className="batch-detail-heading"><span>#{selected.request.index + 1} · {selected.request.id}</span><span>{getCorrelationLabel(selected)}</span></div>
          <nav className="body-view-tabs" aria-label="Selected batch operation representations">
            {(["request", "response", "headers", "raw"] as const).map((view) => <button key={view} className={activeView === view ? "is-active" : ""} type="button" onClick={() => setActiveView(view)}>{view}</button>)}
          </nav>
          <div className="batch-detail-content">
            {activeView === "request" && <BatchBody content={selected.request.body} cacheKey={`batch-request-${exchangeKey.exchangeId}-${selected.request.index}`} emptyMessage="This operation did not send a request body." />}
            {activeView === "response" && <BatchBody content={selected.response?.body ?? null} cacheKey={`batch-response-${exchangeKey.exchangeId}-${selected.request.index}`} emptyMessage={selected.response?.statusCode === 204 ? "No content returned (204 No Content)." : "Response unavailable for this operation."} />}
            {activeView === "headers" && <div className="batch-headers"><section><h3>Request headers</h3><HeadersViewer headers={selected.request.headers} /></section><section><h3>Response headers</h3><HeadersViewer emptyMessage="No response headers were captured." headers={selected.response?.headers ?? []} /></section></div>}
            {activeView === "raw" && <CodeBodyViewer content={buildRawOperation(selected)} preserveHttpLines />}
          </div>
        </article>}
      </div>
    </section>
  );
}

function BatchBody({ cacheKey, content, emptyMessage }: { readonly cacheKey: string; readonly content: string | null; readonly emptyMessage: string }) {
  if (content === null || content.length === 0) return <p className="empty-copy">{emptyMessage}</p>;
  return isJson(content)
    ? <Suspense fallback={<p className="empty-copy">Loading JSON viewer…</p>}><JsonBodyViewer cacheKey={cacheKey} content={content} isComplete /></Suspense>
    : <CodeBodyViewer content={content} />;
}

function summarize(operations: readonly HttpBatchOperation[]): { readonly total: number; readonly successful: number; readonly failed: number; readonly unavailable: number } {
  const successful = operations.filter((operation) => operation.response !== null && operation.response.statusCode < 400).length;
  const failed = operations.filter((operation) => operation.response !== null && operation.response.statusCode >= 400).length;
  return { total: operations.length, successful, failed, unavailable: operations.length - successful - failed };
}

function getStatusClass(operation: HttpBatchOperation): string {
  if (operation.response === null) return "batch-status is-unavailable";
  return operation.response.statusCode >= 400 ? "batch-status is-failed" : "batch-status is-successful";
}

function getStatusLabel(operation: HttpBatchOperation): string {
  return operation.response === null ? "—" : String(operation.response.statusCode);
}

function getCorrelationLabel(operation: HttpBatchOperation): string {
  if (operation.correlation === "contentId") return "Matched by Content-ID";
  if (operation.correlation === "batchOrder") return "Matched by batch order";
  return "Response unavailable";
}

function formatOuterStatus(response: HttpResponse | null): string {
  if (response === null) return "Outer response pending or unavailable";
  return `Outer ${response.statusCode}${response.reasonPhrase ? ` ${response.reasonPhrase}` : ""}`;
}

function getHeaderValue(headers: readonly { readonly name: string; readonly value: string }[], name: string): string | null {
  return headers.find((header) => header.name.toLowerCase() === name)?.value ?? null;
}

function buildRawOperation(operation: HttpBatchOperation): string {
  const requestHeaders = operation.request.headers.map((header) => `${header.name}: ${header.value}`).join("\r\n");
  const request = `${operation.request.method} ${operation.request.url} HTTP/1.1\r\n${requestHeaders}${operation.request.body === null ? "" : `\r\n\r\n${operation.request.body}`}`;
  if (operation.response === null) return `${request}\r\n\r\n[Response unavailable]`;
  const responseHeaders = operation.response.headers.map((header) => `${header.name}: ${header.value}`).join("\r\n");
  const response = `${operation.response.protocol ?? "HTTP"} ${operation.response.statusCode}${operation.response.reasonPhrase ? ` ${operation.response.reasonPhrase}` : ""}\r\n${responseHeaders}${operation.response.body.length === 0 ? "" : `\r\n\r\n${operation.response.body}`}`;
  return `${request}\r\n\r\n${response}`;
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
