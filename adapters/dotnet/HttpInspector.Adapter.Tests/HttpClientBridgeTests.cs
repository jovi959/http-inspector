using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Text;
using HttpInspector.Adapter;
using Microsoft.Extensions.DependencyInjection;
using RestSharp;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class HttpClientBridgeTests
{
    [Fact]
    public async Task BRG_001_observes_mutations_from_earlier_handlers_at_the_final_supported_position()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        using var invoker = CreatePipeline(adapter, response, request =>
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "final-token");
            request.Headers.TryAddWithoutValidation("Cookie", "session=final-cookie");
        });
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/items?x=1");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var headers = started["request"]!["headers"]!.AsArray();

        Assert.Same(response, returned);
        Assert.Contains(headers, header => header!["name"]!.GetValue<string>() == "Authorization" && header["value"]!.GetValue<string>() == "Bearer final-token");
        Assert.Contains(headers, header => header!["name"]!.GetValue<string>() == "Cookie" && header["value"]!.GetValue<string>() == "session=final-cookie");
    }

    [Fact]
    public async Task BRG_002_registration_appends_the_package_handler_after_existing_handlers()
    {
        var services = new ServiceCollection();
        services.AddTransient<MutationHandler>();
        services.AddHttpClient("adapter-order")
            .AddHttpMessageHandler<MutationHandler>()
            .AddHttpInspectorAdapter(options => options.Endpoint = TestValues.Endpoint);
        await using var provider = services.BuildServiceProvider();
        var factory = provider.GetRequiredService<IHttpMessageHandlerFactory>();
        var handler = factory.CreateHandler("adapter-order");

        var pipeline = HandlerTypes(handler).ToList();
        Assert.True(pipeline.IndexOf(typeof(MutationHandler)) < pipeline.IndexOf(typeof(HttpInspectorHandler)));
    }

    [Fact]
    public async Task BRG_003_and_NIF_001_and_NIF_002_return_the_original_response_without_waiting_for_inspector_io()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var response = new HttpResponseMessage(HttpStatusCode.Accepted);
        using var invoker = CreatePipeline(adapter, response);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/slow");

        var returned = await invoker.SendAsync(request, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Same(response, returned);
    }

    [Fact]
    public async Task BRG_004_rethrows_the_original_error_after_capture_is_enqueued()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var expected = new HttpRequestException("original failure");
        using var invoker = CreatePipeline(adapter, null, exception: expected);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/failure");

        var actual = await Assert.ThrowsAsync<HttpRequestException>(() => invoker.SendAsync(request, CancellationToken.None));

        Assert.Same(expected, actual);
    }

    [Fact]
    public async Task BRG_005_preserves_native_cancellation_semantics()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        using var invoker = CreatePipeline(adapter, null, cancellationToken: cancellation.Token);
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/cancel");

        var exception = await Assert.ThrowsAnyAsync<OperationCanceledException>(() => invoker.SendAsync(request, cancellation.Token));

        Assert.Equal(cancellation.Token, exception.CancellationToken);
    }

    [Fact]
    public async Task BRG_006_does_not_consume_a_one_shot_request_stream_and_reports_its_body_unavailable()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var stream = new NonSeekableReadStream(Encoding.UTF8.GetBytes("one-shot-body"));
        string? receivedBody = null;
        var terminal = new DelegateHandler(async request =>
        {
            receivedBody = await request.Content!.ReadAsStringAsync();
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var inspector = new HttpInspectorHandler(adapter) { InnerHandler = terminal };
        using var invoker = new HttpMessageInvoker(inspector);
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/v1/stream")
        {
            Content = new StreamContent(stream),
        };

        await invoker.SendAsync(request, CancellationToken.None);
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("one-shot-body", receivedBody);
        Assert.Equal("unavailable", started["request"]!["body"]!["availability"]!.GetValue<string>());
    }

    [Fact]
    public void COR_008_mapper_does_not_add_adapter_state_to_the_native_request()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/v1/items?region=ca&region=on&includeClosed")
        {
            Content = new StringContent("{\"id\":42}", Encoding.UTF8, "application/json"),
        };
        request.Headers.TryAddWithoutValidation("X-Trace", ["one", "two"]);
        var beforeHeaders = request.Headers.SelectMany(header => header.Value.Select(value => $"{header.Key}:{value}")).ToArray();
        var beforeBody = request.Content.Headers.ContentType!.ToString();

        var captured = HttpClientCaptureMapper.ToCapturedRequest(request);

        Assert.Equal(beforeHeaders, request.Headers.SelectMany(header => header.Value.Select(value => $"{header.Key}:{value}")));
        Assert.Equal(beforeBody, request.Content.Headers.ContentType!.ToString());
        Assert.Equal(new[] { "region", "region", "includeClosed" }, captured.Query.Select(item => item.Name));
        Assert.Equal(new[] { "one", "two" }, captured.Headers.Where(header => header.Name == "X-Trace").Select(header => header.Value));
    }

    [Fact]
    public void COR_009_exchange_handle_retains_only_value_state_and_no_native_request_or_response_reference()
    {
        var fieldTypes = typeof(ExchangeHandle).GetFields(System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public)
            .Select(field => field.FieldType)
            .ToArray();

        Assert.DoesNotContain(typeof(HttpRequestMessage), fieldTypes);
        Assert.DoesNotContain(typeof(HttpResponseMessage), fieldTypes);
        Assert.DoesNotContain(typeof(HttpContent), fieldTypes);
    }

    [Fact]
    public async Task BRG_013_collects_every_host_visible_general_and_content_header_without_an_allowlist()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        (string Name, string Value)[] expected = [];
        var terminal = new DelegateHandler(request =>
        {
            expected = request.Headers.NonValidated
                .Concat(request.Content!.Headers.NonValidated)
                .SelectMany(header => header.Value.Select(value => (header.Key, value)))
                .ToArray();
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK));
        });
        var inspector = new HttpInspectorHandler(adapter) { InnerHandler = terminal };
        using var client = new HttpClient(inspector);
        client.DefaultRequestHeaders.UserAgent.ParseAdd("HTTPInspectorAdapterTDD/1.0");
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/v1/documents/search")
        {
            Content = new ByteArrayContent([1, 2, 3]),
        };
        request.Headers.Host = "api.example.test";
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.AcceptLanguage.ParseAdd("en-CA");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "fixture-token");
        request.Headers.TryAddWithoutValidation("Cookie", "session=fixture-session; region=ca");
        request.Headers.TryAddWithoutValidation("X-Api-Key", "fixture-api-key");
        request.Headers.TryAddWithoutValidation("X-Project-Specific-Header", "project-value");
        request.Headers.TryAddWithoutValidation("X-Unrecognized-By-Adapter", "retain-me");
        request.Headers.TryAddWithoutValidation("x-MiXeD-Custom", "one,  two; q=0.50");
        request.Headers.TryAddWithoutValidation("X-Trace", ["one", "two"]);
        request.Content.Headers.ContentType = new("application/json");
        request.Content.Headers.ContentLength = 3;

        await client.SendAsync(request);
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var actual = started["request"]!["headers"]!.AsArray()
            .Select(header => (header!["name"]!.GetValue<string>(), header["value"]!.GetValue<string>()))
            .ToArray();

        Assert.Equal(expected, actual);
        Assert.Contains(("User-Agent", "HTTPInspectorAdapterTDD/1.0"), actual);
        Assert.Contains(("X-Unrecognized-By-Adapter", "retain-me"), actual);
        Assert.Contains(("x-MiXeD-Custom", "one,  two; q=0.50"), actual);
        Assert.Equal(new[] { "one", "two" }, actual.Where(header => header.Item1 == "X-Trace").Select(header => header.Item2));
        Assert.Contains(("Content-Type", "application/json"), actual);
        Assert.Contains(("Content-Length", "3"), actual);
    }

    [Fact]
    public void BRG_014_does_not_invent_headers_created_after_the_final_handler_seam()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/items");

        var captured = HttpClientCaptureMapper.ToCapturedRequest(request);

        Assert.Equal("api.example.test", captured.Host);
        Assert.DoesNotContain(captured.Headers, header => header.Name.Equals("Host", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(captured.Headers, header => header.Name.Equals("User-Agent", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(captured.Headers, header => header.Name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task BRG_015_global_registration_captures_every_factory_client_once_without_per_client_edits()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpClient("ordinary-client").ConfigurePrimaryHttpMessageHandler(() => new DelegateHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK))));
        services.AddHttpClient("refit-equivalent-client").ConfigurePrimaryHttpMessageHandler(() => new DelegateHandler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Accepted))));
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var factory = provider.GetRequiredService<IHttpClientFactory>();

        using var ordinary = factory.CreateClient("ordinary-client");
        using var refitEquivalent = factory.CreateClient("refit-equivalent-client");
        await ordinary.GetAsync("https://api.example.test/v1/ordinary");
        await refitEquivalent.GetAsync("https://api.example.test/v1/refit-equivalent");

        var messages = new[]
        {
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
        };

        var started = messages.Where(message => message["type"]!.GetValue<string>() == "exchange.started").ToArray();
        Assert.Equal(2, started.Length);
        Assert.All(started, message => Assert.Equal("httpClientFactory", message["metadata"]!["captureBridge"]!.GetValue<string>()));
        Assert.Equal(1, started.Count(message => message["request"]!["url"]!.GetValue<string>().EndsWith("/ordinary", StringComparison.Ordinal)));
        Assert.Equal(1, started.Count(message => message["request"]!["url"]!.GetValue<string>().EndsWith("/refit-equivalent", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task BRG_016_system_net_http_diagnostics_capture_unmarked_direct_requests_once()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        var hostedServices = provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().ToArray();
        foreach (var hostedService in hostedServices)
        {
            await hostedService.StartAsync(CancellationToken.None);
        }

        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        using var diagnostics = new DiagnosticListener("HttpHandlerDiagnosticListener");
        using var directRequest = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/direct-client");
        using var response = new HttpResponseMessage(HttpStatusCode.OK) { RequestMessage = directRequest };
        diagnostics.Write("System.Net.Http.HttpRequestOut.Start", new { Request = directRequest });
        diagnostics.Write("System.Net.Http.HttpRequestOut.Stop", new { Response = response });

        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
        Assert.Equal("systemNetHttpDiagnostic", started["metadata"]!["captureBridge"]!.GetValue<string>());
        Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());

        foreach (var hostedService in hostedServices.Reverse())
        {
            await hostedService.StopAsync(CancellationToken.None);
        }
    }

    [Fact]
    public async Task BRG_017_real_direct_http_client_uses_the_runtime_diagnostic_bridge()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        var hostedServices = provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().ToArray();
        foreach (var hostedService in hostedServices)
        {
            await hostedService.StartAsync(CancellationToken.None);
        }

        try
        {
            await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            await using var server = await DirectHttpServer.StartAsync();
            using var directClient = new HttpClient();

            Assert.Equal("ok", await directClient.GetStringAsync(server.Uri));

            var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
            Assert.Equal("systemNetHttpDiagnostic", started["metadata"]!["captureBridge"]!.GetValue<string>());
            Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
        }
        finally
        {
            foreach (var hostedService in hostedServices.Reverse())
            {
                await hostedService.StopAsync(CancellationToken.None);
            }
        }
    }

    [Fact]
    public async Task BRG_020_runtime_diagnostic_bridge_decodes_a_gzip_xml_response()
    {
        const string xml = "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><Result>ok</Result></s:Body></s:Envelope>";
        var compressed = Gzip(xml);
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        var hostedServices = provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().ToArray();
        foreach (var hostedService in hostedServices)
        {
            await hostedService.StartAsync(CancellationToken.None);
        }

        try
        {
            await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            await using var server = await DirectHttpServer.StartAsync(compressed, "text/xml; charset=utf-8", "Content-Encoding: gzip\r\n");
            using var directClient = new HttpClient();

            Assert.Equal(compressed, await directClient.GetByteArrayAsync(server.Uri));

            var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            Assert.Equal("systemNetHttpDiagnostic", started["metadata"]!["captureBridge"]!.GetValue<string>());
            Assert.Equal(xml, completed["response"]!["body"]!["content"]!["value"]!.GetValue<string>());
            Assert.Equal("gzip", completed["response"]!["raw"]!["contentEncoding"]!.GetValue<string>());
        }
        finally
        {
            foreach (var hostedService in hostedServices.Reverse())
            {
                await hostedService.StopAsync(CancellationToken.None);
            }
        }
    }

    [Fact]
    public async Task BRG_018_factory_and_runtime_diagnostic_bridges_do_not_duplicate_the_same_request()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpClient("factory-client");
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        var hostedServices = provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().ToArray();
        foreach (var hostedService in hostedServices)
        {
            await hostedService.StartAsync(CancellationToken.None);
        }

        try
        {
            await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            await using var server = await DirectHttpServer.StartAsync();
            using var factoryClient = provider.GetRequiredService<IHttpClientFactory>().CreateClient("factory-client");

            Assert.Equal("ok", await factoryClient.GetStringAsync(server.Uri));

            var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            await Task.Delay(50);
            Assert.Equal("httpClientFactory", started["metadata"]!["captureBridge"]!.GetValue<string>());
            Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
            Assert.Equal(2, transport.MessageCount);
        }
        finally
        {
            foreach (var hostedService in hostedServices.Reverse())
            {
                await hostedService.StopAsync(CancellationToken.None);
            }
        }
    }

    [Fact]
    public async Task BRG_019_real_direct_rest_sharp_client_uses_the_runtime_diagnostic_bridge()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        var services = new ServiceCollection();
        services.AddSingleton(adapter);
        services.AddHttpInspectorAdapter();
        await using var provider = services.BuildServiceProvider();
        var hostedServices = provider.GetServices<Microsoft.Extensions.Hosting.IHostedService>().ToArray();
        foreach (var hostedService in hostedServices)
        {
            await hostedService.StartAsync(CancellationToken.None);
        }

        try
        {
            await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            await using var server = await DirectHttpServer.StartAsync();
            using var restClient = new RestClient(server.Uri);

            var response = await restClient.ExecuteGetAsync(new RestRequest());

            Assert.True(response.IsSuccessful);
            var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            Assert.Equal("systemNetHttpDiagnostic", started["metadata"]!["captureBridge"]!.GetValue<string>());
            Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
        }
        finally
        {
            foreach (var hostedService in hostedServices.Reverse())
            {
                await hostedService.StopAsync(CancellationToken.None);
            }
        }
    }

    private static HttpMessageInvoker CreatePipeline(HttpInspectorAdapter adapter, HttpResponseMessage? response, Action<HttpRequestMessage>? mutate = null, Exception? exception = null, CancellationToken cancellationToken = default)
    {
        var terminal = new DelegateHandler(_ =>
        {
            if (exception is not null)
            {
                return Task.FromException<HttpResponseMessage>(exception);
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return Task.FromCanceled<HttpResponseMessage>(cancellationToken);
            }

            return Task.FromResult(response!);
        });
        var inspector = new HttpInspectorHandler(adapter) { InnerHandler = terminal };
        return new HttpMessageInvoker(new MutationHandler(inspector, mutate));
    }

    private static IEnumerable<Type> HandlerTypes(HttpMessageHandler handler)
    {
        for (var current = handler; current is DelegatingHandler delegating; current = delegating.InnerHandler!)
        {
            yield return current.GetType();
        }
    }

    private static byte[] Gzip(string value)
    {
        using var output = new MemoryStream();
        using (var compressor = new GZipStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            compressor.Write(Encoding.UTF8.GetBytes(value));
        }

        return output.ToArray();
    }

    private sealed class MutationHandler : DelegatingHandler
    {
        private readonly Action<HttpRequestMessage>? _mutate;

        public MutationHandler()
        {
        }

        public MutationHandler(HttpMessageHandler innerHandler, Action<HttpRequestMessage>? mutate)
        {
            InnerHandler = innerHandler;
            _mutate = mutate;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            _mutate?.Invoke(request);
            return base.SendAsync(request, cancellationToken);
        }
    }

    private sealed class DelegateHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }

    private sealed class DirectHttpServer : IAsyncDisposable
    {
        private readonly TcpListener _listener;
        private readonly Task _serveTask;

        private readonly byte[] _responseBody;
        private readonly string _contentType;
        private readonly string _additionalHeaders;

        private DirectHttpServer(TcpListener listener, byte[] responseBody, string contentType, string additionalHeaders)
        {
            _listener = listener;
            _responseBody = responseBody;
            _contentType = contentType;
            _additionalHeaders = additionalHeaders;
            Uri = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/v1/direct-client");
            _serveTask = ServeAsync();
        }

        public Uri Uri { get; }

        public static Task<DirectHttpServer> StartAsync(byte[]? responseBody = null, string contentType = "text/plain", string additionalHeaders = "")
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return Task.FromResult(new DirectHttpServer(listener, responseBody ?? "ok"u8.ToArray(), contentType, additionalHeaders));
        }

        public async ValueTask DisposeAsync()
        {
            _listener.Stop();
            try
            {
                await _serveTask.WaitAsync(TimeSpan.FromSeconds(1));
            }
            catch (OperationCanceledException)
            {
            }
            catch (SocketException)
            {
            }
        }

        private async Task ServeAsync()
        {
            using var client = await _listener.AcceptTcpClientAsync();
            await using var stream = client.GetStream();
            var buffer = new byte[4096];
            var total = 0;
            while (total < buffer.Length)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(total));
                if (read == 0)
                {
                    return;
                }

                total += read;
                if (total >= 4 && buffer.AsSpan(0, total).IndexOf("\r\n\r\n"u8) >= 0)
                {
                    break;
                }
            }

            var headers = $"HTTP/1.1 200 OK\r\nContent-Type: {_contentType}\r\nContent-Length: {_responseBody.Length}\r\n{_additionalHeaders}Connection: close\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(headers));
            await stream.WriteAsync(_responseBody);
        }
    }

    private sealed class NonSeekableReadStream(byte[] data) : Stream
    {
        private readonly MemoryStream _inner = new(data, writable: false);

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override Task FlushAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => _inner.ReadAsync(buffer, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
