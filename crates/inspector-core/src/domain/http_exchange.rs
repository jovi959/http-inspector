use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Contract compatibility version negotiated between an adapter and the inspector.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaVersion {
    pub major: u16,
    pub minor: u16,
}

/// Identifies the adapter process that emitted an exchange.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub instance_id: String,
    pub application_name: String,
    pub service_name: String,
    pub platform: String,
    pub adapter_name: String,
    pub adapter_version: String,
    pub protocol_version: SchemaVersion,
    pub environment: Option<String>,
    pub device_name: Option<String>,
    pub process_id: Option<u32>,
    pub build_version: Option<String>,
    pub base_url: Option<String>,
    pub metadata: Metadata,
}

/// The pair prevents different monitored processes from colliding on an adapter exchange ID.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeKey {
    pub source_instance_id: String,
    pub exchange_id: String,
}

/// Stable tracing fields are modelled now even though the first UI only displays them.
#[derive(Clone, Debug, Default, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationContext {
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub parent_span_id: Option<String>,
    pub operation_id: Option<String>,
    pub parent_exchange_id: Option<String>,
}

/// Lifecycle semantics are independent from HTTP response status classes.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeLifecycle {
    pub state: ExchangeState,
    pub started_at: String,
    pub received_at: String,
    pub last_updated_at: String,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExchangeState {
    InFlight,
    Completed,
    Failed,
    Cancelled,
    Incomplete,
}

/// Retains header duplication and arrival order; no values are transformed or masked.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderEntry {
    pub name: String,
    pub value: String,
    pub provenance: Option<CaptureProvenance>,
}

/// Retains query duplication, original order, and a distinction between absent and empty values.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueryEntry {
    pub name: String,
    pub value: Option<String>,
    pub provenance: Option<CaptureProvenance>,
}

/// Identifies how a value was observed without claiming unavailable proxy-level data.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureProvenance {
    Exact,
    AdapterReported,
    Measured,
    Derived,
    Reconstructed,
    Truncated,
    Unavailable,
}

/// Describes body availability before choosing where captured bytes are stored.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BodyAvailability {
    NotApplicable,
    Pending,
    Captured,
    Empty,
    Omitted,
    Truncated,
    Unavailable,
}

/// Body storage is opaque to the webview when content is retained outside the inline envelope.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "kind")]
pub enum BodyContent {
    InlineText { value: String },
    InlineBase64 { value: String },
    AttachmentRef { attachment_id: String },
}

/// Captured body descriptors preserve the data supplied by an adapter without value redaction.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpBody {
    pub availability: BodyAvailability,
    pub media_type: Option<String>,
    pub charset: Option<String>,
    pub content_encoding: Option<String>,
    pub declared_byte_length: Option<u64>,
    pub observed_byte_length: Option<u64>,
    pub captured_byte_length: Option<u64>,
    pub sha256: Option<String>,
    pub content: Option<BodyContent>,
    pub truncation_reason: Option<String>,
}

/// Captures one endpoint and its origin without fabricating network resolution details.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddressDetails {
    pub value: String,
    pub provenance: CaptureProvenance,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub original_method: Option<String>,
    pub url: String,
    pub scheme: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub path: Option<String>,
    pub path_segments: Vec<String>,
    pub fragment: Option<String>,
    pub query: Vec<QueryEntry>,
    pub protocol: Option<String>,
    pub headers: Vec<HeaderEntry>,
    pub body: Option<HttpBody>,
    pub raw: Option<HttpBody>,
    pub remote_address: Option<AddressDetails>,
    pub local_address: Option<AddressDetails>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status_code: u16,
    pub reason_phrase: Option<String>,
    pub protocol: Option<String>,
    pub headers: Vec<HeaderEntry>,
    pub body: Option<HttpBody>,
    pub raw: Option<HttpBody>,
}

/// A duration is present only when known; provenance explains its source instead of using zero.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DurationValue {
    pub milliseconds: Option<u64>,
    pub provenance: CaptureProvenance,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeTiming {
    pub request_headers_sent_ms: Option<u64>,
    pub request_body_finished_ms: Option<u64>,
    pub response_headers_received_ms: Option<u64>,
    pub response_body_finished_ms: Option<u64>,
    pub exchange_ended_ms: Option<u64>,
    pub dns: DurationValue,
    pub connect: DurationValue,
    pub tls: DurationValue,
    pub queue: DurationValue,
    pub request_write: DurationValue,
    pub server_wait: DurationValue,
    pub response_read: DurationValue,
    pub total: DurationValue,
}

/// A byte count follows the same explicit known/unknown rule as duration values.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ByteCount {
    pub bytes: Option<u64>,
    pub provenance: CaptureProvenance,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeSizes {
    pub request_headers: ByteCount,
    pub request_body: ByteCount,
    pub response_headers: ByteCount,
    pub response_body: ByteCount,
    pub total: ByteCount,
}

/// Failure describes capture or transport failures, not ordinary 4xx and 5xx HTTP responses.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeFailure {
    pub category: ExchangeFailureCategory,
    pub message: String,
    pub retryable: bool,
    pub code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExchangeFailureCategory {
    Transport,
    Serialization,
    Interceptor,
    Connection,
    Timeout,
    Cancelled,
    Capture,
}

/// Every independently captured area advertises fidelity so Raw and Overview remain honest.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFidelity {
    pub request_headers: CaptureProvenance,
    pub response_headers: CaptureProvenance,
    pub request_body: CaptureProvenance,
    pub response_body: CaptureProvenance,
    pub timing: CaptureProvenance,
    pub sizes: CaptureProvenance,
    pub request_raw: CaptureProvenance,
    pub response_raw: CaptureProvenance,
}

/// JSON-safe metadata intentionally retains adapter-specific values without replacing typed fields.
pub type Metadata = BTreeMap<String, serde_json::Value>;

/// The authoritative model stored by the capture hub and fetched by the inspector UI.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HttpExchange {
    pub schema_version: SchemaVersion,
    pub id: String,
    pub session_id: String,
    pub revision: u64,
    pub arrival_sequence: u64,
    pub source: CaptureSource,
    pub correlation: Option<CorrelationContext>,
    pub lifecycle: ExchangeLifecycle,
    pub request: HttpRequest,
    pub response: Option<HttpResponse>,
    pub timing: ExchangeTiming,
    pub sizes: ExchangeSizes,
    pub transport: Option<Metadata>,
    pub failure: Option<ExchangeFailure>,
    pub capture: CaptureFidelity,
    pub tags: Vec<String>,
    pub metadata: Metadata,
}
