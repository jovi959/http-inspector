use std::sync::{Arc, atomic::{AtomicU64, Ordering}};

use inspector_core::{
    application::{CaptureHub, HubMutation},
    domain::{CaptureMessage, CaptureSource, CaptureUiDelta, ModelValidationError},
};
use tokio::sync::{broadcast, mpsc, oneshot};

/// Diagnostics describe transport pressure without retaining a duplicate copy of captured payloads.
#[derive(Default)]
pub(crate) struct CaptureDiagnostics {
    dropped_count: AtomicU64,
    rejected_count: AtomicU64,
}

impl CaptureDiagnostics {
    pub(crate) fn dropped_count(&self) -> u64 { self.dropped_count.load(Ordering::Relaxed) }
    pub(crate) fn rejected_count(&self) -> u64 { self.rejected_count.load(Ordering::Relaxed) }
    pub(crate) fn record_drop(&self) { self.dropped_count.fetch_add(1, Ordering::Relaxed); }
    pub(crate) fn record_rejection(&self) { self.rejected_count.fetch_add(1, Ordering::Relaxed); }
    pub(crate) fn record_source_drops(&self, dropped_count: u64) { self.dropped_count.fetch_max(dropped_count, Ordering::Relaxed); }
}

pub(crate) struct QueuedCapture {
    pub source: CaptureSource,
    pub received_at: String,
    pub message: CaptureMessage,
    pub completion: oneshot::Sender<Result<HubMutation, ModelValidationError>>,
}

/// One bounded processor establishes deterministic cross-source arrival order before publishing UI batches.
pub(crate) async fn process_capture_queue(
    hub: CaptureHub,
    ui_events: broadcast::Sender<Vec<CaptureUiDelta>>,
    mut receiver: mpsc::Receiver<QueuedCapture>,
) {
    while let Some(queued) = receiver.recv().await {
        let result = hub.ingest(&queued.source, &queued.received_at, queued.message);
        if let Ok(mutation) = &result
            && mutation.changed
        {
            let _ = ui_events.send(mutation.deltas.clone());
        }
        let _ = queued.completion.send(result);
    }
}

pub(crate) type SharedDiagnostics = Arc<CaptureDiagnostics>;
