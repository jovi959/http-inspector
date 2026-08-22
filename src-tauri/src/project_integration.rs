use inspector_project_integration::{ApplyRequest, CurrentEndpoint, FolderSelection, IntegrationCapabilities, IntegrationCatalog, IntegrationError, IntegrationIdRequest, IntegrationPreview, IntegrationRuntime, IntegrationService, IntegrationServiceConfig, IntegrationTransport, OperationResult, PreviewRequest, ProjectSelection, SelectBashRequest, SelectProjectRequest};
use tauri::State;

pub(crate) struct NativeProjectIntegration(pub IntegrationService);

impl NativeProjectIntegration {
    pub(crate) fn new(state_root: std::path::PathBuf, current_endpoint: CurrentEndpoint) -> Self {
        Self(IntegrationService::new(IntegrationServiceConfig {
            state_root,
            runtime: IntegrationRuntime::Tauri,
            transport: IntegrationTransport::Ipc,
            folder_selection: FolderSelection::NativePicker,
            current_endpoint: Some(current_endpoint),
        }))
    }
}

#[tauri::command]
pub(crate) fn integration_capabilities(runtime: State<'_, NativeProjectIntegration>) -> IntegrationCapabilities {
    runtime.0.capabilities()
}

#[tauri::command]
pub(crate) fn integration_choose_project(runtime: State<'_, NativeProjectIntegration>) -> Result<Option<ProjectSelection>, IntegrationError> {
    let Some(path) = rfd::FileDialog::new().set_title("Choose a .NET project folder").pick_folder() else { return Ok(None); };
    runtime.0.select(SelectProjectRequest { path: path.display().to_string() }).map(Some)
}

#[tauri::command]
pub(crate) fn integration_choose_bash(runtime: State<'_, NativeProjectIntegration>) -> Result<Option<IntegrationCapabilities>, IntegrationError> {
    let Some(path) = rfd::FileDialog::new().set_title("Choose Git Bash").add_filter("Git Bash", &["exe"]).pick_file() else { return Ok(None); };
    runtime.0.select_bash(SelectBashRequest { path: path.display().to_string() }).map(Some)
}

#[tauri::command]
pub(crate) fn integration_select_project(request: SelectProjectRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<ProjectSelection, IntegrationError> {
    runtime.0.select(request)
}

#[tauri::command]
pub(crate) fn integration_preview(request: PreviewRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<IntegrationPreview, IntegrationError> {
    runtime.0.preview(request)
}

#[tauri::command]
pub(crate) fn integration_apply(request: ApplyRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<OperationResult, IntegrationError> {
    runtime.0.apply(request)
}

#[tauri::command]
pub(crate) fn integration_list(runtime: State<'_, NativeProjectIntegration>) -> Result<IntegrationCatalog, IntegrationError> {
    runtime.0.list()
}

#[tauri::command]
pub(crate) fn integration_remove(request: IntegrationIdRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<OperationResult, IntegrationError> {
    runtime.0.remove(request)
}

#[tauri::command]
pub(crate) fn integration_recover(request: IntegrationIdRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<OperationResult, IntegrationError> {
    runtime.0.recover(request)
}

#[tauri::command]
pub(crate) fn integration_force_remove(request: IntegrationIdRequest, runtime: State<'_, NativeProjectIntegration>) -> Result<OperationResult, IntegrationError> {
    runtime.0.force_remove(request)
}
