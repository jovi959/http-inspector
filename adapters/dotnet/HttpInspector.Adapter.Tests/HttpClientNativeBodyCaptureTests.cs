using System.Net;
using System.Net.Sockets;
using System.Text;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class HttpClientNativeBodyCaptureTests
{
    [Fact]
    public async Task INT_009_native_http_client_captures_real_local_json_xml_and_binary_responses()
    {
        var cases = new[]
        {
            new NativeBodyCase(
                "application/json; charset=utf-8",
                Encoding.UTF8.GetBytes("{\"items\":[{\"id\":42,\"active\":true}],\"nextPage\":null}"),
                "inlineText"),
            new NativeBodyCase(
                "application/soap+xml; charset=utf-8",
                Encoding.UTF8.GetBytes("<?xml version=\"1.0\"?><soap:Envelope xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\"><soap:Body><ok>true</ok></soap:Body></soap:Envelope>"),
                "inlineText"),
            new NativeBodyCase(
                "application/octet-stream",
                [0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff],
                "inlineBase64"),
        };
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        using var sockets = new SocketsHttpHandler();
        using var inspector = new HttpInspectorHandler(adapter) { InnerHandler = sockets };
        using var client = new HttpClient(inspector);

        foreach (var captureCase in cases)
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var endpoint = (IPEndPoint)listener.LocalEndpoint;
            var server = ServeOnceAsync(listener, captureCase);

            using var response = await client.GetAsync($"http://127.0.0.1:{endpoint.Port}/v1/body");
            var applicationBody = await response.Content.ReadAsByteArrayAsync();
            await server.WaitAsync(TimeSpan.FromSeconds(2));
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
            var capturedBody = completed["response"]!["body"]!;
            var capturedContent = capturedBody["content"]!;

            Assert.Equal(captureCase.Bytes, applicationBody);
            Assert.Equal("captured", capturedBody["availability"]!.GetValue<string>());
            Assert.Equal(captureCase.Bytes.LongLength, capturedBody["declaredByteLength"]!.GetValue<long>());
            Assert.Equal(captureCase.Bytes.LongLength, capturedBody["observedByteLength"]!.GetValue<long>());
            Assert.Equal(captureCase.Bytes.LongLength, capturedBody["capturedByteLength"]!.GetValue<long>());
            Assert.Equal(captureCase.ContentKind, capturedContent["kind"]!.GetValue<string>());
            Assert.Equal(captureCase.Bytes, CapturedBytes(capturedContent));
        }
    }

    private static byte[] CapturedBytes(System.Text.Json.Nodes.JsonNode content) =>
        content["kind"]!.GetValue<string>() == "inlineBase64"
            ? Convert.FromBase64String(content["value"]!.GetValue<string>())
            : Encoding.UTF8.GetBytes(content["value"]!.GetValue<string>());

    private static async Task ServeOnceAsync(TcpListener listener, NativeBodyCase captureCase)
    {
        using var client = await listener.AcceptTcpClientAsync();
        await using var stream = client.GetStream();
        var request = new byte[4096];
        var received = 0;
        while (received < request.Length)
        {
            var count = await stream.ReadAsync(request.AsMemory(received));
            if (count == 0)
            {
                break;
            }

            received += count;
            if (Encoding.ASCII.GetString(request, 0, received).Contains("\r\n\r\n", StringComparison.Ordinal))
            {
                break;
            }
        }

        var headers = Encoding.ASCII.GetBytes($"HTTP/1.1 200 OK\r\nContent-Type: {captureCase.ContentType}\r\nContent-Length: {captureCase.Bytes.Length}\r\nConnection: close\r\n\r\n");
        await stream.WriteAsync(headers);
        await stream.WriteAsync(captureCase.Bytes);
        await stream.FlushAsync();
    }

    private sealed record NativeBodyCase(string ContentType, byte[] Bytes, string ContentKind);
}
