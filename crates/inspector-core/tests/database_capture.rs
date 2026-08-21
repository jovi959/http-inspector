use inspector_core::{
    application::{CaptureHub, DatabaseRepositoryLimits, RepositoryLimits},
    domain::{
        CaptureMessage, CaptureProvenance, CaptureSource, DatabaseCaptureAvailability,
        DatabaseParameterCapture, DatabaseQueryCapture, DatabaseResultAvailability, DurationValue,
        ExchangeState, SchemaVersion,
    },
};

#[test]
fn database_lifecycle_is_retained_independently_from_http_summaries() {
    let source = source();
    let hub = CaptureHub::with_database_limits(
        RepositoryLimits { max_summaries: 1 },
        DatabaseRepositoryLimits { max_commands: 1, max_retained_bytes: 1024 * 1024 },
    );
    let command_id = "11111111-2222-4333-8444-55555555f010".to_string();

    let started = CaptureMessage::DatabaseCommandStarted {
        schema_version: version(),
        message_id: "11111111-2222-4333-8444-55555555c010".into(),
        command_id: command_id.clone(),
        source_instance_id: source.instance_id.clone(),
        revision: 1,
        sent_at: "2026-08-21T12:00:00.000Z".into(),
        provider: "Microsoft.Data.SqlClient".into(),
        database_name: "school".into(),
        data_source: Some("server.example.test".into()),
        command_type: "Text".into(),
        operation: "SELECT".into(),
        primary_target: "dbo.students".into(),
        query: DatabaseQueryCapture {
            availability: DatabaseCaptureAvailability::Captured,
            value: Some("select * from dbo.students".into()),
            observed_byte_length: Some(26), captured_byte_length: Some(26), reason: None,
        },
        parameters: DatabaseParameterCapture {
            availability: DatabaseCaptureAvailability::Captured,
            values: Vec::new(), observed_byte_length: Some(2), captured_byte_length: Some(2), reason: None,
        },
        correlation: None,
    };
    let start = hub.ingest(&source, "2026-08-21T12:00:00.001Z", started).expect("database start should merge");
    assert!(start.deltas.is_empty());
    assert_eq!(start.database_deltas.len(), 1);

    let completed = CaptureMessage::DatabaseCommandCompleted {
        schema_version: version(),
        message_id: "11111111-2222-4333-8444-55555555c011".into(),
        command_id: command_id.clone(),
        source_instance_id: source.instance_id.clone(),
        revision: 2,
        sent_at: "2026-08-21T12:00:00.050Z".into(),
        total_duration: DurationValue { milliseconds: Some(50), provenance: CaptureProvenance::Measured },
        result: DatabaseResultAvailability { availability: DatabaseCaptureAvailability::Unavailable, reason: Some("result rows are not captured".into()) },
    };
    hub.ingest(&source, "2026-08-21T12:00:00.051Z", completed).expect("database completion should merge");

    let summary = hub.database_snapshot().pop().expect("database summary should remain available");
    assert_eq!(summary.primary_target, "dbo.students");
    assert_eq!(summary.lifecycle.state, ExchangeState::Completed);
    assert!(hub.snapshot().is_empty());
}

fn version() -> SchemaVersion {
    SchemaVersion { major: 1, minor: 0 }
}

fn source() -> CaptureSource {
    CaptureSource {
        instance_id: "11111111-2222-4333-8444-55555555b010".into(),
        application_name: "test".into(), service_name: "test".into(), platform: "dotnet".into(),
        adapter_name: "test-adapter".into(), adapter_version: "1.4.0".into(), protocol_version: version(),
        environment: None, device_name: None, process_id: None, build_version: None, base_url: None,
        metadata: Default::default(),
    }
}
