using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace HttpInspector.Adapter;

/// <summary>Forwards provider behavior while substituting commands with an opt-in capture wrapper.</summary>
internal sealed class HttpInspectorDbConnection(DbConnection inner, HttpInspectorDatabaseCapture capture) : DbConnection
{
    internal DbConnection Inner { get; } = inner;

    [AllowNull]
    public override string ConnectionString { get => Inner.ConnectionString; set => Inner.ConnectionString = value; }
    public override string Database => Inner.Database;
    public override string DataSource => Inner.DataSource;
    public override string ServerVersion => Inner.ServerVersion;
    public override ConnectionState State => Inner.State;
    public override int ConnectionTimeout => Inner.ConnectionTimeout;

    public override void ChangeDatabase(string databaseName) => Inner.ChangeDatabase(databaseName);
    public override void Close() => Inner.Close();
    public override void Open() => Inner.Open();
    public override Task OpenAsync(CancellationToken cancellationToken) => Inner.OpenAsync(cancellationToken);
    protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => Inner.BeginTransaction(isolationLevel);
    protected override DbCommand CreateDbCommand() => new HttpInspectorDbCommand(Inner.CreateCommand(), this, capture);

    protected override void Dispose(bool disposing)
    {
        if (disposing) Inner.Dispose();
        base.Dispose(disposing);
    }

    public override ValueTask DisposeAsync() => Inner.DisposeAsync();
}

/// <summary>Captures only execution methods, leaving command construction and provider parameters untouched.</summary>
internal sealed class HttpInspectorDbCommand(DbCommand inner, HttpInspectorDbConnection connection, HttpInspectorDatabaseCapture capture) : DbCommand
{
    private DbConnection? _connection = connection;
    private DbTransaction? _transaction;

    [AllowNull]
    public override string CommandText { get => inner.CommandText; set => inner.CommandText = value; }
    public override int CommandTimeout { get => inner.CommandTimeout; set => inner.CommandTimeout = value; }
    public override CommandType CommandType { get => inner.CommandType; set => inner.CommandType = value; }
    public override bool DesignTimeVisible { get => inner.DesignTimeVisible; set => inner.DesignTimeVisible = value; }
    public override UpdateRowSource UpdatedRowSource { get => inner.UpdatedRowSource; set => inner.UpdatedRowSource = value; }
    protected override DbConnection? DbConnection
    {
        get => _connection;
        set
        {
            _connection = value;
            inner.Connection = value is HttpInspectorDbConnection wrapped ? wrapped.Inner : value;
        }
    }
    protected override DbParameterCollection DbParameterCollection => inner.Parameters;
    protected override DbTransaction? DbTransaction { get => _transaction; set { _transaction = value; inner.Transaction = value; } }

    public override void Cancel() => inner.Cancel();
    public override int ExecuteNonQuery() => ExecuteWithCapture(command => command.ExecuteNonQuery(), (session, value) => capture.CompleteNonQuery(session, value));
    public override object? ExecuteScalar() => ExecuteWithCapture(command => command.ExecuteScalar(), (session, value) => capture.CompleteScalar(session, value));
    public override Task<int> ExecuteNonQueryAsync(CancellationToken cancellationToken) => ExecuteWithCaptureAsync(command => command.ExecuteNonQueryAsync(cancellationToken), (session, value) => capture.CompleteNonQuery(session, value));
    public override Task<object?> ExecuteScalarAsync(CancellationToken cancellationToken) => ExecuteWithCaptureAsync(command => command.ExecuteScalarAsync(cancellationToken), (session, value) => capture.CompleteScalar(session, value));
    public override void Prepare() => inner.Prepare();
    protected override DbParameter CreateDbParameter() => inner.CreateParameter();

    protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
    {
        var session = capture.Start(inner);
        try { return new HttpInspectorDbDataReader(inner.ExecuteReader(behavior), capture, session); }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    protected override async Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken)
    {
        var session = capture.Start(inner);
        try { return new HttpInspectorDbDataReader(await inner.ExecuteReaderAsync(behavior, cancellationToken), capture, session); }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) inner.Dispose();
        base.Dispose(disposing);
    }

    private T ExecuteWithCapture<T>(Func<DbCommand, T> execute, Action<DatabaseCaptureSession, T> complete)
    {
        var session = capture.Start(inner);
        try
        {
            var value = execute(inner);
            complete(session, value);
            return value;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    private async Task<T> ExecuteWithCaptureAsync<T>(Func<DbCommand, Task<T>> execute, Action<DatabaseCaptureSession, T> complete)
    {
        var session = capture.Start(inner);
        try
        {
            var value = await execute(inner);
            complete(session, value);
            return value;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }
}
