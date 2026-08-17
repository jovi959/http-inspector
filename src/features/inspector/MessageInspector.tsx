import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { findTextSearchMatches, getSearchMatchIndex } from "@/domain/body-presentation/bodySearch";
import { getAvailableBodyViews, getInlineText, type BodyView } from "@/domain/body-presentation/bodyRendererRegistry";
import { getHexPresentation, getHexSearchText } from "@/domain/body-presentation/hexPresentation";
import { buildRawRequest, buildRawResponse } from "@/domain/raw-representation/buildRawMessage";
import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import { AuthenticationViewer } from "@/features/inspector/authentication/AuthenticationViewer";
import { HeadersViewer } from "@/features/inspector/headers/HeadersViewer";
import { QueryParametersViewer } from "@/features/inspector/query/QueryParametersViewer";
import { CodeBodyViewer } from "@/features/inspector/body/CodeBodyViewer";
import { HexBodyViewer } from "@/features/inspector/body/HexBodyViewer";
import { MessageBodyToolbar } from "@/features/inspector/body/MessageBodyToolbar";
import { ResponseSearchToolbar } from "@/features/inspector/body/ResponseSearchToolbar";
import { useCapturedBody } from "@/features/inspector/body/useCapturedBody";
import { useBodyTextPresentation } from "@/features/inspector/body/useBodyTextPresentation";
import type { ExchangeKey, HttpRequest, HttpResponse } from "@/generated/contracts";

// CodeMirror belongs in its own chunk because most request selection never opens a JSON body.
const JsonBodyViewer = lazy(() => import("@/features/inspector/body/JsonBodyViewer"));
const XmlBodyViewer = lazy(() => import("@/features/inspector/body/XmlBodyViewer"));

type MessageView = BodyView | "authentication" | "query";

interface MessageInspectorProps {
  readonly bodyRevision: number;
  readonly dataSource: CaptureDataSource;
  readonly exchangeKey: ExchangeKey;
  readonly message: HttpRequest | HttpResponse;
  readonly title: "Request" | "Response";
  readonly rawFidelity: string;
}

