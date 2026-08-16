use std::{collections::BTreeMap, sync::Arc, time::Instant};

use chrono::{SecondsFormat, Utc};
use inspector_core::{
    application::CaptureHub,
    domain::{
        CaptureMessage, CaptureProvenance, CaptureSource, CaptureUiDelta, CorrelationContext,
        ExchangeFailure, ExchangeFailureCategory, ExchangeKey, SchemaVersion,
    },
};
use reqwest::{Client, redirect::Policy};
use tokio::{runtime::Handle, sync::broadcast};
use uuid::Uuid;

use super::{ReplayExecutionReceipt, ReplayRequest};
use super::model::{capture_response, completed_timing, fidelity, sizes, started_timing};
use super::request::{PreparedReplay, prepare};

/// Schedules bounded local replay while publishing canonical capture lifecycle revisions.
#[derive(Clone)]
pub struct ReplayService {
    client: Client,
    hub: CaptureHub,
    ui_events: broadcast::Sender<Vec<CaptureUiDelta>>,
    source: Arc<CaptureSource>,
    maximum_body_bytes: u64,
    runtime: Handle,
}

impl ReplayService {
    pub fn new(hub: CaptureHub, ui_events: broadcast::Sender<Vec<CaptureUiDelta>>, maximum_body_bytes: u64) -> Result<Self, String> {
        let client = Client::builder().redirect(Policy::none()).build().map_err(|error| error.to_string())?;
        let runtime = Handle::try_current().map_err(|error| format!("The replay runtime is unavailable: {error}"))?;
        let source = CaptureSource {
            instance_id: Uuid::new_v4().to_string(),
            application_name: "HTTP Inspector Replay".into(),
            service_name: "HTTP Inspector Replay".into(),
            platform: "desktop".into(),
            adapter_name: "http-inspector-replay".into(),
            adapter_version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: SchemaVersion { major: 1, minor: 0 },
            environment: None,
            device_name: None,
            process_id: Some(std::process::id()),
            build_version: Some(env!("CARGO_PKG_VERSION").into()),
            base_url: None,
            metadata: BTreeMap::new(),
        };
        Ok(Self { client, hub, ui_events, source: Arc::new(source), maximum_body_bytes, runtime })
    }

    pub fn execute(&self, request: ReplayRequest) -> Result<ReplayExecutionReceipt, String> {
        let prepared = prepare(&self.client, request)?;
        let exchange_id = Uuid::new_v4().to_string();
        let sent_at = timestamp();
        let message = CaptureMessage::ExchangeStarted {
            schema_version: SchemaVersion { major: 1, minor: 0 },
            message_id: Uuid::new_v4().to_string(),
            exchange_id: exchange_id.clone(),
            source_instance_id: self.source.instance_id.clone(),
            revision: 1,
            sent_at: sent_at.clone(),
            request: Box::new(prepared.captured_request.clone()),
            timing: Box::new(started_timing()),
            tags: vec!["replay".into()],
            correlation: Some(CorrelationContext { parent_exchange_id: Some(prepared.origin.exchange_id.clone()), ..CorrelationContext::default() }),
            metadata: origin_metadata(&prepared),
        };
        self.ingest(&sent_at, message)?;
        let service = self.clone();
        let terminal_exchange_id = exchange_id.clone();
        service.runtime.clone().spawn(async move { service.finish(terminal_exchange_id, prepared).await; });
        Ok(ReplayExecutionReceipt {
            exchange_key: ExchangeKey { source_instance_id: self.source.instance_id.clone(), exchange_id },
            revision: 1,
        })
    }

