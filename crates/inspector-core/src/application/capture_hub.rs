use std::{collections::{BTreeMap, VecDeque}, sync::{Arc, Mutex}};

use uuid::Uuid;

use super::{merge_capture_message, MergeResult};
use crate::domain::{
    CaptureMessage, CaptureSource, CaptureUiDelta, ExchangeKey, ExchangeState, HttpExchange,
    HttpExchangeSummary, ModelValidationError,
};

/// Repository limits bound only structural retention; accepted capture values are never redacted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RepositoryLimits {
    pub max_summaries: usize,
}

impl Default for RepositoryLimits {
    fn default() -> Self {
        Self { max_summaries: 25_000 }
    }
}

/// Small status surface shared by the future hosted API and Tauri commands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaptureHubStatus {
    pub session_id: String,
    pub recording: bool,
    pub exchange_count: usize,
    pub retention_blocked_by_in_flight: bool,
}

/// One ingestion call can publish an upsert plus deterministic retention removals.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HubMutation {
    pub deltas: Vec<CaptureUiDelta>,
    pub changed: bool,
}

/// Thread-safe bounded repository owned by the portable core rather than a specific transport.
#[derive(Clone)]
pub struct CaptureHub {
    limits: RepositoryLimits,
    state: Arc<Mutex<HubState>>,
}

struct HubState {
    session_id: String,
    recording: bool,
    next_arrival_sequence: u64,
    exchanges: BTreeMap<ExchangeKey, HttpExchange>,
    arrival_order: VecDeque<ExchangeKey>,
    retention_blocked_by_in_flight: bool,
}

impl CaptureHub {
    pub fn new(limits: RepositoryLimits) -> Self {
        Self {
            limits,
            state: Arc::new(Mutex::new(HubState {
                session_id: Uuid::new_v4().to_string(),
                recording: true,
                next_arrival_sequence: 1,
                exchanges: BTreeMap::new(),
                arrival_order: VecDeque::new(),
                retention_blocked_by_in_flight: false,
            })),
        }
    }

    /// Merges an accepted source message and projects only summary-sized UI deltas.
    pub fn ingest(
        &self,
        source: &CaptureSource,
        received_at: &str,
        message: CaptureMessage,
    ) -> Result<HubMutation, ModelValidationError> {
        self.ingest_with_policy(source, received_at, message, true)
    }

    /// Records an explicit inspector action even when passive adapter recording is paused.
    pub fn ingest_explicit(
        &self,
        source: &CaptureSource,
        received_at: &str,
        message: CaptureMessage,
    ) -> Result<HubMutation, ModelValidationError> {
        self.ingest_with_policy(source, received_at, message, false)
    }

    fn ingest_with_policy(
        &self,
        source: &CaptureSource,
        received_at: &str,
        message: CaptureMessage,
        require_recording: bool,
    ) -> Result<HubMutation, ModelValidationError> {
        validate_message_source(source, &message)?;
        let mut state = self.state.lock().expect("capture hub mutex should not be poisoned");
        if require_recording && !state.recording {
            return Ok(HubMutation { deltas: Vec::new(), changed: false });
        }
        let key = exchange_key(&message, &source.instance_id);
        let current = key.as_ref().and_then(|value| state.exchanges.get(value).cloned());
        let arrival_sequence = current.as_ref().map_or(state.next_arrival_sequence, |value| value.arrival_sequence);
        let result = merge_capture_message(current, source, &state.session_id, arrival_sequence, received_at, message)?;
        let mut deltas = Vec::new();
        match result {
            MergeResult::Applied(exchange) => {
                let exchange = *exchange;
                let key = exchange_key_from(&exchange);
                let is_new = state.exchanges.insert(key.clone(), exchange.clone()).is_none();
                if is_new {
                    state.next_arrival_sequence += 1;
                    state.arrival_order.push_back(key);
                }
                deltas.push(CaptureUiDelta::Upsert { summary: Box::new(summary_from(&exchange)) });
                deltas.extend(evict_terminal_exchanges(&mut state, self.limits));
                Ok(HubMutation { deltas, changed: true })
            }
            MergeResult::IgnoredStale { .. } | MergeResult::Heartbeat => Ok(HubMutation { deltas, changed: false }),
        }
    }

    pub fn status(&self) -> CaptureHubStatus {
        let state = self.state.lock().expect("capture hub mutex should not be poisoned");
        CaptureHubStatus {
            session_id: state.session_id.clone(),
            recording: state.recording,
            exchange_count: state.exchanges.len(),
            retention_blocked_by_in_flight: state.retention_blocked_by_in_flight,
        }
    }

    pub fn snapshot(&self) -> Vec<HttpExchangeSummary> {
        let state = self.state.lock().expect("capture hub mutex should not be poisoned");
        state.arrival_order.iter().filter_map(|key| state.exchanges.get(key)).map(summary_from).collect()
    }

    pub fn exchange(&self, key: &ExchangeKey) -> Option<HttpExchange> {
        self.state.lock().expect("capture hub mutex should not be poisoned").exchanges.get(key).cloned()
    }

    pub fn set_recording(&self, recording: bool) {
        self.state.lock().expect("capture hub mutex should not be poisoned").recording = recording;
    }

