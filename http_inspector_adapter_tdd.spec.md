# HTTP Inspector Adapter TDD Specification

Status: normative companion to `http_inspector_adapter.spec.md` 1.12.0
Test specification version: 1.6.0
Protocol under test: capture protocol `{ "major": 1, "minor": 0 }`  
Audience: developers and coding agents implementing an HTTP Inspector adapter or integration strategy

## Purpose

This document defines the tests an adapter implementation must satisfy. Translate the pseudocode into the target ecosystem's normal test framework and naming conventions. The behavior and fixed values are normative; the pseudocode syntax is not.

Use test-driven development:

1. Add the smallest applicable test below and confirm that it fails for the intended reason.
2. Implement only enough production behavior to pass it.
3. Refactor without weakening assertions or changing the fixed contract values.
4. Repeat in the dependency order in this document.

Do not delete, skip, loosen, snapshot-update, or rewrite a failing normative test merely to make an implementation pass. If the target HTTP stack cannot expose a value or lifecycle seam, keep the test as an explicitly documented unsupported capability and emit unavailable/null provenance as required by the adapter specification.

## Test lanes

| Lane | Marker | Runtime dependencies | Requirement |
| --- | --- | --- | --- |
| Adapter unit | `UNIT` | Fake clock, fake IDs, fake transport, fake HTTP callbacks | Every adapter implementation must run these locally and in CI. |
| Wire contract | `CONTRACT` | Serializer plus `contracts/http-inspector.v1.schema.json` and committed fixtures | Every adapter implementation must validate its emitted objects against protocol v1. |
| Listener integration | `INTEGRATION` | Ephemeral real HTTP Inspector listener on loopback port `0` | Required before declaring `websocket-v1` compatible; not a substitute for unit tests. |
| Injection portability | `PORTABILITY` | Temporary copies of two independent compatible fixture projects | Required only when an automatic pre-run/post-run strategy is advertised. |

Product UI tests are outside this adapter test specification. Adapter tests prove emitted data, lifecycle, non-interference, and integration cleanup. The HTTP Inspector repository continues to limit automatically added product tests to its model/contract surface.

CFG-003 and REC-005 are future-red cases for the planned standalone-listener descriptor. Keep them visible and map them as `pendingProductDependency` while the implementation-plan `listener-endpoint-descriptor` checkpoint is open. They become ordinary mandatory tests before descriptor production code is added; they are not grounds for claiming descriptor support today.

## Canonical test values

Use these deterministic values. A native test may wrap them in typed value objects, but serialized output must remain identical.

```text
protocolVersion        = { major: 1, minor: 0 }
endpoint               = ws://127.0.0.1:53662/v1/capture
alternateEndpoint      = ws://127.0.0.1:54321/v1/capture
sourceInstanceId       = 11111111-2222-4333-8444-55555555b001
otherSourceInstanceId  = 11111111-2222-4333-8444-55555555b002
sessionId              = 11111111-2222-4333-8444-55555555a001
connectionId           = 11111111-2222-4333-8444-55555555d001
exchangeA              = 11111111-2222-4333-8444-55555555f001
exchangeB              = 11111111-2222-4333-8444-55555555f002
exchangeC              = 11111111-2222-4333-8444-55555555f003
messageStartA          = 11111111-2222-4333-8444-55555555c001
messageCompleteA       = 11111111-2222-4333-8444-55555555c002
messageStartB          = 11111111-2222-4333-8444-55555555c003
messageCompleteB       = 11111111-2222-4333-8444-55555555c004
messageFailure         = 11111111-2222-4333-8444-55555555c005
messageCancellation    = 11111111-2222-4333-8444-55555555c006
messageHeartbeat       = 11111111-2222-4333-8444-55555555c007
startedAt              = 2026-08-13T20:39:49.000Z
completedAt            = 2026-08-13T20:39:49.040Z
maximumMessageBytes    = 4194304
maximumBodyBytes       = 1048576
defaultQueueCapacity   = 256
defaultHeartbeat       = 15 seconds
```

Canonical request A and request B intentionally have the same method and URL:

