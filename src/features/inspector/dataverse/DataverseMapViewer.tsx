import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import { getInlineText } from "@/domain/body-presentation/bodyRendererRegistry";
import { createDataverseResponseRecords, renderDataverseClassDiagram } from "@/domain/dataverse/dataverseMap";
import { createDataverseMapRenderSequence } from "@/domain/dataverse/dataverseMapRenderSequence";
import type { DataverseMap } from "@/domain/dataverse/dataverseMap";
import { useCapturedBody } from "@/features/inspector/body/useCapturedBody";
import { decorateDataverseDiagramValues } from "@/features/inspector/dataverse/decorateDataverseDiagramValues";
import type { ExchangeKey, HttpBody } from "@/generated/contracts";
import { useCaptureStore } from "@/state/capture/captureStore";

interface DataverseMapViewerProps {
  readonly dataSource: CaptureDataSource;
  readonly exchangeKey: ExchangeKey;
  readonly map: DataverseMap;
  readonly responseBody: HttpBody | null;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface DragState {
  readonly pointerId: number;
  readonly start: Point;
  readonly pan: Point;
}

const minimumZoom = .4;
const maximumZoom = 2.5;
const zoomStep = .15;

/** Shows captured Dataverse records on their matching OData entity cards without issuing another request. */
export function DataverseMapViewer({ dataSource, exchangeKey, map, responseBody }: DataverseMapViewerProps) {
  const theme = useCaptureStore((state) => state.theme);
  const bodyResult = useCapturedBody(dataSource, exchangeKey, "responseBody", responseBody);
  const responseRecords = useMemo(() => createDataverseResponseRecords(getInlineText(bodyResult.body)), [bodyResult.body]);
  const diagramContainer = useRef<HTMLDivElement>(null);
  const dragState = useRef<DragState | null>(null);
  const diagramId = useId().replaceAll(":", "");
  const renderSequence = useRef(createDataverseMapRenderSequence(`dataverse-map-${diagramId}`));
  const [diagramRevision, setDiagramRevision] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [recordIndex, setRecordIndex] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [renderError, setRenderError] = useState<string | null>(null);
  const record = recordIndex < 0 ? null : responseRecords.records[recordIndex] ?? null;
  const mermaidSource = useMemo(() => renderDataverseClassDiagram(map, record), [map, record]);

  useEffect(() => {
    setRecordIndex(-1);
  }, [exchangeKey.exchangeId, exchangeKey.sourceInstanceId]);

  useEffect(() => {
    setRecordIndex((current) => current < 0 ? -1 : Math.min(current, Math.max(responseRecords.records.length - 1, 0)));
  }, [responseRecords.records.length]);

  useEffect(() => {
    let disposed = false;
    const renderRequest = renderSequence.current.begin();
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

    async function renderDiagram() {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDark ? "dark" : "default" });
        const renderContainer = document.createElement("div");
        renderContainer.setAttribute("aria-hidden", "true");
        renderContainer.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
        document.body.append(renderContainer);
        try {
          const { svg } = await mermaid.render(renderRequest.id, mermaidSource, renderContainer);
          if (!disposed && renderSequence.current.isLatest(renderRequest) && diagramContainer.current) {
            diagramContainer.current.innerHTML = svg;
            const renderedDiagram = diagramContainer.current.querySelector("svg");
            if (renderedDiagram) decorateDataverseDiagramValues(renderedDiagram);
            setDiagramRevision((current) => current + 1);
            setRenderError(null);
          }
        } finally {
          renderContainer.remove();
        }
      } catch (error) {
        console.error("Dataverse Map render failed.", error);
        if (!disposed && renderSequence.current.isLatest(renderRequest)) setRenderError("The Dataverse Map could not be rendered for this request.");
      }
    }

