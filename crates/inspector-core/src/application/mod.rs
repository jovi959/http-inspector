//! Application use cases remain independent from Axum, Tauri, and browser transports.

mod capture_hub;
mod database_lifecycle_merger;
mod lifecycle_merger;

pub use capture_hub::{CaptureHub, CaptureHubStatus, DatabaseRepositoryLimits, HubMutation, RepositoryLimits};
pub use database_lifecycle_merger::{DatabaseMergeResult, merge_database_message};
pub use lifecycle_merger::{merge_capture_message, MergeResult};
