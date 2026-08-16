using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

[CollectionDefinition("HTTP Inspector listener", DisableParallelization = true)]
public sealed class HttpInspectorListenerCollection;

[Collection("HTTP Inspector listener")]
public sealed class ListenerContractTests
{
    [Fact]
    public async Task INT_001_valid_hello_start_and_completion_are_acknowledged_and_stored_as_one_completed_exchange()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(listener.CaptureEndpoint.ToString()));
        adapter.Start();
        await listener.WaitForStatusAsync(status => status["connectedSources"]!.GetValue<int>() == 1);
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handle, TestValues.ResponseA());
        await listener.WaitForStatusAsync(status => status["exchangeCount"]!.GetValue<int>() == 1);

        var exchange = await listener.ExchangeAsync(adapter.SourceInstanceId, handle.ExchangeId);

        Assert.Equal("completed", exchange["lifecycle"]!["state"]!.GetValue<string>());
        Assert.Equal(2L, exchange["revision"]!.GetValue<long>());
    }

    [Fact]
    public async Task INT_002_identical_requests_completed_in_reverse_order_remain_two_distinct_exchanges()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(listener.CaptureEndpoint.ToString()));
        adapter.Start();
        await listener.WaitForStatusAsync(status => status["connectedSources"]!.GetValue<int>() == 1);
        var first = adapter.CaptureStarted(TestValues.RequestA());
        var second = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(second, TestValues.ResponseA());
        adapter.CaptureCompleted(first, TestValues.ResponseA());
        await listener.WaitForStatusAsync(status => status["exchangeCount"]!.GetValue<int>() == 2);

        var firstExchange = await listener.ExchangeAsync(adapter.SourceInstanceId, first.ExchangeId);
        var secondExchange = await listener.ExchangeAsync(adapter.SourceInstanceId, second.ExchangeId);

        Assert.Equal("completed", firstExchange["lifecycle"]!["state"]!.GetValue<string>());
        Assert.Equal("completed", secondExchange["lifecycle"]!["state"]!.GetValue<string>());
        Assert.NotEqual(first.ExchangeId, second.ExchangeId);
    }

    [Fact]
    public async Task COR_004_same_exchange_id_from_two_sources_remains_two_server_records()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        var exchangeId = Guid.NewGuid();
        using var firstSocket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId);
        using var secondSocket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.OtherSourceId);
        await SendJsonAsync(firstSocket, StartedMessage(exchangeId, Guid.NewGuid(), TestValues.SourceId));
        await SendJsonAsync(secondSocket, StartedMessage(exchangeId, Guid.NewGuid(), TestValues.OtherSourceId));
        Assert.Equal("message.accepted", (await ReceiveJsonAsync(firstSocket))["type"]!.GetValue<string>());
        Assert.Equal("message.accepted", (await ReceiveJsonAsync(secondSocket))["type"]!.GetValue<string>());
        await listener.WaitForStatusAsync(status => status["exchangeCount"]!.GetValue<int>() == 2);

        Assert.Equal("inFlight", (await listener.ExchangeAsync(Guid.Parse(TestValues.SourceId), exchangeId))["lifecycle"]!["state"]!.GetValue<string>());
        Assert.Equal("inFlight", (await listener.ExchangeAsync(Guid.Parse(TestValues.OtherSourceId), exchangeId))["lifecycle"]!["state"]!.GetValue<string>());
    }

    [Fact]
    public async Task INT_003_source_mismatch_returns_message_error()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        using var socket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId);
        await SendJsonAsync(socket, StartedMessage(Guid.NewGuid(), Guid.NewGuid(), TestValues.OtherSourceId));

        var error = await ReceiveJsonAsync(socket);

        Assert.Equal("message.error", error["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task INT_004_unsupported_protocol_is_non_retryable_hello_error()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(listener.CaptureEndpoint, CancellationToken.None);
        var hello = Hello(TestValues.SourceId);
        hello["schemaVersion"]!["major"] = 2;
        hello["source"]!["protocolVersion"]!["major"] = 2;
        hello["supportedProtocol"]!["minimum"]!["major"] = 2;
        hello["supportedProtocol"]!["maximum"]!["major"] = 2;
        await SendJsonAsync(socket, hello);

        var error = await ReceiveJsonAsync(socket);

        Assert.Equal("hello.error", error["type"]!.GetValue<string>());
        Assert.False(error["value"]!["retryable"]!.GetValue<bool>());
    }

    [Fact]
    public async Task INT_005_missing_hello_times_out_and_closes()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        using var socket = new ClientWebSocket();
        await socket.ConnectAsync(listener.CaptureEndpoint, CancellationToken.None);

        var error = await ReceiveJsonAsync(socket, TimeSpan.FromSeconds(4));

        Assert.Equal("hello.error", error["type"]!.GetValue<string>());
        Assert.Equal("hello.timeout", error["value"]!["code"]!.GetValue<string>());
    }

    [Fact]
    public async Task INT_006_binary_frames_are_rejected_and_three_rejections_close_the_socket()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        using var socket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId);
        for (var count = 0; count < 3; count++)
        {
            await socket.SendAsync(new byte[] { 1 }, WebSocketMessageType.Binary, true, CancellationToken.None);
            var error = await ReceiveJsonAsync(socket);
            Assert.Equal("message.error", error["type"]!.GetValue<string>());
        }

        try
        {
            Assert.Equal(WebSocketMessageType.Close, await ReceiveFrameTypeAsync(socket));
        }
        catch (WebSocketException)
        {
        }
    }

    [Fact]
    public async Task INT_007_listener_accepts_one_mebibyte_and_rejects_one_mebibyte_plus_one()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        using var socket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId);
        await SendJsonAsync(socket, StartedMessage(Guid.NewGuid(), Guid.NewGuid(), TestValues.SourceId, new string('a', 1024 * 1024)));
        var accepted = await ReceiveJsonAsync(socket);
        await SendJsonAsync(socket, StartedMessage(Guid.NewGuid(), Guid.NewGuid(), TestValues.SourceId, new string('a', (1024 * 1024) + 1)));
        var rejected = await ReceiveJsonAsync(socket);

        Assert.Equal("message.accepted", accepted["type"]!.GetValue<string>());
        Assert.Equal("message.error", rejected["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task INT_008_disconnect_marks_an_in_flight_exchange_incomplete_and_newer_snapshot_restores_completion()
    {
        await using var listener = await EphemeralInspectorListener.StartAsync();
        var exchangeId = Guid.NewGuid();
        using (var firstSocket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId))
        {
            await SendJsonAsync(firstSocket, StartedMessage(exchangeId, Guid.NewGuid(), TestValues.SourceId));
            Assert.Equal("message.accepted", (await ReceiveJsonAsync(firstSocket))["type"]!.GetValue<string>());
        }

        await listener.WaitForExchangeAsync(TestValues.SourceId, exchangeId, exchange => exchange["lifecycle"]!["state"]!.GetValue<string>() == "incomplete");
        using var secondSocket = await ConnectAndAcceptAsync(listener.CaptureEndpoint, TestValues.SourceId);
        await SendJsonAsync(secondSocket, SnapshotMessage(exchangeId, Guid.NewGuid(), TestValues.SourceId));
        Assert.Equal("message.accepted", (await ReceiveJsonAsync(secondSocket))["type"]!.GetValue<string>());
        await listener.WaitForExchangeAsync(TestValues.SourceId, exchangeId, exchange => exchange["lifecycle"]!["state"]!.GetValue<string>() == "completed");

        var restored = await listener.ExchangeAsync(Guid.Parse(TestValues.SourceId), exchangeId);
        Assert.Equal(3L, restored["revision"]!.GetValue<long>());
    }

    private static JsonObject Hello(string sourceId) => new()
    {
        ["schemaVersion"] = Version(),
        ["supportedProtocol"] = new JsonObject { ["minimum"] = Version(), ["maximum"] = Version() },
        ["source"] = Source(sourceId),
    };

    private static JsonObject StartedMessage(Guid exchangeId, Guid messageId, string sourceId, string? body = null)
    {
        var request = Request();
        if (body is not null)
        {
            request["body"] = new JsonObject
            {
                ["availability"] = "captured",
                ["mediaType"] = "text/plain",
                ["charset"] = "utf-8",
                ["contentEncoding"] = null,
                ["declaredByteLength"] = body.Length,
                ["observedByteLength"] = body.Length,
                ["capturedByteLength"] = body.Length,
                ["sha256"] = null,
                ["content"] = new JsonObject { ["kind"] = "inlineText", ["value"] = body },
                ["truncationReason"] = null,
            };
        }

        return new JsonObject
        {
            ["type"] = "exchange.started",
            ["schemaVersion"] = Version(),
            ["messageId"] = messageId.ToString(),
            ["exchangeId"] = exchangeId.ToString(),
            ["sourceInstanceId"] = sourceId,
            ["revision"] = 1,
            ["sentAt"] = "2026-08-14T12:00:00.000Z",
            ["request"] = request,
            ["timing"] = Timing(),
            ["tags"] = new JsonArray(),
            ["correlation"] = null,
            ["metadata"] = new JsonObject(),
        };
    }

    private static JsonObject SnapshotMessage(Guid exchangeId, Guid messageId, string sourceId) => new()
    {
        ["type"] = "exchange.snapshot",
        ["schemaVersion"] = Version(),
        ["messageId"] = messageId.ToString(),
        ["exchangeId"] = exchangeId.ToString(),
        ["sourceInstanceId"] = sourceId,
        ["revision"] = 3,
        ["sentAt"] = "2026-08-14T12:00:03.000Z",
        ["exchange"] = new JsonObject
        {
            ["schemaVersion"] = Version(),
            ["id"] = exchangeId.ToString(),
            ["sessionId"] = TestValues.SessionId,
            ["revision"] = 3,
            ["arrivalSequence"] = 1,
            ["source"] = Source(sourceId),
            ["lifecycle"] = new JsonObject
            {
                ["state"] = "completed",
                ["startedAt"] = "2026-08-14T12:00:00.000Z",
                ["receivedAt"] = "2026-08-14T12:00:00.000Z",
                ["lastUpdatedAt"] = "2026-08-14T12:00:03.000Z",
            },
            ["request"] = Request(),
            ["response"] = new JsonObject { ["statusCode"] = 200, ["reasonPhrase"] = "OK", ["protocol"] = "HTTP/1.1", ["headers"] = new JsonArray(), ["body"] = null, ["raw"] = null },
            ["failure"] = null,
            ["correlation"] = null,
            ["timing"] = Timing(),
            ["sizes"] = Sizes(),
            ["capture"] = Capture(),
            ["tags"] = new JsonArray(),
            ["metadata"] = new JsonObject(),
            ["transport"] = null,
        },
    };

    private static JsonObject Request() => new()
    {
        ["method"] = "GET",
        ["originalMethod"] = null,
        ["url"] = "https://api.example.test/v1/items",
        ["scheme"] = "https",
        ["host"] = "api.example.test",
        ["port"] = null,
        ["path"] = "/v1/items",
        ["pathSegments"] = new JsonArray("v1", "items"),
        ["fragment"] = null,
        ["query"] = new JsonArray(),
        ["protocol"] = null,
        ["headers"] = new JsonArray(),
        ["body"] = null,
        ["raw"] = null,
        ["remoteAddress"] = null,
        ["localAddress"] = null,
    };

    private static JsonObject Source(string sourceId) => new()
    {
        ["instanceId"] = sourceId,
        ["applicationName"] = "listener-test",
        ["serviceName"] = "listener-test",
        ["platform"] = "dotnet",
        ["adapterName"] = "listener-test",
        ["adapterVersion"] = "1.0.0",
        ["protocolVersion"] = Version(),
        ["environment"] = null,
        ["deviceName"] = null,
        ["processId"] = null,
        ["buildVersion"] = null,
        ["baseUrl"] = null,
        ["metadata"] = new JsonObject(),
    };

    private static JsonObject Timing() => new()
    {
        ["requestHeadersSentMs"] = null,
        ["requestBodyFinishedMs"] = null,
        ["responseHeadersReceivedMs"] = null,
        ["responseBodyFinishedMs"] = null,
        ["exchangeEndedMs"] = null,
        ["dns"] = Duration(),
        ["connect"] = Duration(),
        ["tls"] = Duration(),
        ["queue"] = Duration(),
        ["requestWrite"] = Duration(),
        ["serverWait"] = Duration(),
        ["responseRead"] = Duration(),
        ["total"] = Duration(),
    };

    private static JsonObject Sizes() => new()
    {
        ["requestHeaders"] = Bytes(),
        ["requestBody"] = Bytes(),
        ["responseHeaders"] = Bytes(),
        ["responseBody"] = Bytes(),
        ["total"] = Bytes(),
    };

    private static JsonObject Capture() => new()
    {
        ["requestHeaders"] = "exact",
        ["responseHeaders"] = "exact",
        ["requestBody"] = "unavailable",
        ["responseBody"] = "unavailable",
        ["timing"] = "unavailable",
        ["sizes"] = "unavailable",
        ["requestRaw"] = "unavailable",
        ["responseRaw"] = "unavailable",
    };

    private static JsonObject Duration() => new() { ["milliseconds"] = null, ["provenance"] = "unavailable" };

    private static JsonObject Bytes() => new() { ["bytes"] = null, ["provenance"] = "unavailable" };

    private static JsonObject Version() => new() { ["major"] = 1, ["minor"] = 0 };

    private static async Task<ClientWebSocket> ConnectAndAcceptAsync(Uri endpoint, string sourceId)
    {
        var socket = new ClientWebSocket();
        await socket.ConnectAsync(endpoint, CancellationToken.None);
        await SendJsonAsync(socket, Hello(sourceId));
        Assert.Equal("hello.accepted", (await ReceiveJsonAsync(socket))["type"]!.GetValue<string>());
        return socket;
    }

    private static async Task SendJsonAsync(ClientWebSocket socket, JsonObject value)
    {
        var bytes = Encoding.UTF8.GetBytes(value.ToJsonString());
        await socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private static async Task<JsonObject> ReceiveJsonAsync(ClientWebSocket socket, TimeSpan? timeout = null)
    {
        using var cancellation = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(2));
        var bytes = new List<byte>();
        var buffer = new byte[16 * 1024];
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellation.Token);
            Assert.Equal(WebSocketMessageType.Text, result.MessageType);
            bytes.AddRange(buffer.AsSpan(0, result.Count).ToArray());
        }
        while (!result.EndOfMessage);

        return JsonNode.Parse(Encoding.UTF8.GetString(bytes.ToArray()))!.AsObject();
    }

    private static async Task<WebSocketMessageType> ReceiveFrameTypeAsync(ClientWebSocket socket)
    {
        var buffer = new byte[128];
        var result = await socket.ReceiveAsync(buffer, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(2));
        return result.MessageType;
    }

    private sealed class EphemeralInspectorListener : IAsyncDisposable
    {
        private static readonly Regex AddressPattern = new("listening at http://127\\.0\\.0\\.1:(?<port>\\d+)", RegexOptions.Compiled);
        private readonly Process _process;
        private readonly Task _outputTask;
        private readonly HttpClient _httpClient;

        private EphemeralInspectorListener(Process process, Task outputTask, Uri captureEndpoint)
        {
            _process = process;
            _outputTask = outputTask;
            CaptureEndpoint = captureEndpoint;
            HttpBaseAddress = new Uri($"http://127.0.0.1:{captureEndpoint.Port}/");
            _httpClient = new HttpClient { BaseAddress = HttpBaseAddress };
        }

        public Uri CaptureEndpoint { get; }
        public Uri HttpBaseAddress { get; }

        public static async Task<EphemeralInspectorListener> StartAsync()
        {
            var started = new TaskCompletionSource<Uri>(TaskCreationOptions.RunContinuationsAsynchronously);
            var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "cargo",
                    Arguments = "run --quiet -p inspector-server --bin inspector-dev-server",
                    WorkingDirectory = InspectorRoot(),
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                },
                EnableRaisingEvents = true,
            };
            process.StartInfo.Environment["HTTP_INSPECTOR_PORT"] = "0";
            Assert.True(process.Start());
            var outputTask = Task.Run(async () =>
            {
                while (await process.StandardOutput.ReadLineAsync() is { } line)
                {
                    var address = AddressPattern.Match(line);
                    if (address.Success)
                    {
                        started.TrySetResult(new Uri($"ws://127.0.0.1:{address.Groups["port"].Value}/v1/capture"));
                    }
                }
            });
            _ = Task.Run(async () => await process.StandardError.ReadToEndAsync());
            var endpoint = await started.Task.WaitAsync(TimeSpan.FromSeconds(60));
            return new EphemeralInspectorListener(process, outputTask, endpoint);
        }

        public async Task WaitForStatusAsync(Func<JsonObject, bool> predicate)
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                var status = await JsonAsync("api/status");
                if (predicate(status))
                {
                    return;
                }

                await Task.Delay(20);
            }

            throw new TimeoutException("The inspector listener did not reach the expected status.");
        }

        public async Task WaitForExchangeAsync(string sourceId, Guid exchangeId, Func<JsonObject, bool> predicate)
        {
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline)
            {
                var exchange = await ExchangeAsync(Guid.Parse(sourceId), exchangeId);
                if (predicate(exchange))
                {
                    return;
                }

                await Task.Delay(20);
            }

            throw new TimeoutException("The inspector listener did not reach the expected exchange state.");
        }

        public Task<JsonObject> ExchangeAsync(Guid sourceId, Guid exchangeId) => JsonAsync($"api/exchanges/{sourceId}/{exchangeId}");

        public async ValueTask DisposeAsync()
        {
            _httpClient.Dispose();
            if (!_process.HasExited)
            {
                _process.Kill(true);
            }

            await _process.WaitForExitAsync();
            await _outputTask;
            _process.Dispose();
        }

        private async Task<JsonObject> JsonAsync(string path)
        {
            var response = await _httpClient.GetAsync(path);
            response.EnsureSuccessStatusCode();
            return JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        }

        private static string InspectorRoot()
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            {
                if (File.Exists(Path.Combine(directory.FullName, "Cargo.toml"))
                    && File.Exists(Path.Combine(directory.FullName, "contracts/http-inspector.v1.schema.json")))
                {
                    return directory.FullName;
                }
            }

            throw new DirectoryNotFoundException("Could not locate the HTTP Inspector repository root.");
        }
    }
}
