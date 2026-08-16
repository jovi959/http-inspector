use chrono::DateTime;
use serde_json::Value;
use uuid::Uuid;

use super::{
    BodyAvailability, ByteCount, CaptureProvenance, DurationValue, ExchangeState, HttpBody,
    HttpExchange, Metadata,
};

/// Limits protect structural resources only; the inspector deliberately retains accepted values.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ValidationLimits {
    pub metadata_max_depth: usize,
    pub metadata_max_keys: usize,
    pub metadata_max_string_bytes: usize,
    pub metadata_max_serialized_bytes: usize,
    pub max_tags: usize,
}

impl Default for ValidationLimits {
    fn default() -> Self {
        Self {
            metadata_max_depth: 8,
            metadata_max_keys: 128,
            metadata_max_string_bytes: 16 * 1024,
            metadata_max_serialized_bytes: 64 * 1024,
            max_tags: 64,
        }
    }
}

/// Typed validation failures produce safe, precise diagnostics for fixtures and receiver clients.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelValidationError(pub String);

impl std::fmt::Display for ModelValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for ModelValidationError {}

impl HttpExchange {
    /// Validates the v1 contract without fabricating omitted transport details or transforming data.
    pub fn validate(&self) -> Result<(), ModelValidationError> {
        self.validate_with_limits(ValidationLimits::default())
    }

    pub fn validate_with_limits(&self, limits: ValidationLimits) -> Result<(), ModelValidationError> {
        validate_uuid("exchange id", &self.id)?;
        validate_uuid("session id", &self.session_id)?;
        validate_uuid("source instance id", &self.source.instance_id)?;
        if self.schema_version.major != 1 {
            return Err(ModelValidationError("schema version major must be 1".into()));
        }
        if self.source.protocol_version.major != 1 {
            return Err(ModelValidationError("source protocol version major must be 1".into()));
        }
        if self.revision == 0 || self.arrival_sequence == 0 {
            return Err(ModelValidationError("revision and arrival sequence must be positive".into()));
        }
        required("source application name", &self.source.application_name)?;
        required("source service name", &self.source.service_name)?;
        required("source platform", &self.source.platform)?;
        required("source adapter name", &self.source.adapter_name)?;
        required("source adapter version", &self.source.adapter_version)?;
        validate_timestamps(&self.lifecycle)?;
        required("request method", &self.request.method)?;
        required("request URL", &self.request.url)?;
        validate_exchange_state(self)?;
        validate_body(self.request.body.as_ref())?;
        validate_body(self.request.raw.as_ref())?;
        if let Some(response) = &self.response {
            if !(100..=599).contains(&response.status_code) {
                return Err(ModelValidationError("response status must be between 100 and 599".into()));
            }
            validate_body(response.body.as_ref())?;
            validate_body(response.raw.as_ref())?;
        }
        validate_timing(self)?;
        validate_sizes(self)?;
        if self.tags.len() > limits.max_tags || self.tags.iter().any(|tag| tag.trim().is_empty()) {
            return Err(ModelValidationError("tags must be non-empty and within the configured limit".into()));
        }
        validate_metadata("source metadata", &self.source.metadata, limits)?;
        validate_metadata("metadata", &self.metadata, limits)?;
        if let Some(transport) = &self.transport {
            validate_metadata("transport", transport, limits)?;
        }
        Ok(())
    }
}

fn validate_exchange_state(exchange: &HttpExchange) -> Result<(), ModelValidationError> {
    match exchange.lifecycle.state {
        ExchangeState::Completed if exchange.response.is_none() => {
            Err(ModelValidationError("completed exchange requires a response".into()))
        }
        ExchangeState::Failed if exchange.failure.is_none() => {
            Err(ModelValidationError("failed exchange requires a failure".into()))
        }
        ExchangeState::Failed => Ok(()),
        _ if exchange.failure.is_some() => Err(ModelValidationError(
            "only a failed exchange may contain failure details".into(),
        )),
        _ => Ok(()),
    }
}

fn validate_body(body: Option<&HttpBody>) -> Result<(), ModelValidationError> {
    let Some(body) = body else { return Ok(()); };
    let has_content = body.content.is_some();
    match body.availability {
        BodyAvailability::Captured if !has_content => {
            return Err(ModelValidationError("captured body requires content".into()));
        }
        BodyAvailability::Truncated if !has_content || body.truncation_reason.as_deref().unwrap_or_default().is_empty() => {
            return Err(ModelValidationError("truncated body requires content and truncation reason".into()));
        }
        BodyAvailability::Pending | BodyAvailability::Empty | BodyAvailability::NotApplicable
        | BodyAvailability::Omitted | BodyAvailability::Unavailable if has_content => {
            return Err(ModelValidationError("unavailable body state must not contain content".into()));
        }
        _ => {}
    }
    if body.availability != BodyAvailability::Truncated && body.truncation_reason.is_some() {
        return Err(ModelValidationError("only a truncated body may include a truncation reason".into()));
    }
    if let (Some(captured), Some(observed)) = (body.captured_byte_length, body.observed_byte_length)
        && captured > observed
    {
        return Err(ModelValidationError("captured body bytes cannot exceed observed bytes".into()));
    }
    Ok(())
}

