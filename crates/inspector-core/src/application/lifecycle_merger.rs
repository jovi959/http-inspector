use std::collections::BTreeMap;

use super::super::domain::{
    ByteCount, CaptureFidelity, CaptureMessage, CaptureProvenance, CaptureSource,
    DurationValue, ExchangeKey, ExchangeLifecycle, ExchangeSizes, ExchangeState, ExchangeTiming,
    HttpExchange, HttpRequest, ModelValidationError, SchemaVersion,
};

/// The outcome differentiates a heartbeat or stale revision from a changed canonical exchange.
#[derive(Clone, Debug, PartialEq)]
pub enum MergeResult {
    Applied(Box<HttpExchange>),
    IgnoredStale { key: ExchangeKey, revision: u64 },
    Heartbeat,
}

/// Shared immutable inputs keep each lifecycle branch focused on its message-specific mutation.
struct MergeContext<'a> {
    source: &'a CaptureSource,
    session_id: &'a str,
    arrival_sequence: u64,
    received_at: &'a str,
}

/// Merges one accepted wire message without exposing transport details to the domain layer.
pub fn merge_capture_message(
    current: Option<HttpExchange>,
    source: &CaptureSource,
    session_id: &str,
    arrival_sequence: u64,
    received_at: &str,
    message: CaptureMessage,
) -> Result<MergeResult, ModelValidationError> {
    let context = MergeContext { source, session_id, arrival_sequence, received_at };
    match message {
        CaptureMessage::Heartbeat { .. } => Ok(MergeResult::Heartbeat),
        CaptureMessage::ExchangeStarted {
            exchange_id, revision, sent_at, request, timing, tags, correlation, metadata, ..
        } => {
            let Some(mut exchange) = begin_or_current(current, &context, &exchange_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &exchange_id, revision));
            };
            exchange.request = *request;
            exchange.timing = *timing;
            exchange.tags = tags;
            exchange.correlation = correlation;
            exchange.metadata = metadata;
            if !is_terminal(&exchange.lifecycle.state) {
                exchange.lifecycle.state = ExchangeState::InFlight;
            }
            finish(exchange, revision, context.received_at)
        }
        CaptureMessage::ExchangeCompleted {
            exchange_id, revision, sent_at, response, timing, sizes, capture, metadata_patch, ..
        } => {
            let Some(mut exchange) = begin_or_current(current, &context, &exchange_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &exchange_id, revision));
            };
            exchange.response = Some(*response);
            exchange.timing = *timing;
            exchange.sizes = *sizes;
            exchange.capture = capture;
            exchange.failure = None;
            exchange.lifecycle.state = ExchangeState::Completed;
            apply_metadata_patch(&mut exchange.metadata, metadata_patch);
            finish(exchange, revision, context.received_at)
        }
        CaptureMessage::ExchangeFailed {
            exchange_id, revision, sent_at, failure, response, timing, sizes, capture, metadata_patch, ..
        } => {
            let Some(mut exchange) = begin_or_current(current, &context, &exchange_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &exchange_id, revision));
            };
            exchange.response = response.map(|value| *value);
            exchange.timing = *timing;
            exchange.sizes = *sizes;
            exchange.capture = capture;
            exchange.failure = Some(*failure);
            exchange.lifecycle.state = ExchangeState::Failed;
            apply_metadata_patch(&mut exchange.metadata, metadata_patch);
            finish(exchange, revision, context.received_at)
        }
        CaptureMessage::ExchangeCancelled {
            exchange_id, revision, sent_at, origin, timing, sizes, capture, ..
        } => {
            let Some(mut exchange) = begin_or_current(current, &context, &exchange_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &exchange_id, revision));
            };
            exchange.timing = *timing;
            exchange.sizes = *sizes;
            exchange.capture = capture;
            exchange.failure = None;
            exchange.lifecycle.state = ExchangeState::Cancelled;
            exchange.metadata.insert("capture.cancellationOrigin".into(), origin.into());
            finish(exchange, revision, context.received_at)
        }
        CaptureMessage::ExchangeSnapshot { exchange_id, revision, exchange, .. } => {
            if let Some(current) = current
                && revision <= current.revision
            {
                return Ok(stale(&context.source.instance_id, &exchange_id, revision));
            }
            if exchange.id != exchange_id {
                return Err(ModelValidationError("snapshot exchange ID must match message exchange ID".into()));
            }
            let mut exchange = *exchange;
            exchange.session_id = context.session_id.into();
            exchange.source = context.source.clone();
            exchange.revision = revision;
            exchange.arrival_sequence = arrival_sequence;
            exchange.lifecycle.received_at = context.received_at.into();
            exchange.lifecycle.last_updated_at = context.received_at.into();
            exchange.validate()?;
            Ok(MergeResult::Applied(Box::new(exchange)))
        }
    }
}

