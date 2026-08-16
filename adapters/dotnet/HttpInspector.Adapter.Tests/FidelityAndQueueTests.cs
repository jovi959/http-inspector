using System.Text;
using System.Text.Json.Nodes;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class FidelityAndQueueTests
{
    [Fact]
    public async Task FID_001_FID_003_and_FID_004_preserve_duplicate_headers_ordered_query_and_sensitive_values()
    {
        var started = await CaptureStartedAsync(TestValues.RequestA() with
        {
            Headers =
            [
                new CapturedHeader("Content-Type", "application/json"),
                new CapturedHeader("Authorization", "Bearer fixture-token"),
                new CapturedHeader("Cookie", "session=fixture-cookie"),
                new CapturedHeader("X-Trace", "one"),
                new CapturedHeader("X-Trace", "two"),
            ],
            Raw = CapturedBody.TextBody("POST /v1/documents/search HTTP/2", "message/http"),
        });

        var headers = started["request"]!["headers"]!.AsArray();
        var query = started["request"]!["query"]!.AsArray();

        Assert.Equal("Bearer fixture-token", headers[1]!["value"]!.GetValue<string>());
        Assert.Equal("session=fixture-cookie", headers[2]!["value"]!.GetValue<string>());
        Assert.Equal(("X-Trace", "one"), (headers[3]!["name"]!.GetValue<string>(), headers[3]!["value"]!.GetValue<string>()));
        Assert.Equal(("X-Trace", "two"), (headers[4]!["name"]!.GetValue<string>(), headers[4]!["value"]!.GetValue<string>()));
        Assert.Equal(("region", "ca"), (query[0]!["name"]!.GetValue<string>(), query[0]!["value"]!.GetValue<string>()));
        Assert.Equal(("region", "on"), (query[1]!["name"]!.GetValue<string>(), query[1]!["value"]!.GetValue<string>()));
        Assert.Equal("includeClosed", query[2]!["name"]!.GetValue<string>());
        Assert.Null(query[2]!["value"]);
        Assert.Equal("{\"searchType\":\"IDNumber\",\"includeClosed\":false,\"page\":1}", started["request"]!["body"]!["content"]!["value"]!.GetValue<string>());
        Assert.Equal("POST /v1/documents/search HTTP/2", started["request"]!["raw"]!["content"]!["value"]!.GetValue<string>());
    }

    [Fact]
    public async Task FID_002_preserves_duplicate_response_headers_in_order()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handle, TestValues.ResponseA());
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var headers = completed["response"]!["headers"]!.AsArray();

        Assert.Equal(("Set-Cookie", "session=fixture-a"), (headers[1]!["name"]!.GetValue<string>(), headers[1]!["value"]!.GetValue<string>()));
        Assert.Equal(("Set-Cookie", "theme=dark"), (headers[2]!["name"]!.GetValue<string>(), headers[2]!["value"]!.GetValue<string>()));
    }

    [Fact]
    public async Task FID_005_and_FID_006_preserve_json_and_xml_soap_lexical_text()
    {
        const string xml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><GetDocument id=\"42\" /></soap:Body></soap:Envelope>";
        var request = TestValues.RequestA() with
        {
            Headers = [new CapturedHeader("SOAPAction", "urn:GetDocument")],
            Body = CapturedBody.TextBody(xml, "application/soap+xml", "utf-8"),
        };

        var started = await CaptureStartedAsync(request);

        Assert.Equal("application/soap+xml", started["request"]!["body"]!["mediaType"]!.GetValue<string>());
        Assert.Equal(xml, started["request"]!["body"]!["content"]!["value"]!.GetValue<string>());
        Assert.Equal("urn:GetDocument", started["request"]!["headers"]![0]!["value"]!.GetValue<string>());
    }

    [Fact]
    public async Task FID_007_binary_body_is_encoded_once_as_standard_base64()
    {
        var request = TestValues.RequestA() with { Body = CapturedBody.BinaryBody([0, 1, 2, 255], "application/octet-stream") };
        var started = await CaptureStartedAsync(request);
        var body = started["request"]!["body"]!;

        Assert.Equal("inlineBase64", body["content"]!["kind"]!.GetValue<string>());
        Assert.Equal(new byte[] { 0, 1, 2, 255 }, Convert.FromBase64String(body["content"]!["value"]!.GetValue<string>()));
    }

    [Fact]
    public async Task FID_008_and_FID_009_empty_and_unavailable_bodies_do_not_invent_content()
    {
        var empty = await CaptureStartedAsync(TestValues.RequestA() with { Body = CapturedBody.Empty() });
        var unavailable = await CaptureStartedAsync(TestValues.RequestA() with { Body = CapturedBody.Unavailable("application/json", declaredByteLength: 12) });

        Assert.Equal("empty", empty["request"]!["body"]!["availability"]!.GetValue<string>());
        Assert.Null(empty["request"]!["body"]!["content"]);
        Assert.Equal("unavailable", unavailable["request"]!["body"]!["availability"]!.GetValue<string>());
        Assert.Null(unavailable["request"]!["body"]!["content"]);
    }

    [Fact]
    public async Task FID_010_multibyte_text_uses_encoded_byte_count()
    {
        var started = await CaptureStartedAsync(TestValues.RequestA() with { Body = CapturedBody.TextBody("é", "text/plain", "utf-8") });

        Assert.Equal(2L, started["request"]!["body"]!["capturedByteLength"]!.GetValue<long>());
    }

    [Fact]
    public async Task FID_011_and_FID_012_respect_the_negotiated_one_mebibyte_body_boundary()
    {
        var accepted = await CaptureStartedAsync(TestValues.RequestA() with { Body = CapturedBody.BinaryBody(new byte[1024 * 1024], "application/octet-stream") });
        var overLimit = await CaptureStartedAsync(TestValues.RequestA() with { Body = CapturedBody.BinaryBody(new byte[(1024 * 1024) + 1], "application/octet-stream") });

        Assert.Equal("captured", accepted["request"]!["body"]!["availability"]!.GetValue<string>());
        Assert.Equal("unavailable", overLimit["request"]!["body"]!["availability"]!.GetValue<string>());
        Assert.Null(overLimit["request"]!["body"]!["content"]);
    }

    [Fact]
    public async Task FID_015_FID_016_and_FID_017_preserve_the_complete_header_array_without_an_allowlist()
    {
        CapturedHeader[] expected =
        [
            new("Host", "api.example.test"),
            new("User-Agent", "HTTPInspectorAdapterTDD/1.0"),
            new("Accept", "application/json"),
            new("Accept-Language", "en-CA,en;q=0.9"),
            new("Content-Type", "application/json"),
            new("Content-Length", "56"),
            new("Authorization", "Bearer fixture-token"),
            new("Cookie", "session=fixture-session; region=ca"),
            new("X-Api-Key", "fixture-api-key"),
            new("X-Project-Specific-Header", "project-value"),
            new("X-Unrecognized-By-Adapter", "retain-me"),
            new("X-Trace", "one"),
            new("X-Trace", "two"),
        ];
        var started = await CaptureStartedAsync(TestValues.RequestA() with { Headers = expected });
        var actual = started["request"]!["headers"]!.AsArray()
            .Select(header => new CapturedHeader(
                header!["name"]!.GetValue<string>(),
                header["value"]!.GetValue<string>(),
                header["provenance"]!.GetValue<string>()))
            .ToArray();

        Assert.Equal(expected, actual);
    }

    [Fact]
    public async Task NIF_003_and_NIF_004_keep_queue_bounded_and_report_cumulative_drops_in_heartbeat()
    {
        var transport = new FakeCaptureTransport { AutoAcceptMessages = false };
        var delay = new FakeDelay();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(queueCapacity: 2), TestValues.Dependencies(transport, delay: delay));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureStarted(TestValues.RequestA());
        var firstMessage = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var secondMessage = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(1, adapter.DroppedCount);
        transport.Accept(firstMessage["messageId"]!.GetValue<string>());
        transport.Accept(secondMessage["messageId"]!.GetValue<string>());
        await WaitForAsync(() => transport.PendingAcknowledgementCount == 0);
        delay.Advance(TimeSpan.FromSeconds(15));
        var heartbeat = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("heartbeat", heartbeat["type"]!.GetValue<string>());
        Assert.Equal(1L, heartbeat["droppedCount"]!.GetValue<long>());
    }

    [Fact]
    public async Task NIF_005_serialization_failure_is_local_and_does_not_throw_from_capture()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));

        var handle = adapter.CaptureStarted(TestValues.RequestA() with { Url = string.Empty });

        Assert.False(handle.IsCaptured);
        Assert.Contains(adapter.Diagnostics, diagnostic => diagnostic.Code == "serialization");
    }

    [Fact]
    public async Task NIF_007_excludes_the_inspector_endpoint_from_capture()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var handle = adapter.CaptureStarted(TestValues.RequestA() with { Url = "http://127.0.0.1:53662/v1/capture" });

        Assert.False(handle.IsCaptured);
        Assert.Equal(0, transport.MessageCount);
    }

    private static async Task<JsonObject> CaptureStartedAsync(CapturedRequest request)
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        adapter.CaptureStarted(request);
        return await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
    }

    private static async Task WaitForAsync(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(1);
        while (!condition())
        {
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException("The expected asynchronous adapter state was not reached.");
            }

            await Task.Yield();
        }
    }
}
