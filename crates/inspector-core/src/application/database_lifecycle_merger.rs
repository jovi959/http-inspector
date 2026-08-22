use super::super::domain::{
    CaptureMessage, CaptureProvenance, CaptureSource, DatabaseCaptureAvailability, DatabaseCommand,
    DatabaseCommandKey, DatabaseParameterCapture, DatabaseQueryCapture,
    DatabaseResultAvailability, DurationValue, ExchangeLifecycle, ExchangeState,
    ModelValidationError, SchemaVersion,
};

/// Database lifecycle outcomes mirror HTTP ordering without sharing HTTP state or types.
#[derive(Clone, Debug, PartialEq)]
pub enum DatabaseMergeResult {
    Applied(Box<DatabaseCommand>),
    IgnoredStale { key: DatabaseCommandKey, revision: u64 },
    NotDatabaseMessage,
}

struct MergeContext<'a> {
    source: &'a CaptureSource,
    session_id: &'a str,
    arrival_sequence: u64,
    received_at: &'a str,
}

/// Merges only database messages; HTTP messages remain owned by the existing HTTP merger.
pub fn merge_database_message(
    current: Option<DatabaseCommand>,
    source: &CaptureSource,
    session_id: &str,
    arrival_sequence: u64,
    received_at: &str,
    message: CaptureMessage,
) -> Result<DatabaseMergeResult, ModelValidationError> {
    let context = MergeContext { source, session_id, arrival_sequence, received_at };
    match message {
        CaptureMessage::DatabaseCommandStarted {
            command_id, revision, sent_at, provider, database_name, data_source, command_type,
            operation, primary_target, query, parameters, correlation, ..
        } => {
            let Some(mut command) = begin_or_current(current, &context, &command_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &command_id, revision));
            };
            command.provider = provider;
            command.database_name = database_name;
            command.data_source = data_source;
            command.command_type = command_type;
            command.operation = operation;
            command.primary_target = primary_target;
            command.query = query;
            command.parameters = parameters;
            command.correlation = correlation;
            if !is_terminal(&command.lifecycle.state) {
                command.lifecycle.state = ExchangeState::InFlight;
            }
            finish(command, revision, context.received_at)
        }
        CaptureMessage::DatabaseCommandCompleted {
            command_id, revision, sent_at, total_duration, result, ..
        } => {
            let Some(mut command) = begin_or_current(current, &context, &command_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &command_id, revision));
            };
            command.total_duration = total_duration;
            command.result = result;
            command.failure = None;
            command.lifecycle.state = ExchangeState::Completed;
            finish(command, revision, context.received_at)
        }
        CaptureMessage::DatabaseCommandFailed {
            command_id, revision, sent_at, failure, total_duration, result, ..
        } => {
            let Some(mut command) = begin_or_current(current, &context, &command_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &command_id, revision));
            };
            command.total_duration = total_duration;
            command.result = result;
            command.failure = Some(failure);
            command.lifecycle.state = ExchangeState::Failed;
            finish(command, revision, context.received_at)
        }
        CaptureMessage::DatabaseCommandCancelled {
            command_id, revision, sent_at, origin, total_duration, result, ..
        } => {
            let Some(mut command) = begin_or_current(current, &context, &command_id, revision, &sent_at)? else {
                return Ok(stale(&context.source.instance_id, &command_id, revision));
            };
            command.total_duration = total_duration;
            command.result = result;
            command.failure = None;
            command.lifecycle.state = ExchangeState::Cancelled;
            command.result.reason = Some(origin);
            finish(command, revision, context.received_at)
        }
        CaptureMessage::DatabaseCommandSnapshot { command_id, revision, command, .. } => {
            if let Some(current) = current
                && revision <= current.revision
            {
                return Ok(stale(&context.source.instance_id, &command_id, revision));
            }
            if command.id != command_id {
                return Err(ModelValidationError("snapshot database command ID must match message command ID".into()));
            }
            let mut command = *command;
            command.session_id = context.session_id.into();
            command.source = context.source.clone();
            command.revision = revision;
            command.arrival_sequence = context.arrival_sequence;
            command.lifecycle.received_at = context.received_at.into();
            command.lifecycle.last_updated_at = context.received_at.into();
            command.validate()?;
            Ok(DatabaseMergeResult::Applied(Box::new(command)))
        }
        _ => Ok(DatabaseMergeResult::NotDatabaseMessage),
    }
}

fn begin_or_current(
    current: Option<DatabaseCommand>,
    context: &MergeContext<'_>,
    command_id: &str,
    revision: u64,
    sent_at: &str,
) -> Result<Option<DatabaseCommand>, ModelValidationError> {
    match current {
        Some(current) if revision <= current.revision => Ok(None),
        Some(current) => Ok(Some(current)),
        None => Ok(Some(missing_start_command(context, command_id, revision, sent_at))),
    }
}

fn finish(mut command: DatabaseCommand, revision: u64, received_at: &str) -> Result<DatabaseMergeResult, ModelValidationError> {
    command.revision = revision;
    command.lifecycle.last_updated_at = received_at.into();
    command.validate()?;
    Ok(DatabaseMergeResult::Applied(Box::new(command)))
}

fn stale(source_instance_id: &str, command_id: &str, revision: u64) -> DatabaseMergeResult {
    DatabaseMergeResult::IgnoredStale {
        key: DatabaseCommandKey { source_instance_id: source_instance_id.into(), command_id: command_id.into() },
        revision,
    }
}

fn missing_start_command(
    context: &MergeContext<'_>,
    command_id: &str,
    revision: u64,
    sent_at: &str,
) -> DatabaseCommand {
    let unavailable = DatabaseCaptureAvailability::Unavailable;
    DatabaseCommand {
        schema_version: SchemaVersion { major: 1, minor: 1 },
        id: command_id.into(),
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
        provider: "unknown".into(),
        database_name: "Unknown database".into(),
        data_source: None,
        command_type: "unknown".into(),
        operation: "unknown".into(),
        primary_target: "Unknown target".into(),
        query: DatabaseQueryCapture {
            availability: unavailable.clone(), value: None, observed_byte_length: None,
            captured_byte_length: None, reason: Some("database command started message was not received".into()),
        },
        parameters: DatabaseParameterCapture {
            availability: unavailable.clone(), values: Vec::new(), observed_byte_length: None,
            captured_byte_length: None, reason: Some("database command started message was not received".into()),
        },
        total_duration: DurationValue { milliseconds: None, provenance: CaptureProvenance::Unavailable },
        failure: None,
        result: DatabaseResultAvailability {
            availability: unavailable,
            reason: Some("result rows are not captured".into()),
            columns: Vec::new(),
            rows: Vec::new(),
            rows_observed: None,
            rows_captured: None,
            truncated: false,
        },
    }
}

fn is_terminal(state: &ExchangeState) -> bool {
    matches!(state, ExchangeState::Completed | ExchangeState::Failed | ExchangeState::Cancelled | ExchangeState::Incomplete)
}
