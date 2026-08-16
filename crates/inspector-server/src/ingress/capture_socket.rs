use std::sync::atomic::Ordering;

use axum::{
    extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}},
    response::Response,
};
use chrono::{SecondsFormat, Utc};
use futures_util::StreamExt;
use inspector_core::domain::{BodyContent, CaptureMessage, ClientHello, HelloAccepted, HelloError, HttpBody, HttpRequest, HttpResponse, SchemaVersion, ServerMessage};
use tokio::{sync::{mpsc, oneshot}, time::{Duration, timeout}};
use uuid::Uuid;

use super::{ServerState, status_delta};

/// Applies four-MiB framing before upgrade and keeps the adapter protocol out of browser code.
pub(crate) async fn upgrade(State(state): State<ServerState>, upgrade: WebSocketUpgrade) -> Response {
    let maximum_message_bytes = state.maximum_message_bytes;
    upgrade
        .max_message_size(maximum_message_bytes)
        .max_frame_size(maximum_message_bytes)
        .on_upgrade(move |socket| capture_connection(socket, state))
}

async fn capture_connection(mut socket: WebSocket, state: ServerState) {
    let hello = match timeout(Duration::from_secs(3), socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<ClientHello>(&text),
        Ok(Some(Ok(_))) => Err(serde_json::Error::io(std::io::Error::other("hello must be text"))),
        Ok(Some(Err(error))) => Err(serde_json::Error::io(std::io::Error::other(error))),
        Ok(None) | Err(_) => {
            let _ = close_with_error(&mut socket, "hello.timeout", "hello was not received within three seconds", true).await;
            return;
        }
    };
    let Ok(hello) = hello else {
        let _ = close_with_error(&mut socket, "hello.invalid", "hello payload is invalid", true).await;
        return;
    };
    if let Err(error) = validate_hello(&hello) {
        let _ = close_with_error(&mut socket, "hello.rejected", &error, false).await;
        return;
    }

    let accepted = ServerMessage::HelloAccepted {
        value: HelloAccepted {
            schema_version: SchemaVersion { major: 1, minor: 0 },
            connection_id: Uuid::new_v4().to_string(),
            session_id: state.hub.status().session_id,
            maximum_message_bytes: state.maximum_message_bytes as u64,
            maximum_body_bytes: state.maximum_body_bytes,
        },
    };
    if send_json(&mut socket, &accepted).await.is_err() {
        return;
    }

    state.connected_sources.fetch_add(1, Ordering::Relaxed);
    publish_status(&state);
    let mut consecutive_errors = 0_u8;
    while let Some(frame) = socket.next().await {
        match frame {
            Ok(Message::Text(text)) => match serde_json::from_str::<CaptureMessage>(&text) {
                Ok(message) => {
                    let message_id = message_id(&message).map(str::to_owned);
                    if record_heartbeat_drops(&state, &message) {
                        publish_status(&state);
                    }
                    match queue_capture(&state, &hello.source, message).await {
                    Ok(_) => {
                        consecutive_errors = 0;
                        if let Some(message_id) = message_id
                            && send_json(&mut socket, &ServerMessage::MessageAccepted { message_id }).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(error) => {
                        consecutive_errors += 1;
                        state.diagnostics.record_rejection();
                        publish_status(&state);
                        if send_message_error(&mut socket, message_id.as_deref(), error.to_string()).await.is_err() || error.should_close() || consecutive_errors >= 3 {
                            break;
                        }
                    }
                }}
                Err(_) => {
                    consecutive_errors += 1;
                    state.diagnostics.record_rejection();
                    publish_status(&state);
                    if send_message_error(&mut socket, None, "message payload is invalid".into()).await.is_err() || consecutive_errors >= 3 {
                        break;
                    }
                }
            },
            Ok(Message::Binary(_)) => {
                consecutive_errors += 1;
                state.diagnostics.record_rejection();
                publish_status(&state);
                if send_message_error(&mut socket, None, "binary messages are not supported by protocol v1".into()).await.is_err() || consecutive_errors >= 3 {
                    break;
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
        }
    }
    state.connected_sources.fetch_sub(1, Ordering::Relaxed);
    if let Ok(mutation) = state.hub.mark_source_disconnected(&hello.source.instance_id, &timestamp())
        && mutation.changed
    {
        let _ = state.ui_events.send(mutation.deltas);
    }
    publish_status(&state);
}

fn validate_hello(hello: &ClientHello) -> Result<(), String> {
    if hello.schema_version.major != 1 || hello.source.protocol_version.major != 1 {
        return Err("protocol major version is not supported".into());
    }
    if hello.supported_protocol.minimum.major > 1 || hello.supported_protocol.maximum.major < 1 {
        return Err("supported protocol range does not include v1".into());
    }
    Ok(())
}

fn message_id(message: &CaptureMessage) -> Option<&str> {
    match message {
        CaptureMessage::ExchangeStarted { message_id, .. }
        | CaptureMessage::ExchangeCompleted { message_id, .. }
        | CaptureMessage::ExchangeFailed { message_id, .. }
        | CaptureMessage::ExchangeCancelled { message_id, .. }
        | CaptureMessage::ExchangeSnapshot { message_id, .. }
        | CaptureMessage::Heartbeat { message_id, .. } => Some(message_id),
    }
}

async fn send_message_error(socket: &mut WebSocket, message_id: Option<&str>, message: String) -> Result<(), axum::Error> {
    send_json(socket, &ServerMessage::MessageError {
        message_id: message_id.map(str::to_owned),
        error: HelloError { code: "message.rejected".into(), message, retryable: true },
    }).await
}

async fn close_with_error(socket: &mut WebSocket, code: &str, message: &str, retryable: bool) -> Result<(), axum::Error> {
    send_json(socket, &ServerMessage::HelloError {
        value: HelloError { code: code.into(), message: message.into(), retryable },
    }).await?;
    socket.send(Message::Close(None)).await
}

async fn send_json<T: serde::Serialize>(socket: &mut WebSocket, value: &T) -> Result<(), axum::Error> {
    let payload = serde_json::to_string(value).expect("server messages should serialize");
    socket.send(Message::Text(payload.into())).await
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn publish_status(state: &ServerState) {
    let _ = state.ui_events.send(vec![status_delta(state)]);
}

enum QueueCaptureError {
    Rejected(String),
    Overloaded,
    Unavailable,
}

impl QueueCaptureError {
    fn should_close(&self) -> bool {
        matches!(self, Self::Overloaded | Self::Unavailable)
    }
}

impl std::fmt::Display for QueueCaptureError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected(message) => formatter.write_str(message),
            Self::Overloaded => formatter.write_str("capture queue is full; reconnect and retry"),
            Self::Unavailable => formatter.write_str("capture processor is unavailable; reconnect and retry"),
        }
    }
}

async fn queue_capture(
    state: &ServerState,
    source: &inspector_core::domain::CaptureSource,
    message: CaptureMessage,
) -> Result<inspector_core::application::HubMutation, QueueCaptureError> {
    validate_message_body_limits(&message, state.maximum_body_bytes).map_err(QueueCaptureError::Rejected)?;
    let (completion, response) = oneshot::channel();
    let queued = super::queue::QueuedCapture { source: source.clone(), received_at: timestamp(), message, completion };
    match state.ingest_queue.try_send(queued) {
        Ok(()) => response.await.map_err(|_| QueueCaptureError::Unavailable)?.map_err(|error| QueueCaptureError::Rejected(error.to_string())),
        Err(mpsc::error::TrySendError::Full(_)) => {
            state.diagnostics.record_drop();
            Err(QueueCaptureError::Overloaded)
        }
        Err(mpsc::error::TrySendError::Closed(_)) => Err(QueueCaptureError::Unavailable),
    }
}

/// Applies limits before queueing without redacting, trimming, or rewriting an accepted value.
fn validate_message_body_limits(message: &CaptureMessage, maximum_body_bytes: u64) -> Result<(), String> {
    match message {
        CaptureMessage::ExchangeStarted { request, .. } => validate_request_bodies(request, maximum_body_bytes),
        CaptureMessage::ExchangeCompleted { response, .. } => validate_response_bodies(response, maximum_body_bytes),
        CaptureMessage::ExchangeFailed { response, .. } => response.as_deref().map_or(Ok(()), |value| validate_response_bodies(value, maximum_body_bytes)),
        CaptureMessage::ExchangeSnapshot { exchange, .. } => {
            validate_request_bodies(&exchange.request, maximum_body_bytes)?;
            exchange.response.as_ref().map_or(Ok(()), |value| validate_response_bodies(value, maximum_body_bytes))
        }
        CaptureMessage::ExchangeCancelled { .. } | CaptureMessage::Heartbeat { .. } => Ok(()),
    }
}

fn validate_request_bodies(request: &HttpRequest, maximum_body_bytes: u64) -> Result<(), String> {
    validate_body_limit(request.body.as_ref(), maximum_body_bytes)?;
    validate_body_limit(request.raw.as_ref(), maximum_body_bytes)
}

fn validate_response_bodies(response: &HttpResponse, maximum_body_bytes: u64) -> Result<(), String> {
    validate_body_limit(response.body.as_ref(), maximum_body_bytes)?;
    validate_body_limit(response.raw.as_ref(), maximum_body_bytes)
}

fn validate_body_limit(body: Option<&HttpBody>, maximum_body_bytes: u64) -> Result<(), String> {
    let Some(body) = body else { return Ok(()); };
    if body.captured_byte_length.is_some_and(|size| size > maximum_body_bytes) {
        return Err("captured body exceeds the negotiated maximum body size".into());
    }
    let Some(content) = &body.content else { return Ok(()); };
    let content_bytes = match content {
        BodyContent::InlineText { value } => value.len() as u64,
        BodyContent::InlineBase64 { value } => base64::Engine::decode(&base64::engine::general_purpose::STANDARD, value)
            .map_err(|_| "captured binary body is not valid base64")?
            .len() as u64,
        BodyContent::AttachmentRef { .. } => return Ok(()),
    };
    if content_bytes > maximum_body_bytes {
        return Err("captured body exceeds the negotiated maximum body size".into());
    }
    Ok(())
}

fn record_heartbeat_drops(state: &ServerState, message: &CaptureMessage) -> bool {
    if let CaptureMessage::Heartbeat { dropped_count, .. } = message {
        state.diagnostics.record_source_drops(*dropped_count);
        return true;
    }
    false
}