```json
{
  "method": "POST",
  "originalMethod": "post",
  "url": "https://api.example.test/v1/documents/search?region=ca&region=on&includeClosed",
  "scheme": "https",
  "host": "api.example.test",
  "port": null,
  "path": "/v1/documents/search",
  "pathSegments": ["v1", "documents", "search"],
  "fragment": null,
  "query": [
    { "name": "region", "value": "ca", "provenance": "exact" },
    { "name": "region", "value": "on", "provenance": "exact" },
    { "name": "includeClosed", "value": null, "provenance": "exact" }
  ],
  "protocol": "HTTP/2",
  "headers": [
    { "name": "Host", "value": "api.example.test", "provenance": "exact" },
    { "name": "User-Agent", "value": "HTTPInspectorAdapterTDD/1.0", "provenance": "exact" },
    { "name": "Accept", "value": "application/json", "provenance": "exact" },
    { "name": "Accept-Language", "value": "en-CA,en;q=0.9", "provenance": "exact" },
    { "name": "Content-Type", "value": "application/json", "provenance": "exact" },
    { "name": "Content-Length", "value": "56", "provenance": "exact" },
    { "name": "Authorization", "value": "Bearer fixture-token", "provenance": "exact" },
    { "name": "Cookie", "value": "session=fixture-session; region=ca", "provenance": "exact" },
    { "name": "X-Api-Key", "value": "fixture-api-key", "provenance": "exact" },
    { "name": "X-Project-Specific-Header", "value": "project-value", "provenance": "exact" },
    { "name": "X-Trace", "value": "one", "provenance": "exact" },
    { "name": "X-Trace", "value": "two", "provenance": "exact" }
  ],
  "body": {
    "availability": "captured",
    "mediaType": "application/json",
    "charset": "utf-8",
    "contentEncoding": null,
    "declaredByteLength": 56,
    "observedByteLength": 56,
    "capturedByteLength": 56,
    "sha256": null,
    "content": { "kind": "inlineText", "value": "{\"searchType\":\"IDNumber\",\"includeClosed\":false,\"page\":1}" },
    "truncationReason": null
  },
  "raw": null,
  "remoteAddress": { "value": "203.0.113.10:443", "provenance": "adapterReported" },
  "localAddress": null
}
```

Canonical response A:

```json
{
  "statusCode": 200,
  "reasonPhrase": "OK",
  "protocol": "HTTP/2",
  "headers": [
    { "name": "Content-Type", "value": "application/json; charset=utf-8", "provenance": "exact" },
    { "name": "Set-Cookie", "value": "session=fixture-a", "provenance": "exact" },
    { "name": "Set-Cookie", "value": "theme=dark", "provenance": "exact" }
  ],
  "body": {
    "availability": "captured",
    "mediaType": "application/json",
    "charset": "utf-8",
    "contentEncoding": null,
    "declaredByteLength": 51,
    "observedByteLength": 51,
    "capturedByteLength": 51,
    "sha256": null,
    "content": { "kind": "inlineText", "value": "{\"items\":[{\"id\":42,\"active\":true}],\"nextPage\":null}" },
    "truncationReason": null
  },
  "raw": null
}
```

Canonical XML/SOAP body:

```text
<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetDocument id="42" /></soap:Body></soap:Envelope>
```

## Required test harness ports

Production code must be testable without opening a real socket or sleeping. Implement equivalent ports using ecosystem-native interfaces/protocols/abstract classes:

```text
IdGenerator.nextUuid() -> UUID
WallClock.nowUtc() -> RFC 3339 UTC timestamp
MonotonicClock.now() -> monotonic duration marker
Delay.schedule(duration) -> controllable async completion

CaptureTransport.connect(ClientHello) -> NegotiatedSession
CaptureTransport.send(CaptureMessage) -> MessageAcknowledgement
CaptureTransport.flush(timeout) -> FlushResult
CaptureTransport.close() -> void
```

The unit-test fakes must support:

- A queued deterministic UUID sequence.
- Independently controlled wall and monotonic clocks.
- Capturing every connect/send/flush/close call in order.
- Accepting, rejecting, delaying, or disconnecting a connection/send operation.
- Returning `hello.accepted`, `hello.error`, `message.accepted`, or `message.error` values.
- Advancing scheduled reconnect/heartbeat delays without real time passing.
- Simulating a full bounded queue.

Do not mock the adapter itself. Test its public API and the real serializer/queue/lifecycle code with fake boundary ports.

## TDD implementation order

Implement and pass suites in this order:

1. Configuration and deterministic construction.
2. Handshake and transport isolation.
3. Request start and terminal lifecycle.
4. Concurrent request/response correlation.
5. Exact value preservation and body variants.
6. Failure, cancellation, limits, and backpressure.
7. Disconnect, retry, and recovery snapshots.
8. HTTP-stack-specific bridge behavior.
9. Real-listener contract smoke.
10. Pre-run/post-run portability when automatic integration is advertised.

## Configuration unit tests

