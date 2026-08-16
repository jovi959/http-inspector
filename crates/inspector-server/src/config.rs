use std::{net::SocketAddr, str::FromStr};

use inspector_core::application::RepositoryLimits;

/// Server-only limits translate transport input into the portable core without altering values.
#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub bind_address: SocketAddr,
    pub maximum_message_bytes: usize,
    pub maximum_body_bytes: u64,
    pub repository_limits: RepositoryLimits,
    pub project_integration_local: bool,
    pub project_integration_state_root: std::path::PathBuf,
}

impl ServerConfig {
    /// Uses fixed loopback development routing unless an explicit local configuration overrides it.
    pub fn development() -> Result<Self, String> {
        let bind_address = std::env::var("HTTP_INSPECTOR_PORT")
            .ok()
            .map(|port| format!("127.0.0.1:{port}"))
            .unwrap_or_else(|| "127.0.0.1:53662".into());
        let local_from_argument = std::env::args().collect::<Vec<_>>().windows(2).any(|values| values == ["--project-integration", "local"]);
        let project_integration_local = local_from_argument || std::env::var("HTTP_INSPECTOR_PROJECT_INTEGRATION").is_ok_and(|value| value == "local");
        let mut config = Self::loopback(&bind_address)?;
        config.project_integration_local = project_integration_local;
        Ok(config)
    }

    pub fn bind(bind_address: &str) -> Result<Self, String> {
        Ok(Self {
            bind_address: SocketAddr::from_str(bind_address).map_err(|error| error.to_string())?,
            maximum_message_bytes: 4 * 1024 * 1024,
            maximum_body_bytes: 1024 * 1024,
            repository_limits: RepositoryLimits::default(),
            project_integration_local: false,
            project_integration_state_root: std::env::var_os("HTTP_INSPECTOR_INTEGRATION_STATE_ROOT").map(std::path::PathBuf::from)
                .unwrap_or_else(inspector_project_integration::default_state_root),
        })
    }

    pub fn loopback(bind_address: &str) -> Result<Self, String> {
        Self::bind(bind_address)
    }
}
