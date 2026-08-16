using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.Hosting;

namespace HttpInspector.Adapter;

internal sealed class SystemNetHttpDiagnosticBridge(HttpInspectorAdapter adapter) : IHostedService, IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    private const string ListenerName = "HttpHandlerDiagnosticListener";
    private readonly ConcurrentDictionary<HttpRequestMessage, DiagnosticExchange> _requests = new(ReferenceEqualityComparer.Instance);
    private readonly ConcurrentDictionary<string, DiagnosticExchange> _activities = new(StringComparer.Ordinal);
    private readonly ConcurrentBag<IDisposable> _eventSubscriptions = [];
    private IDisposable? _listenerSubscription;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        adapter.Start();
        _listenerSubscription ??= DiagnosticListener.AllListeners.Subscribe(this);
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        Dispose();
        return Task.CompletedTask;
    }

    public void OnNext(DiagnosticListener listener)
    {
        if (string.Equals(listener.Name, ListenerName, StringComparison.Ordinal))
        {
            _eventSubscriptions.Add(listener.Subscribe(this, IsHttpRequestEvent));
        }
    }

    public void OnNext(KeyValuePair<string, object?> value)
    {
        if (value.Key.EndsWith(".Start", StringComparison.Ordinal))
        {
            ObserveStart(Request(value.Value));
            return;
        }

        if (value.Key.EndsWith(".Stop", StringComparison.Ordinal))
        {
            ObserveStop(Request(value.Value), Response(value.Value));
            return;
        }

        if (value.Key.EndsWith(".Exception", StringComparison.Ordinal))
        {
            ObserveFailure(Request(value.Value), Exception(value.Value));
        }
    }

    public void OnCompleted()
    {
    }

    public void OnError(Exception error)
    {
    }

    public void Dispose()
    {
        _listenerSubscription?.Dispose();
        _listenerSubscription = null;
        while (_eventSubscriptions.TryTake(out var subscription))
        {
            subscription.Dispose();
        }

        _requests.Clear();
        _activities.Clear();
    }

    private void ObserveStart(HttpRequestMessage? request)
    {
        if (request is null || HttpInspectorRequestMarker.IsMarked(request) || request.RequestUri is null || adapter.IsInspectorEndpoint(request.RequestUri.AbsoluteUri))
        {
            return;
        }

        var activity = Activity.Current;
        var timing = adapter.GetCaptureStartTiming();
        var exchange = new DiagnosticExchange(
            adapter,
            request,
            activity is null ? null : new CaptureContext(activity.TraceId.ToString(), activity.SpanId.ToString(), activity.ParentSpanId.ToString(), activity.Id),
            activity?.Id,
            timing.MonotonicStart,
            timing.WallClockStart,
            Remove);
        if (!_requests.TryAdd(request, exchange))
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(exchange.ActivityId))
        {
            _activities.TryAdd(exchange.ActivityId, exchange);
        }

        exchange.ObserveStart();
    }

    private void ObserveStop(HttpRequestMessage? request, HttpResponseMessage? response)
    {
        var exchange = Find(request ?? response?.RequestMessage);
        if (exchange is not null && response is not null)
        {
            exchange.Complete(response);
        }
    }

    private void ObserveFailure(HttpRequestMessage? request, Exception? exception)
    {
        var exchange = Find(request);
        if (exchange is not null && exception is not null)
        {
            exchange.Fail(exception);
        }
    }

    private DiagnosticExchange? Find(HttpRequestMessage? request)
    {
        if (request is not null && _requests.TryGetValue(request, out var exchange))
        {
            return exchange;
        }

        return Activity.Current?.Id is { Length: > 0 } activityId && _activities.TryGetValue(activityId, out exchange) ? exchange : null;
    }

    private void Remove(DiagnosticExchange exchange)
    {
        _requests.TryRemove(exchange.Request, out _);
        if (!string.IsNullOrWhiteSpace(exchange.ActivityId))
        {
            _activities.TryRemove(exchange.ActivityId, out _);
        }
    }

    private static bool IsHttpRequestEvent(string name) =>
        string.Equals(name, "System.Net.Http.HttpRequestOut", StringComparison.Ordinal)
        || (name.StartsWith("System.Net.Http.HttpRequestOut.", StringComparison.Ordinal)
            && (name.EndsWith(".Start", StringComparison.Ordinal) || name.EndsWith(".Stop", StringComparison.Ordinal) || name.EndsWith(".Exception", StringComparison.Ordinal)));

    private static HttpRequestMessage? Request(object? payload) => payload as HttpRequestMessage ?? Property<HttpRequestMessage>(payload, "Request");

    private static HttpResponseMessage? Response(object? payload) => payload as HttpResponseMessage ?? Property<HttpResponseMessage>(payload, "Response");

    private static Exception? Exception(object? payload) => payload as Exception ?? Property<Exception>(payload, "Exception");

    private static T? Property<T>(object? payload, string name) where T : class => payload?.GetType().GetProperty(name)?.GetValue(payload) as T;

    private sealed class DiagnosticExchange
    {
        private readonly object _gate = new();
        private readonly HttpInspectorAdapter _adapter;
        private readonly CaptureContext? _context;
        private readonly long _monotonicStart;
        private readonly DateTimeOffset _wallClockStart;
        private readonly Action<DiagnosticExchange> _remove;
        private readonly CapturedRequest _request;
        private ExchangeHandle? _handle;

        public DiagnosticExchange(
            HttpInspectorAdapter adapter,
            HttpRequestMessage request,
            CaptureContext? context,
            string? activityId,
            long monotonicStart,
            DateTimeOffset wallClockStart,
            Action<DiagnosticExchange> remove)
        {
            _adapter = adapter;
            Request = request;
            _context = context;
            ActivityId = activityId;
            _monotonicStart = monotonicStart;
            _wallClockStart = wallClockStart;
            _remove = remove;
            _request = HttpClientCaptureMapper.ToCapturedRequest(request);
        }

        public HttpRequestMessage Request { get; }
        public string? ActivityId { get; }

        public void ObserveStart()
        {
            if (Request.Content is null || Request.Content.Headers.ContentLength == 0)
            {
                EnsureStarted();
                return;
            }

            Request.Content = HttpContentObservation.WrapRequest(
                Request.Content,
                _adapter.MaximumBodyBytes,
                body => EnsureStarted(body),
                (body, exception) =>
                {
                    var handle = EnsureStarted(body);
                    _adapter.CaptureFailed(handle, new CapturedFailure("requestBody", exception.Message, false, exception.GetType().FullName));
                    _remove(this);
                });
        }

        public void Complete(HttpResponseMessage response)
        {
            var handle = EnsureStarted();
            if (!handle.IsCaptured)
            {
                _remove(this);
                return;
            }

            HttpClientCaptureMapper.ObserveResponse(
                response,
                _adapter.MaximumBodyBytes,
                captured =>
                {
                    _adapter.CaptureCompleted(handle, captured);
                    _remove(this);
                },
                (captured, exception) =>
                {
                    _adapter.CaptureFailed(handle, new CapturedFailure("responseBody", exception.Message, false, exception.GetType().FullName), captured);
                    _remove(this);
                });
        }

        public void Fail(Exception exception)
        {
            var handle = EnsureStarted();
            _adapter.CaptureFailed(handle, new CapturedFailure("transport", exception.Message, true, exception.GetType().FullName));
            _remove(this);
        }

        private ExchangeHandle EnsureStarted(CapturedBody? body = null)
        {
            lock (_gate)
            {
                _handle ??= _adapter.CaptureStarted(
                    body is null ? _request : _request with { Body = body },
                    _context,
                    CaptureOrigin.SystemNetHttpDiagnostic,
                    _monotonicStart,
                    _wallClockStart);
                return _handle;
            }
        }
    }
}
