use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};

use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{ApplyRequest, DatabaseResultCapturePreview, FolderSelection, IntegrationCapabilities, IntegrationCatalog, IntegrationCoverage, IntegrationError, IntegrationIdRequest, IntegrationPreview, IntegrationRuntime, IntegrationTransport, OperationResult, PackageIdentity, PreviewRequest, ProjectChoice, ProjectSelection, SelectBashRequest, SelectProjectRequest, bash::{discover_bash, run_json, select_bash, to_bash_path, to_native_path}, payload::{EMBEDDED_ADAPTER_VERSION, EMBEDDED_PACKAGE_ID, EMBEDDED_PACKAGE_VERSION, EMBEDDED_PAYLOAD_DIGEST, MaterializedPayload, garbage_collect, materialize}};

#[derive(Clone)]
pub struct IntegrationServiceConfig {
    pub state_root: PathBuf,
    pub runtime: IntegrationRuntime,
    pub transport: IntegrationTransport,
    pub folder_selection: FolderSelection,
    pub current_endpoint: Option<CurrentEndpoint>,
}

pub type CurrentEndpoint = Arc<dyn Fn() -> Option<String> + Send + Sync>;

struct Selection { path: PathBuf }
struct PreviewState { path: PathBuf, project_file: Option<String>, endpoint: String, database_result_capture: bool, raw_ado_net_result_capture: bool, file_hashes: Vec<(PathBuf, String)>, created_at: Instant }

pub struct IntegrationService {
    config: IntegrationServiceConfig,
    bash: Mutex<Option<PathBuf>>,
    payload: Result<MaterializedPayload, IntegrationError>,
    selections: Mutex<HashMap<String, Selection>>,
    previews: Mutex<HashMap<String, PreviewState>>,
    active_operations: Mutex<HashSet<PathBuf>>,
}

impl IntegrationService {
    pub fn new(config: IntegrationServiceConfig) -> Self {
        let bash = discover_bash(&config.state_root);
        let payload = materialize(&config.state_root);
        Self { config, bash: Mutex::new(bash), payload, selections: Mutex::new(HashMap::new()), previews: Mutex::new(HashMap::new()), active_operations: Mutex::new(HashSet::new()) }
    }

    pub fn capabilities(&self) -> IntegrationCapabilities {
        let bash = self.bash.lock().ok().and_then(|bash| bash.clone());
        let reason_code = if bash.is_none() { Some("bashUnavailable".into()) } else if self.payload.is_err() { Some("payloadUnavailable".into()) } else { None };
        IntegrationCapabilities {
            available: reason_code.is_none(), runtime: self.config.runtime, transport: self.config.transport, folder_selection: self.config.folder_selection,
            reason_code, bash_path: bash.map(|path| path.display().to_string()), adapter_id: "dotnet-httpclient".into(),
            adapter_version: EMBEDDED_ADAPTER_VERSION.into(), payload_digest: EMBEDDED_PAYLOAD_DIGEST.into(), package_id: EMBEDDED_PACKAGE_ID.into(), package_version: EMBEDDED_PACKAGE_VERSION.into(),
        }
    }

    pub fn select_bash(&self, request: SelectBashRequest) -> Result<IntegrationCapabilities, IntegrationError> {
        let bash = select_bash(&self.config.state_root, Path::new(&request.path))?;
        *self.bash.lock().map_err(lock_error)? = Some(bash);
        Ok(self.capabilities())
    }

    pub fn select(&self, request: SelectProjectRequest) -> Result<ProjectSelection, IntegrationError> {
        self.ensure_available()?;
        let path = canonical_project_path(Path::new(&request.path))?;
        let token = Uuid::new_v4().to_string();
        self.selections.lock().map_err(lock_error)?.insert(token.clone(), Selection { path: path.clone() });
        Ok(ProjectSelection { selection_token: token, path: path.display().to_string() })
    }

