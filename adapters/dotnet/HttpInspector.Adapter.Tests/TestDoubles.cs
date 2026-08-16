using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

internal sealed class QueuedIdGenerator(IEnumerable<Guid> values) : IIdGenerator
{
    private readonly Queue<Guid> _values = new(values);

    public Guid NextUuid() => _values.Count > 0 ? _values.Dequeue() : Guid.NewGuid();
}

internal sealed class FakeClock : IAdapterClock
{
    public FakeClock(DateTimeOffset utcNow)
    {
        CurrentUtcNow = utcNow;
    }

    public DateTimeOffset CurrentUtcNow { get; set; }
    public long Timestamp { get; set; }
    public DateTimeOffset UtcNow => CurrentUtcNow;

    public long GetTimestamp() => Timestamp;

    public TimeSpan GetElapsed(long startTimestamp, long endTimestamp) => TimeSpan.FromMilliseconds(endTimestamp - startTimestamp);
}

internal sealed class FakeDelay : IAdapterDelay
{
    private readonly ConcurrentQueue<(TimeSpan Delay, TaskCompletionSource Completion)> _scheduled = [];

    public IReadOnlyCollection<TimeSpan> Scheduled => _scheduled.Select(value => value.Delay).ToArray();

    public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _scheduled.Enqueue((delay, completion));
        return completion.Task.WaitAsync(cancellationToken);
    }

    public void AdvanceNext()
    {
        Assert.True(_scheduled.TryDequeue(out var scheduled), "No scheduled delay was available.");
        scheduled.Completion.SetResult();
    }

    public void Advance(TimeSpan delay)
    {
        var retained = new List<(TimeSpan Delay, TaskCompletionSource Completion)>();
        TaskCompletionSource? selected = null;
        while (_scheduled.TryDequeue(out var scheduled))
        {
            if (selected is null && scheduled.Delay == delay)
            {
                selected = scheduled.Completion;
            }
            else
            {
                retained.Add(scheduled);
            }
        }

        foreach (var scheduled in retained)
        {
            _scheduled.Enqueue(scheduled);
        }

        Assert.NotNull(selected);
        selected!.SetResult();
    }
}

internal sealed class FakeEnvironment(string? endpoint = null) : IEnvironmentReader
{
    public string? GetEnvironmentVariable(string variableName) => variableName == "HTTP_INSPECTOR_WS" ? endpoint : null;
}

internal sealed class FakeCaptureTransport : ICaptureTransport
{
    private readonly Channel<JsonObject> _hellos = Channel.CreateUnbounded<JsonObject>();
    private readonly Channel<JsonObject> _messages = Channel.CreateUnbounded<JsonObject>();
    private readonly ConcurrentQueue<JsonObject> _recordedMessages = [];
    private readonly Queue<TaskCompletionSource<NegotiatedSession>> _connections = [];
    private readonly ConcurrentDictionary<string, TaskCompletionSource<MessageAcknowledgement>> _acknowledgements = [];
    private readonly bool _acceptImplicitConnection;

    public FakeCaptureTransport(bool acceptInitialConnection = true)
    {
        _acceptImplicitConnection = acceptInitialConnection;
        if (acceptInitialConnection)
        {
            QueueConnection(new NegotiatedSession(TestValues.ConnectionId, TestValues.SessionId, TestValues.MaximumMessageBytes, TestValues.MaximumBodyBytes));
        }
    }

    public int ConnectCount { get; private set; }
    public int FlushCount { get; private set; }
    public int CloseCount { get; private set; }
    public int MessageCount => _recordedMessages.Count;
    public int PendingAcknowledgementCount => _acknowledgements.Count;
    public IReadOnlyList<JsonObject> RecordedMessages => _recordedMessages.ToArray();
    public bool AutoAcceptMessages { get; set; } = true;
    public Exception? ConnectException { get; set; }

    public void QueueConnection(NegotiatedSession? session = null)
    {
        var completion = new TaskCompletionSource<NegotiatedSession>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (session is not null)
        {
            completion.SetResult(session);
        }

        _connections.Enqueue(completion);
    }

    public void RejectNextConnection(string code, bool retryable)
    {
        var completion = new TaskCompletionSource<NegotiatedSession>(TaskCreationOptions.RunContinuationsAsynchronously);
        completion.SetException(new CaptureTransportException(code, code, retryable));
        _connections.Enqueue(completion);
    }

    public async Task<NegotiatedSession> ConnectAsync(Uri endpoint, JsonObject clientHello, CancellationToken cancellationToken)
    {
        ConnectCount++;
        _hellos.Writer.TryWrite((JsonObject)clientHello.DeepClone());
        if (ConnectException is not null)
        {
            throw ConnectException;
        }

        if (_connections.Count == 0)
        {
            QueueConnection(_acceptImplicitConnection
                ? new NegotiatedSession(TestValues.ConnectionId, TestValues.SessionId, TestValues.MaximumMessageBytes, TestValues.MaximumBodyBytes)
                : null);
        }

        return await _connections.Dequeue().Task.WaitAsync(cancellationToken);
    }

    public async Task<MessageAcknowledgement> SendAsync(JsonObject message, CancellationToken cancellationToken)
    {
        _messages.Writer.TryWrite((JsonObject)message.DeepClone());
        _recordedMessages.Enqueue((JsonObject)message.DeepClone());
        var messageId = message["messageId"]!.GetValue<string>();
        if (AutoAcceptMessages)
        {
            return new MessageAcknowledgement(messageId, true);
        }

        var acknowledgement = new TaskCompletionSource<MessageAcknowledgement>(TaskCreationOptions.RunContinuationsAsynchronously);
        Assert.True(_acknowledgements.TryAdd(messageId, acknowledgement));
        return await acknowledgement.Task.WaitAsync(cancellationToken);
    }

