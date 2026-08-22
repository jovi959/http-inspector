using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;

namespace HttpInspector.Adapter;

/// <summary>Opt-in boundary for database factories that need bounded Dapper or raw ADO.NET result capture.</summary>
public interface IHttpInspectorDatabaseCapture
{
    DbConnection Wrap(DbConnection connection);
    Task<DbDataReader> ExecuteReaderAsync(DbCommand command, CancellationToken cancellationToken = default);
    Task<object?> ExecuteScalarAsync(DbCommand command, CancellationToken cancellationToken = default);
    Task<int> ExecuteNonQueryAsync(DbCommand command, CancellationToken cancellationToken = default);
}

/// <summary>Wraps only connections explicitly returned by an integrated database factory.</summary>
public sealed class HttpInspectorDatabaseCapture : IHttpInspectorDatabaseCapture
{
    private readonly HttpInspectorAdapter _adapter;
    private readonly DatabaseCommandOwnership _ownership;
    private readonly ulong _maximumBytes;
    private readonly int _maximumRows;
    private readonly ulong _maximumCellBytes;
    private readonly int _maximumColumns;

    internal HttpInspectorDatabaseCapture(HttpInspectorAdapter adapter, DatabaseCommandOwnership ownership, ulong maximumBytes, int maximumRows, ulong maximumCellBytes, int maximumColumns)
    {
        _adapter = adapter;
        _ownership = ownership;
        _maximumBytes = maximumBytes;
        _maximumRows = maximumRows;
        _maximumCellBytes = maximumCellBytes;
        _maximumColumns = maximumColumns;
    }

    /// <summary>Creates a provider-neutral wrapper without changing the original connection configuration.</summary>
    public DbConnection Wrap(DbConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        return connection is HttpInspectorDbConnection ? connection : new HttpInspectorDbConnection(connection, this);
    }

    /// <summary>Captures a reader only when the calling factory explicitly routes the command through this boundary.</summary>
    public async Task<DbDataReader> ExecuteReaderAsync(DbCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var session = Start(command);
        try { return new HttpInspectorDbDataReader(await command.ExecuteReaderAsync(cancellationToken), this, session); }
        catch (Exception exception) { Fail(session, exception); throw; }
    }

    /// <summary>Captures a scalar only when the calling factory explicitly routes the command through this boundary.</summary>
    public async Task<object?> ExecuteScalarAsync(DbCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var session = Start(command);
        try
        {
            var value = await command.ExecuteScalarAsync(cancellationToken);
            CompleteScalar(session, value);
            return value;
        }
        catch (Exception exception) { Fail(session, exception); throw; }
    }

    /// <summary>Captures an affected-row result only when the calling factory explicitly routes the command through this boundary.</summary>
    public async Task<int> ExecuteNonQueryAsync(DbCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        var session = Start(command);
        try
        {
            var value = await command.ExecuteNonQueryAsync(cancellationToken);
            CompleteNonQuery(session, value);
            return value;
        }
        catch (Exception exception) { Fail(session, exception); throw; }
    }

    internal DatabaseCaptureSession Start(DbCommand command)
    {
        _ownership.Claim(command);
        var activity = Activity.Current;
        var context = activity is null ? null : new CaptureContext(activity.TraceId.ToString(), activity.SpanId.ToString(), activity.ParentSpanId.ToString(), activity.Id);
        return new DatabaseCaptureSession(command, _adapter.CaptureDatabaseStarted(command, context), new DatabaseResultCollector(_maximumBytes, _maximumRows, _maximumCellBytes, _maximumColumns));
    }

    internal void Complete(DatabaseCaptureSession session, bool readerCompleted)
    {
        if (!session.TryQueueTerminal()) return;
        _adapter.CaptureDatabaseCompleted(session.Handle, session.Results.Build(readerCompleted));
        _ownership.Release(session.Command);
    }

    internal void CompleteNonQuery(DatabaseCaptureSession session, int affectedRows)
    {
        session.Results.CaptureNonQuery(affectedRows);
        Complete(session, true);
    }

