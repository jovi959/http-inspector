use std::io::{Cursor, Read};

use base64::{Engine, engine::general_purpose::STANDARD};
use brotli::Decompressor;
use flate2::read::{DeflateDecoder, GzDecoder};
use inspector_core::domain::{
    BodyAvailability, BodyContent, ByteCount, CaptureFidelity, CaptureProvenance,
    DurationValue, ExchangeSizes, ExchangeTiming, HeaderEntry, HttpBody, HttpResponse,
};
use reqwest::{Response, Version};

use super::ReplayHeader;
use super::request::{header_bytes, inline_bytes, protocol_from_version};

pub(super) struct CapturedResponse {
    pub response: HttpResponse,
    pub response_header_bytes: u64,
    pub response_body_bytes: u64,
    pub truncated: bool,
}

struct SemanticResponseBody {
    bytes: Vec<u8>,
    observed: u64,
    truncated: bool,
    content_encoding: Option<String>,
}

pub(super) async fn capture_response(mut response: Response, maximum_body_bytes: u64) -> Result<CapturedResponse, String> {
    let status = response.status();
    let version = response.version();
    let headers: Vec<ReplayHeader> = response.headers().iter().map(|(name, value)| ReplayHeader {
        name: name.as_str().into(),
        value: value.to_str().map_or_else(|_| STANDARD.encode(value.as_bytes()), Into::into),
    }).collect();
    let media_type = content_type(&headers);
    let charset = content_charset(&headers);
    let mut captured = Vec::new();
    let mut observed = 0_u64;
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("Replay response body failed: {error}"))? {
        observed += chunk.len() as u64;
        let remaining = maximum_body_bytes.saturating_sub(captured.len() as u64) as usize;
        captured.extend_from_slice(&chunk[..chunk.len().min(remaining)]);
    }
    let truncated = observed > captured.len() as u64;
    let content_encoding = content_encoding(&headers);
    let semantic = semantic_response_body(captured.clone(), observed, truncated, content_encoding, maximum_body_bytes);
    let body = response_body(semantic.bytes, semantic.observed, semantic.truncated, media_type, charset, semantic.content_encoding);
    let raw = raw_response(status.as_u16(), status.canonical_reason(), version, &headers, &captured, observed, truncated);
    let response_header_bytes = header_bytes(&headers);
    Ok(CapturedResponse {
        response: HttpResponse {
            status_code: status.as_u16(),
            reason_phrase: status.canonical_reason().map(Into::into),
            protocol: Some(protocol_from_version(version)),
            headers: headers.into_iter().map(|header| HeaderEntry {
                name: header.name, value: header.value, provenance: Some(CaptureProvenance::AdapterReported),
            }).collect(),
            body,
            raw: Some(raw),
        },
        response_header_bytes,
        response_body_bytes: observed,
        truncated,
    })
}

pub(super) fn started_timing() -> ExchangeTiming {
    unavailable_timing(None)
}

pub(super) fn completed_timing(elapsed_ms: u64) -> ExchangeTiming {
    let unavailable = unavailable_duration();
    ExchangeTiming {
        request_headers_sent_ms: Some(0),
        request_body_finished_ms: Some(0),
        response_headers_received_ms: None,
        response_body_finished_ms: Some(elapsed_ms),
        exchange_ended_ms: Some(elapsed_ms),
        dns: unavailable.clone(), connect: unavailable.clone(), tls: unavailable.clone(), queue: unavailable.clone(),
        request_write: unavailable.clone(), server_wait: unavailable.clone(), response_read: unavailable,
        total: DurationValue { milliseconds: Some(elapsed_ms), provenance: CaptureProvenance::Measured },
    }
}

pub(super) fn sizes(request_headers: u64, request_body: u64, response_headers: Option<u64>, response_body: Option<u64>) -> ExchangeSizes {
    let known = |bytes| ByteCount { bytes: Some(bytes), provenance: CaptureProvenance::Measured };
    let unavailable = ByteCount { bytes: None, provenance: CaptureProvenance::Unavailable };
    let total = response_headers.zip(response_body).map(|(headers, body)| request_headers + request_body + headers + body);
    ExchangeSizes {
        request_headers: known(request_headers),
        request_body: known(request_body),
        response_headers: response_headers.map_or_else(|| unavailable.clone(), known),
        response_body: response_body.map_or_else(|| unavailable.clone(), known),
        total: total.map_or(unavailable, known),
    }
}

pub(super) fn fidelity(truncated: bool) -> CaptureFidelity {
    CaptureFidelity {
        request_headers: CaptureProvenance::AdapterReported,
        response_headers: CaptureProvenance::AdapterReported,
        request_body: CaptureProvenance::AdapterReported,
        response_body: if truncated { CaptureProvenance::Truncated } else { CaptureProvenance::Exact },
        timing: CaptureProvenance::Measured,
        sizes: CaptureProvenance::Measured,
        request_raw: CaptureProvenance::Reconstructed,
        response_raw: CaptureProvenance::Reconstructed,
    }
}

fn response_body(bytes: Vec<u8>, observed: u64, truncated: bool, media_type: Option<String>, charset: Option<String>, content_encoding: Option<String>) -> Option<HttpBody> {
    if observed == 0 {
        return Some(HttpBody {
            availability: BodyAvailability::Empty, media_type, charset, content_encoding,
            declared_byte_length: Some(0), observed_byte_length: Some(0), captured_byte_length: Some(0),
            sha256: None, content: None, truncation_reason: None,
        });
    }
    let captured = bytes.len() as u64;
    let content = String::from_utf8(bytes).map_or_else(
        |error| BodyContent::InlineBase64 { value: STANDARD.encode(error.into_bytes()) },
        |value| BodyContent::InlineText { value },
    );
    Some(HttpBody {
        availability: if truncated { BodyAvailability::Truncated } else { BodyAvailability::Captured },
        media_type, charset, content_encoding,
        declared_byte_length: None, observed_byte_length: Some(observed), captured_byte_length: Some(captured),
        sha256: None, content: Some(content),
        truncation_reason: truncated.then(|| "response exceeded replay capture limit".into()),
    })
}

