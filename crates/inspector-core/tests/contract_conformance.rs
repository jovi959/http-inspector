use std::{fs, path::PathBuf};

use inspector_core::{
    application::{CaptureHub, RepositoryLimits},
    domain::{CaptureMessage, ExchangeKey, HelloError, HttpExchange, ModelValidationError, SchemaVersion, ServerMessage, ValidationLimits},
};
use schemars::schema_for;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InvalidModelCase {
    name: String,
    pointer: String,
    value: serde_json::Value,
    outcome: String,
    metadata_max_keys: Option<usize>,
    error: Option<String>,
}

fn fixtures_directory() -> PathBuf {
    // Cargo runs this test from the crate, so two parents return to the workspace root.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join("fixtures/captures")
}

#[test]
fn valid_capture_fixtures_deserialize_and_validate() {
    for entry in fs::read_dir(fixtures_directory()).expect("fixture directory should exist") {
        let path = entry.expect("fixture directory entry should be readable").path();
        let name = path.file_name().and_then(|value| value.to_str()).unwrap_or_default();
        if !name.starts_with("valid-") {
            continue;
        }

        let content = fs::read_to_string(&path).expect("valid fixture should be readable");
        let exchange: HttpExchange = serde_json::from_str(&content).expect("valid fixture should deserialize");
        assert!(exchange.validate().is_ok(), "{} should satisfy model invariants", name);
    }
}

#[test]
fn invalid_capture_fixtures_are_rejected_by_model_validation() {
    let path = fixtures_directory().join("invalid-status.json");
    let content = fs::read_to_string(path).expect("invalid fixture should be readable");
    assert!(serde_json::from_str::<HttpExchange>(&content).is_err());

    let cases: Vec<InvalidModelCase> = serde_json::from_str(
        &fs::read_to_string(fixtures_directory().join("invalid-model-cases.json"))
            .expect("invalid model cases should be readable"),
    ).expect("invalid model cases should be JSON");
    for case in cases {
        let mut value = valid_completed_value();
        *value.pointer_mut(&case.pointer).expect("fixture case pointer should resolve") = case.value;
        if case.outcome == "deserialize" {
            assert!(serde_json::from_value::<HttpExchange>(value).is_err(), "{} should fail deserialization", case.name);
            continue;
        }
        let exchange: HttpExchange = serde_json::from_value(value).expect("validation case should deserialize");
        let limits = ValidationLimits { metadata_max_keys: case.metadata_max_keys.unwrap_or(ValidationLimits::default().metadata_max_keys), ..ValidationLimits::default() };
        assert_eq!(exchange.validate_with_limits(limits), Err(ModelValidationError(case.error.expect("validation case should have an error"))), "{} should fail validation", case.name);
    }
}

#[test]
fn semantic_invariants_reject_invalid_exchange_values() {
    let mut value = valid_completed_value();

    value["response"]["statusCode"] = serde_json::json!(700);
    let invalid_status: HttpExchange = serde_json::from_value(value.clone()).expect("shape remains valid");
    assert_eq!(invalid_status.validate(), Err(ModelValidationError("response status must be between 100 and 599".into())));

    value["response"]["statusCode"] = serde_json::json!(200);
    value["id"] = serde_json::json!("not-a-uuid");
    let invalid_id: HttpExchange = serde_json::from_value(value.clone()).expect("shape remains valid");
    assert_eq!(invalid_id.validate(), Err(ModelValidationError("exchange id must be a UUID".into())));

    value["id"] = serde_json::json!("11111111-2222-4333-8444-55555555f001");
    value["lifecycle"]["state"] = serde_json::json!("failed");
    let invalid_failure: HttpExchange = serde_json::from_value(value).expect("shape remains valid");
    assert_eq!(invalid_failure.validate(), Err(ModelValidationError("failed exchange requires a failure".into())));
}

