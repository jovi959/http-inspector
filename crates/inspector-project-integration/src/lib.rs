//! Shared project-integration application service used by desktop and hosted-local transports.

mod bash;
mod model;
mod payload;
mod service;

pub use model::*;
pub use service::{CurrentEndpoint, IntegrationService, IntegrationServiceConfig};

pub fn default_state_root() -> std::path::PathBuf {
    if cfg!(target_os = "macos") {
        return std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Library/Application Support/HTTP Inspector");
    }
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return std::path::PathBuf::from(local_app_data).join("HTTP Inspector");
    }
    std::env::var_os("XDG_STATE_HOME").map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join(".local/state")))
        .unwrap_or_else(std::env::temp_dir).join("http-inspector")
}
