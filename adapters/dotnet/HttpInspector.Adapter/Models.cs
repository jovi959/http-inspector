using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;

namespace HttpInspector.Adapter;

public static class HttpInspectorProtocol
{
    public const string DefaultEndpoint = "ws://127.0.0.1:53662/v1/capture";
    public const string TransportProfile = "websocket-v1";
    public const string AdapterName = "http-inspector-dotnet-httpclient";
    public const string AdapterVersion = "1.3.3";
}

public sealed class AdapterConfig
{
    public string? Endpoint { get; init; }
    public string TransportProfile { get; init; } = HttpInspectorProtocol.TransportProfile;
    public string ApplicationName { get; init; } = AppDomain.CurrentDomain.FriendlyName;
    public string ServiceName { get; init; } = AppDomain.CurrentDomain.FriendlyName;
    public string Platform { get; init; } = "dotnet";
    public string AdapterName { get; init; } = HttpInspectorProtocol.AdapterName;
    public string AdapterVersion { get; init; } = HttpInspectorProtocol.AdapterVersion;
    public string? Environment { get; init; }
    public string? DeviceName { get; init; }
    public uint? ProcessId { get; init; } = (uint)System.Environment.ProcessId;
    public string? BuildVersion { get; init; }
    public string? BaseUrl { get; init; }
    public JsonObject SourceMetadata { get; init; } = [];
    public int QueueCapacity { get; init; } = 256;
    public TimeSpan HeartbeatInterval { get; init; } = TimeSpan.FromSeconds(15);
}

public sealed record CapturedHeader(string Name, string Value, string? Provenance = "exact");

public sealed record CapturedQuery(string Name, string? Value, string? Provenance = "exact");

public sealed class CapturedBody
{
    private CapturedBody(
        string availability,
        string? mediaType,
        string? charset,
        string? contentEncoding,
        long? declaredByteLength,
        string? text,
        byte[]? binary)
    {
        Availability = availability;
        MediaType = mediaType;
        Charset = charset;
        ContentEncoding = contentEncoding;
        DeclaredByteLength = declaredByteLength;
        Text = text;
        Binary = binary?.ToArray();
    }

    public string Availability { get; }
    public string? MediaType { get; }
    public string? Charset { get; }
    public string? ContentEncoding { get; }
    public long? DeclaredByteLength { get; }
    public string? Text { get; }
    public byte[]? Binary { get; }

    public static CapturedBody TextBody(string value, string? mediaType, string? charset = "utf-8", long? declaredByteLength = null, string? contentEncoding = null) =>
        new("captured", mediaType, charset, contentEncoding, declaredByteLength, value, null);

    public static CapturedBody BinaryBody(byte[] value, string? mediaType, long? declaredByteLength = null, string? contentEncoding = null) =>
        new("captured", mediaType, null, contentEncoding, declaredByteLength, null, value);

    public static CapturedBody Empty(string? mediaType = null, string? charset = null, string? contentEncoding = null) =>
        new("empty", mediaType, charset, contentEncoding, 0, null, null);

    public static CapturedBody Unavailable(string? mediaType = null, string? charset = null, string? contentEncoding = null, long? declaredByteLength = null) =>
        new("unavailable", mediaType, charset, contentEncoding, declaredByteLength, null, null);

    internal long? ObservedByteLength
    {
        get
        {
            if (Text is not null)
            {
                return GetEncoding(Charset).GetByteCount(Text);
            }

            return Binary?.LongLength;
        }
    }

    internal static Encoding GetEncoding(string? charset)
    {
        if (string.IsNullOrWhiteSpace(charset))
        {
            return Encoding.UTF8;
        }

        try
        {
            return Encoding.GetEncoding(charset);
        }
        catch (ArgumentException)
        {
            return Encoding.UTF8;
        }
    }
}

public sealed record CapturedRequest(
    string Method,
    string Url,
    IReadOnlyList<CapturedHeader> Headers,
    IReadOnlyList<CapturedQuery> Query,
    CapturedBody? Body = null,
    string? OriginalMethod = null,
    string? Scheme = null,
    string? Host = null,
    int? Port = null,
    string? Path = null,
    IReadOnlyList<string>? PathSegments = null,
    string? Fragment = null,
    string? Protocol = null,
    CapturedBody? Raw = null);

public sealed record CapturedResponse(
    int StatusCode,
    IReadOnlyList<CapturedHeader> Headers,
    CapturedBody? Body = null,
    string? ReasonPhrase = null,
    string? Protocol = null,
    CapturedBody? Raw = null);

public sealed record CapturedFailure(string Category, string Message, bool Retryable, string? Code = null);