    /// Marks unfinished exchanges from a disconnected source without altering any captured request or response values.
    pub fn mark_source_disconnected(&self, source_instance_id: &str, received_at: &str) -> Result<HubMutation, ModelValidationError> {
        let mut state = self.state.lock().expect("capture hub mutex should not be poisoned");
        let keys: Vec<ExchangeKey> = state.arrival_order.iter().filter(|key| key.source_instance_id == source_instance_id).cloned().collect();
        let mut deltas = Vec::new();
        for key in keys {
            let Some(exchange) = state.exchanges.get_mut(&key) else { continue; };
            if exchange.lifecycle.state != ExchangeState::InFlight {
                continue;
            }
            exchange.revision += 1;
            exchange.lifecycle.state = ExchangeState::Incomplete;
            exchange.lifecycle.last_updated_at = received_at.into();
            exchange.metadata.insert("capture.incompleteReason".into(), "source disconnected".into());
            exchange.validate()?;
            deltas.push(CaptureUiDelta::Upsert { summary: Box::new(summary_from(exchange)) });
        }
        Ok(HubMutation { changed: !deltas.is_empty(), deltas })
    }

    /// Starts a fresh ephemeral session while preserving only user-owned display preferences in the UI.
    pub fn clear_session(&self) -> String {
        let mut state = self.state.lock().expect("capture hub mutex should not be poisoned");
        state.session_id = Uuid::new_v4().to_string();
        state.next_arrival_sequence = 1;
        state.exchanges.clear();
        state.arrival_order.clear();
        state.retention_blocked_by_in_flight = false;
        state.session_id.clone()
    }
}

fn exchange_key(message: &CaptureMessage, source_instance_id: &str) -> Option<ExchangeKey> {
    exchange_id(message).map(|exchange_id| ExchangeKey {
        source_instance_id: source_instance_id.into(), exchange_id: exchange_id.into(),
    })
}

fn exchange_key_from(exchange: &HttpExchange) -> ExchangeKey {
    ExchangeKey { source_instance_id: exchange.source.instance_id.clone(), exchange_id: exchange.id.clone() }
}

fn exchange_id(message: &CaptureMessage) -> Option<&str> {
    match message {
        CaptureMessage::ExchangeStarted { exchange_id, .. }
        | CaptureMessage::ExchangeCompleted { exchange_id, .. }
        | CaptureMessage::ExchangeFailed { exchange_id, .. }
        | CaptureMessage::ExchangeCancelled { exchange_id, .. }
        | CaptureMessage::ExchangeSnapshot { exchange_id, .. } => Some(exchange_id),
        CaptureMessage::Heartbeat { .. } => None,
    }
}

fn validate_message_source(source: &CaptureSource, message: &CaptureMessage) -> Result<(), ModelValidationError> {
    let (major, source_instance_id) = match message {
        CaptureMessage::ExchangeStarted { schema_version, source_instance_id, .. }
        | CaptureMessage::ExchangeCompleted { schema_version, source_instance_id, .. }
        | CaptureMessage::ExchangeFailed { schema_version, source_instance_id, .. }
        | CaptureMessage::ExchangeCancelled { schema_version, source_instance_id, .. }
        | CaptureMessage::ExchangeSnapshot { schema_version, source_instance_id, .. }
        | CaptureMessage::Heartbeat { schema_version, source_instance_id, .. } => (schema_version.major, source_instance_id),
    };
    if major != 1 {
        return Err(ModelValidationError("message schema version major must be 1".into()));
    }
    if source.instance_id != *source_instance_id {
        return Err(ModelValidationError("message source instance ID must match registered source".into()));
    }
    Ok(())
}

fn summary_from(exchange: &HttpExchange) -> HttpExchangeSummary {
    HttpExchangeSummary {
        key: exchange_key_from(exchange),
        revision: exchange.revision,
        arrival_sequence: exchange.arrival_sequence,
        lifecycle: exchange.lifecycle.clone(),
        method: exchange.request.method.clone(),
        url: exchange.request.url.clone(),
        scheme: exchange.request.scheme.clone(),
        host: exchange.request.host.clone(),
        port: exchange.request.port,
        path: exchange.request.path.clone(),
        status_code: exchange.response.as_ref().map(|response| response.status_code),
        source_name: exchange.source.application_name.clone(),
        duration_ms: exchange.timing.total.milliseconds,
        total_bytes: exchange.sizes.total.bytes,
        tags: exchange.tags.clone(),
        info: exchange.failure.as_ref().map(|failure| failure.message.clone()),
    }
}

fn evict_terminal_exchanges(state: &mut HubState, limits: RepositoryLimits) -> Vec<CaptureUiDelta> {
    let mut deltas = Vec::new();
    state.retention_blocked_by_in_flight = false;
    while state.exchanges.len() > limits.max_summaries {
        let terminal_index = state.arrival_order.iter().position(|key| {
            state.exchanges.get(key).is_some_and(|exchange| is_terminal(&exchange.lifecycle.state))
        });
        let Some(index) = terminal_index else {
            state.retention_blocked_by_in_flight = true;
            break;
        };
        let key = state.arrival_order.remove(index).expect("located arrival key should exist");
        state.exchanges.remove(&key);
        deltas.push(CaptureUiDelta::Remove { key, reason: "retention limit".into() });
    }
    deltas
}

fn is_terminal(state: &ExchangeState) -> bool {
    matches!(state, ExchangeState::Completed | ExchangeState::Failed | ExchangeState::Cancelled | ExchangeState::Incomplete)
}
