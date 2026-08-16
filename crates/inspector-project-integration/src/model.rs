use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCapabilities {
    pub available: bool,
    pub runtime: IntegrationRuntime,
    pub transport: IntegrationTransport,
    pub folder_selection: FolderSelection,
    pub reason_code: Option<String>,
    pub bash_path: Option<String>,
    pub adapter_id: String,
    pub adapter_version: String,
    pub payload_digest: String,
    pub package_id: String,
    pub package_version: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationRuntime { Tauri, HostedLocal, Unavailable }

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum IntegrationTransport { Ipc, SameOriginHttp, None }

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderSelection { NativePicker, ServiceLocalPath, None }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectProjectRequest { pub path: String }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectBashRequest { pub path: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSelection { pub selection_token: String, pub path: String }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRequest {
    pub selection_token: String,
    pub project_file: Option<String>,
    pub endpoint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChoice { pub project_file: String, pub label: String }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPreview {
    pub preview_token: Option<String>,
    pub choice_required: bool,
    pub choices: Vec<ProjectChoice>,
    pub project_root: String,
    pub project_file: Option<String>,
    pub composition_file: Option<String>,
    pub strategy: String,
    pub endpoint: String,
    pub package: PackageIdentity,
    pub operations: Vec<String>,
    pub coverage: Vec<IntegrationCoverage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCoverage {
    pub family: String,
    pub bridge: String,
    pub source_edits_required: bool,
    pub count: usize,
    pub locations: Vec<String>,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageIdentity {
    pub id: String,
    pub version: String,
    pub file: String,
    pub digest: String,
    pub feed: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest { pub preview_token: String }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationIdRequest { pub integration_id: String }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRecord {
    pub integration_id: String,
    pub project_root: String,
    pub run_id: String,
    pub state: String,
    pub strategy: String,
    #[serde(default)] pub receipt_status: String,
    pub active: bool,
    pub payload_available: bool,
    #[serde(default)] pub payload_root: String,
    #[serde(default)] pub payload_digest: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCatalog { pub integrations: Vec<IntegrationRecord> }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationResult {
    pub ok: bool,
    #[serde(default)] pub active: bool,
    #[serde(default)] pub project_root: String,
    #[serde(default)] pub integration_id: String,
    #[serde(default)] pub run_id: String,
    #[serde(default)] pub state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationError { pub code: String, pub message: String, pub retryable: bool }

impl IntegrationError {
    pub(crate) fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), retryable: false }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_use_the_transport_contract_names() {
        let value = serde_json::to_value(IntegrationCapabilities {
            available: true,
            runtime: IntegrationRuntime::HostedLocal,
            transport: IntegrationTransport::SameOriginHttp,
            folder_selection: FolderSelection::ServiceLocalPath,
            reason_code: None,
            bash_path: Some("/bin/bash".into()),
            adapter_id: "dotnet-httpclient".into(),
            adapter_version: "1.2.4".into(),
            payload_digest: "abc".into(),
            package_id: "HttpInspector.Adapter".into(),
            package_version: "1.2.4".into(),
        }).expect("capabilities should serialize");
        assert_eq!(value["runtime"], "hostedLocal");
        assert_eq!(value["transport"], "sameOriginHttp");
        assert_eq!(value["folderSelection"], "serviceLocalPath");
    }

    #[test]
    fn legacy_catalog_rows_default_the_new_receipt_status() {
        let record: IntegrationRecord = serde_json::from_value(serde_json::json!({
            "integrationId": "dotnet-httpclient:run-id",
            "projectRoot": "/project",
            "runId": "run-id",
            "state": "active",
            "strategy": "dotnet-ihttpclientfactory-bash-v2",
            "active": true,
            "payloadAvailable": false
        })).expect("legacy rows should remain readable");
        assert_eq!(record.receipt_status, "");
    }
}
