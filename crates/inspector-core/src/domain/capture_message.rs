use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{
    CaptureFidelity, CaptureSource, CorrelationContext, DatabaseCommand, DatabaseCommandFailure,
    DatabaseParameterCapture, DatabaseQueryCapture, DatabaseResultAvailability, DurationValue,
    ExchangeFailure, ExchangeKey,
    ExchangeSizes, ExchangeTiming, HttpExchange, HttpExchangeSummary, HttpRequest, HttpResponse,
    Metadata, SchemaVersion,
};

/// Inclusive protocol range advertised by an adapter during the initial handshake.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRange {
    pub minimum: SchemaVersion,
    pub maximum: SchemaVersion,
}

/// The required first message from an adapter before capture telemetry is accepted.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClientHello {
    pub schema_version: SchemaVersion,
    pub supported_protocol: ProtocolRange,
    pub source: CaptureSource,
}

/// The inspector response after a successful protocol negotiation.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelloAccepted {
    pub schema_version: SchemaVersion,
    pub connection_id: String,
    pub session_id: String,
    pub maximum_message_bytes: u64,
    pub maximum_body_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accepted_capabilities: Option<Vec<String>>,
}

/// Machine-readable handshake or message failures for adapters.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HelloError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

/// Lifecycle payloads accepted after a completed handshake.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum CaptureMessage {
    #[serde(rename = "exchange.started")]
    ExchangeStarted {
        schema_version: SchemaVersion,
        message_id: String,
        exchange_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        request: Box<HttpRequest>,
        timing: Box<ExchangeTiming>,
        tags: Vec<String>,
        correlation: Option<CorrelationContext>,
        metadata: Metadata,
    },
    #[serde(rename = "exchange.completed")]
    ExchangeCompleted {
        schema_version: SchemaVersion,
        message_id: String,
        exchange_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        response: Box<HttpResponse>,
        timing: Box<ExchangeTiming>,
        sizes: Box<ExchangeSizes>,
        capture: CaptureFidelity,
        metadata_patch: Option<Metadata>,
    },
    #[serde(rename = "exchange.failed")]
    ExchangeFailed {
        schema_version: SchemaVersion,
        message_id: String,
        exchange_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        failure: Box<ExchangeFailure>,
        response: Option<Box<HttpResponse>>,
        timing: Box<ExchangeTiming>,
        sizes: Box<ExchangeSizes>,
        capture: CaptureFidelity,
        metadata_patch: Option<Metadata>,
    },
    #[serde(rename = "exchange.cancelled")]
    ExchangeCancelled {
        schema_version: SchemaVersion,
        message_id: String,
        exchange_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        origin: String,
        timing: Box<ExchangeTiming>,
        sizes: Box<ExchangeSizes>,
        capture: CaptureFidelity,
    },
    #[serde(rename = "exchange.snapshot")]
    ExchangeSnapshot {
        schema_version: SchemaVersion,
        message_id: String,
        exchange_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        exchange: Box<HttpExchange>,
    },
    #[serde(rename = "database.command.started")]
    DatabaseCommandStarted {
        schema_version: SchemaVersion,
        message_id: String,
        command_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        provider: String,
        database_name: String,
        data_source: Option<String>,
        command_type: String,
        operation: String,
        primary_target: String,
        query: DatabaseQueryCapture,
        parameters: DatabaseParameterCapture,
        correlation: Option<CorrelationContext>,
    },
    #[serde(rename = "database.command.completed")]
    DatabaseCommandCompleted {
        schema_version: SchemaVersion,
        message_id: String,
        command_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        total_duration: DurationValue,
        result: DatabaseResultAvailability,
    },
    #[serde(rename = "database.command.failed")]
    DatabaseCommandFailed {
        schema_version: SchemaVersion,
        message_id: String,
        command_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        failure: DatabaseCommandFailure,
        total_duration: DurationValue,
        result: DatabaseResultAvailability,
    },
    #[serde(rename = "database.command.cancelled")]
    DatabaseCommandCancelled {
        schema_version: SchemaVersion,
        message_id: String,
        command_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        origin: String,
        total_duration: DurationValue,
        result: DatabaseResultAvailability,
    },
    #[serde(rename = "database.command.snapshot")]
    DatabaseCommandSnapshot {
        schema_version: SchemaVersion,
        message_id: String,
        command_id: String,
        source_instance_id: String,
        revision: u64,
        sent_at: String,
        command: Box<DatabaseCommand>,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat {
        schema_version: SchemaVersion,
        message_id: String,
        source_instance_id: String,
        sent_at: String,
        queued_count: u64,
        dropped_count: u64,
    },
}

/// All server messages retain an explicit v1 discriminator for language-neutral adapters.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type")]
pub enum ServerMessage {
    #[serde(rename = "hello.accepted")]
    HelloAccepted { value: HelloAccepted },
    #[serde(rename = "hello.error")]
    HelloError { value: HelloError },
    #[serde(rename = "message.accepted")]
    MessageAccepted { message_id: String },
    #[serde(rename = "message.error")]
    MessageError { message_id: Option<String>, error: HelloError },
}

/// Batches can be safely applied by any UI adapter without sending full captured bodies hot-path.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CaptureUiDelta {
    Upsert { summary: Box<HttpExchangeSummary> },
    Remove { key: ExchangeKey, reason: String },
    Reset { session_id: String, summaries: Vec<HttpExchangeSummary> },
    Status { recording: bool, connected_sources: u32, dropped_count: u64, rejected_count: u64 },
    DetailInvalidated { key: ExchangeKey, revision: u64 },
}
