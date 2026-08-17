using System.Net;
using System.IO.Compression;
using System.Text;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class HttpClientBodyCaptureTests
{
    private const string CanonicalResponse = "{\"items\":[{\"id\":42,\"active\":true}],\"nextPage\":null}";

    [Fact]
    public async Task BRG_007_finite_request_body_is_captured_and_transport_receives_identical_bytes_and_headers()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        byte[]? receivedBytes = null;
        string? receivedContentType = null;
        using var invoker = CreatePipeline(adapter, async request =>
        {
            receivedBytes = await request.Content!.ReadAsByteArrayAsync();
            receivedContentType = request.Content.Headers.ContentType!.ToString();
            return new HttpResponseMessage(HttpStatusCode.NoContent);
        });
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/v1/items")
        {
            Content = new StringContent("{\"id\":42}", Encoding.UTF8, "application/json"),
        };

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        await returned.Content.ReadAsByteArrayAsync();
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = started["request"]!["body"]!;

        Assert.Equal(Encoding.UTF8.GetBytes("{\"id\":42}"), receivedBytes);
        Assert.Equal("application/json; charset=utf-8", receivedContentType);
        Assert.Equal("captured", capturedBody["availability"]!.GetValue<string>());
        Assert.Equal("inlineText", capturedBody["content"]!["kind"]!.GetValue<string>());
        Assert.Equal("{\"id\":42}", capturedBody["content"]!["value"]!.GetValue<string>());
    }

    [Fact]
    public async Task BRG_008_and_FID_013_and_FID_014_capture_finite_json_response_without_changing_host_visible_content()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var control = JsonResponse(CanonicalResponse);
        await control.Content.ReadAsStringAsync();
        var expectedHeaders = control.Content.Headers.Select(header => (header.Key, Values: header.Value.ToArray())).ToArray();
        using var response = JsonResponse(CanonicalResponse);
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/items");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        var applicationBody = await returned.Content.ReadAsStringAsync();
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = completed["response"]!["body"]!;

        Assert.Same(response, returned);
        Assert.Equal(CanonicalResponse, applicationBody);
        Assert.Equal(expectedHeaders, returned.Content.Headers.Select(header => (header.Key, Values: header.Value.ToArray())));
        Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
        Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
        Assert.Equal("captured", capturedBody["availability"]!.GetValue<string>());
        Assert.Equal(CanonicalResponse, capturedBody["content"]!["value"]!.GetValue<string>());
        Assert.Equal(51, capturedBody["declaredByteLength"]!.GetValue<long>());
        Assert.Equal(51, capturedBody["observedByteLength"]!.GetValue<long>());
        Assert.Equal(51, capturedBody["capturedByteLength"]!.GetValue<long>());
    }

    [Fact]
    public async Task BRG_009_finite_binary_response_is_captured_once_and_host_receives_original_bytes()
    {
        var expected = new byte[] { 0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff };
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(expected),
        };
        response.Content.Headers.ContentType = new("application/octet-stream");
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/file");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        var applicationBytes = await returned.Content.ReadAsByteArrayAsync();
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = completed["response"]!["body"]!;

        Assert.Equal(expected, applicationBytes);
        Assert.Equal("inlineBase64", capturedBody["content"]!["kind"]!.GetValue<string>());
        Assert.Equal(expected, Convert.FromBase64String(capturedBody["content"]!["value"]!.GetValue<string>()));
    }

    [Fact]
    public async Task FID_018_gzip_xml_response_is_decoded_for_inspection_and_retains_original_wire_bytes()
    {
        const string xml = "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\"><s:Body><Result>ok</Result></s:Body></s:Envelope>";
        var compressed = Gzip(xml);
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(compressed),
        };
        response.Content.Headers.ContentType = new("text/xml") { CharSet = "utf-8" };
        response.Content.Headers.ContentEncoding.Add("gzip");
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/soap");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        var applicationBytes = await returned.Content.ReadAsByteArrayAsync();
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = completed["response"]!["body"]!;
        var capturedRaw = completed["response"]!["raw"]!;

        Assert.Equal(compressed, applicationBytes);
        Assert.Equal(xml, capturedBody["content"]!["value"]!.GetValue<string>());
        Assert.Null(capturedBody["contentEncoding"]);
        Assert.Equal("inlineBase64", capturedRaw["content"]!["kind"]!.GetValue<string>());
        Assert.Equal(compressed, Convert.FromBase64String(capturedRaw["content"]!["value"]!.GetValue<string>()));
        Assert.Equal("gzip", capturedRaw["contentEncoding"]!.GetValue<string>());
    }

    [Fact]
    public async Task FID_019_transparently_decoded_gzip_xml_is_readable_when_encoded_length_differs()
    {
        const string xml = "<?xml version=\"1.0\"?><Envelope><Result>already decoded</Result></Envelope>";
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(xml)),
        };
        response.Content.Headers.ContentType = new("text/xml") { CharSet = "utf-8" };
        response.Content.Headers.ContentLength = 512;
        response.Content.Headers.ContentEncoding.Add("gzip");
        response.Headers.TryAddWithoutValidation("Content-Encoding", "gzip");
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/soap-transparent");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        await returned.Content.ReadAsByteArrayAsync();
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = completed["response"]!["body"]!;

        Assert.Equal("captured", capturedBody["availability"]!.GetValue<string>());
        Assert.Equal(xml, capturedBody["content"]!["value"]!.GetValue<string>());
        Assert.Null(capturedBody["contentEncoding"]);
        Assert.Equal("gzip", completed["response"]!["raw"]!["contentEncoding"]!.GetValue<string>());
    }

    [Fact]
    public async Task BRG_010_unknown_length_finite_response_is_captured_at_eof_without_changing_bytes()
    {
        var expected = Encoding.UTF8.GetBytes("chunked response");
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new NonSeekableReadStream(expected)),
        };
        response.Content.Headers.ContentType = new("text/plain") { CharSet = "utf-8" };
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/chunked");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        var applicationBytes = await returned.Content.ReadAsByteArrayAsync();
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var capturedBody = completed["response"]!["body"]!;

        Assert.Equal(expected, applicationBytes);
        Assert.Null(capturedBody["declaredByteLength"]);
        Assert.Equal("captured", capturedBody["availability"]!.GetValue<string>());
        Assert.Equal("chunked response", capturedBody["content"]!["value"]!.GetValue<string>());
    }

    [Fact]
    public async Task BRG_011_indefinite_response_is_not_eagerly_drained_or_completed_before_eof()
    {
        var stream = new GatedReadStream(Encoding.UTF8.GetBytes("event-data"));
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(stream),
        };
        response.Content.Headers.ContentType = new("text/event-stream") { CharSet = "utf-8" };
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/events");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var applicationStream = await returned.Content.ReadAsStreamAsync();
        var buffer = new byte[32];
        var bytesRead = await applicationStream.ReadAsync(buffer);
        await Task.Yield();

        Assert.Equal("event-data", Encoding.UTF8.GetString(buffer, 0, bytesRead));
        Assert.Equal(1, transport.MessageCount);

        stream.Complete();
        Assert.Equal(0, await applicationStream.ReadAsync(buffer));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task BRG_012_body_observation_failure_preserves_original_exception_and_reports_unavailable_body()
    {
        var expected = new IOException("original response read failure");
        var transport = new FakeCaptureTransport();
        await using var adapter = await StartAdapterAsync(transport);
        using var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamContent(new ThrowingReadStream(expected)),
        };
        response.Content.Headers.ContentType = new("application/json") { CharSet = "utf-8" };
        using var invoker = CreatePipeline(adapter, _ => Task.FromResult(response));
        using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.example.test/v1/failure");

        var returned = await invoker.SendAsync(request, CancellationToken.None);
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var actual = await Assert.ThrowsAsync<HttpRequestException>(() => returned.Content.ReadAsByteArrayAsync());
        var failed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Same(expected, actual.InnerException);
        Assert.Equal("exchange.failed", failed["type"]!.GetValue<string>());
        Assert.Equal("unavailable", failed["response"]!["body"]!["availability"]!.GetValue<string>());
    }

    private static async Task<HttpInspectorAdapter> StartAdapterAsync(FakeCaptureTransport transport)
    {
        var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        return adapter;
    }

    private static HttpMessageInvoker CreatePipeline(HttpInspectorAdapter adapter, Func<HttpRequestMessage, Task<HttpResponseMessage>> send)
    {
        var inspector = new HttpInspectorHandler(adapter) { InnerHandler = new DelegateHandler(send) };
        return new HttpMessageInvoker(inspector);
    }

    private static HttpResponseMessage JsonResponse(string body) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    private static byte[] Gzip(string value)
    {
        using var output = new MemoryStream();
        using (var compressor = new GZipStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            compressor.Write(Encoding.UTF8.GetBytes(value));
        }

        return output.ToArray();
    }

    private sealed class DelegateHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
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
        public override int Read(byte[] buffer, int offset, int count) => _inner.Read(buffer, offset, count);
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => _inner.ReadAsync(buffer, cancellationToken);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class GatedReadStream(byte[] firstChunk) : Stream
    {
        private bool _sentFirstChunk;
        private bool _completed;

        public void Complete() => _completed = true;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
        public override int Read(Span<byte> buffer)
        {
            if (!_sentFirstChunk)
            {
                firstChunk.CopyTo(buffer);
                _sentFirstChunk = true;
                return firstChunk.Length;
            }

            return _completed ? 0 : throw new InvalidOperationException("The test stream must be completed before its second read.");
        }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => ValueTask.FromResult(Read(buffer.Span));
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private sealed class ThrowingReadStream(IOException exception) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw exception;
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) => ValueTask.FromException<int>(exception);
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