#[test]
fn validation_rejects_contract_version_timing_size_body_and_metadata_violations() {
    let mut value = valid_completed_value();
    value["schemaVersion"]["major"] = serde_json::json!(2);
    assert_validation_error(value.clone(), "schema version major must be 1");

    value["schemaVersion"]["major"] = serde_json::json!(1);
    value["source"]["protocolVersion"]["major"] = serde_json::json!(2);
    assert_validation_error(value.clone(), "source protocol version major must be 1");

    value["source"]["protocolVersion"]["major"] = serde_json::json!(1);
    value["revision"] = serde_json::json!(0);
    assert_validation_error(value.clone(), "revision and arrival sequence must be positive");

    value["revision"] = serde_json::json!(2);
    value["timing"]["total"]["milliseconds"] = serde_json::json!(39);
    assert_validation_error(value.clone(), "total duration cannot precede exchange end");

    value["timing"]["total"]["milliseconds"] = serde_json::json!(40);
    value["sizes"]["total"]["bytes"] = serde_json::json!(1);
    assert_validation_error(value.clone(), "total bytes cannot be smaller than known message parts");

    value["sizes"]["total"]["bytes"] = serde_json::json!(508);
    value["request"]["body"]["content"] = serde_json::Value::Null;
    assert_validation_error(value.clone(), "captured body requires content");

    let mut metadata = serde_json::json!({ "leaf": "value" });
    for _ in 0..8 {
        metadata = serde_json::json!({ "nested": metadata });
    }
    value["request"]["body"]["content"] = serde_json::json!({ "kind": "inlineText", "value": "{}" });
    value["metadata"] = metadata;
    let exchange: HttpExchange = serde_json::from_value(value).expect("shape remains valid");
    let limits = ValidationLimits { metadata_max_depth: 4, ..ValidationLimits::default() };
    assert_eq!(exchange.validate_with_limits(limits), Err(ModelValidationError("metadata exceeds nesting depth limit".into())));
}

#[test]
fn canonical_round_trip_preserves_duplicate_header_order_and_values() {
    let exchange: HttpExchange = serde_json::from_value(valid_completed_value()).expect("fixture should deserialize");
    let round_trip: HttpExchange = serde_json::from_str(&serde_json::to_string(&exchange).expect("model should serialize"))
        .expect("serialized model should deserialize");

    assert_eq!(round_trip, exchange);
    assert_eq!(round_trip.request.headers[2].value, "one");
    assert_eq!(round_trip.request.headers[3].value, "two");
}

#[test]
fn generated_schema_exposes_canonical_exchange_sections() {
    let schema = serde_json::to_string(&schema_for!(HttpExchange)).expect("schema should serialize");

    for field in ["schemaVersion", "lifecycle", "request", "response", "capture", "metadata"] {
        assert!(schema.contains(field), "schema should expose {field}");
    }
}

#[test]
fn protocol_messages_use_generated_camel_case_field_names() {
    let heartbeat: CaptureMessage = serde_json::from_value(serde_json::json!({
        "type": "heartbeat", "schemaVersion": { "major": 1, "minor": 0 },
        "messageId": "11111111-2222-4333-8444-55555555c010",
        "sourceInstanceId": "11111111-2222-4333-8444-55555555b010",
        "sentAt": "2026-08-13T20:42:00.000Z", "queuedCount": 0, "droppedCount": 0
    })).expect("camel case heartbeat should deserialize");
    assert!(matches!(heartbeat, CaptureMessage::Heartbeat { .. }));

    let error = ServerMessage::MessageError {
        message_id: Some("11111111-2222-4333-8444-55555555c010".into()),
        error: HelloError { code: "message.rejected".into(), message: "invalid".into(), retryable: true },
    };
    let json = serde_json::to_value(error).expect("server message should serialize");
    assert!(json.get("messageId").is_some());
}

