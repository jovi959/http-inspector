import { useEffect, useMemo, useState } from "react";

import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import { createDataverseMap } from "@/domain/dataverse/dataverseMap";
import { DataverseMapViewer } from "@/features/inspector/dataverse/DataverseMapViewer";
import { MessageInspector } from "@/features/inspector/MessageInspector";
import { ExchangeOverview } from "@/features/inspector/overview/ExchangeOverview";
import { GroupOverview } from "@/features/structure/GroupOverview";
import { RecomposeEditor } from "@/features/recompose/RecomposeEditor";
import { useCaptureStore } from "@/state/capture/captureStore";

type InspectorTab = "overview" | "request" | "response" | "dataverseMap";

/** Shared detail area renders the exchange selected from either primary projection. */
export function Inspector({ dataSource }: { readonly dataSource: CaptureDataSource }) {
  const selectedExchangeId = useCaptureStore((state) => state.selectedExchangeId);
  const selectedGroupId = useCaptureStore((state) => state.selectedGroupId);
  const selectedExchangeHidden = useCaptureStore((state) => state.selectedExchangeHidden);
  const selectedExchangeEvicted = useCaptureStore((state) => state.selectedExchangeEvicted);
  const selectExchange = useCaptureStore((state) => state.selectExchange);
  const exchange = useCaptureStore((state) => selectedExchangeId ? state.detailById[selectedExchangeId] : undefined);
  const selectedSummary = useCaptureStore((state) => selectedExchangeId ? state.summaryById[selectedExchangeId] : undefined);
  const selectedGroup = useCaptureStore((state) => selectedGroupId ? state.structureTree.nodesById[selectedGroupId] : undefined);
  const captureStatus = useCaptureStore((state) => state.captureStatus);
  const selectedDraftId = useCaptureStore((state) => state.selectedRecomposeDraftId);
  const draft = useCaptureStore((state) => state.activeRecomposeDraft);
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  const dataverseMap = useMemo(() => exchange ? createDataverseMap(exchange.request) : null, [exchange]);

  useEffect(() => {
    if ((activeTab === "response" && !exchange?.response) || (activeTab === "dataverseMap" && !dataverseMap)) setActiveTab("overview");
  }, [activeTab, dataverseMap, exchange?.response]);

  if (draft && selectedDraftId === draft.id) return <RecomposeEditor dataSource={dataSource} draft={draft} />;

  if (!exchange && selectedExchangeEvicted) {
    return <section className="inspector panel empty-inspector"><p>The selected exchange was evicted by retention.</p><button type="button" onClick={() => selectExchange(null)}>Clear selection</button></section>;
  }
  if (!exchange && selectedGroup) {
    return <section className="inspector panel" aria-label="Selected group inspector"><GroupOverview captureStatus={captureStatus} group={selectedGroup} /></section>;
  }
  if (!exchange && selectedSummary) {
    return <section className="inspector panel empty-inspector"><p>The selected exchange detail is unavailable.</p><button type="button" onClick={() => selectExchange(null)}>Clear selection</button></section>;
  }
  if (!exchange) return <section className="inspector panel empty-inspector"><p>Select a request from Structure or Sequence to inspect it.</p></section>;

  const tabs: readonly InspectorTab[] = ["overview", "request", ...(exchange.response ? ["response" as const] : []), ...(dataverseMap ? ["dataverseMap" as const] : [])];
  return (
    <section className="inspector panel" aria-label="Selected exchange inspector">
      <div className="inspector-tabs" role="tablist">
        {tabs.map((tab) => <button key={tab} className={activeTab === tab ? "is-active" : ""} role="tab" type="button" onClick={() => setActiveTab(tab)}>{tab === "dataverseMap" ? "Dataverse Map" : tab}</button>)}
      </div>
      <div className="inspector-content">
        {selectedExchangeHidden && <p className="selection-hidden">This exchange is outside the current filter.</p>}
        {selectedSummary && selectedSummary.revision > exchange.revision && <p className="detail-refreshing">A newer exchange revision is loading; showing the previous detail.</p>}
        <div className={`inspector-view ${activeTab === "overview" ? "" : activeTab === "dataverseMap" ? "is-dataverse-map" : "is-message"}`}>
          {activeTab === "overview" && <ExchangeOverview exchange={exchange} />}
          {activeTab === "request" && <MessageInspector bodyRevision={exchange.revision} dataSource={dataSource} exchangeKey={{ sourceInstanceId: exchange.source.instanceId, exchangeId: exchange.id }} title="Request" message={exchange.request} rawFidelity={exchange.capture.requestRaw} />}
          {activeTab === "response" && exchange.response && <MessageInspector bodyRevision={exchange.revision} dataSource={dataSource} exchangeKey={{ sourceInstanceId: exchange.source.instanceId, exchangeId: exchange.id }} title="Response" message={exchange.response} rawFidelity={exchange.capture.responseRaw} />}
          {activeTab === "dataverseMap" && dataverseMap && <DataverseMapViewer dataSource={dataSource} exchangeKey={{ sourceInstanceId: exchange.source.instanceId, exchangeId: exchange.id }} map={dataverseMap} responseBody={exchange.response?.body ?? null} />}
        </div>
      </div>
    </section>
  );
}