    async fn finish(&self, exchange_id: String, prepared: PreparedReplay) {
        let started = Instant::now();
        let request_header_bytes = prepared.request_header_bytes;
        let request_body_bytes = prepared.request_body_bytes;
        match self.client.execute(prepared.request).await {
            Ok(response) => match capture_response(response, self.maximum_body_bytes).await {
                Ok(captured) => {
                    let elapsed = elapsed_millis(started);
                    let message = CaptureMessage::ExchangeCompleted {
                        schema_version: SchemaVersion { major: 1, minor: 0 },
                        message_id: Uuid::new_v4().to_string(),
                        exchange_id: exchange_id.clone(),
                        source_instance_id: self.source.instance_id.clone(),
                        revision: 2,
                        sent_at: timestamp(),
                        response: Box::new(captured.response),
                        timing: Box::new(completed_timing(elapsed)),
                        sizes: Box::new(sizes(request_header_bytes, request_body_bytes, Some(captured.response_header_bytes), Some(captured.response_body_bytes))),
                        capture: fidelity(captured.truncated),
                        metadata_patch: None,
                    };
                    if let Err(error) = self.ingest(&timestamp(), message) {
                        self.fail(exchange_id, request_header_bytes, request_body_bytes, started, format!("Replay response could not be recorded: {error}"));
                    }
                }
                Err(error) => self.fail(exchange_id, request_header_bytes, request_body_bytes, started, error),
            },
            Err(error) => self.fail(exchange_id, request_header_bytes, request_body_bytes, started, error.to_string()),
        }
    }

    fn fail(&self, exchange_id: String, request_header_bytes: u64, request_body_bytes: u64, started: Instant, error: String) {
        let elapsed = elapsed_millis(started);
        let category = if error.to_ascii_lowercase().contains("timeout") { ExchangeFailureCategory::Timeout } else { ExchangeFailureCategory::Connection };
        let message = CaptureMessage::ExchangeFailed {
            schema_version: SchemaVersion { major: 1, minor: 0 },
            message_id: Uuid::new_v4().to_string(),
            exchange_id,
            source_instance_id: self.source.instance_id.clone(),
            revision: 2,
            sent_at: timestamp(),
            failure: Box::new(ExchangeFailure { category, message: error, retryable: true, code: None }),
            response: None,
            timing: Box::new(completed_timing(elapsed)),
            sizes: Box::new(sizes(request_header_bytes, request_body_bytes, None, None)),
            capture: failure_fidelity(),
            metadata_patch: None,
        };
        let _ = self.ingest(&timestamp(), message);
    }

    fn ingest(&self, received_at: &str, message: CaptureMessage) -> Result<(), String> {
        let mutation = self.hub.ingest_explicit(&self.source, received_at, message).map_err(|error| error.to_string())?;
        if mutation.changed {
            let _ = self.ui_events.send(mutation.deltas);
        }
        Ok(())
    }
}

fn origin_metadata(prepared: &PreparedReplay) -> BTreeMap<String, serde_json::Value> {
    BTreeMap::from([
        ("replay.originSourceInstanceId".into(), prepared.origin.source_instance_id.clone().into()),
        ("replay.originExchangeId".into(), prepared.origin.exchange_id.clone().into()),
        ("replay.draftId".into(), prepared.origin.draft_id.clone().into()),
        ("replay.edited".into(), prepared.origin.edited.into()),
    ])
}

fn failure_fidelity() -> inspector_core::domain::CaptureFidelity {
    inspector_core::domain::CaptureFidelity {
        request_headers: CaptureProvenance::AdapterReported,
        response_headers: CaptureProvenance::Unavailable,
        request_body: CaptureProvenance::AdapterReported,
        response_body: CaptureProvenance::Unavailable,
        timing: CaptureProvenance::Measured,
        sizes: CaptureProvenance::Measured,
        request_raw: CaptureProvenance::Reconstructed,
        response_raw: CaptureProvenance::Unavailable,
    }
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn elapsed_millis(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_can_be_scheduled_from_a_non_tokio_thread() {
        let runtime = tokio::runtime::Runtime::new().expect("test runtime should start");
        let service = runtime.block_on(async {
            let (events, _) = broadcast::channel(1);
            ReplayService::new(CaptureHub::new(Default::default()), events, 1_024).expect("replay service should start")
        });
        let receipt = std::thread::spawn(move || service.execute(ReplayRequest {
            method: "GET".into(),
            url: "http://127.0.0.1:9/unreachable".into(),
            protocol: super::super::ReplayProtocol::Http11,
            headers: Vec::new(),
            body: None,
            origin: super::super::ReplayOrigin {
                source_instance_id: "source".into(), exchange_id: "exchange".into(), draft_id: "draft".into(), edited: false,
            },
        })).join().expect("replay thread should not panic").expect("replay should schedule");
        assert_eq!(receipt.revision, 1);
    }
}