#[test]
fn terminal_message_without_start_is_recovered_and_late_start_does_not_regress_it() {
    let exchange = valid_completed_exchange();
    let hub = CaptureHub::new(RepositoryLimits { max_summaries: 10 });
    let completed = completed_message(&exchange, 2);

    let first = hub.ingest(&exchange.source, "2026-08-13T20:40:00.000Z", completed.clone()).expect("completion should merge");
    assert!(first.changed);
    let key = ExchangeKey { source_instance_id: exchange.source.instance_id.clone(), exchange_id: exchange.id.clone() };
    let recovered = hub.exchange(&key).expect("recovered exchange should be stored");
    assert_eq!(recovered.lifecycle.state, inspector_core::domain::ExchangeState::Completed);
    assert_eq!(recovered.request.method, "UNKNOWN");
    assert_eq!(recovered.metadata["capture.missingStart"], serde_json::json!(true));

    let late_start = CaptureMessage::ExchangeStarted {
        schema_version: SchemaVersion { major: 1, minor: 0 },
        message_id: "11111111-2222-4333-8444-55555555c001".into(),
        exchange_id: exchange.id.clone(),
        source_instance_id: exchange.source.instance_id.clone(),
        revision: 3,
        sent_at: exchange.lifecycle.started_at.clone(),
        request: Box::new(exchange.request.clone()),
        timing: Box::new(exchange.timing.clone()),
        tags: exchange.tags.clone(),
        correlation: exchange.correlation.clone(),
        metadata: exchange.metadata.clone(),
    };
    hub.ingest(&exchange.source, "2026-08-13T20:40:01.000Z", late_start).expect("late start should merge missing request");
    let completed_after_late_start = hub.exchange(&key).expect("exchange should remain stored");
    assert_eq!(completed_after_late_start.lifecycle.state, inspector_core::domain::ExchangeState::Completed);
    assert_eq!(completed_after_late_start.request.method, "POST");

    let stale = hub.ingest(&exchange.source, "2026-08-13T20:40:02.000Z", completed).expect("duplicate should be accepted as stale");
    assert!(!stale.changed);
}

#[test]
fn explicit_inspector_action_records_while_passive_recording_is_paused() {
    let exchange = valid_completed_exchange();
    let hub = CaptureHub::new(RepositoryLimits { max_summaries: 10 });
    hub.set_recording(false);
    let started = CaptureMessage::ExchangeStarted {
        schema_version: SchemaVersion { major: 1, minor: 0 },
        message_id: "11111111-2222-4333-8444-55555555c031".into(),
        exchange_id: exchange.id.clone(),
        source_instance_id: exchange.source.instance_id.clone(),
        revision: 1,
        sent_at: exchange.lifecycle.started_at.clone(),
        request: Box::new(exchange.request.clone()),
        timing: Box::new(exchange.timing.clone()),
        tags: vec!["replay".into()],
        correlation: exchange.correlation.clone(),
        metadata: exchange.metadata.clone(),
    };

    let passive = hub.ingest(&exchange.source, "2026-08-13T20:40:00.000Z", started.clone()).expect("paused passive ingest should be accepted");
    assert!(!passive.changed);
    assert!(hub.snapshot().is_empty());

    let explicit = hub.ingest_explicit(&exchange.source, "2026-08-13T20:40:00.000Z", started).expect("explicit replay should merge");
    assert!(explicit.changed);
    assert_eq!(hub.snapshot().len(), 1);
    assert_eq!(hub.snapshot()[0].lifecycle.state, inspector_core::domain::ExchangeState::InFlight);
}