    pub fn preview(&self, request: PreviewRequest) -> Result<IntegrationPreview, IntegrationError> {
        self.ensure_endpoint_current(&request.endpoint)?;
        let path = self.selections.lock().map_err(lock_error)?.get(&request.selection_token).map(|selection| selection.path.clone())
            .ok_or_else(|| IntegrationError::new("selectionExpired", "Select the project folder again."))?;
        let mut arguments = self.operation_arguments(
            &path,
            request.project_file.as_deref(),
            &request.endpoint,
            request.database_result_capture,
            request.raw_ado_net_result_capture,
        );
        arguments.push("--json".into());
        let value = self.run("inspect.sh", arguments)?;
        let choices = serde_json::from_value::<Vec<ProjectChoice>>(value.get("choices").cloned().unwrap_or_else(|| serde_json::json!([])))
            .map_err(|error| IntegrationError::new("invalidInspectResult", error.to_string()))?;
        let choice_required = value.get("choiceRequired").and_then(|value| value.as_bool()).unwrap_or(false);
        let preview_project_root = value.get("projectRoot").and_then(|value| value.as_str()).map(str::to_owned).unwrap_or_else(|| path.display().to_string());
        let database_result_capture: DatabaseResultCapturePreview = serde_json::from_value(value.get("databaseResultCapture").cloned().unwrap_or_else(|| serde_json::json!({
            "requested": request.database_result_capture,
            "eligible": !request.database_result_capture,
            "reason": if request.database_result_capture { serde_json::Value::String("The integration script did not provide a database capture plan.".into()) } else { serde_json::Value::Null },
            "databaseProjectFile": null,
            "factoryFile": null,
            "dapperLocations": [],
            "dapperFiles": [],
            "rawAdoNetResultCapture": { "requested": request.raw_ado_net_result_capture, "eligible": !request.raw_ado_net_result_capture, "reason": null, "locations": [], "files": [], "unsupportedLocations": [] }
        }))).map_err(|error| IntegrationError::new("invalidDatabaseCapturePreview", error.to_string()))?;
        let mut preview_files = ["projectFile", "compositionFile"].into_iter().filter_map(|key| value.get(key).and_then(|value| value.as_str()).map(str::to_owned)).collect::<Vec<_>>();
        if database_result_capture.requested && database_result_capture.eligible {
            preview_files.extend(database_result_capture.database_project_file.iter().cloned());
            preview_files.extend(database_result_capture.factory_file.iter().cloned());
            preview_files.extend(database_result_capture.dapper_files.iter().cloned());
            preview_files.extend(database_result_capture.raw_ado_net_result_capture.files.iter().cloned());
        }
        let raw_ado_net_ineligible = request.raw_ado_net_result_capture && !database_result_capture.raw_ado_net_result_capture.eligible;
        let preview_token = if choice_required || (request.database_result_capture && !database_result_capture.eligible) || raw_ado_net_ineligible { None } else {
            let token = Uuid::new_v4().to_string();
            let file_hashes = preview_files.iter().map(|file| hash_file(Path::new(file)).map(|hash| (PathBuf::from(file), hash))).collect::<Result<Vec<_>, _>>()?;
            self.previews.lock().map_err(lock_error)?.insert(token.clone(), PreviewState { path: path.clone(), project_file: request.project_file.clone(), endpoint: request.endpoint.clone(), database_result_capture: request.database_result_capture, raw_ado_net_result_capture: request.raw_ado_net_result_capture, file_hashes, created_at: Instant::now() });
            Some(token)
        };
        let package: PackageIdentity = serde_json::from_value(value.get("package").cloned().unwrap_or_else(|| self.package_json())).map_err(|error| IntegrationError::new("invalidPackageIdentity", error.to_string()))?;
        // The Bash plan is authoritative so the native and hosted previews cannot drift from the embedded payload.
        let coverage: Vec<IntegrationCoverage> = serde_json::from_value(value.get("coverage").cloned().unwrap_or_else(|| serde_json::json!([]))).map_err(|error| IntegrationError::new("invalidCoverageInventory", error.to_string()))?;
        Ok(IntegrationPreview { preview_token, choice_required, choices, project_root: preview_project_root,
            project_file: value.get("projectFile").and_then(|value| value.as_str()).map(str::to_owned), composition_file: value.get("compositionFile").and_then(|value| value.as_str()).map(str::to_owned),
            strategy: value.get("strategy").and_then(|value| value.as_str()).unwrap_or("dotnet-multiclient-nuget-bash-v4").to_owned(), endpoint: request.endpoint, package,
            operations: integration_operations(request.database_result_capture, request.raw_ado_net_result_capture), coverage, database_result_capture })
    }