| ID | Case | Arrange and action | Required assertions |
| --- | --- | --- | --- |
| `CFG-001` | Explicit endpoint wins | Configure explicit `alternateEndpoint`, environment `endpoint`, and a descriptor endpoint. Create adapter. | Effective endpoint is `alternateEndpoint`; no other source replaces it. |
| `CFG-002` | Environment endpoint fallback | Omit explicit endpoint; set `HTTP_INSPECTOR_WS` to `alternateEndpoint`. | Effective endpoint is `alternateEndpoint`. |
| `CFG-003` | Descriptor fallback | Omit explicit/environment values; provide a valid current descriptor. | Effective endpoint equals descriptor `loopbackEndpoint`. Mark pending until descriptor support exists. |
| `CFG-004` | Development fallback | Omit explicit/environment/descriptor values. | Effective endpoint is `endpoint`. |
| `CFG-005` | Invalid endpoint fails construction | Supply `http://127.0.0.1:53662/v1/capture`, missing port, or path other than `/v1/capture`. | Construction returns a configuration error before starting workers. |
| `CFG-006` | Deferred profile rejected | Configure `same-origin-relay-v1`, `http-batch-v1`, or an unknown profile. | Construction reports unsupported transport profile; it does not silently use WebSocket. |
| `CFG-007` | No pairing configuration | Create the normal v1 adapter. | Hello/configuration contains no pairing token, authentication token, or rotation state. |

## Handshake and connection unit tests

| ID | Case | Arrange and action | Required assertions |
| --- | --- | --- | --- |
| `HSK-001` | Hello is first | Start adapter with accepting fake transport. | First transport payload is `ClientHello`; no capture message precedes it. |
| `HSK-002` | Hello values | Start adapter with fixed source ID. | Hello uses protocol `1.0`, fixed `sourceInstanceId`, configured source fields, and camelCase serialization. |
| `HSK-003` | Wait for acceptance | Delay `hello.accepted`; call `captureStarted`. | Host callback returns immediately; start is bounded/queued and is not sent before acceptance. |
| `HSK-004` | Store negotiated values | Accept with canonical connection/session IDs and limits. | Adapter exposes/stores exactly those negotiated values for the active connection. |
| `HSK-005` | Non-retryable hello error | Return incompatible-protocol `hello.error` with `retryable: false`. | Adapter stops automatic reconnect until configuration changes and records `protocolMismatch`. |
| `HSK-006` | Retryable hello failure | Fail connection or return retryable hello error. | Adapter schedules bounded backoff without throwing into host HTTP execution. |
| `HSK-007` | One connection per process | Start 100 exchanges. | Exactly one active capture connection is used, not one per exchange. |
| `HSK-008` | Stop closes transport | Start then stop twice. | Flush is attempted once, workers/timers end, socket closes, and repeated stop is harmless. |

## Correlation unit tests

### `COR-001`: pending request becomes the same completed exchange

```text
given fake IDs yield exchangeA, messageStartA, messageCompleteA
and transport has accepted hello

handle = adapter.captureStarted(canonicalRequestA)
adapter.captureCompleted(handle, canonicalResponseA, completedTiming)

assert sent[0].type == "exchange.started"
assert sent[0].exchangeId == exchangeA
assert sent[0].messageId == messageStartA
assert sent[0].revision == 1

assert sent[1].type == "exchange.completed"
assert sent[1].exchangeId == exchangeA
assert sent[1].messageId == messageCompleteA
assert sent[1].revision == 2
assert sent[0].messageId != sent[1].messageId
```

### `COR-002`: identical concurrent requests complete in reverse order

```text
given requestA and requestB have identical method and URL
and fake IDs yield exchangeA, messageStartA, exchangeB, messageStartB,
    messageCompleteB, messageCompleteA

handleA = adapter.captureStarted(requestA)
handleB = adapter.captureStarted(requestB)
adapter.captureCompleted(handleB, responseB)
adapter.captureCompleted(handleA, responseA)

assert emitted lifecycle order is:
  started(exchangeA), started(exchangeB), completed(exchangeB), completed(exchangeA)
assert completed(exchangeB) came from handleB
assert completed(exchangeA) came from handleA
assert no lookup used URL, method, FIFO position, or a global last request
```

Additional correlation cases:

| ID | Case | Required assertions |
| --- | --- | --- |
| `COR-003` | Acknowledgements arrive out of order | Resolve `messageCompleteB` acknowledgement before `messageStartA`; pending acknowledgements resolve by `messageId`, while lifecycle identity remains `exchangeId`. |
| `COR-004` | Same exchange UUID from two sources | Feed reference reducer/hub with `(sourceInstanceId, exchangeA)` and `(otherSourceInstanceId, exchangeA)`. Two records exist; neither overwrites the other. |
| `COR-005` | Duplicate terminal callback | Invoke completion twice for one handle. Exactly one normal terminal event is emitted; duplicate callback is ignored/reported locally. |
| `COR-006` | Failure retains identity | Start `exchangeA`, then fail the same handle. Failure uses `exchangeA` at revision `2`. |
| `COR-007` | Cancellation retains identity | Start `exchangeA`, then cancel the same handle. Cancellation uses `exchangeA` at revision `2`. |
| `COR-008` | Handle does not alter request | Capture a request and inspect the real outbound headers/query/body. No adapter handle or ID was inserted into them. |
| `COR-009` | Handle released | Queue the terminal event and release caller references. The adapter does not retain the request/response object through a leaked handle. |
| `COR-010` | Adapter retry retains identity | Resend an unacknowledged telemetry message after reconnect. It retains its original exchange ID, message ID, and revision. |

