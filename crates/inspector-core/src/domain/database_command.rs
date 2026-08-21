use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{CaptureSource, CorrelationContext, DurationValue, ExchangeLifecycle, ExchangeState, ModelValidationError, SchemaVersion};

/// The pair prevents different monitored processes from colliding on a database command ID.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCommandKey {
    pub source_instance_id: String,
    pub command_id: String,
}

/// Availability is explicit so an unsafe value is never mistaken for an empty captured value.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseCaptureAvailability {
    Captured,
    Unavailable,
}

/// Keeps the original SQL intact when it is safe to retain, with a reason when it is not.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseQueryCapture {
    pub availability: DatabaseCaptureAvailability,
    pub value: Option<String>,
    pub observed_byte_length: Option<u64>,
    pub captured_byte_length: Option<u64>,
    pub reason: Option<String>,
}

/// One database parameter preserves provider metadata without assuming every value is serializable.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseParameter {
    pub name: String,
    pub value: Option<serde_json::Value>,
    pub db_type: Option<String>,
    pub direction: Option<String>,
    pub size: Option<i32>,
    pub precision: Option<u8>,
    pub scale: Option<u8>,
    pub availability: DatabaseCaptureAvailability,
    pub reason: Option<String>,
}

/// Command-level parameter availability distinguishes a known empty parameter list from unavailable capture.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseParameterCapture {
    pub availability: DatabaseCaptureAvailability,
    pub values: Vec<DatabaseParameter>,
    pub observed_byte_length: Option<u64>,
    pub captured_byte_length: Option<u64>,
    pub reason: Option<String>,
}

/// Provider failures are separate from ordinary result metadata and remain visible in the database inspector.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCommandFailure {
    pub category: String,
    pub error_type: Option<String>,
    pub message: String,
}

/// The database command detail intentionally does not imply that result rows were captured.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseResultAvailability {
    pub availability: DatabaseCaptureAvailability,
    pub reason: Option<String>,
}

/// Canonical database command detail stored separately from HTTP exchanges.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCommand {
    pub schema_version: SchemaVersion,
    pub id: String,
    pub session_id: String,
    pub revision: u64,
    pub arrival_sequence: u64,
    pub source: CaptureSource,
    pub correlation: Option<CorrelationContext>,
    pub lifecycle: ExchangeLifecycle,
    pub provider: String,
    pub database_name: String,
    pub data_source: Option<String>,
    pub command_type: String,
    pub operation: String,
    pub primary_target: String,
    pub query: DatabaseQueryCapture,
    pub parameters: DatabaseParameterCapture,
    pub total_duration: DurationValue,
    pub failure: Option<DatabaseCommandFailure>,
    pub result: DatabaseResultAvailability,
}

impl DatabaseCommand {
    /// Validates only database structural requirements so the HTTP contract remains independent.
    pub fn validate(&self) -> Result<(), ModelValidationError> {
        if self.schema_version.major != 1 {
            return Err(ModelValidationError("database command schema version major must be 1".into()));
        }
        if self.id.trim().is_empty() || self.session_id.trim().is_empty() || self.source.instance_id.trim().is_empty() {
            return Err(ModelValidationError("database command IDs must not be empty".into()));
        }
        if self.revision == 0 || self.arrival_sequence == 0 {
            return Err(ModelValidationError("database command revision and arrival sequence must be positive".into()));
        }
        if self.provider.trim().is_empty() || self.database_name.trim().is_empty() || self.primary_target.trim().is_empty() {
            return Err(ModelValidationError("database command provider, database name, and primary target must not be empty".into()));
        }
        if self.query.availability == DatabaseCaptureAvailability::Captured && self.query.value.is_none() {
            return Err(ModelValidationError("captured database query requires a value".into()));
        }
        if self.query.availability == DatabaseCaptureAvailability::Unavailable && self.query.value.is_some() {
            return Err(ModelValidationError("unavailable database query must not include a value".into()));
        }
        if self.parameters.availability == DatabaseCaptureAvailability::Unavailable && !self.parameters.values.is_empty() {
            return Err(ModelValidationError("unavailable database parameters must not include values".into()));
        }
        if self.total_duration.milliseconds.is_none() && self.total_duration.provenance != super::CaptureProvenance::Unavailable {
            return Err(ModelValidationError("unknown database duration requires unavailable provenance".into()));
        }
        if self.lifecycle.state == ExchangeState::Failed && self.failure.is_none() {
            return Err(ModelValidationError("failed database command requires failure details".into()));
        }
        if self.lifecycle.state != ExchangeState::Failed && self.failure.is_some() {
            return Err(ModelValidationError("only a failed database command may include failure details".into()));
        }
        Ok(())
    }

    pub fn retained_byte_length(&self) -> u64 {
        serde_json::to_vec(self).map_or(0, |serialized| serialized.len() as u64)
    }
}

/// UI streaming remains small by sending a command summary instead of its query and parameter values.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCommandSummary {
    pub key: DatabaseCommandKey,
    pub revision: u64,
    pub arrival_sequence: u64,
    pub lifecycle: ExchangeLifecycle,
    pub provider: String,
    pub database_name: String,
    pub data_source: Option<String>,
    pub command_type: String,
    pub operation: String,
    pub primary_target: String,
    pub duration_ms: Option<u64>,
    pub source_name: String,
    pub info: Option<String>,
}

/// Database UI deltas are deliberately independent from the HTTP capture delta contract.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DatabaseUiDelta {
    Upsert { summary: Box<DatabaseCommandSummary> },
    Remove { key: DatabaseCommandKey, reason: String },
    Reset { session_id: String, summaries: Vec<DatabaseCommandSummary> },
    Status { command_count: usize, retained_bytes: u64, retention_blocked_by_in_flight: bool },
    DetailInvalidated { key: DatabaseCommandKey, revision: u64 },
}