#[test]
fn disconnected_source_marks_only_its_in_flight_exchanges_incomplete() {
    let in_flight: HttpExchange = serde_json::from_str(
        &fs::read_to_string(fixtures_directory().join("valid-in-flight.json")).expect("in-flight fixture should be readable"),
    ).expect("in-flight fixture should deserialize");
    let completed = valid_completed_exchange();
    let hub = CaptureHub::new(RepositoryLimits { max_summaries: 10 });
    let started = CaptureMessage::ExchangeStarted {
        schema_version: SchemaVersion { major: 1, minor: 0 },
        message_id: "11111111-2222-4333-8444-55555555c021".into(),
        exchange_id: in_flight.id.clone(),
        source_instance_id: in_flight.source.instance_id.clone(),
        revision: 1,
        sent_at: in_flight.lifecycle.started_at.clone(),
        request: Box::new(in_flight.request.clone()),
        timing: Box::new(in_flight.timing.clone()),
        tags: in_flight.tags.clone(),
        correlation: in_flight.correlation.clone(),
        metadata: in_flight.metadata.clone(),
    };
    hub.ingest(&in_flight.source, "2026-08-13T20:40:11.001Z", started).expect("start should merge");
    hub.ingest(&completed.source, "2026-08-13T20:40:49.041Z", completed_message(&completed, 2)).expect("completion should merge");

    let mutation = hub.mark_source_disconnected(&in_flight.source.instance_id, "2026-08-13T20:40:12.000Z")
        .expect("disconnect should merge");
    let key = ExchangeKey { source_instance_id: in_flight.source.instance_id.clone(), exchange_id: in_flight.id.clone() };
    let marked = hub.exchange(&key).expect("in-flight exchange should remain stored");
    assert!(mutation.changed);
    assert_eq!(marked.lifecycle.state, inspector_core::domain::ExchangeState::Incomplete);
    assert_eq!(marked.metadata["capture.incompleteReason"], serde_json::json!("source disconnected"));
    assert_eq!(hub.snapshot().len(), 2);
}

#[test]
fn hub_evicts_oldest_terminal_summary_deterministically() {
    let first = valid_completed_exchange();
    let mut second = first.clone();
    second.id = "11111111-2222-4333-8444-55555555f099".into();
    let hub = CaptureHub::new(RepositoryLimits { max_summaries: 1 });

    hub.ingest(&first.source, "2026-08-13T20:40:00.000Z", completed_message(&first, 2)).expect("first should merge");
    let second_mutation = hub.ingest(&second.source, "2026-08-13T20:40:01.000Z", completed_message(&second, 2)).expect("second should merge");

    assert_eq!(hub.snapshot().len(), 1);
    assert_eq!(hub.snapshot()[0].key.exchange_id, second.id);
    assert!(second_mutation.deltas.iter().any(|delta| matches!(delta, inspector_core::domain::CaptureUiDelta::Remove { key, .. } if key.exchange_id == first.id)));
}

fn valid_completed_value() -> serde_json::Value {
    let path = fixtures_directory().join("valid-completed.json");
    let content = fs::read_to_string(path).expect("valid fixture should be readable");
    serde_json::from_str(&content).expect("valid fixture should be JSON")
}

fn valid_completed_exchange() -> HttpExchange {
    serde_json::from_value(valid_completed_value()).expect("valid fixture should deserialize")
}
fn completed_message(exchange: &HttpExchange, revision: u64) -> CaptureMessage {
    CaptureMessage::ExchangeCompleted {
        schema_version: SchemaVersion { major: 1, minor: 0 },
        message_id: "11111111-2222-4333-8444-55555555c002".into(),
        exchange_id: exchange.id.clone(),
        source_instance_id: exchange.source.instance_id.clone(),
        revision,
        sent_at: exchange.lifecycle.last_updated_at.clone(),
        response: Box::new(exchange.response.clone().expect("completed fixture needs a response")),
        timing: Box::new(exchange.timing.clone()),
        sizes: Box::new(exchange.sizes.clone()),
        capture: exchange.capture.clone(),
        metadata_patch: None,
    }
}

fn assert_validation_error(value: serde_json::Value, expected: &str) {
    let exchange: HttpExchange = serde_json::from_value(value).expect("fixture shape should remain valid");
    assert_eq!(exchange.validate(), Err(ModelValidationError(expected.into())));
}
