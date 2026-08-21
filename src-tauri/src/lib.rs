use std::{net::SocketAddr, sync::{Arc, Mutex}};

use inspector_core::domain::{CaptureUiDelta, DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta, ExchangeKey, HttpBody, HttpExchange, HttpExchangeSummary};
use inspector_server::{CaptureServerStatus, ReplayExecutionReceipt, ReplayRequest, RunningServer, ServerConfig};
use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State, ipc::Channel};

mod project_integration;
use project_integration::{NativeProjectIntegration, integration_apply, integration_capabilities, integration_choose_bash, integration_choose_project, integration_list, integration_preview, integration_recover, integration_remove, integration_select_project};

const DEFAULT_CAPTURE_PORT: u16 = 53662;

struct NativeCaptureRuntime {
    server: Mutex<Option<RunningServer>>,
    settings: Mutex<CaptureListenerSettings>,
    listener_error: Mutex<Option<String>>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureListenerSettings {
    port: u16,
    lan_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureListenerStatusResponse {
    running: bool,
    bind_address: Option<String>,
    endpoint: Option<String>,
    port: u16,
    lan_enabled: bool,
    error_message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureBodyChunkResponse {
    body: Option<HttpBody>,
    offset: u64,
    next_offset: Option<u64>,
    complete: bool,
}

#[tauri::command]
fn capture_status(runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureServerStatus, String> {
    with_running_server(&runtime, |server| server.status())
}

#[tauri::command]
fn capture_snapshot(runtime: State<'_, NativeCaptureRuntime>) -> Result<Vec<HttpExchangeSummary>, String> {
    with_running_server(&runtime, |server| server.snapshot())
}

#[tauri::command]
fn database_capture_snapshot(runtime: State<'_, NativeCaptureRuntime>) -> Result<Vec<DatabaseCommandSummary>, String> {
    with_running_server(&runtime, |server| server.database_snapshot())
}

#[tauri::command]
fn capture_exchange(source_instance_id: String, exchange_id: String, runtime: State<'_, NativeCaptureRuntime>) -> Result<Option<HttpExchange>, String> {
    with_running_server(&runtime, |server| server.exchange(&ExchangeKey { source_instance_id, exchange_id }))
}

#[tauri::command]
fn database_capture_command(source_instance_id: String, command_id: String, runtime: State<'_, NativeCaptureRuntime>) -> Result<Option<DatabaseCommand>, String> {
    with_running_server(&runtime, |server| server.database_command(&DatabaseCommandKey { source_instance_id, command_id }))
}

#[tauri::command]
fn capture_body_chunk(source_instance_id: String, exchange_id: String, part: String, offset: u64, maximum_bytes: u64, runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureBodyChunkResponse, String> {
    let _ = maximum_bytes;
    with_running_server(&runtime, |server| CaptureBodyChunkResponse {
        body: if offset == 0 { server.body(&ExchangeKey { source_instance_id, exchange_id }, &part) } else { None },
        offset,
        next_offset: None,
        complete: true,
    })
}

#[tauri::command]
fn set_capture_recording(recording: bool, runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureServerStatus, String> {
    with_running_server(&runtime, |server| {
        server.set_recording(recording);
        server.status()
    })
}

#[tauri::command]
fn clear_capture_session(runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureServerStatus, String> {
    with_running_server(&runtime, |server| {
        server.clear_session();
        server.status()
    })
}

#[tauri::command]
fn replay_request(request: ReplayRequest, runtime: State<'_, NativeCaptureRuntime>) -> Result<ReplayExecutionReceipt, String> {
    contain_replay_panic(|| with_running_server(&runtime, |server| server.execute_replay(request)))?
}

fn contain_replay_panic<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(operation))
        .map_err(|_| String::from("HTTP Inspector prevented an internal replay error. The request was not sent; the application is still running."))?
}

#[tauri::command]
fn subscribe_capture_deltas(channel: Channel<Vec<CaptureUiDelta>>, runtime: State<'_, NativeCaptureRuntime>) -> Result<(), String> {
    let (mut events, initial) = with_running_server(&runtime, |server| {
        let initial = CaptureUiDelta::Reset { session_id: server.status().session_id, summaries: server.snapshot() };
        (server.subscribe_ui_events(), initial)
    })?;
    channel.send(vec![initial]).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(deltas) => {
                    if channel.send(deltas).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => break,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn subscribe_database_capture_deltas(channel: Channel<Vec<DatabaseUiDelta>>, runtime: State<'_, NativeCaptureRuntime>) -> Result<(), String> {
    let (mut events, initial) = with_running_server(&runtime, |server| {
        let initial = DatabaseUiDelta::Reset { session_id: server.status().session_id, summaries: server.database_snapshot() };
        (server.subscribe_database_ui_events(), initial)
    })?;
    channel.send(vec![initial]).map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(deltas) => {
                    if channel.send(deltas).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => break,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn capture_listener_status(runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureListenerStatusResponse, String> {
    listener_status(&runtime)
}

#[tauri::command]
fn start_capture_listener(settings: CaptureListenerSettings, runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureListenerStatusResponse, String> {
    replace_listener(&runtime, settings)
}

#[tauri::command]
fn stop_capture_listener(runtime: State<'_, NativeCaptureRuntime>) -> Result<CaptureListenerStatusResponse, String> {
    let mut server = lock_server(&runtime)?;
    if let Some(mut running) = server.take() {
        tauri::async_runtime::block_on(running.shutdown());
    }
    drop(server);
    *runtime.listener_error.lock().map_err(|_| "The native capture runtime is unavailable.")? = None;
    listener_status(&runtime)
}

fn replace_listener(runtime: &NativeCaptureRuntime, settings: CaptureListenerSettings) -> Result<CaptureListenerStatusResponse, String> {
    let config = listener_config(settings)?;
    let mut server = lock_server(runtime)?;
    if let Some(mut running) = server.take() {
        tauri::async_runtime::block_on(running.shutdown());
    }
    match tauri::async_runtime::block_on(inspector_server::start(config)) {
        Ok(running) => {
            *server = Some(running);
            drop(server);
            *runtime.settings.lock().map_err(|_| "The native capture runtime is unavailable.")? = settings;
            *runtime.listener_error.lock().map_err(|_| "The native capture runtime is unavailable.")? = None;
        }
        Err(error) => {
            drop(server);
            *runtime.listener_error.lock().map_err(|_| "The native capture runtime is unavailable.")? = Some(error.to_string());
        }
    }
    listener_status(runtime)
}

fn listener_config(settings: CaptureListenerSettings) -> Result<ServerConfig, String> {
    let host = if settings.lan_enabled { "0.0.0.0" } else { "127.0.0.1" };
    ServerConfig::bind(&format!("{host}:{}", settings.port))
}

fn listener_status(runtime: &NativeCaptureRuntime) -> Result<CaptureListenerStatusResponse, String> {
    let settings = *runtime.settings.lock().map_err(|_| "The native capture runtime is unavailable.")?;
    let server = lock_server(runtime)?;
    let address = server.as_ref().map(|running| running.address);
    let port = address.map_or(settings.port, |value| value.port());
    let endpoint = address.map(loopback_endpoint);
    Ok(CaptureListenerStatusResponse {
        running: address.is_some(),
        bind_address: address.map(|value| value.to_string()),
        endpoint,
        port,
        lan_enabled: settings.lan_enabled,
        error_message: runtime.listener_error.lock().map_err(|_| "The native capture runtime is unavailable.")?.clone(),
    })
}

fn loopback_endpoint(address: SocketAddr) -> String {
    format!("ws://127.0.0.1:{}/v1/capture", address.port())
}

fn lock_server(runtime: &NativeCaptureRuntime) -> Result<std::sync::MutexGuard<'_, Option<RunningServer>>, String> {
    runtime.server.lock().map_err(|_| "The native capture runtime is unavailable.".into())
}

fn with_running_server<T>(runtime: &NativeCaptureRuntime, operation: impl FnOnce(&RunningServer) -> T) -> Result<T, String> {
    let server = lock_server(runtime)?;
    server.as_ref().map(operation).ok_or_else(|| "The native capture listener is stopped. Start it again from the listener controls.".into())
}

/// Starts the native shell while keeping feature logic in the shared frontend/core layers.
pub fn run() {
    let app = tauri::Builder::default()
        .manage(NativeCaptureRuntime {
            server: Mutex::new(None),
            settings: Mutex::new(CaptureListenerSettings { port: DEFAULT_CAPTURE_PORT, lan_enabled: false }),
            listener_error: Mutex::new(None),
        })
        .setup(|app| {
            let state_root = inspector_project_integration::default_state_root();
            let app_handle = app.handle().clone();
            let current_endpoint = Arc::new(move || app_handle.try_state::<NativeCaptureRuntime>().and_then(|runtime| listener_status(&runtime).ok()?.endpoint));
            app.manage(NativeProjectIntegration::new(state_root, current_endpoint));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture_status,
            capture_snapshot,
            database_capture_snapshot,
            capture_exchange,
            database_capture_command,
            capture_body_chunk,
            set_capture_recording,
            clear_capture_session,
            replay_request,
            subscribe_capture_deltas,
            subscribe_database_capture_deltas,
            capture_listener_status,
            start_capture_listener,
            stop_capture_listener,
            integration_capabilities,
            integration_choose_bash,
            integration_choose_project,
            integration_select_project,
            integration_preview,
            integration_apply,
            integration_list,
            integration_remove,
            integration_recover,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build HTTP Inspector");
    if let Some(runtime) = app.try_state::<NativeCaptureRuntime>() {
        let _ = replace_listener(&runtime, CaptureListenerSettings { port: DEFAULT_CAPTURE_PORT, lan_enabled: false });
    }
    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. })
            && let Some(runtime) = app_handle.try_state::<NativeCaptureRuntime>()
            && let Ok(mut server) = runtime.server.lock()
            && let Some(server) = server.as_mut() {
            tauri::async_runtime::block_on(server.shutdown());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_panics_become_command_errors() {
        let result = contain_replay_panic(|| -> Result<(), String> { panic!("simulated replay panic") });
        assert!(result.unwrap_err().contains("application is still running"));
    }
}