fn validate_timing(exchange: &HttpExchange) -> Result<(), ModelValidationError> {
    let timing = &exchange.timing;
    let phases = [
        timing.request_headers_sent_ms,
        timing.request_body_finished_ms,
        timing.response_headers_received_ms,
        timing.response_body_finished_ms,
        timing.exchange_ended_ms,
    ];
    if phases.windows(2).any(|window| matches!(window, [Some(left), Some(right)] if left > right)) {
        return Err(ModelValidationError("timing offsets must be non-decreasing".into()));
    }
    for duration in [
        &timing.dns, &timing.connect, &timing.tls, &timing.queue, &timing.request_write,
        &timing.server_wait, &timing.response_read, &timing.total,
    ] {
        validate_duration(duration)?;
    }
    if let (Some(total), Some(ended)) = (timing.total.milliseconds, timing.exchange_ended_ms)
        && total < ended
    {
        return Err(ModelValidationError("total duration cannot precede exchange end".into()));
    }
    Ok(())
}

fn validate_duration(value: &DurationValue) -> Result<(), ModelValidationError> {
    if value.milliseconds.is_none() && value.provenance != CaptureProvenance::Unavailable {
        return Err(ModelValidationError("unknown duration requires unavailable provenance".into()));
    }
    Ok(())
}

fn validate_sizes(exchange: &HttpExchange) -> Result<(), ModelValidationError> {
    let sizes = &exchange.sizes;
    for size in [
        &sizes.request_headers, &sizes.request_body, &sizes.response_headers, &sizes.response_body,
        &sizes.total,
    ] {
        validate_size(size)?;
    }
    let known_parts = [
        sizes.request_headers.bytes,
        sizes.request_body.bytes,
        sizes.response_headers.bytes,
        sizes.response_body.bytes,
    ].into_iter().flatten().sum::<u64>();
    if let Some(total) = sizes.total.bytes
        && total < known_parts
    {
        return Err(ModelValidationError("total bytes cannot be smaller than known message parts".into()));
    }
    Ok(())
}

fn validate_size(value: &ByteCount) -> Result<(), ModelValidationError> {
    if value.bytes.is_none() && value.provenance != CaptureProvenance::Unavailable {
        return Err(ModelValidationError("unknown byte count requires unavailable provenance".into()));
    }
    Ok(())
}

fn validate_timestamps(lifecycle: &super::ExchangeLifecycle) -> Result<(), ModelValidationError> {
    parse_utc("lifecycle startedAt", &lifecycle.started_at)?;
    let received = parse_utc("lifecycle receivedAt", &lifecycle.received_at)?;
    let updated = parse_utc("lifecycle lastUpdatedAt", &lifecycle.last_updated_at)?;
    // The source clock can legitimately be ahead of the inspector clock, so only inspector times order.
    if updated < received {
        return Err(ModelValidationError("lifecycle inspector timestamps must be ordered".into()));
    }
    Ok(())
}

fn parse_utc(label: &str, value: &str) -> Result<DateTime<chrono::FixedOffset>, ModelValidationError> {
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| ModelValidationError(format!("{label} must be RFC 3339")))?;
    if parsed.offset().local_minus_utc() != 0 {
        return Err(ModelValidationError(format!("{label} must use UTC")));
    }
    Ok(parsed)
}

fn validate_uuid(label: &str, value: &str) -> Result<(), ModelValidationError> {
    Uuid::parse_str(value).map_err(|_| ModelValidationError(format!("{label} must be a UUID")))?;
    Ok(())
}

fn required(label: &str, value: &str) -> Result<(), ModelValidationError> {
    if value.trim().is_empty() {
        return Err(ModelValidationError(format!("{label} must not be empty")));
    }
    Ok(())
}

fn validate_metadata(label: &str, metadata: &Metadata, limits: ValidationLimits) -> Result<(), ModelValidationError> {
    if serde_json::to_vec(metadata)
        .map_err(|_| ModelValidationError(format!("{label} cannot be serialized")))?
        .len() > limits.metadata_max_serialized_bytes
    {
        return Err(ModelValidationError(format!("{label} exceeds serialized size limit")));
    }
    let mut key_count = 0;
    for (key, value) in metadata {
        validate_metadata_string(label, key, limits)?;
        validate_metadata_value(label, value, 1, &mut key_count, limits)?;
    }
    Ok(())
}

fn validate_metadata_value(
    label: &str,
    value: &Value,
    depth: usize,
    key_count: &mut usize,
    limits: ValidationLimits,
) -> Result<(), ModelValidationError> {
    if depth > limits.metadata_max_depth {
        return Err(ModelValidationError(format!("{label} exceeds nesting depth limit")));
    }
    match value {
        Value::String(value) => validate_metadata_string(label, value, limits),
        Value::Array(values) => values.iter().try_for_each(|item| {
            validate_metadata_value(label, item, depth + 1, key_count, limits)
        }),
        Value::Object(values) => values.iter().try_for_each(|(key, item)| {
            *key_count += 1;
            if *key_count > limits.metadata_max_keys {
                return Err(ModelValidationError(format!("{label} exceeds key count limit")));
            }
            validate_metadata_string(label, key, limits)?;
            validate_metadata_value(label, item, depth + 1, key_count, limits)
        }),
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
    }
}

fn validate_metadata_string(label: &str, value: &str, limits: ValidationLimits) -> Result<(), ModelValidationError> {
    if value.len() > limits.metadata_max_string_bytes {
        return Err(ModelValidationError(format!("{label} exceeds string size limit")));
    }
    Ok(())
}
