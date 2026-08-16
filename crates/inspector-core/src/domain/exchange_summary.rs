use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::{ExchangeKey, ExchangeLifecycle};

/// UI streaming remains small by sending this projection instead of body content in every delta.
#[derive(Clone, Debug, Deserialize, JsonSchema, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpExchangeSummary {
    pub key: ExchangeKey,
    pub revision: u64,
    pub arrival_sequence: u64,
    pub lifecycle: ExchangeLifecycle,
    pub method: String,
    pub url: String,
    pub scheme: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub path: Option<String>,
    pub status_code: Option<u16>,
    pub source_name: String,
    pub duration_ms: Option<u64>,
    pub total_bytes: Option<u64>,
    pub tags: Vec<String>,
    pub info: Option<String>,
}
