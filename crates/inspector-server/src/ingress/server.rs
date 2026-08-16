use std::sync::{Arc, atomic::{AtomicU32, Ordering}};

use axum::{Router, routing::{any, get, post}};
use inspector_core::{application::CaptureHub, domain::{CaptureUiDelta, HttpBody}};
use tokio::{net::TcpListener, sync::{broadcast, mpsc, oneshot}, task::JoinHandle};

use crate::{ReplayExecutionReceipt, ReplayRequest, ServerConfig, dev_api, ingress::{capture_socket, queue::{CaptureDiagnostics, QueuedCapture, SharedDiagnostics, process_capture_queue}}, project_integration_api, replay::ReplayService};

/// Shared state is deliberately transport-specific while capture history stays in inspector-core.
#[derive(Clone)]
pub(crate) struct ServerState {
    pub hub: CaptureHub,
    pub maximum_message_bytes: usize,
    pub maximum_body_bytes: u64,
    pub ui_events: broadcast::Sender<Vec<inspector_core::domain::CaptureUiDelta>>,
    pub connected_sources: Arc<AtomicU32>,
    pub diagnostics: SharedDiagnostics,
    pub ingest_queue: mpsc::Sender<QueuedCapture>,
    pub replay: ReplayService,
}

/// Holds the hosted listener and allows development or Tauri composition to stop it gracefully.
pub struct RunningServer {
    pub address: std::net::SocketAddr,
    state: ServerState,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
    processor: JoinHandle<()>,
}

/// Read-only server facts used by both hosted development and the native shell.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureServerStatus {
    pub session_id: String,
    pub recording: bool,
    pub exchange_count: usize,
    pub connected_sources: u32,
    pub dropped_count: u64,
    pub rejected_count: u64,
    pub retention_blocked_by_in_flight: bool,
}

impl RunningServer {
    pub async fn shutdown(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        let _ = (&mut self.task).await;
        self.processor.abort();
        let _ = (&mut self.processor).await;
    }

    /// Returns an immutable status snapshot without exposing transport internals.
    pub fn status(&self) -> CaptureServerStatus {
        let status = self.state.hub.status();
        CaptureServerStatus {
            session_id: status.session_id,
            recording: status.recording,
            exchange_count: status.exchange_count,
            connected_sources: source_count(&self.state),
            dropped_count: self.state.diagnostics.dropped_count(),
            rejected_count: self.state.diagnostics.rejected_count(),
            retention_blocked_by_in_flight: status.retention_blocked_by_in_flight,
        }
    }

    /// Projects only summaries for the initial UI snapshot.
    pub fn snapshot(&self) -> Vec<inspector_core::domain::HttpExchangeSummary> {
        self.state.hub.snapshot()
    }

    /// Retrieves a selected detail on demand so capture bodies stay out of hot-path deltas.
    pub fn exchange(&self, key: &inspector_core::domain::ExchangeKey) -> Option<inspector_core::domain::HttpExchange> {
        self.state.hub.exchange(key)
    }

    /// Reads a captured body or raw descriptor only when a detail consumer asks for it.
    pub fn body(&self, key: &inspector_core::domain::ExchangeKey, part: &str) -> Option<HttpBody> {
        let exchange = self.exchange(key)?;
        match part {
            "requestBody" => exchange.request.body,
            "requestRaw" => exchange.request.raw,
            "responseBody" => exchange.response.and_then(|response| response.body),
            "responseRaw" => exchange.response.and_then(|response| response.raw),
            _ => None,
        }
    }

    /// Starts or pauses capture while retaining the ephemeral session data already accepted.
    pub fn set_recording(&self, recording: bool) {
        self.state.hub.set_recording(recording);
        let _ = self.state.ui_events.send(vec![status_delta(&self.state)]);
    }

    /// Clears the capture session and publishes the canonical reset batch.
    pub fn clear_session(&self) {
        let session_id = self.state.hub.clear_session();
        let _ = self.state.ui_events.send(vec![CaptureUiDelta::Reset { session_id, summaries: Vec::new() }]);
    }

    /// Creates an ordered UI subscriber for a single webview or hosted browser client.
    pub fn subscribe_ui_events(&self) -> broadcast::Receiver<Vec<CaptureUiDelta>> {
        self.state.ui_events.subscribe()
    }

    /// Schedules an explicit replay and returns the key of its recorded in-flight exchange.
    pub fn execute_replay(&self, request: ReplayRequest) -> Result<ReplayExecutionReceipt, String> {
        self.state.replay.execute(request)
    }
}

/// Starts capture ingress and browser-development routes on one fixed loopback service.
pub async fn start(config: ServerConfig) -> Result<RunningServer, std::io::Error> {
    let listener = TcpListener::bind(config.bind_address).await?;
    let address = listener.local_addr()?;
    let (ui_events, _) = broadcast::channel(256);
    let hub = CaptureHub::new(config.repository_limits);
    let replay = ReplayService::new(hub.clone(), ui_events.clone(), config.maximum_body_bytes).map_err(std::io::Error::other)?;
    let (ingest_queue, receiver) = mpsc::channel(512);
    let processor = tokio::spawn(process_capture_queue(hub.clone(), ui_events.clone(), receiver));
    let state = ServerState {
        hub,
        maximum_message_bytes: config.maximum_message_bytes,
        maximum_body_bytes: config.maximum_body_bytes,
        ui_events,
        connected_sources: Arc::new(AtomicU32::new(0)),
        diagnostics: Arc::new(CaptureDiagnostics::default()),
        ingest_queue,
        replay,
    };
    let mut router = Router::new()
        .route("/v1/capture", any(capture_socket::upgrade))
        .route("/api/status", get(dev_api::status))
        .route("/api/exchanges", get(dev_api::exchanges))
        .route("/api/exchanges/{source_instance_id}/{exchange_id}", get(dev_api::exchange))
        .route("/api/recording", post(dev_api::set_recording))
        .route("/api/clear", post(dev_api::clear_session))
        .route("/api/replay", post(dev_api::replay))
        .route("/ws/ui", any(dev_api::ui_socket))
        .with_state(state.clone());
    if config.project_integration_local && address.ip().is_loopback() {
        router = router.merge(project_integration_api::router(config.project_integration_state_root.clone(), loopback_capture_endpoint(address)));
    }
    let (shutdown, shutdown_signal) = oneshot::channel();
    let task = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async { let _ = shutdown_signal.await; })
            .await;
    });
    Ok(RunningServer { address, state, shutdown: Some(shutdown), task, processor })
}

fn loopback_capture_endpoint(address: std::net::SocketAddr) -> String {
    match address.ip() {
        std::net::IpAddr::V4(ip) => format!("ws://{ip}:{}/v1/capture", address.port()),
        std::net::IpAddr::V6(ip) => format!("ws://[{ip}]:{}/v1/capture", address.port()),
    }
}

pub(crate) fn source_count(state: &ServerState) -> u32 {
    state.connected_sources.load(Ordering::Relaxed)
}

pub(crate) fn status_delta(state: &ServerState) -> CaptureUiDelta {
    CaptureUiDelta::Status {
        recording: state.hub.status().recording,
        connected_sources: source_count(state),
        dropped_count: state.diagnostics.dropped_count(),
        rejected_count: state.diagnostics.rejected_count(),
    }
}