    void renderDiagram();
    return () => { disposed = true; };
  }, [mermaidSource, theme]);

  useEffect(() => {
    const svg = diagramContainer.current?.querySelector("svg");
    if (!svg) return;
    svg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    svg.style.transformOrigin = "0 0";
  }, [diagramRevision, pan, zoom]);

  function changeZoom(amount: number) {
    setZoom((current) => clampZoom(current + amount));
  }

  function resetViewport() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function fitViewport() {
    const canvas = diagramContainer.current;
    const svg = canvas?.querySelector("svg");
    const viewBox = svg?.viewBox.baseVal;
    if (!canvas || !viewBox || viewBox.width <= 0 || viewBox.height <= 0) return;
    const nextZoom = clampZoom(Math.min((canvas.clientWidth - 32) / viewBox.width, (canvas.clientHeight - 32) / viewBox.height, 1));
    setZoom(nextZoom);
    setPan({ x: Math.max(16, (canvas.clientWidth - viewBox.width * nextZoom) / 2), y: Math.max(16, (canvas.clientHeight - viewBox.height * nextZoom) / 2) });
  }

  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !diagramContainer.current?.querySelector("svg")) return;
    event.preventDefault();
    dragState.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const activeDrag = dragState.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    setPan({ x: activeDrag.pan.x + event.clientX - activeDrag.start.x, y: activeDrag.pan.y + event.clientY - activeDrag.start.y });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function zoomWithWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? zoomStep : -zoomStep);
  }

  const responseStatus = getResponseStatus(bodyResult.isLoading, bodyResult.error, bodyResult.isComplete, responseRecords.error, responseRecords.records.length, recordIndex);

  return (
    <section className={`dataverse-map-viewer ${isMaximized ? "is-maximized" : ""}`} aria-label="Dataverse Map">
      <header className="dataverse-map-heading">
        <div><strong>Dataverse Map</strong><span>{map.entityName}</span></div>
        <div className="dataverse-map-controls">
          <span>{responseStatus}</span>
          <button type="button" onClick={() => setIsMaximized((current) => !current)}>{isMaximized ? "Restore" : "Maximize"}</button>
        </div>
      </header>
      <div className="dataverse-map-toolbar" aria-label="Dataverse Map controls">
        <div className="dataverse-record-controls">
          <button type="button" disabled={recordIndex < 0 || responseRecords.records.length === 0} onClick={() => setRecordIndex((current) => current - 1)}>Previous</button>
          <span>{responseRecords.records.length === 0 ? "No captured records" : recordIndex < 0 ? "Original query map" : `Record ${recordIndex + 1} of ${responseRecords.records.length}`}</span>
          <button type="button" disabled={recordIndex >= responseRecords.records.length - 1 || responseRecords.records.length === 0} onClick={() => setRecordIndex((current) => current + 1)}>Next</button>
        </div>
        <div className="dataverse-viewport-controls">
          <button type="button" onClick={() => changeZoom(-zoomStep)}>−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => changeZoom(zoomStep)}>+</button>
          <button type="button" onClick={fitViewport}>Fit</button>
          <button type="button" onClick={resetViewport}>Reset</button>
        </div>
      </div>
      {renderError && <p className="dataverse-map-error">{renderError}</p>}
      <div ref={diagramContainer} className="dataverse-map-canvas" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onWheel={zoomWithWheel} />
      <details className="dataverse-map-source">
        <summary>Raw Mermaid source</summary>
        <pre><code>{mermaidSource}</code></pre>
      </details>
    </section>
  );
}

function clampZoom(value: number): number {
  return Math.min(maximumZoom, Math.max(minimumZoom, value));
}

function getResponseStatus(isLoading: boolean, bodyError: string | null, isComplete: boolean, responseError: string | null, recordCount: number, recordIndex: number): string {
  if (isLoading) return "Loading captured response…";
  if (bodyError) return "Captured response could not be loaded";
  if (!isComplete) return "Captured response is incomplete";
  if (responseError) return responseError;
  if (recordCount === 1) return recordIndex < 0 ? "1 captured record · original map" : "1 captured record · showing 1";
  return recordIndex < 0 ? `${recordCount} captured records · original map` : `${recordCount} captured records · showing ${recordIndex + 1}`;
}