fn begin_or_current(
    current: Option<HttpExchange>,
    context: &MergeContext<'_>,
    exchange_id: &str,
    revision: u64,
    sent_at: &str,
) -> Result<Option<HttpExchange>, ModelValidationError> {
    match current {
        Some(current) if revision <= current.revision => Ok(None),
        Some(current) => Ok(Some(current)),
        None => Ok(Some(missing_start_exchange(context, exchange_id, revision, sent_at))),
    }
}

fn finish(mut exchange: HttpExchange, revision: u64, received_at: &str) -> Result<MergeResult, ModelValidationError> {
    exchange.revision = revision;
    exchange.lifecycle.last_updated_at = received_at.into();
    exchange.validate()?;
    Ok(MergeResult::Applied(Box::new(exchange)))
}

fn stale(source_instance_id: &str, exchange_id: &str, revision: u64) -> MergeResult {
    MergeResult::IgnoredStale {
        key: ExchangeKey { source_instance_id: source_instance_id.into(), exchange_id: exchange_id.into() },
        revision,
    }
}

fn missing_start_exchange(
    context: &MergeContext<'_>,
    exchange_id: &str,
    revision: u64,
    sent_at: &str,
) -> HttpExchange {
    let mut metadata = BTreeMap::new();
    metadata.insert("capture.missingStart".into(), true.into());
    HttpExchange {
        schema_version: SchemaVersion { major: 1, minor: 0 },
        id: exchange_id.into(),
        session_id: context.session_id.into(),
        revision,
        arrival_sequence: context.arrival_sequence,
        source: context.source.clone(),
        correlation: None,
        lifecycle: ExchangeLifecycle {
            state: ExchangeState::InFlight,
            started_at: sent_at.into(),
            received_at: context.received_at.into(),
            last_updated_at: context.received_at.into(),
        },
        request: HttpRequest {
            method: "UNKNOWN".into(),
            original_method: None,
            url: format!("capture://missing-request/{exchange_id}"),
            scheme: Some("capture".into()),
            host: Some("missing-request".into()),
            port: None,
            path: Some(format!("/{exchange_id}")),
            path_segments: vec![exchange_id.into()],
            fragment: None,
            query: Vec::new(),
            protocol: None,
            headers: Vec::new(),
            body: None,
            raw: None,
            remote_address: None,
            local_address: None,
        },
        response: None,
        timing: unavailable_timing(),
        sizes: unavailable_sizes(),
        transport: None,
        failure: None,
        capture: unavailable_fidelity(),
        tags: vec!["missing-start".into()],
        metadata,
    }
}

fn unavailable_timing() -> ExchangeTiming {
    let unavailable = DurationValue { milliseconds: None, provenance: CaptureProvenance::Unavailable };
    ExchangeTiming {
        request_headers_sent_ms: None,
        request_body_finished_ms: None,
        response_headers_received_ms: None,
        response_body_finished_ms: None,
        exchange_ended_ms: None,
        dns: unavailable.clone(),
        connect: unavailable.clone(),
        tls: unavailable.clone(),
        queue: unavailable.clone(),
        request_write: unavailable.clone(),
        server_wait: unavailable.clone(),
        response_read: unavailable.clone(),
        total: unavailable,
    }
}

fn unavailable_sizes() -> ExchangeSizes {
    let unavailable = ByteCount { bytes: None, provenance: CaptureProvenance::Unavailable };
    ExchangeSizes {
        request_headers: unavailable.clone(),
        request_body: unavailable.clone(),
        response_headers: unavailable.clone(),
        response_body: unavailable.clone(),
        total: unavailable,
    }
}

fn unavailable_fidelity() -> CaptureFidelity {
    CaptureFidelity {
        request_headers: CaptureProvenance::Unavailable,
        response_headers: CaptureProvenance::Unavailable,
        request_body: CaptureProvenance::Unavailable,
        response_body: CaptureProvenance::Unavailable,
        timing: CaptureProvenance::Unavailable,
        sizes: CaptureProvenance::Unavailable,
        request_raw: CaptureProvenance::Unavailable,
        response_raw: CaptureProvenance::Unavailable,
    }
}

fn apply_metadata_patch(metadata: &mut BTreeMap<String, serde_json::Value>, patch: Option<BTreeMap<String, serde_json::Value>>) {
    if let Some(patch) = patch {
        metadata.extend(patch);
    }
}

fn is_terminal(state: &ExchangeState) -> bool {
    matches!(state, ExchangeState::Completed | ExchangeState::Failed | ExchangeState::Cancelled | ExchangeState::Incomplete)
}