fn semantic_response_body(bytes: Vec<u8>, observed: u64, truncated: bool, content_encoding: Option<String>, maximum_body_bytes: u64) -> SemanticResponseBody {
    let Some(encoding) = content_encoding else {
        return SemanticResponseBody { bytes, observed, truncated, content_encoding: None };
    };
    if truncated {
        return SemanticResponseBody { bytes, observed, truncated, content_encoding: Some(encoding) };
    }
    match decode_content_encoding(&bytes, &encoding, maximum_body_bytes) {
        Ok(decoded) => {
            let observed = decoded.len() as u64;
            SemanticResponseBody { bytes: decoded, observed, truncated: false, content_encoding: None }
        }
        Err(_) => SemanticResponseBody { bytes, observed, truncated: false, content_encoding: Some(encoding) },
    }
}

fn decode_content_encoding(bytes: &[u8], content_encoding: &str, maximum_body_bytes: u64) -> Result<Vec<u8>, String> {
    let encodings: Vec<&str> = content_encoding
        .split(',')
        .map(str::trim)
        .filter(|encoding| !encoding.is_empty() && !encoding.eq_ignore_ascii_case("identity"))
        .collect();
    let mut decoded = bytes.to_vec();
    for encoding in encodings.into_iter().rev() {
        decoded = match encoding.to_ascii_lowercase().as_str() {
            "gzip" | "x-gzip" => decode_bounded(GzDecoder::new(Cursor::new(decoded)), maximum_body_bytes)?,
            "deflate" => decode_bounded(DeflateDecoder::new(Cursor::new(decoded)), maximum_body_bytes)?,
            "br" => decode_bounded(Decompressor::new(Cursor::new(decoded), 8_192), maximum_body_bytes)?,
            _ => return Err(format!("Unsupported content encoding: {encoding}")),
        };
    }
    Ok(decoded)
}

fn decode_bounded(mut decoder: impl Read, maximum_body_bytes: u64) -> Result<Vec<u8>, String> {
    let mut decoded = Vec::new();
    let mut buffer = [0_u8; 8_192];
    loop {
        let count = decoder.read(&mut buffer).map_err(|error| format!("Unable to decode replay response: {error}"))?;
        if count == 0 {
            return Ok(decoded);
        }
        let next = decoded.len().saturating_add(count) as u64;
        if next > maximum_body_bytes {
            return Err("Decoded replay response exceeds the capture limit.".into());
        }
        decoded.extend_from_slice(&buffer[..count]);
    }
}

fn raw_response(status: u16, reason: Option<&str>, version: Version, headers: &[ReplayHeader], body: &[u8], observed: u64, truncated: bool) -> HttpBody {
    let mut bytes = format!("{} {status} {}\r\n", protocol_from_version(version), reason.unwrap_or_default()).into_bytes();
    for header in headers {
        bytes.extend_from_slice(header.name.as_bytes());
        bytes.extend_from_slice(b": ");
        bytes.extend_from_slice(header.value.as_bytes());
        bytes.extend_from_slice(b"\r\n");
    }
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(body);
    let mut raw = inline_bytes(bytes, CaptureProvenance::Reconstructed);
    if truncated {
        let omitted = observed.saturating_sub(body.len() as u64);
        raw.availability = BodyAvailability::Truncated;
        raw.observed_byte_length = raw.captured_byte_length.map(|captured| captured + omitted);
        raw.truncation_reason = Some("response exceeded replay capture limit".into());
    }
    raw
}

fn unavailable_timing(total: Option<u64>) -> ExchangeTiming {
    let unavailable = unavailable_duration();
    ExchangeTiming {
        request_headers_sent_ms: None, request_body_finished_ms: None, response_headers_received_ms: None,
        response_body_finished_ms: None, exchange_ended_ms: total,
        dns: unavailable.clone(), connect: unavailable.clone(), tls: unavailable.clone(), queue: unavailable.clone(),
        request_write: unavailable.clone(), server_wait: unavailable.clone(), response_read: unavailable.clone(),
        total: total.map_or(unavailable, |milliseconds| DurationValue { milliseconds: Some(milliseconds), provenance: CaptureProvenance::Measured }),
    }
}

fn unavailable_duration() -> DurationValue {
    DurationValue { milliseconds: None, provenance: CaptureProvenance::Unavailable }
}

fn content_type(headers: &[ReplayHeader]) -> Option<String> {
    headers.iter().find(|header| header.name.eq_ignore_ascii_case("content-type"))
        .and_then(|header| header.value.split(';').next()).map(|value| value.trim().to_string())
}

fn content_charset(headers: &[ReplayHeader]) -> Option<String> {
    headers.iter().find(|header| header.name.eq_ignore_ascii_case("content-type"))
        .and_then(|header| header.value.split(';').find_map(|part| part.trim().strip_prefix("charset=").map(Into::into)))
}

fn content_encoding(headers: &[ReplayHeader]) -> Option<String> {
    let values: Vec<&str> = headers.iter()
        .filter(|header| header.name.eq_ignore_ascii_case("content-encoding"))
        .map(|header| header.value.trim())
        .filter(|value| !value.is_empty())
        .collect();
    (!values.is_empty()).then(|| values.join(", "))
}