    public Task FlushAsync(TimeSpan timeout, CancellationToken cancellationToken)
    {
        FlushCount++;
        return Task.CompletedTask;
    }

    public Task CloseAsync(CancellationToken cancellationToken)
    {
        CloseCount++;
        return Task.CompletedTask;
    }

    public ValueTask<JsonObject> ReadHelloAsync() => _hellos.Reader.ReadAsync();

    public ValueTask<JsonObject> ReadMessageAsync() => _messages.Reader.ReadAsync();

    public void Accept(string messageId) => Complete(messageId, new MessageAcknowledgement(messageId, true));

    public void Reject(string messageId, bool retryable = true) => Complete(messageId, new MessageAcknowledgement(messageId, false, "message.rejected", "rejected", retryable));

    public void Fail(string messageId, Exception exception)
    {
        Assert.True(_acknowledgements.TryRemove(messageId, out var acknowledgement), "No pending acknowledgement was available.");
        acknowledgement.SetException(exception);
    }

    private void Complete(string messageId, MessageAcknowledgement acknowledgement)
    {
        Assert.True(_acknowledgements.TryRemove(messageId, out var pending), "No pending acknowledgement was available.");
        pending.SetResult(acknowledgement);
    }
}

internal static class TestValues
{
    public const string Endpoint = "ws://127.0.0.1:53662/v1/capture";
    public const string AlternateEndpoint = "ws://127.0.0.1:54321/v1/capture";
    public const string SourceId = "11111111-2222-4333-8444-55555555b001";
    public const string OtherSourceId = "11111111-2222-4333-8444-55555555b002";
    public const string SessionId = "11111111-2222-4333-8444-55555555a001";
    public const string ConnectionId = "11111111-2222-4333-8444-55555555d001";
    public const string ExchangeA = "11111111-2222-4333-8444-55555555f001";
    public const string ExchangeB = "11111111-2222-4333-8444-55555555f002";
    public const string MessageStartA = "11111111-2222-4333-8444-55555555c001";
    public const string MessageCompleteA = "11111111-2222-4333-8444-55555555c002";
    public const string MessageStartB = "11111111-2222-4333-8444-55555555c003";
    public const string MessageCompleteB = "11111111-2222-4333-8444-55555555c004";
    public const ulong MaximumMessageBytes = 4 * 1024 * 1024;
    public const ulong MaximumBodyBytes = 1024 * 1024;
    public static readonly DateTimeOffset StartedAt = DateTimeOffset.Parse("2026-08-13T20:39:49.000Z");

    public static CapturedRequest RequestA() => new(
        "POST",
        "https://api.example.test/v1/documents/search?region=ca&region=on&includeClosed",
        [
            new CapturedHeader("Host", "api.example.test"),
            new CapturedHeader("User-Agent", "HTTPInspectorAdapterTDD/1.0"),
            new CapturedHeader("Accept", "application/json"),
            new CapturedHeader("Accept-Language", "en-CA,en;q=0.9"),
            new CapturedHeader("Content-Type", "application/json"),
            new CapturedHeader("Content-Length", "56"),
            new CapturedHeader("Authorization", "Bearer fixture-token"),
            new CapturedHeader("Cookie", "session=fixture-session; region=ca"),
            new CapturedHeader("X-Api-Key", "fixture-api-key"),
            new CapturedHeader("X-Project-Specific-Header", "project-value"),
            new CapturedHeader("X-Trace", "one"),
            new CapturedHeader("X-Trace", "two"),
        ],
        [
            new CapturedQuery("region", "ca"),
            new CapturedQuery("region", "on"),
            new CapturedQuery("includeClosed", null),
        ],
        CapturedBody.TextBody("{\"searchType\":\"IDNumber\",\"includeClosed\":false,\"page\":1}", "application/json"),
        "post",
        "https",
        "api.example.test",
        null,
        "/v1/documents/search",
        ["v1", "documents", "search"],
        null,
        "HTTP/2");

    public static CapturedResponse ResponseA() => new(
        200,
        [
            new CapturedHeader("Content-Type", "application/json; charset=utf-8"),
            new CapturedHeader("Set-Cookie", "session=fixture-a"),
            new CapturedHeader("Set-Cookie", "theme=dark"),
        ],
        CapturedBody.TextBody("{\"items\":[{\"id\":42,\"active\":true}],\"nextPage\":null}", "application/json"),
        "OK",
        "HTTP/2");

    public static AdapterDependencies Dependencies(FakeCaptureTransport transport, FakeClock? clock = null, FakeDelay? delay = null, IEnvironmentReader? environment = null, IEnumerable<Guid>? ids = null) => new()
    {
        Transport = transport,
        IdGenerator = new QueuedIdGenerator(ids ?? [
            Guid.Parse(SourceId),
            Guid.Parse(ExchangeA),
            Guid.Parse(MessageStartA),
            Guid.Parse(MessageCompleteA),
            Guid.Parse(ExchangeB),
            Guid.Parse(MessageStartB),
            Guid.Parse(MessageCompleteB),
        ]),
        Clock = clock ?? new FakeClock(StartedAt),
        Delay = delay ?? new FakeDelay(),
        Environment = environment ?? new FakeEnvironment(),
    };

    public static AdapterConfig Config(string? endpoint = Endpoint, int queueCapacity = 256) => new()
    {
        Endpoint = endpoint,
        ApplicationName = "test-application",
        ServiceName = "test-service",
        QueueCapacity = queueCapacity,
    };
}
