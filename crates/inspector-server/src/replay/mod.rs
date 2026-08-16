mod model;
mod request;
mod service;

use inspector_core::domain::ExchangeKey;
use serde::{Deserialize, Serialize};

pub use service::ReplayService;

/// Editable application-level request supplied by the inspector UI.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRequest {
    pub method: String,
    pub url: String,
    pub protocol: ReplayProtocol,
    pub headers: Vec<ReplayHeader>,
    pub body: Option<ReplayBody>,
    pub origin: ReplayOrigin,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayHeader {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReplayProtocol {
    Auto,
    Http11,
    Http2,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ReplayBody {
    Text { value: String },
    Base64 { value: String },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayOrigin {
    pub source_instance_id: String,
    pub exchange_id: String,
    pub draft_id: String,
    pub edited: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayExecutionReceipt {
    pub exchange_key: ExchangeKey,
    pub revision: u64,
}