## Lifecycle unit tests

| ID | Case | Required assertions |
| --- | --- | --- |
| `LIF-001` | Successful response | `exchange.started` revision `1` is followed by `exchange.completed` revision `2`. |
| `LIF-002` | HTTP 404/500 | Any received HTTP response, including 4xx/5xx, emits `exchange.completed`, not `exchange.failed`. |
| `LIF-003` | Transport error | No HTTP response plus connection/transport error emits `exchange.failed` with the correct failure category. |
| `LIF-004` | Cancellation | Host cancellation emits `exchange.cancelled` with the observable origin. |
| `LIF-005` | Monotonic duration | Wall clock moves backward while monotonic clock advances 40 ms. Total duration is 40 ms and never negative. |
| `LIF-006` | Unknown timing | HTTP stack does not expose DNS/TLS timing. Values are null with unavailable provenance, not zero. |
| `LIF-007` | One logical internal retry | Stack exposes only one outer callback. Emit one exchange and record only observable retry metadata. |
| `LIF-008` | Observable physical retries | Stack exposes two real attempts. Emit distinct exchange IDs related by `correlation.operationId` and retry metadata. |
| `LIF-009` | Indefinite stream | Start is emitted; no completed event is invented until the stack exposes close, cancellation, or failure. |

## Fidelity and serialization tests

| ID | Case | Required assertions |
| --- | --- | --- |
| `FID-001` | Duplicate request headers | Both `X-Trace` entries remain in original order with values `one`, `two`. |
| `FID-002` | Duplicate response headers | Both `Set-Cookie` entries remain in original order and unchanged. |
| `FID-003` | Ordered query | `region=ca`, `region=on`, then valueless `includeClosed` remain separate ordered entries. |
| `FID-004` | Complete values | Authorization, cookie, query, header, body, raw, and metadata values are not removed, masked, hashed, or replaced. |
| `FID-005` | JSON lexical preservation | Canonical JSON body text is serialized byte-for-byte; adapter does not prettify it. |
| `FID-006` | XML/SOAP lexical preservation | XML declaration, namespace prefix, whitespace, `SOAPAction`, media type, and body text remain exactly observed. |
| `FID-007` | Binary body | Bytes are encoded once as `inlineBase64`; decoding produces the original bytes. |
| `FID-008` | Empty body | Represent no body according to the schema; do not invent `{}`, empty JSON, or a content type. |
| `FID-009` | Unavailable body | Availability/provenance states unavailable and content is null; no body is consumed from a one-shot stream. |
| `FID-010` | Multibyte byte count | Captured length uses encoded byte count, not character count. |
| `FID-011` | Maximum body boundary | Exactly 1,048,576 captured bytes is accepted when the negotiated limit is canonical. |
| `FID-012` | Over-limit body | 1,048,577 bytes is reported as truncated/unavailable before sending, or rejected by the listener; it is never silently shortened while labelled exact. |
| `FID-013` | Declared length is not capture | Give the native bridge canonical response A with `Content-Length: 51`. The emitted body contains the exact canonical JSON, `availability: captured`, and observed/captured lengths `51`; a declared length plus null content or `unavailable` fails. |
| `FID-014` | Host-visible body preservation | Capture a finite body, then read it through the host client's normal API. Host bytes, media type, charset, content encoding, and ordered content headers exactly match the no-adapter control response. |
| `FID-015` | Complete request-header source | The emitted canonical request contains every canonical header in the exact listed order, including full `User-Agent`, authentication, cookie, content, API-key, arbitrary custom, and duplicate headers. Header count, names, casing, values, order, and duplicates match the host-visible input exactly. |
| `FID-016` | No header allowlist | Add `X-Unrecognized-By-Adapter: retain-me` at the final observation seam. The emitted ordered header array contains it unchanged even though the adapter has no predefined knowledge of that name. |
| `FID-017` | Replay-source fidelity | Copy the emitted canonical request header array wholesale into a Recompose input model. Header count, names, casing, values, order, and duplicates are identical; no replay prefill allowlist or special-case omission is permitted. |