    pub fn apply(&self, request: ApplyRequest) -> Result<OperationResult, IntegrationError> {
        let preview = self.previews.lock().map_err(lock_error)?.remove(&request.preview_token).ok_or_else(|| IntegrationError::new("previewExpired", "Preview the project again before applying."))?;
        if preview.created_at.elapsed() > Duration::from_secs(600) {
            return Err(IntegrationError::new("previewExpired", "Preview the project again before applying."));
        }
        self.ensure_endpoint_current(&preview.endpoint)?;
        for (path, expected_hash) in &preview.file_hashes {
            if hash_file(path)? != *expected_hash {
                return Err(IntegrationError::new("previewStale", "Project files changed after preview. Review the current plan before applying."));
            }
        }
        let _operation = self.acquire_operation(preview.path.clone())?;
        let mut arguments = self.operation_arguments(&preview.path, preview.project_file.as_deref(), &preview.endpoint, preview.database_result_capture, preview.raw_ado_net_result_capture);
        arguments.push("--json".into());
        serde_json::from_value(self.run("pre-run.sh", arguments)?).map_err(|error| IntegrationError::new("invalidApplyResult", error.to_string()))
    }

    pub fn list(&self) -> Result<IntegrationCatalog, IntegrationError> {
        let catalog: IntegrationCatalog = serde_json::from_value(self.run("list.sh", vec!["--state-root".into(), self.config.state_root.display().to_string(), "--json".into()])?)
            .map_err(|error| IntegrationError::new("invalidCatalogResult", error.to_string()))?;
        let payload = self.payload.as_ref().map_err(Clone::clone)?;
        let catalog_valid = catalog.integrations.iter().all(|record| record.receipt_status == "valid");
        let referenced = catalog.integrations.iter().filter(|record| record.receipt_status == "valid" && !record.payload_root.is_empty()).map(|record| PathBuf::from(&record.payload_root)).collect::<Vec<_>>();
        garbage_collect(&self.config.state_root, &payload.root, &referenced, catalog_valid)?;
        Ok(catalog)
    }

    pub fn remove(&self, request: IntegrationIdRequest) -> Result<OperationResult, IntegrationError> { self.cleanup(request, "post-run.sh") }
    pub fn recover(&self, request: IntegrationIdRequest) -> Result<OperationResult, IntegrationError> { self.cleanup(request, "recover.sh") }
    pub fn force_remove(&self, request: IntegrationIdRequest) -> Result<OperationResult, IntegrationError> { self.force_cleanup(request) }

    fn cleanup(&self, request: IntegrationIdRequest, script: &str) -> Result<OperationResult, IntegrationError> {
        let record = self.list()?.integrations.into_iter().find(|record| record.integration_id == request.integration_id)
            .ok_or_else(|| IntegrationError::new("integrationNotFound", "Refresh the integration list and try again."))?;
        let _operation = self.acquire_operation(PathBuf::from(&record.project_root))?;
        let arguments = vec!["--project".into(), record.project_root, "--state-root".into(), self.config.state_root.display().to_string(), "--run-id".into(), record.run_id, "--json".into()];
        serde_json::from_value(self.run(script, arguments)?).map_err(|error| IntegrationError::new("invalidCleanupResult", error.to_string()))
    }

    fn force_cleanup(&self, request: IntegrationIdRequest) -> Result<OperationResult, IntegrationError> {
        let record = self.list()?.integrations.into_iter().find(|record| record.integration_id == request.integration_id)
            .ok_or_else(|| IntegrationError::new("integrationNotFound", "Refresh the integration list and try again."))?;
        let _operation = self.acquire_operation(PathBuf::from(&record.project_root))?;
        // The script only removes this receipt's marker blocks and refuses residual unmarked code.
        let arguments = vec!["--project".into(), record.project_root, "--state-root".into(), self.config.state_root.display().to_string(), "--run-id".into(), record.run_id, "--force".into(), "--json".into()];
        serde_json::from_value(self.run("post-run.sh", arguments)?).map_err(|error| IntegrationError::new("invalidCleanupResult", error.to_string()))
    }

    fn run(&self, script: &str, arguments: Vec<String>) -> Result<serde_json::Value, IntegrationError> {
        let bash = self.bash.lock().map_err(lock_error)?.clone().ok_or_else(|| IntegrationError::new("bashUnavailable", "Bash or Git Bash was not found."))?;
        let payload = self.payload.as_ref().map_err(Clone::clone)?;
        let arguments = shell_arguments(&bash, arguments)?;
        let mut value = run_json(&bash, &payload.root.join("HttpInspector.Adapter.Integration").join(script), &arguments)?;
        normalize_script_paths(&bash, &mut value)?;
        Ok(value)
    }