public sealed record CaptureContext(
    string? TraceId = null,
    string? SpanId = null,
    string? ParentSpanId = null,
    string? OperationId = null,
    string? ParentExchangeId = null);

internal sealed record CaptureOrigin(string Bridge, string TransportKind, string ReplayCapability, string? FidelityNote = null)
{
    public static CaptureOrigin AdapterApi { get; } = new("adapterApi", "http", "supported");
    public static CaptureOrigin HttpClientFactory { get; } = new("httpClientFactory", "http", "supported");
    public static CaptureOrigin SystemNetHttpDiagnostic { get; } = new("systemNetHttpDiagnostic", "http", "supported");
    public static CaptureOrigin WcfHttpTransport { get; } = new("wcfHttpTransport", "wcfHttp", "supported");
    public static CaptureOrigin WcfMessageInspector { get; } = new("wcfMessageInspector", "soap", "unsupported", "Logical SOAP capture is not replayable as an HTTP request.");

    public JsonObject ToMetadata() => new()
    {
        ["captureBridge"] = Bridge,
        ["transportKind"] = TransportKind,
        ["replayCapability"] = ReplayCapability,
        ["fidelityNote"] = FidelityNote,
    };
}

public sealed record CompletionData(JsonObject? MetadataPatch = null);

public sealed record AdapterDiagnostic(
    string Code,
    Uri Endpoint,
    string TransportProfile,
    string Message,
    DateTimeOffset Timestamp,
    bool Retryable);

public sealed record NegotiatedSession(
    string ConnectionId,
    string SessionId,
    ulong MaximumMessageBytes,
    ulong MaximumBodyBytes);

public sealed record MessageAcknowledgement(string MessageId, bool Accepted, string? ErrorCode = null, string? ErrorMessage = null, bool Retryable = false);

public sealed class CaptureTransportException(string code, string message, bool retryable, Exception? innerException = null) : Exception(message, innerException)
{
    public string Code { get; } = code;
    public bool Retryable { get; } = retryable;
}

public interface ICaptureTransport
{
    Task<NegotiatedSession> ConnectAsync(Uri endpoint, JsonObject clientHello, CancellationToken cancellationToken);
    Task<MessageAcknowledgement> SendAsync(JsonObject message, CancellationToken cancellationToken);
    Task FlushAsync(TimeSpan timeout, CancellationToken cancellationToken);
    Task CloseAsync(CancellationToken cancellationToken);
}

public interface IIdGenerator
{
    Guid NextUuid();
}

public interface IAdapterClock
{
    DateTimeOffset UtcNow { get; }
    long GetTimestamp();
    TimeSpan GetElapsed(long startTimestamp, long endTimestamp);
}

public interface IAdapterDelay
{
    Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken);
}

public interface IEnvironmentReader
{
    string? GetEnvironmentVariable(string variableName);
}

public sealed class AdapterDependencies
{
    public ICaptureTransport Transport { get; init; } = new WebSocketCaptureTransport();
    public IIdGenerator IdGenerator { get; init; } = new GuidIdGenerator();
    public IAdapterClock Clock { get; init; } = new SystemAdapterClock();
    public IAdapterDelay Delay { get; init; } = new SystemAdapterDelay();
    public IEnvironmentReader Environment { get; init; } = new SystemEnvironmentReader();
}

public sealed class GuidIdGenerator : IIdGenerator
{
    public Guid NextUuid() => Guid.NewGuid();
}

public sealed class SystemAdapterClock : IAdapterClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;

    public long GetTimestamp() => Stopwatch.GetTimestamp();

    public TimeSpan GetElapsed(long startTimestamp, long endTimestamp) => Stopwatch.GetElapsedTime(startTimestamp, endTimestamp);
}

public sealed class SystemAdapterDelay : IAdapterDelay
{
    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) => Task.Delay(delay, cancellationToken);
}

public sealed class SystemEnvironmentReader : IEnvironmentReader
{
    public string? GetEnvironmentVariable(string variableName) => Environment.GetEnvironmentVariable(variableName);
}

public sealed class ExchangeHandle
{
    internal ExchangeHandle(Guid exchangeId, long monotonicStart, DateTimeOffset wallClockStart, bool captured)
    {
        ExchangeId = exchangeId;
        MonotonicStart = monotonicStart;
        WallClockStart = wallClockStart;
        Captured = captured;
    }

    public Guid ExchangeId { get; }
    public long MonotonicStart { get; }
    public DateTimeOffset WallClockStart { get; }
    public bool IsCaptured => Captured;
    internal bool Captured { get; }
    internal int TerminalQueued;
}
