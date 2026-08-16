//! Application use cases remain independent from Axum, Tauri, and browser transports.

mod capture_hub;
mod lifecycle_merger;

pub use capture_hub::{CaptureHub, CaptureHubStatus, HubMutation, RepositoryLimits};
pub use lifecycle_merger::{merge_capture_message, MergeResult};