    internal void CompleteScalar(DatabaseCaptureSession session, object? value)
    {
        session.Results.CaptureScalar(value);
        Complete(session, true);
    }

    internal void Fail(DatabaseCaptureSession session, Exception exception)
    {
        if (!session.TryQueueTerminal()) return;
        if (exception is OperationCanceledException) _adapter.CaptureDatabaseCancelled(session.Handle, "database command cancellation");
        else _adapter.CaptureDatabaseFailed(session.Handle, exception);
        _ownership.Release(session.Command);
    }
}

/// <summary>Prevents provider diagnostics from duplicating commands owned by an opt-in reader wrapper.</summary>
internal sealed class DatabaseCommandOwnership
{
    private readonly ConcurrentDictionary<DbCommand, byte> _commands = new(ReferenceEqualityComparer.Instance);

    public void Claim(DbCommand command) => _commands.TryAdd(command, 0);
    public bool IsOwned(DbCommand command) => _commands.ContainsKey(command);
    public void Release(DbCommand command) => _commands.TryRemove(command, out _);
}

internal sealed class DatabaseCaptureSession(DbCommand command, DatabaseCommandHandle handle, DatabaseResultCollector results)
{
    private int _terminalQueued;

    public DbCommand Command { get; } = command;
    public DatabaseCommandHandle Handle { get; } = handle;
    public DatabaseResultCollector Results { get; } = results;
    public bool TryQueueTerminal() => Interlocked.Exchange(ref _terminalQueued, 1) == 0;
}

/// <summary>Builds a compact, first-result-set snapshot while the application already reads the provider data.</summary>
internal sealed class DatabaseResultCollector(ulong maximumBytes, int maximumRows, ulong maximumCellBytes, int maximumColumns)
{
    private readonly JsonArray _columns = [];
    private readonly JsonArray _rows = [];
    private ulong _capturedBytes;
    private ulong _rowsObserved;
    private bool _columnsCaptured;
    private bool _truncated;

    public void CaptureRow(DbDataReader reader)
    {
        CaptureSchema(reader);
        _rowsObserved++;
        if (_rows.Count >= maximumRows)
        {
            _truncated = true;
            return;
        }

        var row = new JsonArray();
        for (var ordinal = 0; ordinal < _columns.Count; ordinal++)
        {
            var cell = CaptureValue(reader, ordinal, maximumCellBytes);
            var value = cell.Value;
            var encodedLength = (ulong)Encoding.UTF8.GetByteCount(value?.ToJsonString() ?? "null");
            _truncated |= cell.Truncated;
            if (_capturedBytes + encodedLength > maximumBytes)
            {
                _truncated = true;
                row.Add(new JsonObject { ["availability"] = "unavailable", ["reason"] = "cell exceeds the database result capture limit" });
                continue;
            }

            _capturedBytes += encodedLength;
            row.Add(value);
        }
        _rows.Add(row);
    }

    public void CaptureNonQuery(int affectedRows)
    {
        _columns.Clear();
        _rows.Clear();
        _columns.Add("rowsAffected");
        _rows.Add(new JsonArray(affectedRows));
        _rowsObserved = 1;
        _columnsCaptured = true;
    }

    public void CaptureScalar(object? value)
    {
        _columns.Clear();
        _rows.Clear();
        _columns.Add("value");
        var cell = ValueNode(value, maximumCellBytes);
        _rows.Add(new JsonArray(cell.Value));
        _rowsObserved = 1;
        _columnsCaptured = true;
        _truncated = cell.Truncated;
    }

    public JsonObject Build(bool readerCompleted) => new()
    {
        ["availability"] = "captured",
        ["reason"] = readerCompleted ? null : "reader closed before the first result set completed",
        ["columns"] = _columns.DeepClone(),
        ["rows"] = _rows.DeepClone(),
        ["rowsObserved"] = _rowsObserved,
        ["rowsCaptured"] = _rows.Count,
        ["truncated"] = _truncated || !readerCompleted,
    };