/** Selects a safe body representation while leaving raw captured text untouched. */
export function MessageInspector({ bodyRevision, dataSource, exchangeKey, message, rawFidelity, title }: MessageInspectorProps) {
  const bodyPart = title === "Request" ? "requestBody" : "responseBody";
  const rawPart = title === "Request" ? "requestRaw" : "responseRaw";
  const bodyResult = useCapturedBody(dataSource, exchangeKey, bodyPart, message.body);
  const rawResult = useCapturedBody(dataSource, exchangeKey, rawPart, message.raw);
  const bodyTextResult = useBodyTextPresentation(bodyResult.body);
  const query = title === "Request" ? (message as HttpRequest).query : [];
  const availableViews = useMemo<ReadonlyArray<MessageView>>(() => {
    const bodyViews = getAvailableBodyViews(bodyResult.body, bodyTextResult.text);
    const messageViews = bodyViews.flatMap((view) => view === "headers" ? [view, "authentication" as const] : [view]);
    return query.length > 0 ? [...messageViews.slice(0, 2), "query", ...messageViews.slice(2)] : messageViews;
  }, [bodyResult.body, bodyTextResult.text, query.length]);
  const [activeView, setActiveView] = useState<MessageView>(availableViews.includes("json") ? "json" : availableViews.includes("xml") ? "xml" : "headers");
  const [responseSearchQuery, setResponseSearchQuery] = useState("");
  const [responseSearchMatchIndex, setResponseSearchMatchIndex] = useState(0);
  const bodyText = bodyTextResult.text ?? getBodyPlaceholder(bodyResult.body?.availability ?? "notApplicable");
  const raw = getRawPresentation(message, bodyResult.body, rawResult.body, title, rawFidelity);
  const searchContent = useMemo(() => {
    if (activeView === "raw") return raw.content;
    if (activeView === "hex") return getHexSearchText(getHexPresentation(rawResult.body ?? bodyResult.body).bytes);
    return bodyText;
  }, [activeView, bodyResult.body, bodyText, raw.content, rawResult.body]);
  const responseSearchMatches = useMemo(() => findTextSearchMatches(searchContent, responseSearchQuery), [responseSearchQuery, searchContent]);
  const activeResponseSearchMatch = responseSearchMatches.length === 0 ? 0 : responseSearchMatchIndex % responseSearchMatches.length;
  const showsResponseSearch = title === "Response" && !["authentication", "headers", "query"].includes(activeView);

  useEffect(() => {
    if (!availableViews.includes(activeView)) setActiveView(availableViews[0] ?? "headers");
  }, [activeView, availableViews]);

  useEffect(() => setResponseSearchMatchIndex(0), [activeView, responseSearchQuery, searchContent]);
  useEffect(() => setResponseSearchQuery(""), [exchangeKey]);

  return (
    <section className="message-inspector">
      <div className="message-heading"><span>{title}</span><span>{message.body?.mediaType ?? "No content type"}</span></div>
      {showsResponseSearch && <ResponseSearchToolbar activeMatch={activeResponseSearchMatch} matchCount={responseSearchMatches.length} onChange={setResponseSearchQuery} onNavigate={(direction) => setResponseSearchMatchIndex((current) => getSearchMatchIndex(current, responseSearchMatches.length, direction))} value={responseSearchQuery} />}
      {activeView !== "query" && activeView !== "headers" && activeView !== "authentication" && <MessageBodyToolbar body={activeView === "raw" ? (rawResult.body ?? bodyResult.body) : bodyResult.body} decodedCharset={activeView === "raw" || !bodyTextResult.isDecoded || bodyResult.body?.charset !== null ? null : "UTF-8 (inferred)"} rawFidelity={activeView === "raw" ? raw.fidelity : null} />}
      <div className="message-content">
        {bodyResult.isLoading && <p className="body-load-state">Loading captured body…</p>}
        {bodyResult.error && <p className="body-load-state is-error">Captured body unavailable: {bodyResult.error}</p>}
        {bodyTextResult.isLoading && <p className="body-load-state">Decoding captured {bodyResult.body?.contentEncoding ?? "binary"} body…</p>}
        {bodyTextResult.error && <p className="body-load-state is-error">Captured body could not be decoded: {bodyTextResult.error}</p>}
        {activeView === "headers" && <HeadersViewer headers={message.headers} />}
        {activeView === "authentication" && <AuthenticationViewer headers={message.headers} />}
        {activeView === "query" && <QueryParametersViewer query={query} />}
        {activeView === "json" && <Suspense fallback={<p className="empty-copy">Loading JSON viewer…</p>}><JsonBodyViewer cacheKey={`${title}:${bodyRevision}`} content={bodyText} isComplete={bodyResult.isComplete && bodyResult.body?.availability !== "truncated"} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} /></Suspense>}
        {activeView === "xml" && <Suspense fallback={<p className="empty-copy">Loading XML viewer…</p>}><XmlBodyViewer content={bodyText} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} /></Suspense>}
        {activeView === "text" && availableViews.includes("json") && <Suspense fallback={<p className="empty-copy">Loading JSON viewer…</p>}><JsonBodyViewer cacheKey={`${title}:${bodyRevision}:text`} content={bodyText} isComplete={bodyResult.isComplete && bodyResult.body?.availability !== "truncated"} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} /></Suspense>}
        {activeView === "text" && availableViews.includes("xml") && <Suspense fallback={<p className="empty-copy">Loading XML viewer…</p>}><XmlBodyViewer content={bodyText} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} /></Suspense>}
        {activeView === "text" && !availableViews.includes("json") && !availableViews.includes("xml") && <CodeBodyViewer content={bodyText} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} />}
        {activeView === "hex" && <HexBodyViewer body={rawResult.body ?? bodyResult.body} searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} />}
        {activeView === "raw" && <CodeBodyViewer content={raw.content} preserveHttpLines searchMatchIndex={activeResponseSearchMatch} searchQuery={responseSearchQuery} />}
      </div>
      <nav className="body-view-tabs" aria-label={`${title} representations`}>
        {availableViews.map((view) => (
          <button key={view} className={activeView === view ? "is-active" : ""} type="button" onClick={() => setActiveView(view)}>{getViewLabel(view, bodyResult.body, bodyTextResult.text)}</button>
        ))}
      </nav>
    </section>
  );
}

function getBodyPlaceholder(availability: string): string {
  if (availability === "pending") return "Body has not arrived yet.";
  if (availability === "truncated") return "Only a truncated body is currently available.";
  return `Body is ${availability}.`;
}

function getRawPresentation(message: HttpRequest | HttpResponse, body: HttpRequest["body"], rawBody: HttpRequest["raw"], title: "Request" | "Response", rawFidelity: string): { readonly content: string; readonly fidelity: string } {
  const supplied = getInlineText(rawBody);
  if (supplied !== null && rawBody?.mediaType === "message/http") return { content: supplied, fidelity: rawFidelity };
  if (rawBody?.content?.kind === "attachmentRef") return { content: "Raw content is loading from the capture store.", fidelity: rawFidelity };
  const bodyText = supplied ?? rawBodyBase64(rawBody) ?? getInlineText(body);
  const content = title === "Request"
    ? buildRawRequest(message as HttpRequest, bodyText)
    : buildRawResponse(message as HttpResponse, bodyText);
  return { content, fidelity: rawBody ? rawFidelity : "reconstructed" };
}

function rawBodyBase64(body: HttpRequest["raw"]): string | null {
  if (body?.content?.kind !== "inlineBase64") return null;
  return `[Captured binary wire body encoded as base64]\r\n${body.content.value}`;
}

function getViewLabel(view: MessageView, body: HttpRequest["body"], text: string | null): string {
  if (view === "json") return "JSON";
  if (view === "xml") return "XML";
  if (view !== "text") return `${view.charAt(0).toUpperCase()}${view.slice(1)}`;
  const bodyViews = getAvailableBodyViews(body, text);
  if (bodyViews.includes("json")) return "JSON Text";
  if (bodyViews.includes("xml")) return "XML Text";
  return "Text";
}
