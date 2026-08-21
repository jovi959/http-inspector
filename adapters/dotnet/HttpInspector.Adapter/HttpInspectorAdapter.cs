using System.Collections.Concurrent;
using System.Data;
using System.Data.Common;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace HttpInspector.Adapter;

public sealed class HttpInspectorAdapter : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private readonly AdapterConfig _config;
    private readonly AdapterDependencies _dependencies;
    private readonly object _gate = new();
    private readonly Queue<OutboundMessage> _queue = [];
    private readonly Dictionary<Guid, OutboundMessage> _pending = [];
    private readonly Dictionary<Guid, ExchangeState> _exchanges = [];
    private readonly Queue<OutboundMessage> _databaseQueue = [];
    private readonly Dictionary<Guid, OutboundMessage> _databasePending = [];
    private readonly Dictionary<Guid, DatabaseCommandState> _databaseCommands = [];
    private readonly ConcurrentQueue<AdapterDiagnostic> _diagnostics = [];
    private readonly SemaphoreSlim _wake = new(0);
    private readonly CancellationTokenSource _stopping = new();
    private Task? _connectionWorker;
    private Task? _heartbeatWorker;
    private bool _started;
    private bool _stopped;
    private bool _connectionFaulted;
    private bool _hasConnected;
    private bool _reconnectDisabled;
    private long _droppedCount;
    private long _databaseDroppedCount;
    private NegotiatedSession? _negotiatedSession;
    private bool _databaseCapabilityDiagnosticRecorded;

    private HttpInspectorAdapter(AdapterConfig config, AdapterDependencies dependencies, Uri effectiveEndpoint)
    {
        _config = config;
        _dependencies = dependencies;
        EffectiveEndpoint = effectiveEndpoint;
        SourceInstanceId = dependencies.IdGenerator.NextUuid();
    }

    public Uri EffectiveEndpoint { get; }
    public Guid SourceInstanceId { get; }
    public NegotiatedSession? NegotiatedSession
    {
        get
        {
            lock (_gate)
            {
                return _negotiatedSession;
            }
        }
    }

    public long DroppedCount => Interlocked.Read(ref _droppedCount);
    public long DatabaseDroppedCount => Interlocked.Read(ref _databaseDroppedCount);
    public IReadOnlyList<AdapterDiagnostic> Diagnostics => _diagnostics.ToArray();

    public static HttpInspectorAdapter Create(AdapterConfig config, AdapterDependencies? dependencies = null)
    {
        ArgumentNullException.ThrowIfNull(config);
        dependencies ??= new AdapterDependencies();
        ValidateConfig(config);
        return new HttpInspectorAdapter(config, dependencies, ResolveEndpoint(config, dependencies.Environment));
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_started || _stopped)
            {
                return;
            }

            _started = true;
            _connectionWorker = Task.Run(() => ConnectionWorkerAsync(_stopping.Token));
            _heartbeatWorker = Task.Run(() => HeartbeatWorkerAsync(_stopping.Token));
        }
    }

    public ExchangeHandle CaptureStarted(CapturedRequest request, CaptureContext? context = null)
        => CaptureStarted(request, context, CaptureOrigin.AdapterApi);

    internal ExchangeHandle CaptureStarted(
        CapturedRequest request,
        CaptureContext? context,
        CaptureOrigin origin,
        long? monotonicStart = null,
        DateTimeOffset? wallClockStart = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        Start();

        var start = monotonicStart ?? _dependencies.Clock.GetTimestamp();
        var startedAt = wallClockStart ?? _dependencies.Clock.UtcNow;
        if (string.IsNullOrWhiteSpace(request.Method) || string.IsNullOrWhiteSpace(request.Url))
        {
            RecordDiagnostic("serialization", "A captured request requires a method and complete URL.", false);
            return new ExchangeHandle(Guid.Empty, start, startedAt, false);
        }

        if (IsInspectorEndpoint(request.Url))
        {
            return new ExchangeHandle(Guid.Empty, start, startedAt, false);
        }

        var exchangeId = _dependencies.IdGenerator.NextUuid();
        var handle = new ExchangeHandle(exchangeId, start, startedAt, true);
        var bodyLimit = MaximumBodyBytes;
        var message = BuildStartedMessage(exchangeId, request, context, origin, startedAt, bodyLimit);
        var state = new ExchangeState(handle, request, context, message.RequestJson!, message.TimingJson!, message.SizesJson!, message.CaptureJson!, message.MetadataJson!);

        lock (_gate)
        {
            if (_stopped || !TryEnqueueLocked(message))
            {
                handle.TerminalQueued = 1;
                return new ExchangeHandle(exchangeId, start, startedAt, false);
            }

            _exchanges[exchangeId] = state;
        }

        WakeWorker();
        return handle;
    }

    public void CaptureCompleted(ExchangeHandle handle, CapturedResponse response, CompletionData? data = null)
    {
        ArgumentNullException.ThrowIfNull(response);
        QueueTerminal(handle, "exchange.completed", response, null, null, data);
    }

    public void CaptureFailed(ExchangeHandle handle, CapturedFailure failure, CapturedResponse? response = null, CompletionData? data = null)
    {
        ArgumentNullException.ThrowIfNull(failure);
        QueueTerminal(handle, "exchange.failed", response, failure, null, data);
    }

    public void CaptureCancelled(ExchangeHandle handle, string origin, CompletionData? data = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(origin);
        QueueTerminal(handle, "exchange.cancelled", null, null, origin, data);
    }

    /// Captures one completed database command lifecycle without changing the application's database call path.
    public DatabaseCommandHandle CaptureDatabaseStarted(DbCommand command, CaptureContext? context = null)
    {
        ArgumentNullException.ThrowIfNull(command);
        Start();

        var start = _dependencies.Clock.GetTimestamp();
        var startedAt = _dependencies.Clock.UtcNow;
        var commandId = _dependencies.IdGenerator.NextUuid();
        var handle = new DatabaseCommandHandle(commandId, start, startedAt, true);
        var state = BuildDatabaseCommandState(handle, command, context);
        var message = BuildDatabaseStartedMessage(state, startedAt);

        lock (_gate)
        {
            if (_stopped || !TryEnqueueDatabaseLocked(message))
            {
                handle.TerminalQueued = 1;
                return new DatabaseCommandHandle(commandId, start, startedAt, false);
            }

            _databaseCommands[commandId] = state;
        }

        WakeWorker();
        return handle;
    }

    /// Completes database capture without attempting to read result rows or database streams.
    public void CaptureDatabaseCompleted(DatabaseCommandHandle handle)
    {
        QueueDatabaseTerminal(handle, "database.command.completed", null, null);
    }

    /// Records a provider failure while keeping the original SQL capture separate from HTTP failures.
    public void CaptureDatabaseFailed(DatabaseCommandHandle handle, Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        QueueDatabaseTerminal(handle, "database.command.failed", exception, null);
    }

    /// Records cancellation as a terminal database lifecycle state without affecting command execution.
    public void CaptureDatabaseCancelled(DatabaseCommandHandle handle, string origin)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(origin);
        QueueDatabaseTerminal(handle, "database.command.cancelled", null, origin);
    }

    public async Task FlushAsync(TimeSpan timeout)
    {
        if (timeout <= TimeSpan.Zero)
        {
            return;
        }

        using var timeoutSource = new CancellationTokenSource(timeout);
        try
        {
            await _dependencies.Transport.FlushAsync(timeout, timeoutSource.Token);
        }
        catch (OperationCanceledException) when (timeoutSource.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            RecordDiagnostic("endpointUnreachable", exception.Message, true);
        }
    }

    public async Task StopAsync(TimeSpan? flushTimeout = null)
    {
        Task? connectionWorker;
        Task? heartbeatWorker;
        lock (_gate)
        {
            if (_stopped)
            {
                return;
            }

            _stopped = true;
            connectionWorker = _connectionWorker;
            heartbeatWorker = _heartbeatWorker;
        }

        await FlushAsync(flushTimeout ?? TimeSpan.FromSeconds(1));
        _stopping.Cancel();
        WakeWorker();

        try
        {
            await _dependencies.Transport.CloseAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            RecordDiagnostic("endpointUnreachable", exception.Message, true);
        }

        await AwaitWorkerAsync(connectionWorker);
        await AwaitWorkerAsync(heartbeatWorker);

        lock (_gate)
        {
            _queue.Clear();
            _pending.Clear();
            _exchanges.Clear();
            _databaseQueue.Clear();
            _databasePending.Clear();
            _databaseCommands.Clear();
            _negotiatedSession = null;
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _stopping.Dispose();
        _wake.Dispose();
    }

    internal static Uri ResolveEndpoint(AdapterConfig config, IEnvironmentReader environment)
    {
        var endpoint = config.Endpoint;
        if (string.IsNullOrWhiteSpace(endpoint))
        {
            endpoint = environment.GetEnvironmentVariable("HTTP_INSPECTOR_WS");
        }

        endpoint = string.IsNullOrWhiteSpace(endpoint) ? HttpInspectorProtocol.DefaultEndpoint : endpoint;
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var parsed)
            || (parsed.Scheme != Uri.UriSchemeWs && parsed.Scheme != Uri.UriSchemeWss)
            || !HasExplicitPort(endpoint)
            || !string.Equals(parsed.AbsolutePath, "/v1/capture", StringComparison.Ordinal))
        {
            throw new ArgumentException("HTTP Inspector endpoint must be a complete ws:// or wss:// URL ending in /v1/capture with an explicit port.", nameof(config));
        }

        return parsed;
    }

    private static void ValidateConfig(AdapterConfig config)
    {
        if (!string.Equals(config.TransportProfile, HttpInspectorProtocol.TransportProfile, StringComparison.Ordinal))
        {
            throw new ArgumentException($"Only {HttpInspectorProtocol.TransportProfile} is supported.", nameof(config));
        }

        if (string.IsNullOrWhiteSpace(config.ApplicationName)
            || string.IsNullOrWhiteSpace(config.ServiceName)
            || string.IsNullOrWhiteSpace(config.Platform)
            || string.IsNullOrWhiteSpace(config.AdapterName)
            || string.IsNullOrWhiteSpace(config.AdapterVersion)
            || config.QueueCapacity <= 0
            || config.DatabaseQueueCapacity <= 0
            || config.MaximumDatabaseCaptureBytes == 0
            || config.HeartbeatInterval <= TimeSpan.Zero)
        {
            throw new ArgumentException("Adapter source fields, queue capacities, capture limits, and heartbeat interval must be valid.", nameof(config));
        }
    }

    private static bool HasExplicitPort(string endpoint)
    {
        var schemeEnd = endpoint.IndexOf("://", StringComparison.Ordinal);
        if (schemeEnd < 0)
        {
            return false;
        }

        var authorityEnd = endpoint.IndexOf('/', schemeEnd + 3);
        var authority = authorityEnd < 0 ? endpoint[(schemeEnd + 3)..] : endpoint[(schemeEnd + 3)..authorityEnd];
        return authority.LastIndexOf(':') > authority.LastIndexOf(']');
    }

    private async Task ConnectionWorkerAsync(CancellationToken cancellationToken)
    {
        var reconnectAttempt = 0;
        while (!cancellationToken.IsCancellationRequested && !_reconnectDisabled)
        {
            try
            {
                var session = await _dependencies.Transport.ConnectAsync(EffectiveEndpoint, BuildHello(), cancellationToken);
                lock (_gate)
                {
                    _negotiatedSession = session;
                    _connectionFaulted = false;
                    if (!session.SupportsDatabaseCommandCapture)
                    {
                        DropUnsupportedDatabaseCaptureLocked();
                    }
                }

                if (_hasConnected)
                {
                    QueueRecoverySnapshots(session);
                }

                _hasConnected = true;
                reconnectAttempt = 0;

                while (!cancellationToken.IsCancellationRequested)
                {
                    OutboundMessage? message;
                    lock (_gate)
                    {
                        if (_connectionFaulted)
                        {
                            break;
                        }

                        message = _queue.Count > 0 ? _queue.Dequeue() : _databaseQueue.Count > 0 ? _databaseQueue.Dequeue() : null;
                    }

                    if (message is null)
                    {
                        await _wake.WaitAsync(cancellationToken);
                        continue;
                    }

                    Dispatch(message, cancellationToken);
                }

                if (!cancellationToken.IsCancellationRequested)
                {
                    throw new CaptureTransportException("listenerRestarted", "The capture connection was interrupted.", true);
                }
            }
            catch (CaptureTransportException exception) when (!cancellationToken.IsCancellationRequested)
            {
                RecordDiagnostic(exception.Code, exception.Message, exception.Retryable);
                if (!exception.Retryable)
                {
                    _reconnectDisabled = true;
                    break;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
            {
                RecordDiagnostic("connectionRefused", exception.Message, true);
            }
            finally
            {
                lock (_gate)
                {
                    _negotiatedSession = null;
                }

                try
                {
                    await _dependencies.Transport.CloseAsync(CancellationToken.None);
                }
                catch
                {
                }
            }

            if (!cancellationToken.IsCancellationRequested && !_reconnectDisabled)
            {
                var delay = ReconnectDelay(reconnectAttempt++);
                await _dependencies.Delay.DelayAsync(delay, cancellationToken);
            }
        }
    }

    private async Task HeartbeatWorkerAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await _dependencies.Delay.DelayAsync(_config.HeartbeatInterval, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }

            lock (_gate)
            {
                if (_stopped || _negotiatedSession is null)
                {
                    continue;
                }

                TryEnqueueLocked(BuildHeartbeatMessage());
            }

            WakeWorker();
        }
    }

    private void QueueTerminal(
        ExchangeHandle handle,
        string type,
        CapturedResponse? response,
        CapturedFailure? failure,
        string? origin,
        CompletionData? data)
    {
        ArgumentNullException.ThrowIfNull(handle);
        if (!handle.Captured || Interlocked.Exchange(ref handle.TerminalQueued, 1) != 0)
        {
            return;
        }

        var endedAt = _dependencies.Clock.UtcNow;
        var elapsed = _dependencies.Clock.GetElapsed(handle.MonotonicStart, _dependencies.Clock.GetTimestamp());
        var bodyLimit = MaximumBodyBytes;
        lock (_gate)
        {
            if (_stopped || !_exchanges.TryGetValue(handle.ExchangeId, out var state))
            {
                return;
            }

            var message = BuildTerminalMessage(type, handle.ExchangeId, response, failure, origin, state, elapsed, endedAt, bodyLimit, data);
            if (!TryEnqueueLocked(message))
            {
                _exchanges.Remove(handle.ExchangeId);
                return;
            }

            state.ApplyTerminal(type, response, failure, origin, message, endedAt, elapsed);
        }

        WakeWorker();
    }

    private void QueueDatabaseTerminal(DatabaseCommandHandle handle, string type, Exception? exception, string? origin)
    {
        ArgumentNullException.ThrowIfNull(handle);
        if (!handle.Captured || Interlocked.Exchange(ref handle.TerminalQueued, 1) != 0)
        {
            return;
        }

        var endedAt = _dependencies.Clock.UtcNow;
        var elapsed = _dependencies.Clock.GetElapsed(handle.MonotonicStart, _dependencies.Clock.GetTimestamp());
        lock (_gate)
        {
            if (_stopped || !_databaseCommands.TryGetValue(handle.CommandId, out var state))
            {
                return;
            }

            var message = BuildDatabaseTerminalMessage(type, state, elapsed, endedAt, exception, origin);
            if (!TryEnqueueDatabaseLocked(message))
            {
                _databaseCommands.Remove(handle.CommandId);
                return;
            }

            state.ApplyTerminal(type, endedAt, elapsed, exception, origin);
        }

        WakeWorker();
    }

    private void Dispatch(OutboundMessage message, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            PendingFor(message.Stream)[message.MessageId] = message;
        }

        _ = ObserveAcknowledgementAsync(message, cancellationToken);
    }

    private async Task ObserveAcknowledgementAsync(OutboundMessage message, CancellationToken cancellationToken)
    {
        try
        {
            var acknowledgement = await _dependencies.Transport.SendAsync(message.Payload, cancellationToken);
            if (!Guid.TryParse(acknowledgement.MessageId, out var acknowledgementId) || acknowledgementId != message.MessageId)
            {
                throw new CaptureTransportException("messageRejected", "The listener acknowledgement did not match the sent message ID.", true);
            }

            lock (_gate)
            {
                PendingFor(message.Stream).Remove(message.MessageId);
                if (acknowledgement.Accepted && message.ReleasesExchangeOnAcknowledgement)
                {
                    _exchanges.Remove(message.ExchangeId!.Value);
                }
                if (acknowledgement.Accepted && message.ReleasesDatabaseCommandOnAcknowledgement)
                {
                    _databaseCommands.Remove(message.DatabaseCommandId!.Value);
                }
            }

            if (!acknowledgement.Accepted)
            {
                RecordDiagnostic(acknowledgement.ErrorCode ?? "messageRejected", acknowledgement.ErrorMessage ?? "The listener rejected a capture message.", acknowledgement.Retryable);
                if (acknowledgement.Retryable)
                {
                    RequeueForRetry(message);
                }
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (CaptureTransportException exception)
        {
            RecordDiagnostic(exception.Code, exception.Message, exception.Retryable);
            if (exception.Retryable)
            {
                RequeueForRetry(message);
                SignalConnectionFault();
            }
        }
        catch (Exception exception)
        {
            RequeueForRetry(message);
            RecordDiagnostic("endpointUnreachable", exception.Message, true);
            SignalConnectionFault();
        }
    }

    private void RequeueForRetry(OutboundMessage message)
    {
        lock (_gate)
        {
            PendingFor(message.Stream).Remove(message.MessageId);
            if (_stopped)
            {
                return;
            }

            var retryQueue = new Queue<OutboundMessage>();
            retryQueue.Enqueue(message);
            var queue = QueueFor(message.Stream);
            while (queue.Count > 0)
            {
                retryQueue.Enqueue(queue.Dequeue());
            }

            while (retryQueue.Count > 0)
            {
                queue.Enqueue(retryQueue.Dequeue());
            }
        }

        WakeWorker();
    }

    private void SignalConnectionFault()
    {
        lock (_gate)
        {
            _connectionFaulted = true;
        }

        WakeWorker();
    }

    private void QueueRecoverySnapshots(NegotiatedSession session)
    {
        lock (_gate)
        {
            foreach (var state in _exchanges.Values.ToArray())
            {
                state.Revision += 2;
                var snapshot = BuildSnapshotMessage(state, session);
                TryEnqueueLocked(snapshot);
            }
        }

        WakeWorker();
    }

    private bool TryEnqueueLocked(OutboundMessage message)
    {
        if (_queue.Count + _pending.Count >= _config.QueueCapacity)
        {
            Interlocked.Increment(ref _droppedCount);
            RecordDiagnostic("queueOverloaded", "The bounded capture queue is full; host HTTP execution was not affected.", true);
            return false;
        }

        _queue.Enqueue(message);
        return true;
    }

    private bool TryEnqueueDatabaseLocked(OutboundMessage message)
    {
        if (_negotiatedSession is not null && !_negotiatedSession.SupportsDatabaseCommandCapture)
        {
            return false;
        }
        if (_databaseQueue.Count + _databasePending.Count >= _config.DatabaseQueueCapacity)
        {
            Interlocked.Increment(ref _databaseDroppedCount);
            RecordDiagnostic("databaseQueueOverloaded", "The bounded database capture queue is full; database execution was not affected.", true);
            return false;
        }

        _databaseQueue.Enqueue(message);
        return true;
    }

    private Queue<OutboundMessage> QueueFor(CaptureStream stream) => stream == CaptureStream.Database ? _databaseQueue : _queue;

    private Dictionary<Guid, OutboundMessage> PendingFor(CaptureStream stream) => stream == CaptureStream.Database ? _databasePending : _pending;

    private void DropUnsupportedDatabaseCaptureLocked()
    {
        var hadDatabaseCapture = _databaseQueue.Count > 0 || _databasePending.Count > 0 || _databaseCommands.Count > 0;
        _databaseQueue.Clear();
        _databasePending.Clear();
        _databaseCommands.Clear();
        if (!hadDatabaseCapture || _databaseCapabilityDiagnosticRecorded)
        {
            return;
        }

        _databaseCapabilityDiagnosticRecorded = true;
        RecordDiagnostic("databaseCaptureUnsupported", "The connected HTTP Inspector listener does not advertise database command capture; HTTP capture continues unchanged.", false);
    }

    private JsonObject BuildHello() => new()
    {
        ["schemaVersion"] = VersionJson(),
        ["supportedProtocol"] = new JsonObject
        {
            ["minimum"] = VersionJson(),
            ["maximum"] = VersionJson(),
        },
        ["source"] = SourceJson(),
    };

    private OutboundMessage BuildStartedMessage(Guid exchangeId, CapturedRequest request, CaptureContext? context, CaptureOrigin origin, DateTimeOffset sentAt, ulong maximumBodyBytes)
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var requestJson = RequestJson(request, maximumBodyBytes);
        var timing = EmptyTiming();
        var metadata = origin.ToMetadata();
        var payload = LifecycleBase("exchange.started", exchangeId, 1, sentAt, messageId);
        payload["request"] = requestJson;
        payload["timing"] = timing;
        payload["tags"] = new JsonArray();
        payload["correlation"] = CorrelationJson(context);
        payload["metadata"] = metadata;
        return new OutboundMessage(messageId, exchangeId, 1, payload, false, requestJson, timing, EmptySizes(), CaptureJson(request, null), null, metadata);
    }

    private OutboundMessage BuildTerminalMessage(
        string type,
        Guid exchangeId,
        CapturedResponse? response,
        CapturedFailure? failure,
        string? origin,
        ExchangeState state,
        TimeSpan elapsed,
        DateTimeOffset sentAt,
        ulong maximumBodyBytes,
        CompletionData? completionData)
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var payload = LifecycleBase(type, exchangeId, 2, sentAt, messageId);
        var responseJson = response is null ? null : ResponseJson(response, maximumBodyBytes);
        var timing = TerminalTiming(elapsed);
        var sizes = SizesJson(state.Request, response, maximumBodyBytes);
        var capture = CaptureJson(state.Request, response);

        if (type == "exchange.completed")
        {
            payload["response"] = responseJson;
            payload["timing"] = timing;
            payload["sizes"] = sizes;
            payload["capture"] = capture;
            payload["metadataPatch"] = MetadataPatch(state.MetadataJson, completionData);
        }
        else if (type == "exchange.failed")
        {
            payload["failure"] = new JsonObject
            {
                ["category"] = failure!.Category,
                ["message"] = failure.Message,
                ["retryable"] = failure.Retryable,
                ["code"] = failure.Code,
            };
            payload["response"] = responseJson;
            payload["timing"] = timing;
            payload["sizes"] = sizes;
            payload["capture"] = capture;
            payload["metadataPatch"] = MetadataPatch(state.MetadataJson, completionData);
        }
        else
        {
            payload["origin"] = origin;
            payload["timing"] = timing;
            payload["sizes"] = sizes;
            payload["capture"] = capture;
        }

        return new OutboundMessage(messageId, exchangeId, 2, payload, true, state.RequestJson, timing, sizes, capture, responseJson);
    }

    private DatabaseCommandState BuildDatabaseCommandState(DatabaseCommandHandle handle, DbCommand command, CaptureContext? context)
    {
        var query = DatabaseQueryJson(command.CommandText);
        var parameters = DatabaseParametersJson(command.Parameters);
        return new DatabaseCommandState(
            handle,
            context,
            ProviderName(command),
            string.IsNullOrWhiteSpace(command.Connection?.Database) ? "Unknown database" : command.Connection.Database,
            command.Connection?.DataSource,
            command.CommandType.ToString(),
            DatabaseOperation(command),
            DatabasePrimaryTarget(command.CommandText),
            query,
            parameters);
    }

    private OutboundMessage BuildDatabaseStartedMessage(DatabaseCommandState state, DateTimeOffset sentAt)
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var payload = DatabaseLifecycleBase("database.command.started", state.Handle.CommandId, 1, sentAt, messageId);
        payload["provider"] = state.Provider;
        payload["databaseName"] = state.DatabaseName;
        payload["dataSource"] = state.DataSource;
        payload["commandType"] = state.CommandType;
        payload["operation"] = state.Operation;
        payload["primaryTarget"] = state.PrimaryTarget;
        payload["query"] = state.QueryJson.DeepClone();
        payload["parameters"] = state.ParametersJson.DeepClone();
        payload["correlation"] = CorrelationJson(state.Context);
        return new OutboundMessage(messageId, null, 1, payload, false, null, null, null, null)
        {
            Stream = CaptureStream.Database,
            DatabaseCommandId = state.Handle.CommandId,
        };
    }

    private OutboundMessage BuildDatabaseTerminalMessage(
        string type,
        DatabaseCommandState state,
        TimeSpan elapsed,
        DateTimeOffset sentAt,
        Exception? exception,
        string? origin)
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var payload = DatabaseLifecycleBase(type, state.Handle.CommandId, 2, sentAt, messageId);
        payload["totalDuration"] = DurationJson((ulong)Math.Max(0, (long)elapsed.TotalMilliseconds), "measured");
        payload["result"] = DatabaseResultJson();
        if (type == "database.command.failed")
        {
            payload["failure"] = new JsonObject
            {
                ["category"] = "provider",
                ["errorType"] = exception!.GetType().FullName,
                ["message"] = exception.Message,
            };
        }
        else if (type == "database.command.cancelled")
        {
            payload["origin"] = origin;
        }

        return new OutboundMessage(messageId, null, 2, payload, false, null, null, null, null)
        {
            Stream = CaptureStream.Database,
            DatabaseCommandId = state.Handle.CommandId,
            ReleasesDatabaseCommandOnAcknowledgement = true,
        };
    }

    private OutboundMessage BuildHeartbeatMessage()
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var payload = new JsonObject
        {
            ["type"] = "heartbeat",
            ["schemaVersion"] = VersionJson(),
            ["messageId"] = messageId.ToString(),
            ["sourceInstanceId"] = SourceInstanceId.ToString(),
            ["sentAt"] = Timestamp(_dependencies.Clock.UtcNow),
            ["queuedCount"] = _queue.Count + _pending.Count + _databaseQueue.Count + _databasePending.Count,
            ["droppedCount"] = DroppedCount + DatabaseDroppedCount,
        };
        return new OutboundMessage(messageId, null, null, payload, false, null, null, null, null);
    }

    private OutboundMessage BuildSnapshotMessage(ExchangeState state, NegotiatedSession session)
    {
        var messageId = _dependencies.IdGenerator.NextUuid();
        var payload = LifecycleBase("exchange.snapshot", state.Handle.ExchangeId, state.Revision, _dependencies.Clock.UtcNow, messageId);
        payload["exchange"] = new JsonObject
        {
            ["schemaVersion"] = VersionJson(),
            ["id"] = state.Handle.ExchangeId.ToString(),
            ["sessionId"] = session.SessionId,
            ["revision"] = state.Revision,
            ["arrivalSequence"] = 1,
            ["source"] = SourceJson(),
            ["lifecycle"] = new JsonObject
            {
                ["state"] = state.LifecycleState,
                ["startedAt"] = Timestamp(state.Handle.WallClockStart),
                ["receivedAt"] = Timestamp(state.Handle.WallClockStart),
                ["lastUpdatedAt"] = Timestamp(state.LastUpdatedAt),
            },
            ["request"] = state.RequestJson.DeepClone(),
            ["response"] = state.ResponseJson?.DeepClone(),
            ["failure"] = state.FailureJson?.DeepClone(),
            ["correlation"] = CorrelationJson(state.Context),
            ["timing"] = state.TimingJson.DeepClone(),
            ["sizes"] = state.SizesJson.DeepClone(),
            ["capture"] = state.CaptureJson.DeepClone(),
            ["tags"] = new JsonArray(),
            ["metadata"] = state.MetadataJson.DeepClone(),
            ["transport"] = null,
        };
        return new OutboundMessage(messageId, state.Handle.ExchangeId, state.Revision, payload, state.IsTerminal, state.RequestJson, state.TimingJson, state.SizesJson, state.CaptureJson, state.ResponseJson);
    }

    private JsonObject LifecycleBase(string type, Guid exchangeId, ulong revision, DateTimeOffset sentAt, Guid messageId)
    {
        return new JsonObject
        {
            ["type"] = type,
            ["schemaVersion"] = VersionJson(),
            ["messageId"] = messageId.ToString(),
            ["exchangeId"] = exchangeId.ToString(),
            ["sourceInstanceId"] = SourceInstanceId.ToString(),
            ["revision"] = revision,
            ["sentAt"] = Timestamp(sentAt),
        };
    }

    private JsonObject DatabaseLifecycleBase(string type, Guid commandId, ulong revision, DateTimeOffset sentAt, Guid messageId)
    {
        return new JsonObject
        {
            ["type"] = type,
            ["schemaVersion"] = VersionJson(),
            ["messageId"] = messageId.ToString(),
            ["commandId"] = commandId.ToString(),
            ["sourceInstanceId"] = SourceInstanceId.ToString(),
            ["revision"] = revision,
            ["sentAt"] = Timestamp(sentAt),
        };
    }

    private JsonObject DatabaseQueryJson(string? commandText)
    {
        if (commandText is null)
        {
            return DatabaseUnavailableJson("command text was unavailable");
        }

        var observedByteLength = Encoding.UTF8.GetByteCount(commandText);
        if ((ulong)observedByteLength > _config.MaximumDatabaseCaptureBytes)
        {
            return DatabaseUnavailableJson("command text exceeds the database capture limit", observedByteLength);
        }

        return new JsonObject
        {
            ["availability"] = "captured",
            ["value"] = commandText,
            ["observedByteLength"] = observedByteLength,
            ["capturedByteLength"] = observedByteLength,
            ["reason"] = null,
        };
    }

    private JsonObject DatabaseParametersJson(DbParameterCollection parameters)
    {
        var values = new JsonArray();
        foreach (DbParameter parameter in parameters)
        {
            values.Add(DatabaseParameterJson(parameter));
        }

        var observedByteLength = Encoding.UTF8.GetByteCount(values.ToJsonString(JsonOptions));
        if ((ulong)observedByteLength > _config.MaximumDatabaseCaptureBytes)
        {
            return new JsonObject
            {
                ["availability"] = "unavailable",
                ["values"] = new JsonArray(),
                ["observedByteLength"] = observedByteLength,
                ["capturedByteLength"] = null,
                ["reason"] = "parameter payload exceeds the database capture limit",
            };
        }

        return new JsonObject
        {
            ["availability"] = "captured",
            ["values"] = values,
            ["observedByteLength"] = observedByteLength,
            ["capturedByteLength"] = observedByteLength,
            ["reason"] = null,
        };
    }

    private static JsonObject DatabaseParameterJson(DbParameter parameter)
    {
        var value = DatabaseParameterValueJson(parameter.Value, out var availability, out var reason);
        return new JsonObject
        {
            ["name"] = parameter.ParameterName,
            ["value"] = value,
            ["dbType"] = parameter.DbType.ToString(),
            ["direction"] = parameter.Direction.ToString(),
            ["size"] = parameter.Size,
            ["precision"] = parameter.Precision,
            ["scale"] = parameter.Scale,
            ["availability"] = availability,
            ["reason"] = reason,
        };
    }

    private static JsonNode? DatabaseParameterValueJson(object? value, out string availability, out string? reason)
    {
        if (value is null || value is DBNull)
        {
            availability = "captured";
            reason = null;
            return null;
        }
        if (value is Stream or TextReader)
        {
            availability = "unavailable";
            reason = "stream parameter values are not consumed for capture";
            return null;
        }

        try
        {
            availability = "captured";
            reason = null;
            return JsonSerializer.SerializeToNode(value, value.GetType(), JsonOptions);
        }
        catch (Exception)
        {
            availability = "unavailable";
            reason = "parameter value could not be serialized without altering execution";
            return null;
        }
    }

    private static JsonObject DatabaseUnavailableJson(string reason, int? observedByteLength = null) => new()
    {
        ["availability"] = "unavailable",
        ["value"] = null,
        ["observedByteLength"] = observedByteLength,
        ["capturedByteLength"] = null,
        ["reason"] = reason,
    };

    private static JsonObject DatabaseResultJson() => new()
    {
        ["availability"] = "unavailable",
        ["reason"] = "result rows are not captured",
    };

    private static string ProviderName(DbCommand command) => command.GetType().Assembly.GetName().Name ?? command.GetType().Namespace ?? "unknown";

    private static string DatabaseOperation(DbCommand command)
    {
        if (command.CommandType == CommandType.StoredProcedure)
        {
            return "storedProcedure";
        }

        var firstKeyword = Regex.Match(command.CommandText ?? string.Empty, @"(?i)\b(select|insert|update|delete|merge|execute)\b");
        return firstKeyword.Success ? firstKeyword.Groups[1].Value.ToUpperInvariant() : "unknown";
    }

    private static string DatabasePrimaryTarget(string? commandText)
    {
        var target = Regex.Match(commandText ?? string.Empty, @"(?ix)\b(?:from|join|into|update)\s+((?:\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][\w$]*)){0,2})");
        return target.Success ? target.Groups[1].Value.Replace(" ", string.Empty, StringComparison.Ordinal) : "Unknown target";
    }

    private JsonObject SourceJson() => new()
    {
        ["instanceId"] = SourceInstanceId.ToString(),
        ["applicationName"] = _config.ApplicationName,
        ["serviceName"] = _config.ServiceName,
        ["platform"] = _config.Platform,
        ["adapterName"] = _config.AdapterName,
        ["adapterVersion"] = _config.AdapterVersion,
        ["protocolVersion"] = VersionJson(),
        ["environment"] = _config.Environment,
        ["deviceName"] = _config.DeviceName,
        ["processId"] = _config.ProcessId,
        ["buildVersion"] = _config.BuildVersion,
        ["baseUrl"] = _config.BaseUrl,
        ["metadata"] = _config.SourceMetadata.DeepClone(),
    };

    private static JsonObject VersionJson() => new() { ["major"] = 1, ["minor"] = 0 };

    private static JsonObject? CorrelationJson(CaptureContext? context)
    {
        if (context is null)
        {
            return null;
        }

        return new JsonObject
        {
            ["traceId"] = context.TraceId,
            ["spanId"] = context.SpanId,
            ["parentSpanId"] = context.ParentSpanId,
            ["operationId"] = context.OperationId,
            ["parentExchangeId"] = context.ParentExchangeId,
        };
    }

    private static JsonObject MetadataPatch(JsonObject metadata, CompletionData? completionData)
    {
        var patch = (JsonObject)metadata.DeepClone();
        if (completionData?.MetadataPatch is null)
        {
            return patch;
        }

        foreach (var item in completionData.MetadataPatch)
        {
            patch[item.Key] = item.Value?.DeepClone();
        }

        return patch;
    }

    private static string Timestamp(DateTimeOffset value) => value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    private static JsonObject RequestJson(CapturedRequest request, ulong maximumBodyBytes) => new()
    {
        ["method"] = request.Method,
        ["originalMethod"] = request.OriginalMethod,
        ["url"] = request.Url,
        ["scheme"] = request.Scheme,
        ["host"] = request.Host,
        ["port"] = request.Port,
        ["path"] = request.Path,
        ["pathSegments"] = ArrayJson(request.PathSegments ?? []),
        ["fragment"] = request.Fragment,
        ["query"] = QueryJson(request.Query),
        ["protocol"] = request.Protocol,
        ["headers"] = HeadersJson(request.Headers),
        ["body"] = BodyJson(request.Body, maximumBodyBytes),
        ["raw"] = BodyJson(request.Raw, maximumBodyBytes),
        ["remoteAddress"] = null,
        ["localAddress"] = null,
    };

    private static JsonObject ResponseJson(CapturedResponse response, ulong maximumBodyBytes) => new()
    {
        ["statusCode"] = response.StatusCode,
        ["reasonPhrase"] = response.ReasonPhrase,
        ["protocol"] = response.Protocol,
        ["headers"] = HeadersJson(response.Headers),
        ["body"] = BodyJson(response.Body, maximumBodyBytes),
        ["raw"] = BodyJson(response.Raw, maximumBodyBytes),
    };

    private static JsonArray HeadersJson(IReadOnlyList<CapturedHeader> headers)
    {
        var result = new JsonArray();
        foreach (var header in headers)
        {
            result.Add(new JsonObject { ["name"] = header.Name, ["value"] = header.Value, ["provenance"] = header.Provenance });
        }

        return result;
    }

    private static JsonArray QueryJson(IReadOnlyList<CapturedQuery> query)
    {
        var result = new JsonArray();
        foreach (var value in query)
        {
            result.Add(new JsonObject { ["name"] = value.Name, ["value"] = value.Value, ["provenance"] = value.Provenance });
        }

        return result;
    }

    private static JsonArray ArrayJson(IReadOnlyList<string> values)
    {
        var result = new JsonArray();
        foreach (var value in values)
        {
            result.Add(value);
        }

        return result;
    }

    private static JsonObject? BodyJson(CapturedBody? body, ulong maximumBodyBytes)
    {
        if (body is null)
        {
            return null;
        }

        var observedLength = body.ObservedByteLength;
        var exceedsLimit = observedLength is not null && (ulong)observedLength.Value > maximumBodyBytes;
        var availability = exceedsLimit ? "unavailable" : body.Availability;
        JsonObject? content = null;
        if (!exceedsLimit && availability == "captured")
        {
            content = body.Text is not null
                ? new JsonObject { ["kind"] = "inlineText", ["value"] = body.Text }
                : new JsonObject { ["kind"] = "inlineBase64", ["value"] = Convert.ToBase64String(body.Binary ?? []) };
        }

        return new JsonObject
        {
            ["availability"] = availability,
            ["mediaType"] = body.MediaType,
            ["charset"] = body.Charset,
            ["contentEncoding"] = body.ContentEncoding,
            ["declaredByteLength"] = body.DeclaredByteLength,
            ["observedByteLength"] = observedLength,
            ["capturedByteLength"] = exceedsLimit ? null : observedLength,
            ["sha256"] = null,
            ["content"] = content,
            ["truncationReason"] = null,
        };
    }

    private static JsonObject EmptyTiming() => new()
    {
        ["requestHeadersSentMs"] = null,
        ["requestBodyFinishedMs"] = null,
        ["responseHeadersReceivedMs"] = null,
        ["responseBodyFinishedMs"] = null,
        ["exchangeEndedMs"] = null,
        ["dns"] = DurationJson(null, "unavailable"),
        ["connect"] = DurationJson(null, "unavailable"),
        ["tls"] = DurationJson(null, "unavailable"),
        ["queue"] = DurationJson(null, "unavailable"),
        ["requestWrite"] = DurationJson(null, "unavailable"),
        ["serverWait"] = DurationJson(null, "unavailable"),
        ["responseRead"] = DurationJson(null, "unavailable"),
        ["total"] = DurationJson(null, "unavailable"),
    };

    private static JsonObject TerminalTiming(TimeSpan elapsed)
    {
        var milliseconds = (ulong)Math.Max(0, (long)elapsed.TotalMilliseconds);
        var timing = EmptyTiming();
        timing["exchangeEndedMs"] = milliseconds;
        timing["total"] = DurationJson(milliseconds, "measured");
        return timing;
    }

    private static JsonObject DurationJson(ulong? milliseconds, string provenance) => new()
    {
        ["milliseconds"] = milliseconds,
        ["provenance"] = provenance,
    };

    private static JsonObject EmptySizes() => new()
    {
        ["requestHeaders"] = ByteCountJson(null, "unavailable"),
        ["requestBody"] = ByteCountJson(null, "unavailable"),
        ["responseHeaders"] = ByteCountJson(null, "unavailable"),
        ["responseBody"] = ByteCountJson(null, "unavailable"),
        ["total"] = ByteCountJson(null, "unavailable"),
    };

    private static JsonObject SizesJson(CapturedRequest request, CapturedResponse? response, ulong maximumBodyBytes)
    {
        var requestBody = BodyJson(request.Body, maximumBodyBytes);
        var responseBody = response is null ? null : BodyJson(response.Body, maximumBodyBytes);
        var requestBytes = BodyByteCount(requestBody);
        var responseBytes = BodyByteCount(responseBody);
        return new JsonObject
        {
            ["requestHeaders"] = ByteCountJson(null, "unavailable"),
            ["requestBody"] = ByteCountJson(requestBytes, requestBytes is null ? "unavailable" : "exact"),
            ["responseHeaders"] = ByteCountJson(null, "unavailable"),
            ["responseBody"] = ByteCountJson(responseBytes, responseBytes is null ? "unavailable" : "exact"),
            ["total"] = ByteCountJson(null, "unavailable"),
        };
    }

    private static ulong? BodyByteCount(JsonObject? body)
    {
        var availability = body?["availability"]?.GetValue<string>();
        if (availability is not "captured" and not "empty")
        {
            return null;
        }

        var capturedLength = body?["capturedByteLength"];
        return capturedLength is null ? null : checked((ulong)capturedLength.GetValue<long>());
    }

    private static JsonObject ByteCountJson(ulong? bytes, string provenance) => new()
    {
        ["bytes"] = bytes,
        ["provenance"] = provenance,
    };

    private static JsonObject CaptureJson(CapturedRequest request, CapturedResponse? response) => new()
    {
        ["requestHeaders"] = "exact",
        ["responseHeaders"] = response is null ? "unavailable" : "exact",
        ["requestBody"] = BodyProvenance(request.Body),
        ["responseBody"] = response is null ? "unavailable" : BodyProvenance(response.Body),
        ["timing"] = "measured",
        ["sizes"] = "unavailable",
        ["requestRaw"] = BodyProvenance(request.Raw),
        ["responseRaw"] = response is null ? "unavailable" : BodyProvenance(response.Raw),
    };

    private static string BodyProvenance(CapturedBody? body) => body?.Availability switch
    {
        "captured" or "empty" => "exact",
        "truncated" => "truncated",
        _ => "unavailable",
    };

    internal ulong MaximumBodyBytes
    {
        get
        {
            lock (_gate)
            {
                return _negotiatedSession?.MaximumBodyBytes ?? 1024UL * 1024UL;
            }
        }
    }

    internal (long MonotonicStart, DateTimeOffset WallClockStart) GetCaptureStartTiming() =>
        (_dependencies.Clock.GetTimestamp(), _dependencies.Clock.UtcNow);

    internal bool IsInspectorEndpoint(string url)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var requestUri)
            && string.Equals(requestUri.Host, EffectiveEndpoint.Host, StringComparison.OrdinalIgnoreCase)
            && requestUri.Port == EffectiveEndpoint.Port
            && string.Equals(requestUri.AbsolutePath, EffectiveEndpoint.AbsolutePath, StringComparison.Ordinal);
    }

    private static TimeSpan ReconnectDelay(int attempt) => attempt switch
    {
        0 => TimeSpan.FromMilliseconds(250),
        1 => TimeSpan.FromMilliseconds(500),
        2 => TimeSpan.FromSeconds(1),
        3 => TimeSpan.FromSeconds(2),
        _ => TimeSpan.FromSeconds(5),
    };

    private void WakeWorker()
    {
        try
        {
            _wake.Release();
        }
        catch (SemaphoreFullException)
        {
        }
    }

    private void RecordDiagnostic(string code, string message, bool retryable)
    {
        _diagnostics.Enqueue(new AdapterDiagnostic(code, EffectiveEndpoint, HttpInspectorProtocol.TransportProfile, message, _dependencies.Clock.UtcNow, retryable));
    }

    private static async Task AwaitWorkerAsync(Task? worker)
    {
        if (worker is null)
        {
            return;
        }

        try
        {
            await worker;
        }
        catch (OperationCanceledException)
        {
        }
    }

    private sealed class OutboundMessage(
        Guid messageId,
        Guid? exchangeId,
        ulong? revision,
        JsonObject payload,
        bool releasesExchangeOnAcknowledgement,
        JsonObject? requestJson,
        JsonObject? timingJson,
        JsonObject? sizesJson,
        JsonObject? captureJson,
        JsonObject? responseJson = null,
        JsonObject? metadataJson = null)
    {
        public Guid MessageId { get; } = messageId;
        public Guid? ExchangeId { get; } = exchangeId;
        public ulong? Revision { get; } = revision;
        public JsonObject Payload { get; } = payload;
        public bool ReleasesExchangeOnAcknowledgement { get; } = releasesExchangeOnAcknowledgement;
        public JsonObject? RequestJson { get; } = requestJson;
        public JsonObject? TimingJson { get; } = timingJson;
        public JsonObject? SizesJson { get; } = sizesJson;
        public JsonObject? CaptureJson { get; } = captureJson;
        public JsonObject? ResponseJson { get; } = responseJson;
        public JsonObject? MetadataJson { get; } = metadataJson;
        public CaptureStream Stream { get; init; } = CaptureStream.Http;
        public Guid? DatabaseCommandId { get; init; }
        public bool ReleasesDatabaseCommandOnAcknowledgement { get; init; }
    }

    private enum CaptureStream
    {
        Http,
        Database,
    }

    private sealed class ExchangeState(
        ExchangeHandle handle,
        CapturedRequest request,
        CaptureContext? context,
        JsonObject requestJson,
        JsonObject timingJson,
        JsonObject sizesJson,
        JsonObject captureJson,
        JsonObject metadataJson)
    {
        public ExchangeHandle Handle { get; } = handle;
        public CapturedRequest Request { get; } = request;
        public CaptureContext? Context { get; } = context;
        public JsonObject RequestJson { get; } = requestJson;
        public JsonObject TimingJson { get; private set; } = timingJson;
        public JsonObject SizesJson { get; private set; } = sizesJson;
        public JsonObject CaptureJson { get; private set; } = captureJson;
        public JsonObject MetadataJson { get; } = metadataJson;
        public JsonObject? ResponseJson { get; private set; }
        public JsonObject? FailureJson { get; private set; }
        public string LifecycleState { get; private set; } = "inFlight";
        public DateTimeOffset LastUpdatedAt { get; private set; } = handle.WallClockStart;
        public ulong Revision { get; set; } = 1;
        public bool IsTerminal => LifecycleState is "completed" or "failed" or "cancelled";

        public void ApplyTerminal(string type, CapturedResponse? response, CapturedFailure? failure, string? origin, OutboundMessage message, DateTimeOffset endedAt, TimeSpan elapsed)
        {
            LifecycleState = type switch
            {
                "exchange.completed" => "completed",
                "exchange.failed" => "failed",
                _ => "cancelled",
            };
            Revision = 2;
            LastUpdatedAt = endedAt;
            TimingJson = message.TimingJson!;
            SizesJson = message.SizesJson!;
            CaptureJson = message.CaptureJson!;
            ResponseJson = message.ResponseJson;
            FailureJson = failure is null ? null : new JsonObject
            {
                ["category"] = failure.Category,
                ["message"] = failure.Message,
                ["retryable"] = failure.Retryable,
                ["code"] = failure.Code,
            };
        }
    }

    private sealed class DatabaseCommandState(
        DatabaseCommandHandle handle,
        CaptureContext? context,
        string provider,
        string databaseName,
        string? dataSource,
        string commandType,
        string operation,
        string primaryTarget,
        JsonObject queryJson,
        JsonObject parametersJson)
    {
        public DatabaseCommandHandle Handle { get; } = handle;
        public CaptureContext? Context { get; } = context;
        public string Provider { get; } = provider;
        public string DatabaseName { get; } = databaseName;
        public string? DataSource { get; } = dataSource;
        public string CommandType { get; } = commandType;
        public string Operation { get; } = operation;
        public string PrimaryTarget { get; } = primaryTarget;
        public JsonObject QueryJson { get; } = queryJson;
        public JsonObject ParametersJson { get; } = parametersJson;
        public DateTimeOffset LastUpdatedAt { get; private set; } = handle.WallClockStart;
        public ulong Revision { get; private set; } = 1;

        public void ApplyTerminal(string type, DateTimeOffset endedAt, TimeSpan elapsed, Exception? exception, string? origin)
        {
            _ = type;
            _ = elapsed;
            _ = exception;
            _ = origin;
            Revision = 2;
            LastUpdatedAt = endedAt;
        }
    }
}
