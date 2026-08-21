# HTTP Inspector

HTTP Inspector is a Tauri desktop application for viewing HTTP traffic emitted by in-process adapters. It is an observation tool: adapters report requests and responses that their host application has already made; the inspector is not an HTTP proxy and does not alter that traffic.

## Build an adapter or plugin

An adapter can be written for Flutter, C#, Node.js, or any platform that can open a WebSocket and serialize JSON. The canonical API is the generated [v1 JSON Schema](contracts/http-inspector.v1.schema.json); the UI's generated TypeScript projection is [src/generated/contracts.ts](src/generated/contracts.ts). Use them as the field-level contract.

For a self-contained specification that can be handed directly to a coding agent in another repository, use [http_inspector_adapter.spec.md](http_inspector_adapter.spec.md). It defines reusable externally owned adapter packages by runtime/client stack, recommended package/tool folder boundaries, the minimal consuming-project footprint, external receipt/backup storage, the required adapter API, connection state machine, ports, exact message shapes, lifecycle semantics, replay boundary, retry behavior, surgical language-specific interception seams with good/bad Flutter and C# examples, universal capability-based pre-run/post-run injection, crash recovery, and completion checklist.

Use [http_inspector_adapter_tdd.spec.md](http_inspector_adapter_tdd.spec.md) alongside it. The TDD companion supplies deterministic IDs, requests, responses, fake transport/clock boundaries, dependency-ordered pseudocode tests, and named happy-path, unhappy-path, edge, concurrency, reconnect, fidelity, listener, and pre-run/post-run cases. An implementation must translate every applicable test ID into its native test framework and publish the ID-to-test result manifest defined there.

For temporary .NET project integration, open **Integrations** in the application toolbar or use the Bash scripts documented in [adapters/dotnet/HttpInspector.Adapter.Integration/README.md](adapters/dotnet/HttpInspector.Adapter.Integration/README.md). The distribution build packs the adapter once; the runtime exports the exact embedded `.nupkg` to an application-owned private feed and adds reversible project-scoped source/package edits without invoking `dotnet`, NuGet, Node.js, Python, or a C# integration executable. Unsupported projects stop without mutation.

The bundled .NET `1.4.0` adapter registers once at the host service seam. Its global factory filter observes `IHttpClientFactory` and Refit clients after application handlers; its diagnostic fallback observes direct `HttpClient` and RestSharp without request-method edits. HTTP WCF is covered when the runtime emits `System.Net.Http` diagnostics. Generated non-HTTP WCF clients are intentionally shown as manual-review sites because they require an explicit pre-open `HttpInspectorWcf.Attach(client, adapter)` call for logical SOAP capture; the integration tool does not rewrite generated-client construction automatically. It also observes `Microsoft.Data.SqlClient` commands without changing repository or query call sites.

### Build and run the desktop app

On macOS, build the standalone Tauri application with:

```sh
./build_app.sh
```

Then launch the compiled application with:

```sh
./run_app.sh
```

Build the portable Windows executable with:

```sh
./build_windows_portable.sh
```

`build_app.sh` stages the macOS app at `releases/macos/HTTP Inspector.app`. Build the portable Windows executable—on Windows or cross-compiled from macOS—with `./build_windows_portable.sh`; it stages the result at `releases/windows/HTTP-Inspector-windows-x64-portable.exe`. The Windows script runs Tauri's production build command rather than Cargo directly, so the executable embeds the frontend and never requires the Vite development URL. The `target/` directory is internal build output, not a distribution location. The adapter package, Bash lifecycle, manifest, and templates are linked inside the application binary and are hash-verified into application data only when integration is used; no companion adapter folder is required. Windows project integration requires Git Bash, while capture and replay remain available without it.

Building the distribution from source requires the .NET 10 SDK plus `zip` and `unzip` so the adapter package can be packed, normalized, and checked against the release digest in `adapter.json`. Those are packaging-machine prerequisites only; the finished application never invokes them while integrating or removing a project.

On Windows, the standalone application automatically checks the standard system-wide and per-user Git locations, including `%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe`. If it cannot find Git Bash, **Integrations** shows **Choose Git Bash…**. Select either Git's `git-bash.exe` launcher or its `bin\\bash.exe`; the application resolves and verifies the real Bash executable, stores that application-only preference, and uses it only for the reversible integration scripts. Native folder-picker paths—including Windows extended-length `\\?\\` paths—are translated to Git Bash paths for the lifecycle scripts and translated back before the host reads files, stores receipts, or presents results.

The standalone app exposes project integration through typed native commands and a native folder chooser. Browser development can expose the same feature only from an explicitly enabled loopback service:

```sh
HTTP_INSPECTOR_PROJECT_INTEGRATION=local pnpm dev
# or: cargo run -p inspector-server --bin inspector-dev-server -- --project-integration local
```

Hosted-local mode uses an absolute path on the service machine. Static hosting, disabled services, and non-loopback/LAN listeners do not register mutation routes; their capture and replay routes continue to work.

If the build script reports that pnpm is unavailable, enable the package manager shipped with Node.js (`corepack enable pnpm`) or install pnpm with Homebrew (`brew install pnpm`).