Every emitted hello/message sample must pass JSON parsing, use camelCase field names, and validate against `contracts/http-inspector.v1.schema.json` where the schema covers that object. Reuse the repository's `fixtures/captures/valid-*.json` and prove that `fixtures/captures/invalid-*.json` or equivalent mutations are rejected.

## Non-interference and queue tests

### `NIF-001`: inspector I/O never delays the real request

```text
given fake transport connect and send operations never complete
when the HTTP bridge invokes its request callback
then callback continuation completes without advancing fake transport
and the real HTTP chain is invoked exactly once
```

| ID | Case | Required assertions |
| --- | --- | --- |
| `NIF-002` | Inspector unavailable | Connection throws/refuses. Host request and its original result/error are unchanged. |
| `NIF-003` | Queue capacity | Fill a queue of capacity `2`; enqueue a third item. Memory remains bounded and drop/overload count increments deterministically. |
| `NIF-004` | Heartbeat reports drops | After one local drop, next heartbeat contains cumulative `droppedCount: 1`. |
| `NIF-005` | Serialization failure | Unsupported metadata/body mapping records capture/serialization failure without replacing the host response. |
| `NIF-006` | Chain exactly once | Success, failure, and cancellation paths each advance the native HTTP handler/interceptor chain exactly once. |
| `NIF-007` | Capture recursion excluded | A request to the effective inspector host/port/path is not captured and therefore cannot recursively generate another capture. |

## Reconnect and recovery tests

### `REC-001`: reconnect retains process and exchange identity

```text
start exchangeA at revision 1
disconnect transport before terminal acknowledgement
advance fake delay through 250 ms reconnect slot
accept a new hello

assert new hello.source.instanceId == sourceInstanceId
assert new connectionId differs from prior connectionId
assert recovery snapshot.exchangeId == exchangeA
assert recovery snapshot.revision >= 3
```

| ID | Case | Required assertions |
| --- | --- | --- |
| `REC-002` | Bounded backoff | Consecutive retry delays approximate 250 ms, 500 ms, 1 s, 2 s, then at most 5 s, with injectable deterministic jitter. |
| `REC-003` | Fresh hello | Every reconnected WebSocket sends hello first and waits for acceptance before draining. |
| `REC-004` | Pinned endpoint | Explicit/environment endpoint is not silently changed after failure. |
| `REC-005` | Descriptor refresh | Descriptor-derived endpoint is re-read after listener restart/refusal and updates only when descriptor instance/port changed. Mark pending until descriptor support exists. |
| `REC-006` | Disconnect is not post-run | Transient socket loss starts reconnect; it does not uninject, delete receipts, or stop the host application. |
| `REC-007` | Ordered shutdown | `stop()` rejects new telemetry, attempts bounded flush, stops timers, closes transport, and releases queued bodies even when flush times out. |

## HTTP-stack bridge tests

Every supported bridge adds native tests for these common behaviors plus stack-specific stream/callback behavior:

| ID | Case | Required assertions |
| --- | --- | --- |
| `BRG-001` | Final supported observer position | Captured request contains authentication/cookie/serialization changes made by earlier hooks when the stack exposes that position. |
| `BRG-002` | Existing hook order | Registration adds the adapter without changing the relative order or implementation of existing hooks. |
| `BRG-003` | Original success | Bridge returns the exact native response/result from the real chain. |
| `BRG-004` | Original error | Bridge rethrows/returns the original native error and stack information after enqueueing capture. |
| `BRG-005` | Original cancellation | Bridge preserves native cancellation identity/semantics. |
| `BRG-006` | One-shot request body | When safe pre-send duplication is unavailable, the original outbound request stream remains readable by the transport and only that request body reports unavailable. |
| `BRG-007` | Finite request body | An ordinary replayable JSON/XML/form/byte-array request within the negotiated limit is captured exactly and the transport receives identical bytes and content headers. |
| `BRG-008` | Finite response body | An ordinary finite JSON response within the negotiated limit is captured exactly and remains readable by the application with identical bytes and content headers. Blanket `unavailable` mapping fails. |
| `BRG-009` | Finite binary response | A bounded binary response is emitted once as standard `inlineBase64`; the application receives the original bytes unchanged. |
| `BRG-010` | Unknown-length finite response | A chunked/unknown-length finite response reaches EOF, is captured according to the supported stack's safe pass-through/buffering seam, and remains unchanged for the application. |
| `BRG-011` | Indefinite response stream | The adapter does not eagerly drain or falsely complete an indefinite stream. Native streaming/cancellation/disposal behavior is preserved; completion is emitted only at an observable terminal point. |
| `BRG-012` | Body observation failure | A body copy/wrapper failure records an unavailable body/diagnostic without replacing the host response, changing its bytes, or surfacing an inspector exception to application code. |
| `BRG-013` | Complete native request-header surfaces | The native bridge collects every header exposed by both general request headers and content-header collections at the final supported seam. The full `User-Agent` and the canonical request's host-visible header sequence are present without a curated allowlist. |
| `BRG-014` | Transport-generated header boundary | When a documented native transport creates a header only after the final supported observation seam, the adapter does not invent it. The implementation manifest names the header and seam limitation precisely; all headers visible at the seam still pass `FID-015` and `FID-016`. |

