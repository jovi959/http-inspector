use axum::{
    Json,
    extract::{Path, State, ws::{Message, WebSocket, WebSocketUpgrade}},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::StreamExt;
use inspector_core::domain::{CaptureUiDelta, DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta, ExchangeKey, HttpExchange, HttpExchangeSummary};
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::{ReplayExecutionReceipt, ReplayRequest, ingress::{ServerState, source_count, status_delta}};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusResponse {
    session_id: String,
    capture_endpoint: String,
    recording: bool,
    exchange_count: usize,
    connected_sources: u32,
    dropped_count: u64,
    rejected_count: u64,
    retention_blocked_by_in_flight: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordingRequest {
    recording: bool,
}

pub(crate) async fn status(State(state): State<ServerState>) -> Json<StatusResponse> {
    Json(status_response(&state))
}

pub(crate) async fn exchanges(State(state): State<ServerState>) -> Json<Vec<HttpExchangeSummary>> {
    Json(state.hub.snapshot())
}

/// Hosted development exposes database summaries through a separate route from HTTP exchanges.
pub(crate) async fn database_commands(State(state): State<ServerState>) -> Json<Vec<DatabaseCommandSummary>> {
    Json(state.hub.database_snapshot())
}

pub(crate) async fn exchange(
    State(state): State<ServerState>,
    Path((source_instance_id, exchange_id)): Path<(String, String)>,
) -> Result<Json<HttpExchange>, ApiError> {
    state.hub.exchange(&ExchangeKey { source_instance_id, exchange_id })
        .map(Json)
        .ok_or_else(|| ApiError::not_found("exchange was not found"))
}

/// SQL detail is read only after an item is selected so the database stream stays summary-sized.
pub(crate) async fn database_command(
    State(state): State<ServerState>,
    Path((source_instance_id, command_id)): Path<(String, String)>,
) -> Result<Json<DatabaseCommand>, ApiError> {
    state.hub.database_command(&DatabaseCommandKey { source_instance_id, command_id })
        .map(Json)
        .ok_or_else(|| ApiError::not_found("database command was not found"))
}

pub(crate) async fn set_recording(
    State(state): State<ServerState>,
    Json(request): Json<RecordingRequest>,
) -> Json<StatusResponse> {
    state.hub.set_recording(request.recording);
    let _ = state.ui_events.send(vec![status_delta(&state)]);
    Json(status_response(&state))
}

pub(crate) async fn clear_session(State(state): State<ServerState>) -> Json<StatusResponse> {
    let session_id = state.hub.clear_session();
    let _ = state.ui_events.send(vec![CaptureUiDelta::Reset { session_id, summaries: Vec::new() }]);
    Json(status_response(&state))
}

/// Hosted browser mode delegates replays to Rust so every captured request header can be sent.
pub(crate) async fn replay(State(state): State<ServerState>, Json(request): Json<ReplayRequest>) -> Result<Json<ReplayExecutionReceipt>, ApiError> {
    state.replay.execute(request).map(Json).map_err(|error| ApiError::bad_gateway(&error))
}

/// Browser development receives the same ordered summary batches as the future Tauri channel.
pub(crate) async fn ui_socket(State(state): State<ServerState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.max_message_size(state.maximum_message_bytes).on_upgrade(move |socket| stream_ui(socket, state))
}

/// Browser development receives the database stream without sharing HTTP UI events.
pub(crate) async fn database_ui_socket(State(state): State<ServerState>, upgrade: WebSocketUpgrade) -> Response {
    upgrade.max_message_size(state.maximum_message_bytes).on_upgrade(move |socket| stream_database_ui(socket, state))
}

async fn stream_ui(mut socket: WebSocket, state: ServerState) {
    let initial = CaptureUiDelta::Reset { session_id: state.hub.status().session_id, summaries: state.hub.snapshot() };
    if send_deltas(&mut socket, vec![initial]).await.is_err() {
        return;
    }
    let mut events = state.ui_events.subscribe();
    loop {
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            },
            event = events.recv() => match event {
                Ok(deltas) => {
                    if send_deltas(&mut socket, deltas).await.is_err() { return; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let reset = CaptureUiDelta::Reset { session_id: state.hub.status().session_id, summaries: state.hub.snapshot() };
                    if send_deltas(&mut socket, vec![reset]).await.is_err() { return; }
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    }
}

async fn stream_database_ui(mut socket: WebSocket, state: ServerState) {
    let initial = DatabaseUiDelta::Reset { session_id: state.hub.status().session_id, summaries: state.hub.database_snapshot() };
    if send_database_deltas(&mut socket, vec![initial]).await.is_err() {
        return;
    }
    let mut events = state.database_ui_events.subscribe();
    loop {
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return,
                Some(Ok(_)) => {}
            },
            event = events.recv() => match event {
                Ok(deltas) => {
                    if send_database_deltas(&mut socket, deltas).await.is_err() { return; }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let reset = DatabaseUiDelta::Reset { session_id: state.hub.status().session_id, summaries: state.hub.database_snapshot() };
                    if send_database_deltas(&mut socket, vec![reset]).await.is_err() { return; }
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    }
}

async fn send_deltas(socket: &mut WebSocket, deltas: Vec<CaptureUiDelta>) -> Result<(), axum::Error> {
    let payload = serde_json::to_string(&deltas).expect("UI deltas should serialize");
    socket.send(Message::Text(payload.into())).await
}

async fn send_database_deltas(socket: &mut WebSocket, deltas: Vec<DatabaseUiDelta>) -> Result<(), axum::Error> {
    let payload = serde_json::to_string(&deltas).expect("database UI deltas should serialize");
    socket.send(Message::Text(payload.into())).await
}

fn status_response(state: &ServerState) -> StatusResponse {
    let status = state.hub.status();
    StatusResponse {
        session_id: status.session_id,
        capture_endpoint: state.capture_endpoint.clone(),
        recording: status.recording,
        exchange_count: status.exchange_count,
        connected_sources: source_count(state),
        dropped_count: state.diagnostics.dropped_count(),
        rejected_count: state.diagnostics.rejected_count(),
        retention_blocked_by_in_flight: status.retention_blocked_by_in_flight,
    }
}

pub(crate) struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn not_found(message: &str) -> Self {
        Self { status: StatusCode::NOT_FOUND, message: message.into() }
    }

    fn bad_gateway(message: &str) -> Self {
        Self { status: StatusCode::BAD_GATEWAY, message: message.into() }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(serde_json::json!({ "error": self.message }))).into_response()
    }
}