    public void CaptureSchema(DbDataReader reader)
    {
        if (_columnsCaptured) return;
        for (var ordinal = 0; ordinal < Math.Min(reader.FieldCount, maximumColumns); ordinal++) _columns.Add(reader.GetName(ordinal));
        _truncated = reader.FieldCount > maximumColumns;
        _columnsCaptured = true;
    }

    private static CapturedCell CaptureValue(DbDataReader reader, int ordinal, ulong maximumCellBytes)
    {
        if (reader.IsDBNull(ordinal)) return new CapturedCell(null, false);
        if (reader.GetFieldType(ordinal) == typeof(string))
        {
            var characterLength = reader.GetChars(ordinal, 0, null, 0, 0);
            var captureLength = (int)Math.Min(characterLength, Math.Max(1, MaximumCaptureLength(maximumCellBytes / 4)));
            var characters = new char[captureLength];
            _ = reader.GetChars(ordinal, 0, characters, 0, captureLength);
            return characterLength > captureLength
                ? new CapturedCell(new JsonObject { ["kind"] = "text", ["value"] = new string(characters), ["observedCharacterLength"] = characterLength, ["truncated"] = true }, true)
                : new CapturedCell(JsonValue.Create(new string(characters)), false);
        }
        if (reader.GetFieldType(ordinal) == typeof(byte[]))
        {
            var byteLength = reader.GetBytes(ordinal, 0, null, 0, 0);
            var captureLength = (int)Math.Min(byteLength, Math.Max(1, MaximumCaptureLength(maximumCellBytes)));
            var bytes = new byte[captureLength];
            _ = reader.GetBytes(ordinal, 0, bytes, 0, captureLength);
            var truncated = captureLength < byteLength;
            return new CapturedCell(new JsonObject { ["kind"] = "binary", ["encoding"] = "base64", ["value"] = Convert.ToBase64String(bytes), ["observedByteLength"] = byteLength, ["truncated"] = truncated }, truncated);
        }

        return ValueNode(reader.GetValue(ordinal), maximumCellBytes);
    }

    private static CapturedCell ValueNode(object? value, ulong maximumCellBytes) => value switch
    {
        null or DBNull => new CapturedCell(null, false),
        string text => TextValue(text, maximumCellBytes),
        bool boolean => new CapturedCell(JsonValue.Create(boolean), false),
        byte byteValue => new CapturedCell(JsonValue.Create(byteValue), false),
        short shortValue => new CapturedCell(JsonValue.Create(shortValue), false),
        int intValue => new CapturedCell(JsonValue.Create(intValue), false),
        long longValue => new CapturedCell(JsonValue.Create(longValue), false),
        float floatValue => new CapturedCell(JsonValue.Create(floatValue), false),
        double doubleValue => new CapturedCell(JsonValue.Create(doubleValue), false),
        decimal decimalValue => new CapturedCell(JsonValue.Create(decimalValue), false),
        DateTime dateTime => new CapturedCell(JsonValue.Create(dateTime.ToString("O", CultureInfo.InvariantCulture)), false),
        DateTimeOffset offset => new CapturedCell(JsonValue.Create(offset.ToString("O", CultureInfo.InvariantCulture)), false),
        Guid guid => new CapturedCell(JsonValue.Create(guid.ToString()), false),
        _ => TextValue(Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty, maximumCellBytes),
    };

    private static CapturedCell TextValue(string value, ulong maximumCellBytes)
    {
        var captureLength = Math.Min(value.Length, Math.Max(1, MaximumCaptureLength(maximumCellBytes / 4)));
        return value.Length > captureLength
            ? new CapturedCell(new JsonObject { ["kind"] = "text", ["value"] = value[..captureLength], ["observedCharacterLength"] = value.Length, ["truncated"] = true }, true)
            : new CapturedCell(JsonValue.Create(value), false);
    }

    private sealed record CapturedCell(JsonNode? Value, bool Truncated);

    private static int MaximumCaptureLength(ulong maximumBytes) => (int)Math.Min(maximumBytes, (ulong)int.MaxValue);
}