### Mandatory .NET `HttpClient` body regression

The .NET bridge must run this with the public package registration and a real local HTTP server through `HttpClient`/`IHttpClientFactory`; a fake terminal handler alone is insufficient:

```text
server responds 200 with:
  Content-Type: application/json; charset=utf-8
  Content-Length: 51
  body: {"items":[{"id":42,"active":true}],"nextPage":null}

response = await client.GetAsync(serverUrl)
applicationBody = await response.Content.ReadAsStringAsync()
completed = await fakeCaptureTransport.read("exchange.completed")

assert applicationBody == canonicalResponseA.body.content.value
assert completed.response.body.availability == "captured"
assert completed.response.body.content.kind == "inlineText"
assert completed.response.body.content.value == applicationBody
assert completed.response.body.declaredByteLength == 51
assert completed.response.body.observedByteLength == 51
assert completed.response.body.capturedByteLength == 51
assert completed.capture.responseBody is exact or adapterReported according to the implemented observation seam
assert response.Content.Headers are byte-for-byte/value-for-value equal to a no-adapter control response
```

Add the equivalent XML/SOAP and binary cases using the same native pipeline. An implementation that merely reads `Content-Length` and sends `availability: unavailable` does not pass `BRG-008`, even if the application later consumes the body successfully.

Required platform correlation cases:

- Flutter/Dio: store a namespaced handle in request-scoped `RequestOptions.extra`, retrieve it in `onResponse`/`onError`, and avoid colliding with existing `extra` entries.
- .NET: keep the handle as a local variable around the one awaited `base.SendAsync` call; concurrent invocations retain separate locals.
- JavaScript `fetch`: keep the handle in the wrapper invocation closure; overlapping promises retain independent handles.

## Listener contract tests

Run these against an ephemeral fresh listener bound to loopback port `0`. Do not rely on a developer's long-running port `53662` process.

| ID | Case | Required assertions |
| --- | --- | --- |
| `INT-001` | Valid hello/start/completion | Listener accepts hello, acknowledges both message IDs, and stores one completed exchange at revision `2`. |
| `INT-002` | Reverse completion | Two identical starts followed by B then A completions produce two correctly associated completed exchanges. |
| `INT-003` | Source mismatch | Message `sourceInstanceId` differs from accepted hello source. Listener returns `message.error`. |
| `INT-004` | Unsupported protocol | Hello range excludes major `1`. Listener returns non-retryable `hello.error` and closes. |
| `INT-005` | Hello deadline | Send no hello for three seconds using a controllable/real bounded timeout. Listener returns `hello.timeout` and closes. |
| `INT-006` | Binary frame | Send a binary v1 frame. Listener rejects it; after three consecutive invalid/rejected frames it closes. |
| `INT-007` | Body limit | Exactly 1 MiB is accepted; 1 MiB plus one byte is rejected before hub storage. |
| `INT-008` | Disconnect recovery | Disconnect an in-flight source. Stored exchange becomes incomplete; newer recovery snapshot restores the reported terminal state. |
| `INT-009` | Native finite JSON body | Through the adapter's real supported HTTP-client bridge, call a local HTTP server returning canonical response A. The host reads the exact body; the listener stores the same exchange at revision `2` with response body `captured`, inline text equal to the server bytes, and captured/observed lengths `51`. |

The implementation may reuse the repository's listener and fixtures when developing in this workspace. A third-party adapter repository should vendor/version only the public schema and conformance fixtures needed for its release, not copy HTTP Inspector production source.

## Pre-run/post-run portability tests

These are mandatory only for an advertised automatic integration strategy. Run against newly created temporary copies, never a developer's working project.