    fn operation_arguments(&self, path: &Path, project_file: Option<&str>, endpoint: &str, database_result_capture: bool, raw_ado_net_result_capture: bool) -> Vec<String> {
        let payload = self.payload.as_ref().expect("availability checked");
        let mut arguments = vec!["--project".into(), path.display().to_string(), "--endpoint".into(), endpoint.into(), "--state-root".into(), self.config.state_root.display().to_string(),
            "--package-file".into(), payload.package_file.display().to_string(), "--package-id".into(), EMBEDDED_PACKAGE_ID.into(), "--package-version".into(), EMBEDDED_PACKAGE_VERSION.into(),
            "--payload-root".into(), payload.root.display().to_string(), "--payload-digest".into(), EMBEDDED_PAYLOAD_DIGEST.into()];
        if let Some(project_file) = project_file { arguments.extend(["--project-file".into(), project_file.into()]); }
        if database_result_capture { arguments.push("--database-result-capture".into()); }
        if raw_ado_net_result_capture { arguments.push("--raw-ado-net-result-capture".into()); }
        arguments
    }

    fn package_json(&self) -> serde_json::Value {
        let payload = self.payload.as_ref().expect("availability checked");
        serde_json::json!({"id": EMBEDDED_PACKAGE_ID, "version": EMBEDDED_PACKAGE_VERSION, "file": payload.package_file, "digest": payload.package_digest, "feed": payload.package_file.parent()})
    }

    fn ensure_available(&self) -> Result<(), IntegrationError> {
        if let Some(reason) = self.capabilities().reason_code { Err(IntegrationError::new(&reason, "Project integration is unavailable in this runtime.")) } else { Ok(()) }
    }

    fn ensure_endpoint_current(&self, expected: &str) -> Result<(), IntegrationError> {
        let Some(resolve) = &self.config.current_endpoint else { return Ok(()); };
        let current = resolve().ok_or_else(|| IntegrationError::new("captureListenerStopped", "Start the capture listener before integrating a project."))?;
        if current != expected {
            return Err(IntegrationError::new("listenerEndpointChanged", format!("The capture listener endpoint changed to {current}. Preview the integration again.")));
        }
        Ok(())
    }

    fn acquire_operation(&self, path: PathBuf) -> Result<ProjectOperation<'_>, IntegrationError> {
        let mut active = self.active_operations.lock().map_err(lock_error)?;
        if !active.insert(path.clone()) {
            return Err(IntegrationError::new("projectBusy", "Another integration operation is already running for this project."));
        }
        Ok(ProjectOperation { path, active_operations: &self.active_operations })
    }
}

fn integration_operations(database_result_capture: bool, raw_ado_net_result_capture: bool) -> Vec<String> {
    let mut operations = vec![
        "Add project-scoped private local NuGet feed".into(),
        "Add exact private PackageReference".into(),
        "Register one host-wide capture bridge for IHttpClientFactory, Refit, direct HttpClient, and RestSharp".into(),
    ];
    if database_result_capture {
        operations.push("Add an opt-in Dapper database-result wrapper only at verified factory call sites".into());
    }
    if raw_ado_net_result_capture {
        operations.push("Replace only verified raw ADO.NET terminal calls with factory-owned capture helpers".into());
    }
    operations
}

struct ProjectOperation<'a> { path: PathBuf, active_operations: &'a Mutex<HashSet<PathBuf>> }

impl Drop for ProjectOperation<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active_operations.lock() { active.remove(&self.path); }
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> IntegrationError { IntegrationError::new("integrationStateUnavailable", "Project integration state is unavailable.") }

fn canonical_project_path(requested: &Path) -> Result<PathBuf, IntegrationError> {
    if !requested.is_absolute() {
        return Err(IntegrationError::new("invalidProjectPath", "Project path must be an absolute service-local directory."));
    }
    let path = requested.canonicalize().map_err(|error| IntegrationError::new("projectPathUnavailable", error.to_string()))?;
    if !path.is_dir() { return Err(IntegrationError::new("invalidProjectPath", "Project path must be an absolute service-local directory.")); }
    Ok(path)
}

fn hash_file(path: &Path) -> Result<String, IntegrationError> {
    fs::read(path).map(|bytes| format!("{:x}", Sha256::digest(bytes))).map_err(|error| IntegrationError::new("previewFileUnavailable", error.to_string()))
}

