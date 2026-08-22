using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using Microsoft.Extensions.Hosting;

namespace HttpInspector.Adapter;

/// Observes Microsoft.Data.SqlClient diagnostics globally so application repositories remain unchanged.
internal sealed class SqlClientDiagnosticBridge(HttpInspectorAdapter adapter, DatabaseCommandOwnership ownership) : IHostedService, IObserver<DiagnosticListener>, IObserver<KeyValuePair<string, object?>>, IDisposable
{
    private const string ListenerName = "SqlClientDiagnosticListener";
    private readonly ConcurrentDictionary<DbCommand, DatabaseCommandHandle> _commands = new(ReferenceEqualityComparer.Instance);
    private readonly ConcurrentDictionary<string, DatabaseCommandHandle> _activities = new(StringComparer.Ordinal);
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
            _eventSubscriptions.Add(listener.Subscribe(this, IsCommandEvent));
        }
    }

    public void OnNext(KeyValuePair<string, object?> value)
    {
        var command = Property<DbCommand>(value.Value, "Command");
        if (value.Key.EndsWith("WriteCommandBefore", StringComparison.Ordinal))
        {
            ObserveStart(command);
            return;
        }
        if (value.Key.EndsWith("WriteCommandAfter", StringComparison.Ordinal))
        {
            ObserveCompleted(command);
            return;
        }
        if (value.Key.EndsWith("WriteCommandError", StringComparison.Ordinal))
        {
            ObserveFailure(command, Property<Exception>(value.Value, "Exception"));
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

        _commands.Clear();
        _activities.Clear();
    }

    private void ObserveStart(DbCommand? command)
    {
        if (command is null || ownership.IsOwned(command) || _commands.ContainsKey(command))
        {
            return;
        }

        var activity = Activity.Current;
        var context = activity is null ? null : new CaptureContext(activity.TraceId.ToString(), activity.SpanId.ToString(), activity.ParentSpanId.ToString(), activity.Id);
        var handle = adapter.CaptureDatabaseStarted(command, context);
        if (!handle.IsCaptured || !_commands.TryAdd(command, handle))
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(activity?.Id))
        {
            _activities.TryAdd(activity.Id, handle);
        }
    }

    private void ObserveCompleted(DbCommand? command)
    {
        var handle = Find(command);
        if (handle is null)
        {
            return;
        }

        adapter.CaptureDatabaseCompleted(handle);
        Remove(command, handle);
    }

    private void ObserveFailure(DbCommand? command, Exception? exception)
    {
        var handle = Find(command);
        if (handle is null || exception is null)
        {
            return;
        }

        if (exception is OperationCanceledException)
        {
            adapter.CaptureDatabaseCancelled(handle, "provider cancellation");
        }
        else
        {
            adapter.CaptureDatabaseFailed(handle, exception);
        }
        Remove(command, handle);
    }

    private DatabaseCommandHandle? Find(DbCommand? command)
    {
        if (command is not null && _commands.TryGetValue(command, out var handle))
        {
            return handle;
        }

        return Activity.Current?.Id is { Length: > 0 } activityId && _activities.TryGetValue(activityId, out handle) ? handle : null;
    }

    private void Remove(DbCommand? command, DatabaseCommandHandle handle)
    {
        if (command is not null)
        {
            _commands.TryRemove(command, out _);
        }
        foreach (var item in _activities.Where(item => item.Value.CommandId == handle.CommandId).ToArray())
        {
            _activities.TryRemove(item.Key, out _);
        }
    }

    private static bool IsCommandEvent(string name) =>
        string.Equals(name, "Microsoft.Data.SqlClient.WriteCommandBefore", StringComparison.Ordinal)
        || string.Equals(name, "Microsoft.Data.SqlClient.WriteCommandAfter", StringComparison.Ordinal)
        || string.Equals(name, "Microsoft.Data.SqlClient.WriteCommandError", StringComparison.Ordinal);

    private static T? Property<T>(object? payload, string name) where T : class => payload?.GetType().GetProperty(name)?.GetValue(payload) as T;
}