| ID | Case | Required assertions |
| --- | --- | --- |
| `INJ-001` | Dry run | Reports detected client, strategy, package, endpoint, files, and hunks; changes zero bytes. |
| `INJ-002` | Minimal injection | Adds only package/configuration/import/central registration changes recorded in the external receipt. |
| `INJ-003` | Idempotent pre-run | Repeating the same run does not duplicate dependency, import, handler, interceptor, or marker block. |
| `INJ-004` | Clean post-run | Reverses operations in strict reverse order and restores exact original bytes/modes. |
| `INJ-005` | Developer edit conflict | Modify an injected target after pre-run. Post-run preserves the developer change and leaves `cleanupRequired` diagnostics. |
| `INJ-006` | Crash recovery | Leave an active receipt/stale lock; next invocation recovers before attempting new injection. |
| `INJ-007` | Unsupported layout | Ambiguous project receives manual instructions and no mutation. |
| `INJ-008` | Two-project portability | The same packaged adapter and strategy inject/capture/uninject in two independently named compatible fixtures without project-specific code. |
| `INJ-009` | External state | Receipts, locks, backups, integration-tool source, and adapter implementation remain outside the consuming project. |
| `INJ-010` | Surgical seam | No per-request, repository, controller, generated-client, or existing-handler method is edited when a shared hook exists. |
| `INJ-011` | Structured semantic discovery | A fixture uses multiline calls, aliases, or extension syntax. The strategy resolves the supported client/registration symbols through its project/AST/semantic API and produces one deterministic central plan. |
| `INJ-012` | Bounded textual fallback | For a strategy without a mature parser, exactly one anchored match in a pre-identified composition root may plan an edit; zero or multiple matches produce unsupported/ambiguous with no byte changes. |
| `INJ-013` | Import ownership | Missing adapter import is added once and recorded; an existing equivalent import is not duplicated; post-run removes only the owned import and preserves neighboring imports. |
| `INJ-014` | Existing superclass preserved | Fixtures contain existing `DelegatingHandler`/interceptor subclasses. Detection may report them as evidence, but apply/post-run never changes their superclass, implementation, or relative registration order. |
| `INJ-015` | Generic dispatcher fail-closed | Point the language-neutral pre-run entrypoint at an ecosystem with no installed strategy. It reports the detected/unknown ecosystem, changes zero project/state bytes, and never invokes another ecosystem's mutator. |
| `INJ-016` | Wrapper lifecycle | The generic run entrypoint injects once, exports the selected endpoint to the child, preserves the child's exit status, and invokes post-run after successful, failed, and signalled child termination where the platform permits. |
| `INJ-017` | Retry after partial cleanup | Post-run restores at least one operation before encountering a changed owned block. A later post-run/recovery recognizes already-restored pre-injection hashes, retries only unresolved operations, and never reports the restored operation as a new conflict. |
| `INJ-018` | Read-only UI inspect | `inspect.sh --json` returns runtime/client evidence, candidate choices, exact operations, endpoint, strategy, payload, and package identity while project and state-root byte trees remain identical. |
| `INJ-019` | Receipt-only catalog | `list.sh --json` reports active, cleanup-required, missing-project, missing-payload, and invalid-receipt states from external receipts without scanning a supplied source tree or accepting a frontend-provided receipt path. |
| `INJ-020` | Embedded package identity | Source/artifact build packs once; both host binaries embed the same declared `.nupkg` and SHA-256; runtime materialization reproduces those exact bytes without invoking build, pack, restore, or a remote feed. |
| `INJ-021` | Project-scoped private feed | Apply adds one marked `RestoreAdditionalProjectSources` private feed and exact `PackageReference` with `PrivateAssets="all"`; `NuGet.Config`, global/user NuGet sources, and the target repository's non-owned files remain unchanged. |
| `INJ-022` | Legacy receipt cleanup | A valid legacy direct-DLL receipt remains listable/removable after its recorded DLL is absent; safe path/marker validation still prevents cleanup outside recorded ownership. |
| `INJ-023` | Stale preview rejection | Change a preview-bound project file, endpoint, runtime/transport, or payload/package digest before apply. Apply rejects the token and changes zero bytes until a fresh preview is confirmed. |
| `INJ-024` | Hosted boundary | Disabled, static, remote, relative-path, and non-loopback/LAN modes expose no mutation operation; loopback opt-in accepts only a canonical absolute path on the service machine. Capture and replay remain operational in every unavailable mode. |
| `INJ-025` | Missing Bash isolation | Remove Bash/Git Bash from discovery. Capabilities report integration unavailable with a stable reason while capture/replay startup and use remain successful. |
| `INJ-026` | Selected solution project scope | A solution folder contains two supported application `.csproj` files, each with an independent `Startup.cs`/`Program.cs` and `AddHttpClient` registrations. Choosing either project produces a ready preview scoped to that project's directory, never reports the sibling root as ambiguous, and permits two independent receipt-backed apply/remove cycles with exact restoration. |

## Minimum per-adapter test manifest

Each adapter release must include a machine-readable or Markdown manifest mapping every applicable ID to its native test name and result:

