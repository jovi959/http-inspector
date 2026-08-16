# HttpInspector.Adapter

`HttpInspector.Adapter` is a reusable .NET 10 package for observing outbound `IHttpClientFactory` pipelines with one final `DelegatingHandler`. It implements HTTP Inspector capture protocol v1 over `websocket-v1` and is compatible with `Microsoft.Extensions.Http` 10.x.

The package owns protocol serialization, a bounded asynchronous queue, acknowledgement tracking by `messageId`, reconnect/recovery, heartbeat, lifecycle handling, and the `HttpInspectorHandler` bridge. It has no dependency on a consuming application's code, endpoints, models, or DI composition root.

## Manual permanent registration

Install the package, then append it after existing outbound handlers:

```csharp
services.AddHttpClient<BackendClient>()
    .AddHttpMessageHandler<AuthHandler>()
    .AddHttpMessageHandler<CorrelationHandler>()
    .AddHttpInspectorAdapter(options => options.Endpoint = configuration["HttpInspector:Endpoint"]);
```

`AddHttpInspectorAdapter` registers the singleton adapter, its hosted lifecycle service, and the transient `HttpInspectorHandler`. Existing handlers retain their order; the inspector handler is the final supported observer before the primary transport.

Endpoint resolution is explicit `options.Endpoint`, then `HTTP_INSPECTOR_WS`, then the development fallback `ws://127.0.0.1:53662/v1/capture`. Only `websocket-v1` is supported. The endpoint must include an explicit port and `/v1/capture` path.

## Behavior and limits

- One process-stable source ID, one exchange ID per observed request, and a distinct message ID for each telemetry frame.
- The handler keeps the exchange handle in its local `SendAsync` invocation; concurrent identical requests never use URL/FIFO/global-last-request correlation.
- The handler invokes `base.SendAsync` exactly once and returns/rethrows the original response, error, or cancellation unchanged. Inspector work runs independently of the application request.
- Every header exposed at the final handler seam through `HttpRequestMessage.Headers`, `HttpRequestMessage.Content.Headers`, `HttpResponseMessage.Headers`, or `HttpResponseMessage.Content.Headers` is emitted without an allowlist. This includes the full `User-Agent`, host when explicitly exposed, authorization, proxy authorization, cookies, every response cookie, content/accept headers, SOAP action, tracing/correlation values, API-key headers, and arbitrary custom headers.
- Header names and values are emitted in the order and casing exposed by .NET. Multi-value and duplicate headers remain separate ordered entries; they are not masked, normalized, combined, or rewritten. The complete captured request-header array is therefore available to prefill Recompose. The inspector endpoint itself is excluded from capture.
- Replayable `StringContent`, `ByteArrayContent`, form content, and `JsonContent` request bodies are captured within the listener-negotiated body limit. One-shot request streams are not consumed and are reported as unavailable.
- Response content is observed through a bounded pass-through wrapper. Finite JSON, XML/SOAP, text, and binary bodies complete after the declared byte length or EOF while the application receives the same bytes and content headers. Unknown-length and indefinite responses are never eagerly drained.
- A response that exceeds the negotiated limit, fails during its native read, or is disposed before a complete body is observed reports unavailable content. The original body bytes, exception, cancellation, and disposal behavior remain application-owned.
- Textual bodies retain their lexical text and charset. Binary or content-encoded bytes use one standard Base64 encoding. The adapter performs no masking or redaction of headers, query values, cookies, tokens, or bodies.
- `HttpClient` still does not safely expose raw wire bytes, DNS/connect/TLS phases, addresses, every custom request-content implementation, or headers generated only inside the primary transport after the final `DelegatingHandler`. For example, a transport-generated `Host`, `Content-Length`, or transfer-encoding header cannot be claimed as captured when it was absent from both native header collections at the observation seam. Those unavailable fields are documented rather than invented; all headers visible at the seam are captured.

## Temporary development integration

The .NET adapter bundle includes reversible Bash entrypoints in the adjacent `adapters/dotnet/HttpInspector.Adapter.Integration/` directory. The distribution build creates the versioned `.nupkg` once and embeds it with the Bash assets into the standalone and hosted-service binaries. At runtime the strategy exports those exact bytes to an application-owned private local feed, detects a supported `net10.0` SDK project with central `AddHttpClient` registration, and adds only a project-scoped local-feed property, exact private package reference, import, and final `.AddHttpInspectorAdapter()` chain call. The runtime integration engine does not invoke `dotnet`, NuGet, Node.js, Python, or a C# integration executable and does not change global/user NuGet configuration.

```sh
./adapters/dotnet/HttpInspector.Adapter.Integration/pre-run.sh --project /absolute/path/to/project --dry-run
./adapters/dotnet/HttpInspector.Adapter.Integration/run-with-http-inspector.sh --project /absolute/path/to/project -- dotnet run
./adapters/dotnet/HttpInspector.Adapter.Integration/post-run.sh --project /absolute/path/to/project
```

The integration receipt, exact backups, lock, adapter source, and integration engine remain outside the consuming project. Cleanup restores exact unchanged files, removes exact owned blocks around unrelated developer edits, and retains a conflict receipt rather than overwriting a changed owned block. See the adjacent integration README for supported layouts, recovery/status commands, and limitations. Unsupported projects are not modified.

## Disable or remove

Remove the final `.AddHttpInspectorAdapter(...)` handler-chain call to stop capture while keeping the package installed. To remove it completely, also remove the `HttpInspector.Adapter` package reference and optional `HttpInspector:Endpoint` configuration. No business methods, controllers, repositories, or existing handlers need to be restored because the package does not modify them.
