use std::{io::Write, time::Duration};

use axum::{
    Router,
    body::Bytes,
    extract::RawQuery,
    http::{HeaderMap, StatusCode, header::{CONTENT_ENCODING, CONTENT_TYPE, LOCATION}},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use inspector_core::domain::{
    BodyAvailability, BodyContent, CaptureProvenance, ExchangeKey, ExchangeState,
};
use inspector_server::{
    ReplayBody, ReplayHeader, ReplayOrigin, ReplayProtocol, ReplayRequest, RunningServer,
    ServerConfig, start,
};
use flate2::{Compression, write::GzEncoder};
use tokio::{net::TcpListener, task::JoinHandle, time::sleep};

#[tokio::test]
async fn replay_records_started_and_completed_fidelity_while_recording_is_paused() {
    let (target, target_task) = target_server().await;
    let mut server = inspector_server(1_024).await;
    server.set_recording(false);
    let request = replay_request(
        "POST",
        format!("http://{target}/complete?first=one&first=two&flag"),
        vec![
            ReplayHeader { name: "Content-Type".into(), value: "application/json".into() },
            ReplayHeader { name: "X-Duplicate".into(), value: "one".into() },
            ReplayHeader { name: "X-Duplicate".into(), value: "two".into() },
        ],
        Some(ReplayBody::Text { value: "{\"name\":\"draft\"}".into() }),
    );

    let receipt = server
        .execute_replay(request)
        .expect("replay should schedule");
    assert_eq!(receipt.revision, 1);
    let started = server
        .exchange(&receipt.exchange_key)
        .expect("started exchange should be visible");
    assert_eq!(started.lifecycle.state, ExchangeState::InFlight);
    assert_eq!(
        started
            .correlation
            .as_ref()
            .and_then(|correlation| correlation.parent_exchange_id.as_deref()),
        Some("source-exchange")
    );
    assert_eq!(
        started
            .metadata
            .get("replay.draftId")
            .and_then(|value| value.as_str()),
        Some("draft-id")
    );

    let completed = wait_for_terminal(&server, &receipt.exchange_key).await;
    assert_eq!(completed.lifecycle.state, ExchangeState::Completed);
    assert_eq!(completed.response.as_ref().map(|response| response.status_code), Some(200));
    assert_eq!(
        completed
            .request
            .query
            .iter()
            .map(|entry| (entry.name.as_str(), entry.value.as_deref()))
            .collect::<Vec<_>>(),
        vec![("first", Some("one")), ("first", Some("two")), ("flag", None)]
    );
    assert_eq!(
        completed
            .request
            .headers
            .iter()
            .map(|entry| (entry.name.as_str(), entry.value.as_str()))
            .collect::<Vec<_>>(),
        vec![("Content-Type", "application/json"), ("X-Duplicate", "one"), ("X-Duplicate", "two")]
    );
    assert!(!completed.request.headers.iter().any(|entry| entry.name.eq_ignore_ascii_case("user-agent")));
    assert_eq!(
        completed
            .request
            .body
            .as_ref()
            .and_then(|body| body.content.as_ref()),
        Some(&BodyContent::InlineText { value: "{\"name\":\"draft\"}".into() })
    );
    assert_eq!(
        completed
            .response
            .as_ref()
            .and_then(|response| response.body.as_ref())
            .and_then(|body| body.content.as_ref()),
        Some(&BodyContent::InlineText { value: "{\"received\":true}".into() })
    );

    server.shutdown().await;
    target_task.abort();
}

#[tokio::test]
async fn replay_keeps_redirects_and_http_errors_completed_but_transport_errors_failed() {
    let (target, target_task) = target_server().await;
    let mut server = inspector_server(1_024).await;

    let redirect = server
        .execute_replay(replay_request(
            "GET",
            format!("http://{target}/redirect"),
            Vec::new(),
            None,
        ))
        .expect("redirect should schedule");
    let redirect = wait_for_terminal(&server, &redirect.exchange_key).await;
    assert_eq!(redirect.lifecycle.state, ExchangeState::Completed);
    assert_eq!(redirect.response.as_ref().map(|response| response.status_code), Some(302));

    let http_error = server
        .execute_replay(replay_request(
            "GET",
            format!("http://{target}/error"),
            Vec::new(),
            None,
        ))
        .expect("HTTP error should schedule");
    let http_error = wait_for_terminal(&server, &http_error.exchange_key).await;
    assert_eq!(http_error.lifecycle.state, ExchangeState::Completed);
    assert_eq!(http_error.response.as_ref().map(|response| response.status_code), Some(503));

    let unused = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("unused port should bind")
        .local_addr()
        .expect("unused address");
    let transport_error = server
        .execute_replay(replay_request(
            "GET",
            format!("http://{unused}/missing"),
            Vec::new(),
            None,
        ))
        .expect("transport failure should schedule");
    let transport_error = wait_for_terminal(&server, &transport_error.exchange_key).await;
    assert_eq!(transport_error.lifecycle.state, ExchangeState::Failed);
    assert!(transport_error.failure.is_some());

    server.shutdown().await;
    target_task.abort();
}

#[tokio::test]
async fn replay_bounds_response_capture_and_reports_observed_bytes() {
    let (target, target_task) = target_server().await;
    let mut server = inspector_server(8).await;
    let receipt = server
        .execute_replay(replay_request(
            "GET",
            format!("http://{target}/large"),
            Vec::new(),
            None,
        ))
        .expect("large response should schedule");
    let completed = wait_for_terminal(&server, &receipt.exchange_key).await;
    let response = completed.response.expect("large response should complete");
    let body = response
        .body
        .expect("large response body should be described");
    assert_eq!(body.availability, BodyAvailability::Truncated);
    assert_eq!(body.observed_byte_length, Some(64));
    assert_eq!(body.captured_byte_length, Some(8));
    assert_eq!(
        completed.capture.response_body,
        CaptureProvenance::Truncated
    );
    assert_eq!(
        response
            .raw
            .expect("raw response should be retained")
            .availability,
        BodyAvailability::Truncated
    );

    server.shutdown().await;
    target_task.abort();
}

#[tokio::test]
async fn replay_decodes_gzip_response_for_inspection_while_retaining_raw_wire_response() {
    let (target, target_task) = target_server().await;
    let mut server = inspector_server(1_024).await;
    let receipt = server.execute_replay(replay_request("GET", format!("http://{target}/gzip"), vec![ReplayHeader { name: "Accept-Encoding".into(), value: "gzip".into() }], None)).expect("gzip response should schedule");
    let response = wait_for_terminal(&server, &receipt.exchange_key).await.response.expect("gzip response should complete");
    let body = response.body.expect("gzip response body should be described");
    assert_eq!(body.content_encoding, None);
    assert_eq!(body.content, Some(BodyContent::InlineText { value: "<soap:Envelope><soap:Body>ok</soap:Body></soap:Envelope>".into() }));
    assert!(matches!(response.raw.expect("raw response should be retained").content, Some(BodyContent::InlineBase64 { .. })));
    server.shutdown().await;
    target_task.abort();
}

async fn inspector_server(maximum_body_bytes: u64) -> RunningServer {
    let mut config = ServerConfig::bind("127.0.0.1:0").expect("inspector address should parse");
    config.maximum_body_bytes = maximum_body_bytes;
    start(config).await.expect("inspector server should start")
}

async fn target_server() -> (std::net::SocketAddr, JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("target should bind");
    let address = listener
        .local_addr()
        .expect("target address should resolve");
    let router = Router::new()
        .route("/complete", any(complete))
        .route(
            "/redirect",
            get(|| async { (StatusCode::FOUND, [(LOCATION, "/complete")]) }),
        )
        .route("/error", get(|| async { StatusCode::SERVICE_UNAVAILABLE }))
        .route("/large", get(|| async { "x".repeat(64) }))
        .route("/gzip", get(gzip));
    let task = tokio::spawn(async move {
        axum::serve(listener, router)
            .await
            .expect("target should serve");
    });
    (address, task)
}

async fn gzip() -> Response {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(b"<soap:Envelope><soap:Body>ok</soap:Body></soap:Envelope>").expect("gzip response should write");
    ([(CONTENT_TYPE, "text/xml; charset=utf-8"), (CONTENT_ENCODING, "gzip")], encoder.finish().expect("gzip response should finish")).into_response()
}

async fn complete(headers: HeaderMap, RawQuery(query): RawQuery, body: Bytes) -> Response {
    sleep(Duration::from_millis(75)).await;
    let duplicates = headers
        .get_all("x-duplicate")
        .iter()
        .filter_map(|value| value.to_str().ok())
        .collect::<Vec<_>>();
    let valid = !headers.contains_key("user-agent")
        && duplicates == ["one", "two"]
        && query.as_deref() == Some("first=one&first=two&flag")
        && body.as_ref() == b"{\"name\":\"draft\"}";
    if valid {
        (
            StatusCode::OK,
            [("content-type", "application/json")],
            "{\"received\":true}",
        )
            .into_response()
    } else {
        StatusCode::BAD_REQUEST.into_response()
    }
}

fn replay_request(
    method: &str,
    url: String,
    headers: Vec<ReplayHeader>,
    body: Option<ReplayBody>,
) -> ReplayRequest {
    ReplayRequest {
        method: method.into(),
        url,
        protocol: ReplayProtocol::Http11,
        headers,
        body,
        origin: ReplayOrigin {
            source_instance_id: "source-instance".into(),
            exchange_id: "source-exchange".into(),
            draft_id: "draft-id".into(),
            edited: true,
        },
    }
}

async fn wait_for_terminal(
    server: &RunningServer,
    key: &ExchangeKey,
) -> inspector_core::domain::HttpExchange {
    for _ in 0..100 {
        let exchange = server
            .exchange(key)
            .expect("scheduled exchange should remain retained");
        if exchange.lifecycle.state != ExchangeState::InFlight {
            return exchange;
        }
        sleep(Duration::from_millis(10)).await;
    }
    panic!("replay did not reach a terminal state");
}
