# Dataverse batch request-body capture remediation plan

## Implementation status

Implemented in bundled adapter `1.4.11`.

- The factory handler now observes request bytes during the actual outbound serialization instead of pre-reading only a type whitelist.
- One-shot streams and custom batch content are covered by regression tests; the request is written once and the same bytes are captured.
- Response capture remains unchanged and is verified by the existing response-body suite.
- The portable Windows executable was rebuilt with this package embedded.

## Finding

The supplied exchange is a completed `POST` to the Dataverse `$batch` endpoint. The server returned `200 OK` in about 12.9 seconds and the inspector captured the 1,800-byte `multipart/mixed` response exactly. The missing information is specifically the **request body**:

- `capture.requestBody`: `unavailable`
- `request.body.availability`: `unavailable`
- request media type: `application/json`
- capture bridge: `httpClientFactory`
- adapter version: `1.4.7`

This is not caused by a response-size limit or a failed request. The response is complete. It is also not a database-result-capture issue.

The pasted copy is missing its opening `{`, so it is not valid JSON as pasted. Adding that one character makes the envelope parse, and its capture fields are internally consistent. The application export code itself uses `JSON.stringify`; this looks like a copy/paste artifact, but it should be covered by an export round-trip test.

## Root cause

`HttpInspectorHandler` captures a request body before sending the request. Its current helper (`HttpContentObservation.CaptureReplayableRequestAsync`) only reads `ByteArrayContent`, `StringContent`, and `JsonContent`. Any other `HttpContent` is deliberately marked unavailable so the adapter cannot consume a one-shot stream or change the application's request semantics.

The exchange was captured by that handler, not by the diagnostic fallback bridge. Dataverse batch clients commonly use custom or streaming `HttpContent`, so they fall outside the replayable whitelist. The body reaches Dataverse successfully, but the inspector never observes the bytes that were actually sent.

Increasing the body-size limit will not resolve this case: the body was not rejected for size; it was never safely observed.

## Fix approach

Capture the content while .NET serializes it for the real outbound request, rather than trying to pre-read it.

1. Add a request-capture operation in `adapters/dotnet/HttpInspector.Adapter/HttpClientBridge.cs` that wraps a non-empty `HttpRequestMessage.Content` with the existing observation wrapper before calling the next handler.
2. Have the wrapper tee the bytes written to the real transport into a bounded in-memory capture buffer. It must never read the content separately, rewind it, or replace its headers.
3. Preserve the request's original timestamp and correlation context. Start the inspector exchange once the wrapper has a terminal request-body result, then complete or fail that same exchange when the response/exception arrives.
4. If a handler returns or fails without serializing content, create the exchange with an explicit unavailable body instead of dropping the exchange. This keeps the current honest-fidelity behavior.
5. Keep the System.Net diagnostic bridge excluded for marked `HttpClientFactory` requests, so the new wrapper does not create a duplicate capture.
6. Retain the negotiated maximum-body limit. If the actual outgoing body exceeds it, record `unavailable` (or a future explicit truncated state) without interrupting the application request.

## Tests before implementation

Create failing regression tests first in `adapters/dotnet/HttpInspector.Adapter.Tests`:

1. A custom, non-replayable `HttpContent` whose bytes can only be written once. Verify that the application receives the exact bytes and the inspector captures the same bytes.
2. A `StreamContent`/one-shot stream request. Verify no additional read occurs and that capture comes from the actual transport write.
3. A Dataverse-style multipart batch request. Verify that the request body is captured, remains `multipart/mixed` when that is the real media type, and the response remains unchanged.
4. An oversized streaming request. Verify the request still succeeds, while capture reports the configured unavailable/truncated outcome.
5. A serialization failure and cancellation. Verify original exceptions/cancellation behavior is unchanged and exactly one terminal exchange is emitted.
6. Existing `StringContent`, `ByteArrayContent`, JSON, response capture, and direct-`HttpClient` diagnostic tests. Verify no duplicate exchanges and no regressions.
7. Export a completed exchange, parse it with `parseExchangeImport`, and verify the JSON envelope begins with `{` and round-trips unchanged.

## Implementation and verification sequence

1. Add the failing tests above and confirm the current adapter fails the custom-content and stream-capture cases.
2. Implement the transport-write tee and deferred request-start handling.
3. Run the focused adapter test suite, then the full .NET adapter suite and the Rust/TypeScript contract tests affected by capture revisions.
4. Bump the adapter package version, build one fresh NuGet package, and rebuild the Windows application.
5. Use the Project Integrations UI to update the target project. Confirm the UI reports the new adapter version before testing.
6. Run the same Dataverse `$batch` action. Confirm all of the following in the exported exchange:
   - request body availability is `captured` (or an explicit size-limit state only when it truly exceeds the limit);
   - captured request bytes match the outbound batch payload;
   - response remains `captured` and unchanged;
   - exactly one exchange exists for the action;
   - the application response is still `200 OK` and unchanged.

## Rollout safeguard

Do not remove the unavailable fallback. Some request content cannot be fully observed because the transport never serializes it, it is cancelled, or it exceeds the configured safe capture limit. The new behavior should capture more request bodies without ever pretending that unavailable data was captured.
