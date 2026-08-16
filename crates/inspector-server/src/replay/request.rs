use base64::{Engine, engine::general_purpose::STANDARD};
use inspector_core::domain::{
    BodyAvailability, BodyContent, CaptureProvenance, HeaderEntry, HttpBody, HttpRequest,
    QueryEntry,
};
use reqwest::{Client, Method, Request, Url, Version, header::{HeaderMap, HeaderName, HeaderValue}};

use super::{ReplayBody, ReplayProtocol, ReplayRequest};

pub(super) struct PreparedReplay {
    pub request: Request,
    pub captured_request: HttpRequest,
    pub request_header_bytes: u64,
    pub request_body_bytes: u64,
    pub origin: super::ReplayOrigin,
}

pub(super) fn prepare(client: &Client, replay: ReplayRequest) -> Result<PreparedReplay, String> {
    let method = Method::from_bytes(replay.method.as_bytes()).map_err(|error| format!("Invalid HTTP method: {error}"))?;
    let url = Url::parse(&replay.url).map_err(|error| format!("Invalid replay URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Replay URL must use HTTP or HTTPS.".into());
    }
    let mut headers = HeaderMap::new();
    for header in &replay.headers {
        let field_name = HeaderName::from_bytes(header.name.as_bytes()).map_err(|error| format!("Invalid header '{}': {error}", header.name))?;
        let value = HeaderValue::from_str(&header.value).map_err(|error| format!("Invalid value for header '{}': {error}", header.name))?;
        headers.append(field_name, value);
    }
    let body_bytes = body_bytes(replay.body.as_ref())?;
    let request_body = body_descriptor(replay.body.as_ref(), &body_bytes, &replay.headers);
    let raw = raw_request(&replay, &url, &body_bytes);
    let captured_request = HttpRequest {
        method: replay.method.clone(),
        original_method: None,
        url: replay.url.clone(),
        scheme: Some(url.scheme().into()),
        host: url.host_str().map(Into::into),
        port: url.port(),
        path: Some(url.path().into()),
        path_segments: url.path_segments().map(|segments| segments.map(Into::into).collect()).unwrap_or_default(),
        fragment: url.fragment().map(Into::into),
        query: query_entries(&url),
        protocol: protocol_name(replay.protocol).map(Into::into),
        headers: replay.headers.iter().map(|header| HeaderEntry {
            name: header.name.clone(), value: header.value.clone(), provenance: Some(CaptureProvenance::AdapterReported),
        }).collect(),
        body: request_body,
        raw: Some(raw),
        remote_address: None,
        local_address: None,
    };
    let request_header_bytes = header_bytes(&replay.headers);
    let request_body_bytes = body_bytes.len() as u64;
    let mut builder = client.request(method, url).headers(headers);
    builder = match replay.protocol {
        ReplayProtocol::Auto => builder,
        ReplayProtocol::Http11 => builder.version(Version::HTTP_11),
        ReplayProtocol::Http2 => builder.version(Version::HTTP_2),
    };
    if replay.body.is_some() {
        builder = builder.body(body_bytes);
    }
    let request = builder.build().map_err(|error| format!("Replay request could not be built: {error}"))?;
    Ok(PreparedReplay { request, captured_request, request_header_bytes, request_body_bytes, origin: replay.origin })
}

pub(super) fn header_bytes(headers: &[super::ReplayHeader]) -> u64 {
    headers.iter().map(|header| (header.name.len() + header.value.len() + 4) as u64).sum()
}

pub(super) fn protocol_from_version(version: Version) -> String {
    match version {
        Version::HTTP_09 => "HTTP/0.9",
        Version::HTTP_10 => "HTTP/1.0",
        Version::HTTP_11 => "HTTP/1.1",
        Version::HTTP_2 => "HTTP/2",
        Version::HTTP_3 => "HTTP/3",
        _ => "HTTP",
    }.into()
}

fn body_bytes(body: Option<&ReplayBody>) -> Result<Vec<u8>, String> {
    match body {
        Some(ReplayBody::Text { value }) => Ok(value.as_bytes().to_vec()),
        Some(ReplayBody::Base64 { value }) => STANDARD.decode(value).map_err(|error| format!("Replay body is not valid Base64: {error}")),
        None => Ok(Vec::new()),
    }
}

fn body_descriptor(body: Option<&ReplayBody>, bytes: &[u8], headers: &[super::ReplayHeader]) -> Option<HttpBody> {
    let body = body?;
    let length = bytes.len() as u64;
    let content = if bytes.is_empty() { None } else { Some(match body {
        ReplayBody::Text { value } => BodyContent::InlineText { value: value.clone() },
        ReplayBody::Base64 { value } => BodyContent::InlineBase64 { value: value.clone() },
    }) };
    Some(HttpBody {
        availability: if bytes.is_empty() { BodyAvailability::Empty } else { BodyAvailability::Captured },
        media_type: content_type(headers),
        charset: content_charset(headers),
        content_encoding: None,
        declared_byte_length: Some(length),
        observed_byte_length: Some(length),
        captured_byte_length: Some(length),
        sha256: None,
        content,
        truncation_reason: None,
    })
}