```text
adapter: <package name and version>
runtime: <language/runtime versions>
httpClient: <client and supported versions>
transportProfiles: [websocket-v1]
spec: http_inspector_adapter.spec.md 1.11.0
tddSpec: http_inspector_adapter_tdd.spec.md 1.5.0

CFG-001 -> ConfigTests.explicit_endpoint_wins -> pass
HSK-001 -> HandshakeTests.hello_is_first -> pass
COR-002 -> CorrelationTests.identical_requests_complete_in_reverse_order -> pass
...

unsupportedCapabilities:
  <test ID> -> <native limitation and emitted unavailable behavior>

pendingProductDependencies:
  CFG-003 -> listener-endpoint-descriptor
  REC-005 -> listener-endpoint-descriptor
```

An omitted applicable test is a failure, not an implicit pass. A capability may be unsupported only when the target stack truly cannot expose it and the adapter reports the limitation honestly; correlation, non-interference, value preservation, protocol serialization, and cleanup ownership rules are never optional. Ordinary finite bodies are not an unsupported capability for a client stack that exposes bounded buffering, cloning, replayable content, or a pass-through/tee seam. A package must not claim body compatibility by testing only its protocol serializer with already-materialized `CapturedBody` values while its native HTTP bridge always emits `unavailable`.

## Definition of done

An adapter is ready to advertise compatibility only when:

- All applicable `UNIT` tests pass without a real inspector process, real network, or real-time sleeps.
- All emitted protocol samples pass the `CONTRACT` schema/fixture checks.
- All `websocket-v1` `INTEGRATION` tests pass against an ephemeral fresh listener.
- The native HTTP-client bridge passes finite JSON, XML/SOAP, and binary body tests that assert both emitted capture content and unchanged host consumption; serializer-only body tests are insufficient.
- Every advertised automatic strategy passes `PORTABILITY` tests against two independent fixture projects.
- The test manifest maps every applicable ID to evidence and documents genuinely unsupported observability.
- No test proves success merely with `returnsNormally`, a non-null result, or a snapshot lacking field-level assertions.
- Host HTTP behavior remains unchanged when the inspector is unavailable, slow, rejecting messages, or disconnected.

## Canonical repository references

- Adapter behavior: `http_inspector_adapter.spec.md`
- Machine-readable schema: `contracts/http-inspector.v1.schema.json`
- Valid exchange fixtures: `fixtures/captures/valid-*.json`
- Invalid exchange fixtures: `fixtures/captures/invalid-*.json`
- Reference Rust model tests: `crates/inspector-core/tests/contract_conformance.rs`
- Reference receiver: `crates/inspector-server/src/ingress/capture_socket.rs`

If the wire contract or adapter behavior changes, update the schema/fixtures, main adapter specification, this TDD specification, and affected conformance tests in the same change.

## .NET multi-client critical verification

The .NET `1.3.2` package adds four observation paths. Keep this focused suite alongside the existing lifecycle and fidelity tests; do not create broad project-specific unit suites merely to prove registration.

| ID | Case | Required assertions |
| --- | --- | --- |
| `DMC-001` | Global factory registration | One `AddHttpInspectorAdapter()` registration observes both an ordinary named/typed `HttpClient` and a Refit-created client without per-client calls. Existing handlers retain their order and the resulting `captureBridge` is `httpClientFactory`. |
| `DMC-002` | Diagnostic direct-client capture | A real direct `new HttpClient()` request to an ephemeral local server produces exactly one started/terminal exchange with `captureBridge: systemNetHttpDiagnostic`. |
| `DMC-003` | Diagnostic RestSharp capture | A real direct RestSharp request to an ephemeral local server produces exactly one started/terminal exchange with `captureBridge: systemNetHttpDiagnostic`. |
| `DMC-004` | Factory/diagnostic deduplication | Run a factory-created client while the diagnostic subscriber is active. The private request marker yields exactly one exchange, never a factory and diagnostic duplicate. |
| `DMC-005` | WCF attach lifecycle | Attaching the generated `ClientBase<T>` while created is idempotent. Attach after the client is opened, closed, or faulted fails before channel state is changed. |
| `DMC-006` | Non-HTTP SOAP fidelity | A bounded message-inspector request/reply copy retains logical XML and SOAP action, reports `wcfMessageInspector`, and labels replay unsupported. An unavailable real non-HTTP endpoint is an explicit live-verification boundary, not a fabricated integration pass. |
| `DMC-007` | v4 integration safety | A disposable selected host is dry-run byte-stable, receives only the marked package/feed/import/service-registration hunks on Apply, restores byte-for-byte on Remove, and remains visible to `list.sh` while receipt `4.0.0` is active. |

`DMC-001` through `DMC-005` are the minimum critical native tests for the current package. `DMC-006` and a live HTTP WCF request remain required before declaring non-HTTP WCF support fully proven. `DMC-007` is a command-level disposable-fixture smoke, not a reason to add a target-project test framework.