fn shell_arguments(bash: &Path, arguments: Vec<String>) -> Result<Vec<String>, IntegrationError> {
    let mut converted = Vec::with_capacity(arguments.len());
    let mut path_option = None;
    for argument in arguments {
        if let Some(always_convert) = path_option.take() {
            let convert = always_convert || Path::new(&argument).is_absolute();
            converted.push(if convert && !argument.starts_with('/') { to_bash_path(bash, Path::new(&argument))? } else { argument });
            continue;
        }
        path_option = match argument.as_str() {
            "--project" | "--state-root" | "--package-file" | "--payload-root" | "--receipt" => Some(true),
            "--project-file" => Some(false),
            _ => None,
        };
        converted.push(argument);
    }
    Ok(converted)
}

fn normalize_script_paths(bash: &Path, value: &mut serde_json::Value) -> Result<(), IntegrationError> {
    match value {
        serde_json::Value::Array(values) => for value in values { normalize_script_paths(bash, value)?; },
        serde_json::Value::Object(values) => for (key, value) in values {
            if matches!(key.as_str(), "projectRoot" | "projectFile" | "compositionFile" | "payloadRoot" | "file" | "feed" | "databaseProjectFile" | "factoryFile")
                && value.as_str().is_some_and(|path| path.starts_with('/')) {
                let path = value.as_str().expect("checked string path");
                *value = serde_json::Value::String(to_native_path(bash, path)?.display().to_string());
            } else if matches!(key.as_str(), "dapperFiles" | "files") {
                normalize_path_array(bash, value)?;
            } else {
                normalize_script_paths(bash, value)?;
            }
        },
        _ => {}
    }
    Ok(())
}

fn normalize_path_array(bash: &Path, value: &mut serde_json::Value) -> Result<(), IntegrationError> {
    match value {
        serde_json::Value::Array(values) => for value in values { normalize_path_array(bash, value)?; },
        serde_json::Value::String(path) if path.starts_with('/') => {
            *path = to_native_path(bash, path)?.display().to_string();
        },
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_selection_rejects_relative_paths_before_canonicalizing() {
        let error = canonical_project_path(Path::new("relative/project")).expect_err("relative paths must not resolve against the service process");
        assert_eq!(error.code, "invalidProjectPath");
    }

    #[test]
    fn preview_forwards_the_materialized_package_to_the_inspection_script() {
        let root = std::env::temp_dir().join(format!("http-inspector-preview-{}", uuid::Uuid::new_v4()));
        let project = root.join("project");
        fs::create_dir_all(&project).expect("create project fixture");
        fs::write(project.join("Preview.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk.Web\"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup></Project>")
            .expect("write project file");
        fs::write(project.join("Program.cs"), "var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddControllers();\n")
            .expect("write composition file");
        let service = IntegrationService::new(IntegrationServiceConfig {
            state_root: root.join("state"),
            runtime: IntegrationRuntime::HostedLocal,
            transport: IntegrationTransport::SameOriginHttp,
            folder_selection: FolderSelection::ServiceLocalPath,
            current_endpoint: None,
        });
        let selection = service.select(SelectProjectRequest { path: project.display().to_string() })
            .expect("select project");

        let preview = service.preview(PreviewRequest {
            selection_token: selection.selection_token,
            project_file: None,
            endpoint: "ws://127.0.0.1:53662/v1/capture".into(),
            database_result_capture: false,
            raw_ado_net_result_capture: false,
        }).expect("inspection must receive the materialized package path");

        assert_eq!(preview.package.id, EMBEDDED_PACKAGE_ID);
        assert_eq!(preview.package.version, EMBEDDED_PACKAGE_VERSION);
        assert!(preview.preview_token.is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn normalizes_database_plan_paths_before_hashing() {
        let mut value = serde_json::json!({
            "databaseResultCapture": {
                "databaseProjectFile": "/c/workspace/database/Database.csproj",
                "factoryFile": "/c/workspace/api/Factory.cs",
                "dapperFiles": ["/c/workspace/api/Dapper.cs"],
                "rawAdoNetResultCapture": {
                    "files": ["/c/workspace/api/RawAdo.cs"]
                }
            }
        });

        normalize_script_paths(Path::new(r"C:\Program Files\Git\bin\bash.exe"), &mut value)
            .expect("database plan paths should normalize");

        assert_eq!(value["databaseResultCapture"]["databaseProjectFile"], r"C:\workspace\database\Database.csproj");
        assert_eq!(value["databaseResultCapture"]["factoryFile"], r"C:\workspace\api\Factory.cs");
        assert_eq!(value["databaseResultCapture"]["dapperFiles"][0], r"C:\workspace\api\Dapper.cs");
        assert_eq!(value["databaseResultCapture"]["rawAdoNetResultCapture"]["files"][0], r"C:\workspace\api\RawAdo.cs");
    }
}