### Transport and discovery

Connect to:

```
ws://<inspector-host>:<port>/v1/capture
```

For hosted development, the listener is `ws://127.0.0.1:53662/v1/capture` by default. Set `HTTP_INSPECTOR_PORT` before `pnpm dev:service` to use another loopback port. `GET http://127.0.0.1:<port>/api/status` returns local service status.

The standalone Tauri app exposes its listener controls in the status bar. Choose a port, then use Start or Restart without relaunching the app; Stop leaves the inspector window open so it can be started again later. Port `0` selects an available port automatically. Loopback mode displays the direct capture endpoint. LAN mode binds `0.0.0.0`; configure adapters with this computer's LAN IP and the displayed port.

The currently implemented adapter transport is `websocket-v1`. Same-machine native and server processes can use loopback directly. An Android Emulator uses `10.0.2.2` to reach the development machine; physical devices, VMs, and containers need a reachable host/LAN address. Browser capture can additionally be blocked by `connect-src`, and an HTTPS page cannot rely on an insecure `ws://` listener. The adapter specification defines these environment rules and marks same-origin relay and HTTP batch profiles as deferred rather than available.

### Connection sequence

1. Create one WebSocket for the emitting adapter process.
2. Within three seconds, send a `ClientHello` as the first **text** message.
3. Wait for `hello.accepted` before emitting captures.
4. Send text JSON only. Binary frames are rejected in v1.
5. Respect the negotiated limits in `hello.accepted`.
6. Reconnect after a close. Correct configuration before retrying a `hello.error` whose `retryable` is `false`.

The initial message has no `type` discriminator:

```json
{
  "schemaVersion": { "major": 1, "minor": 0 },
  "supportedProtocol": {
    "minimum": { "major": 1, "minor": 0 },
    "maximum": { "major": 1, "minor": 0 }
  },
  "source": {
    "instanceId": "a-stable-uuid-per-running-process",
    "applicationName": "My Flutter app",
    "serviceName": "mobile-client",
    "platform": "flutter",
    "adapterName": "my-http-inspector-adapter",
    "adapterVersion": "1.0.0",
    "protocolVersion": { "major": 1, "minor": 0 },
    "environment": "development",
    "deviceName": null,
    "processId": null,
    "buildVersion": null,
    "baseUrl": null,
    "metadata": {}
  }
}
```

Successful negotiation returns:

```json
{
  "type": "hello.accepted",
  "value": {
    "schemaVersion": { "major": 1, "minor": 0 },
    "connectionId": "server-generated-uuid",
    "sessionId": "server-generated-uuid",
    "maximumMessageBytes": 4194304,
    "maximumBodyBytes": 1048576
  }
}
```

`hello.error` returns `value.code`, `value.message`, and `value.retryable` when the initial message is malformed, late, or incompatible with the supported protocol.

### Limits and fidelity

| Limit | Default | Meaning |
| --- | ---: | --- |
| `maximumMessageBytes` | 4 MiB | Maximum serialized WebSocket text message. |
| `maximumBodyBytes` | 1 MiB | Maximum inline request body, response body, request raw, or response raw. |
| Ingress queue | 512 messages | Full queues close the source rather than growing without limit. |

The inspector rejects malformed or over-limit messages. It preserves every accepted header, query, metadata value, body, and raw value without masking, truncating, or rewriting it. When a value is unavailable or incomplete, set the appropriate availability and fidelity fields instead of changing the captured value.

## Capture lifecycle

Every post-handshake message includes `schemaVersion`, a unique UUID `messageId`, `sourceInstanceId`, a positive `revision`, and ISO-8601 `sentAt`.

| Message | Use | Important payload |
| --- | --- | --- |
| `exchange.started` | Request interception | `request`, request timing, `tags`, `correlation`, `metadata` |
| `exchange.completed` | Normal completion | `response`, final timing, `sizes`, `capture`, optional `metadataPatch` |
| `exchange.failed` | Error completion | `failure`, optional `response`, final timing, `sizes`, `capture` |
| `exchange.cancelled` | Cancellation | `origin`, final timing, `sizes`, `capture` |
| `exchange.snapshot` | Complete exchange already available | full `exchange` |
| `heartbeat` | Optional adapter health | `queuedCount`, cumulative `droppedCount` |

Use the same `exchangeId` for the lifecycle of one request and increment `revision` for each change. A normal interceptor should send `exchange.started` and one terminal message. The server replies with `message.accepted` or `message.error`; three consecutive message errors close the source.

### How a pending request finds its response

The WebSocket does not match requests and responses by order. Before the real request is sent, the adapter creates an `exchangeId` and keeps it in request-scoped handle state. It sends `exchange.started` revision `1`, which creates the in-flight UI row. The response/error callback receives that same handle and sends a terminal message with the same `exchangeId` at revision `2`; the inspector updates the existing row in place.

`messageId` has a different job: it matches one telemetry frame to its server acknowledgement. It must never be used as the HTTP request/response identifier. URL/method matching, a global last-request variable, and FIFO matching are also invalid because concurrent identical requests can complete in reverse order. The full adapter spec includes the required Dio, .NET, JavaScript, retry, reconnect, and concurrency behavior.

