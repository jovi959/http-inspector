use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::{get, post}};
use inspector_project_integration::{ApplyRequest, FolderSelection, IntegrationCapabilities, IntegrationCatalog, IntegrationError, IntegrationIdRequest, IntegrationPreview, IntegrationRuntime, IntegrationService, IntegrationServiceConfig, IntegrationTransport, OperationResult, PreviewRequest, ProjectSelection, SelectProjectRequest};

pub(crate) fn router(state_root: std::path::PathBuf, current_endpoint: String) -> Router {
    let service = Arc::new(IntegrationService::new(IntegrationServiceConfig {
        state_root,
        runtime: IntegrationRuntime::HostedLocal,
        transport: IntegrationTransport::SameOriginHttp,
        folder_selection: FolderSelection::ServiceLocalPath,
        current_endpoint: Some(Arc::new(move || Some(current_endpoint.clone()))),
    }));
    Router::new()
        .route("/api/project-integrations/capabilities", get(capabilities))
        .route("/api/project-integrations/select", post(select))
        .route("/api/project-integrations/preview", post(preview))
        .route("/api/project-integrations", get(list))
        .route("/api/project-integrations/status", get(list))
        .route("/api/project-integrations/apply", post(apply))
        .route("/api/project-integrations/remove", post(remove))
        .route("/api/project-integrations/recover", post(recover))
        .route("/api/project-integrations/force-remove", post(force_remove))
        .with_state(service)
}

async fn capabilities(State(service): State<Arc<IntegrationService>>) -> Json<IntegrationCapabilities> { Json(service.capabilities()) }

async fn select(State(service): State<Arc<IntegrationService>>, Json(request): Json<SelectProjectRequest>) -> Result<Json<ProjectSelection>, ApiError> {
    service.select(request).map(Json).map_err(ApiError)
}

async fn preview(State(service): State<Arc<IntegrationService>>, Json(request): Json<PreviewRequest>) -> Result<Json<IntegrationPreview>, ApiError> {
    service.preview(request).map(Json).map_err(ApiError)
}

async fn list(State(service): State<Arc<IntegrationService>>) -> Result<Json<IntegrationCatalog>, ApiError> {
    service.list().map(Json).map_err(ApiError)
}

async fn apply(State(service): State<Arc<IntegrationService>>, Json(request): Json<ApplyRequest>) -> Result<Json<OperationResult>, ApiError> {
    service.apply(request).map(Json).map_err(ApiError)
}

async fn remove(State(service): State<Arc<IntegrationService>>, Json(request): Json<IntegrationIdRequest>) -> Result<Json<OperationResult>, ApiError> {
    service.remove(request).map(Json).map_err(ApiError)
}

async fn recover(State(service): State<Arc<IntegrationService>>, Json(request): Json<IntegrationIdRequest>) -> Result<Json<OperationResult>, ApiError> {
    service.recover(request).map(Json).map_err(ApiError)
}

async fn force_remove(State(service): State<Arc<IntegrationService>>, Json(request): Json<IntegrationIdRequest>) -> Result<Json<OperationResult>, ApiError> {
    service.force_remove(request).map(Json).map_err(ApiError)
}

struct ApiError(IntegrationError);

impl axum::response::IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (axum::http::StatusCode::UNPROCESSABLE_ENTITY, Json(self.0)).into_response()
    }
}
