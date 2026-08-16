# Temporary .NET adapter integration

This directory belongs to the existing `HttpInspector.Adapter` family. Its integration engine is implemented entirely in Bash; it contains no integration `.csproj`, C# executable, Node.js tool, or Python tool. The adapter's `.nupkg` is created once by the HTTP Inspector distribution build and is never built, packed, or restored by these runtime scripts.

```sh
./adapters/dotnet/HttpInspector.Adapter.Integration/pre-run.sh --project /absolute/path/to/project --dry-run
./adapters/dotnet/HttpInspector.Adapter.Integration/pre-run.sh --project /absolute/path/to/project
./adapters/dotnet/HttpInspector.Adapter.Integration/run-with-http-inspector.sh --project /absolute/path/to/project -- dotnet run
./adapters/dotnet/HttpInspector.Adapter.Integration/status.sh --project /absolute/path/to/project
./adapters/dotnet/HttpInspector.Adapter.Integration/inspect.sh --project /absolute/path/to/project --json
./adapters/dotnet/HttpInspector.Adapter.Integration/list.sh --json
./adapters/dotnet/HttpInspector.Adapter.Integration/post-run.sh --project /absolute/path/to/project
./adapters/dotnet/HttpInspector.Adapter.Integration/recover.sh --project /absolute/path/to/project
```

The wrapper's command after `--` is the developer's normal project command. The integration engine itself never invokes `dotnet` or NuGet. macOS uses its installed Bash. Windows uses Git Bash, which is an explicit prerequisite for these `.sh` entrypoints.

## Supported project seam

The `dotnet-multiclient-nuget-bash-v4` strategy intentionally supports a narrow layout:

- one selected `net10.0` SDK-style `.csproj`;
- one conventional `Program.cs` or `Startup.cs` containing one unambiguous `services.Add...` or `builder.Services.Add...` registration;
- no existing HTTP Inspector reference, registration, or ownership marker;
- no ambiguous composition roots or C# raw string literal in the selected composition file.

`--project` may point at a repository or solution folder. If it contains more than one `.csproj`, use `--project-file` to choose the application project. After that choice, composition-root discovery, the external receipt key, locking, artifact cleanup, and the catalog entry are scoped to the chosen `.csproj` directory—not the surrounding solution. Two application projects in the same solution can therefore be integrated and removed independently. A project is still rejected only when *its own* directory has multiple supported composition roots.

The standalone application and hosted-local service first hash-verify and export the exact embedded `.nupkg` to a versioned private feed under HTTP Inspector's application-data directory. Pre-run adds a marked project-scoped `RestoreAdditionalProjectSources` value, an exact `PackageReference` with `PrivateAssets="all"`, a marked `using HttpInspector.Adapter`, and one marked `.AddHttpInspectorAdapter()` service registration. That one host registration covers `IHttpClientFactory` clients and Refit through a final handler-builder filter, plus direct `HttpClient` and RestSharp through a process-wide `System.Net.Http` diagnostic bridge. It does not edit `NuGet.Config`, register a global/user NuGet source, copy tooling or package bytes into the consuming project, edit individual requests, replace existing handlers, invoke the target build, or contact a remote package feed.

HTTP/HTTPS WCF is observed through the underlying HTTP bridge where its runtime exposes `System.Net.Http` diagnostics. The package also provides `HttpInspectorWcf.Attach(client, adapter)` for generated `ClientBase<T>` clients: attach before opening the client, only once, and use it for non-HTTP WCF bindings that require buffered logical SOAP capture. The current v4 script inventories WCF sites but deliberately does not inject `Attach` calls automatically; generated client construction shapes vary too widely for a safe textual mutation. The preview marks these sites as requiring manual review rather than claiming full automatic coverage.

The default capture endpoint is `ws://127.0.0.1:53662/v1/capture`. `run-with-http-inspector.sh` exports the selected endpoint as `HTTP_INSPECTOR_WS` before it executes the developer's command.

## Bundled ownership and cleanup

The adapter source, prebuilt NuGet package, Bash integration scripts, and raw insertion templates remain together under `adapters/dotnet/HttpInspector.*` at source-build time. The shared Rust integration crate embeds their exact bytes into both the Tauri and hosted-service binaries. Runtime materialization writes only to application-owned data outside the consuming project. The `.app` or portable `.exe` therefore needs no adjacent adapter folder.

Runtime receipts and exact backups are stored outside the consuming project under the operating system's HTTP Inspector state directory. Post-run restores exact backups when injected files are unchanged. When unrelated developer edits exist, it removes only unchanged ownership blocks. If an owned block was changed or became ambiguous, it preserves the developer file and retains a `cleanupRequired` receipt.

Use `run-with-http-inspector.sh` when possible so cleanup runs after the developer command exits. After a forced shutdown, `recover.sh` or the next `pre-run.sh` uses the external active receipt to restore the project.

Receipt version `4.0.0` records the adapter, strategy, protocol, embedded payload digest, exact package ID/version/file/digest, and private feed. `list.sh` and cleanup remain compatible with `3.0.0` package receipts and legacy `2.1.0` direct-DLL receipts. Missing legacy payload bytes never prevent safe removal because cleanup validates recorded paths and owned blocks rather than requiring the old DLL to exist.

The application UI uses `inspect.sh --json` for a read-only preview, including explicit `.csproj` choices when a folder contains more than one project. It displays the selected application's project directory after that choice, while retaining the original solution/repository selection only to resolve the relative project-file path at apply time. `pre-run.sh`, `post-run.sh`, `recover.sh`, `status.sh`, and `list.sh` expose structured JSON for the shared Rust service; their human CLI modes remain available for manual use.

Integration unit tests and integration fixtures are intentionally not included in this folder. Verification for this migration is performed manually against the real C# example project.