fn raw_request(replay: &ReplayRequest, url: &Url, body: &[u8]) -> HttpBody {
    let target = match url.query() { Some(query) => format!("{}?{query}", url.path()), None => url.path().into() };
    let mut bytes = format!("{} {} {}\r\n", replay.method, target, protocol_name(replay.protocol).unwrap_or("HTTP/1.1")).into_bytes();
    for header in &replay.headers {
        bytes.extend_from_slice(header.name.as_bytes());
        bytes.extend_from_slice(b": ");
        bytes.extend_from_slice(header.value.as_bytes());
        bytes.extend_from_slice(b"\r\n");
    }
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(body);
    inline_bytes(bytes, CaptureProvenance::Reconstructed)
}

pub(super) fn inline_bytes(bytes: Vec<u8>, _provenance: CaptureProvenance) -> HttpBody {
    let length = bytes.len() as u64;
    let content = String::from_utf8(bytes).map_or_else(
        |error| BodyContent::InlineBase64 { value: STANDARD.encode(error.into_bytes()) },
        |value| BodyContent::InlineText { value },
    );
    HttpBody {
        availability: BodyAvailability::Captured,
        media_type: Some("message/http".into()),
        charset: None,
        content_encoding: None,
        declared_byte_length: Some(length),
        observed_byte_length: Some(length),
        captured_byte_length: Some(length),
        sha256: None,
        content: Some(content),
        truncation_reason: None,
    }
}

fn query_entries(url: &Url) -> Vec<QueryEntry> {
    let decoded: Vec<(String, String)> = url.query_pairs().map(|(name, value)| (name.into_owned(), value.into_owned())).collect();
    let raw: Vec<&str> = url.query().map(|query| query.split('&').collect()).unwrap_or_default();
    decoded.into_iter().enumerate().map(|(index, (name, value))| QueryEntry {
        name,
        value: raw.get(index).is_none_or(|component| component.contains('=')).then_some(value),
        provenance: Some(CaptureProvenance::AdapterReported),
    }).collect()
}

fn protocol_name(protocol: ReplayProtocol) -> Option<&'static str> {
    match protocol {
        ReplayProtocol::Auto => None,
        ReplayProtocol::Http11 => Some("HTTP/1.1"),
        ReplayProtocol::Http2 => Some("HTTP/2"),
    }
}

fn content_type(headers: &[super::ReplayHeader]) -> Option<String> {
    headers.iter().find(|header| header.name.eq_ignore_ascii_case("content-type"))
        .and_then(|header| header.value.split(';').next()).map(|value| value.trim().to_string())
}

fn content_charset(headers: &[super::ReplayHeader]) -> Option<String> {
    headers.iter().find(|header| header.name.eq_ignore_ascii_case("content-type"))
        .and_then(|header| header.value.split(';').find_map(|part| part.trim().strip_prefix("charset=").map(Into::into)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prepare_preserves_encoded_odata_query_and_standard_request_headers() {
        let url = "https://api.example.test/saas/d365/v9.2/sample_records?$select=field_assignment,field_title,_field_owner&$filter=field_category%20eq%201001%20and%20_field_project%20ne%20null%20and%20contains(relation_owner/field_login,%27TEST_USER%27)&$expand=relation_account(%20$select=field_account_id,field_name),relation_schedule(%20$select=field_schedule_id;%20$expand=relation_classification(%20$select=field_name),)";
        let replay = ReplayRequest {
            method: "GET".into(), url: url.into(), protocol: ReplayProtocol::Http11,
            headers: vec![
                super::super::ReplayHeader { name: "Host".into(), value: "api.example.test".into() },
                super::super::ReplayHeader { name: "Ocp-Apim-Subscription-Key".into(), value: "simulated-key".into() },
                super::super::ReplayHeader { name: "OData-MaxVersion".into(), value: "4.0".into() },
                super::super::ReplayHeader { name: "OData-Version".into(), value: "4.0".into() },
                super::super::ReplayHeader { name: "Authorization".into(), value: "Bearer simulated-token".into() },
            ],
            body: None,
            origin: super::super::ReplayOrigin { source_instance_id: "source".into(), exchange_id: "exchange".into(), draft_id: "draft".into(), edited: false },
        };
        let prepared = prepare(&Client::new(), replay).expect("OData replay request should prepare");
        assert_eq!(prepared.request.url().as_str(), url);
        assert_eq!(prepared.request.headers().get("host").and_then(|value| value.to_str().ok()), Some("api.example.test"));
        assert_eq!(prepared.captured_request.query.len(), 3);
    }
}