### Exchange requirements

- Use UUIDs for `id`, `sessionId`, `source.instanceId`, `exchangeId`, and `messageId`.
- Keep duplicate headers and their original order: `headers: [{ name, value, provenance }]`. Do not convert them to a map.
- Keep query values ordered in `query: [{ name, value, provenance }]`.
- Use `null` for unavailable addresses, timings, sizes, or protocol values. Do not invent them.
- Use positive `arrivalSequence` and `revision` values; ensure `sizes.total.bytes` is at least the known message-part total.
- Responses must have a status between 100 and 599. Failed exchanges require `failure`.
- Metadata must be JSON values and within the generated schema/model bounds.

### Bodies and raw HTTP text

```json
{
  "availability": "captured",
  "mediaType": "application/json",
  "charset": "utf-8",
  "contentEncoding": null,
  "declaredByteLength": 53,
  "observedByteLength": 53,
  "capturedByteLength": 53,
  "sha256": null,
  "content": { "kind": "inlineText", "value": "{\"page\":1}" },
  "truncationReason": null
}
```

Use `inlineText` for UTF-8 and `inlineBase64` for binary data. If capture is incomplete, retain the exact captured prefix, set `availability` to `truncated`, and explain why with `truncationReason`. Mark raw content `exact` only when it came directly from the HTTP stack; use `reconstructed` or `unavailable` otherwise.

`attachmentRef` exists in the schema, but external attachment storage/read-back is not finished end-to-end. Third-party adapters should currently send inline content within the negotiated size or state that it was omitted, truncated, or unavailable.

## Runnable Node.js smoke adapter

This verifies a local development listener using the checked-in valid fixture. Run it with Node 22+ after starting `pnpm dev:service`.

```js
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const endpoint = process.env.HTTP_INSPECTOR_WS ?? "ws://127.0.0.1:53662/v1/capture";

const exchange = JSON.parse(await readFile("fixtures/captures/valid-completed.json", "utf8"));
const socket = new WebSocket(endpoint);
const nextMessage = () => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Inspector reply timed out.")), 3000);
  socket.addEventListener("message", (event) => {
    clearTimeout(timeout);
    resolve(JSON.parse(event.data));
  }, { once: true });
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

socket.send(JSON.stringify({
  schemaVersion: { major: 1, minor: 0 },
  supportedProtocol: { minimum: { major: 1, minor: 0 }, maximum: { major: 1, minor: 0 } },
  source: exchange.source,
}));

const hello = await nextMessage();
if (hello.type !== "hello.accepted") throw new Error(`Inspector rejected hello: ${hello.value.message}`);

socket.send(JSON.stringify({
  type: "exchange.snapshot",
  schemaVersion: { major: 1, minor: 0 },
  messageId: randomUUID(),
  exchangeId: exchange.id,
  sourceInstanceId: exchange.source.instanceId,
  revision: exchange.revision,
  sentAt: exchange.lifecycle.lastUpdatedAt,
  exchange,
}));

const result = await nextMessage();
if (result.type !== "message.accepted") throw new Error(`Capture was rejected: ${result.error.message}`);
console.log(`Capture accepted: ${result.messageId}`);
socket.close();
```

Production adapters should keep the connection and a bounded local send queue outside individual interceptor calls, so network capture never adds request latency to the host application.

## Adapter checklist

- [ ] Generate one `source.instanceId` per process run.
- [ ] Discover the local endpoint from the hosted configuration or standalone listener controls.
- [ ] Complete `ClientHello` before sending capture telemetry.
- [ ] Allocate UUID exchange/message IDs and increment revisions.
- [ ] Retain each request's `ExchangeHandle` in request-scoped state and use the same `exchangeId` for its terminal event.
- [ ] Prove two identical concurrent requests can complete in reverse order without cross-association.
- [ ] Implement the applicable `http_inspector_adapter_tdd.spec.md` cases before production behavior and publish the test manifest.
- [ ] Preserve source values exactly and report completeness/fidelity honestly.
- [ ] Respect negotiated limits and report local drops through `heartbeat`.
- [ ] Handle `message.error` and reconnect on transport loss.
- [ ] Validate development output against the committed schema before publishing the adapter.

## What is still left

- Add bounded/coalesced native Tauri channel recovery and smoke-test the native app at runtime.
- Implement 512 MiB body retention and attachment-backed body storage.
- Write an atomic standalone-listener descriptor so adapters can follow an automatically selected port without scanning.
- Implement a same-origin relay before advertising capture from HTTPS browser/Flutter Web applications; add HTTP batch ingestion only if short-lived or WebSocket-restricted runtimes are brought into scope.
- Verify real column drag persistence, 25,000-exchange performance, the remaining manual matrix, and installed-app behavior.
- Build and smoke-test Windows and Linux artifacts manually on their matching hosts before distribution; this repository intentionally has no release CI workflow.

The full implementation checklist is [http_inspector_implementation_plan.md](http_inspector_implementation_plan.md).
