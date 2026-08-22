using Microsoft.Data.SqlClient;
using System.Data;
using System.Data.Common;
using System.Text.Json.Nodes;
using Dapper;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class DatabaseCaptureTests
{
    [Fact]
    public async Task DB_001_sql_command_lifecycle_uses_the_capability_gated_database_protocol()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var command = new SqlCommand("select * from dbo.students where id = @id", connection);
        command.Parameters.AddWithValue("@id", 42);
        var handle = adapter.CaptureDatabaseStarted(command);
        adapter.CaptureDatabaseCompleted(handle);

        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.True(handle.IsCaptured);
        Assert.Equal("database.command.started", started["type"]!.GetValue<string>());
        Assert.Equal("school", started["databaseName"]!.GetValue<string>());
        Assert.Equal("dbo.students", started["primaryTarget"]!.GetValue<string>());
        Assert.Equal("select * from dbo.students where id = @id", started["query"]!["value"]!.GetValue<string>());
        Assert.Equal("database.command.completed", completed["type"]!.GetValue<string>());
        Assert.Equal("result rows are not captured", completed["result"]!["reason"]!.GetValue<string>());
        Assert.Empty(completed["result"]!["columns"]!.AsArray());
    }

    [Fact]
    public async Task DB_002_missing_database_capability_drops_database_capture_without_affecting_http_capture()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => adapter.NegotiatedSession is not null);

        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var command = new SqlCommand("select * from dbo.students", connection);
        var databaseHandle = adapter.CaptureDatabaseStarted(command);
        var httpHandle = adapter.CaptureStarted(TestValues.RequestA());
        var httpStarted = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.False(databaseHandle.IsCaptured);
        Assert.True(httpHandle.IsCaptured);
        Assert.Equal("exchange.started", httpStarted["type"]!.GetValue<string>());
    }

    [Fact]
    public async Task DB_003_database_queue_pressure_never_uses_http_queue_capacity()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false) { AutoAcceptMessages = false };
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        var config = TestValues.Config(queueCapacity: 1, databaseQueueCapacity: 1);
        await using var adapter = HttpInspectorAdapter.Create(config, TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var firstCommand = new SqlCommand("select * from dbo.students", connection);
        using var secondCommand = new SqlCommand("select * from dbo.teachers", connection);
        var firstDatabaseHandle = adapter.CaptureDatabaseStarted(firstCommand);
        var databaseStarted = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var droppedDatabaseHandle = adapter.CaptureDatabaseStarted(secondCommand);
        var httpHandle = adapter.CaptureStarted(TestValues.RequestA());
        var httpStarted = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.True(firstDatabaseHandle.IsCaptured);
        Assert.False(droppedDatabaseHandle.IsCaptured);
        Assert.True(httpHandle.IsCaptured);
        Assert.Equal("database.command.started", databaseStarted["type"]!.GetValue<string>());
        Assert.Equal("exchange.started", httpStarted["type"]!.GetValue<string>());
        Assert.Equal(1, adapter.DatabaseDroppedCount);
        Assert.Equal(0, adapter.DroppedCount);
    }

    [Fact]
    public async Task DB_004_opt_in_result_snapshot_preserves_bounded_rows_in_the_database_protocol()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var command = new SqlCommand("select id, name from dbo.students", connection);
        var handle = adapter.CaptureDatabaseStarted(command);
        adapter.CaptureDatabaseCompleted(handle, new JsonObject
        {
            ["availability"] = "captured",
            ["reason"] = null,
            ["columns"] = new JsonArray("id", "name"),
            ["rows"] = new JsonArray(new JsonArray(42, "Jovi")),
            ["rowsObserved"] = 1,
            ["rowsCaptured"] = 1,
            ["truncated"] = false,
        });

        _ = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("captured", completed["result"]!["availability"]!.GetValue<string>());
        Assert.Equal("name", completed["result"]!["columns"]![1]!.GetValue<string>());
        Assert.Equal("Jovi", completed["result"]!["rows"]![0]![1]!.GetValue<string>());
    }

    [Fact]
    public async Task DB_005_factory_owned_reader_capture_observes_rows_without_reexecuting_the_command()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var table = new DataTable();
        table.Columns.Add("id", typeof(int));
        table.Rows.Add(42);
        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var command = new BufferedReaderCommand(connection, table);
        var capture = new HttpInspectorDatabaseCapture(adapter, new DatabaseCommandOwnership(), 1024, 10, 256, 10);

        await using var reader = await capture.ExecuteReaderAsync(command);
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("database.command.started", started["type"]!.GetValue<string>());
        Assert.True(await reader.ReadAsync());
        Assert.Equal(42, reader.GetInt32(0));

        await reader.DisposeAsync();
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("captured", completed["result"]!["availability"]!.GetValue<string>());
        Assert.Equal("id", completed["result"]!["columns"]![0]!.GetValue<string>());
        Assert.Equal(42, completed["result"]!["rows"]![0]![0]!.GetValue<int>());
        Assert.Equal(1, command.ReaderExecutions);
    }

    [Fact]
    public async Task DB_006_dapper_query_async_captures_every_buffered_row()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var table = new DataTable();
        table.Columns.Add("id", typeof(int));
        table.Columns.Add("sequence", typeof(int));
        table.Rows.Add(42, 1);
        table.Rows.Add(43, 2);
        table.Rows.Add(44, 3);
        using var providerConnection = new BufferedReaderConnection(table);
        using var connection = new HttpInspectorDatabaseCapture(adapter, new DatabaseCommandOwnership(), 1024, 10, 256, 10).Wrap(providerConnection);
        await connection.OpenAsync();

        var rows = (await connection.QueryAsync<CapturedRow>("select id, sequence from dbo.students")).ToArray();

        Assert.Equal(3, rows.Length);
        Assert.Equal(1, providerConnection.ReaderExecutions);
        _ = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(3UL, completed["result"]!["rowsObserved"]!.GetValue<ulong>());
        Assert.Equal(3, completed["result"]!["rowsCaptured"]!.GetValue<int>());
        Assert.False(completed["result"]!["truncated"]!.GetValue<bool>());
        Assert.Null(completed["result"]!["reason"]);
    }

    [Fact]
    public async Task DB_007_reader_enumeration_does_not_bypass_result_capture()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.QueueConnection(new NegotiatedSession(
            TestValues.ConnectionId,
            TestValues.SessionId,
            TestValues.MaximumMessageBytes,
            TestValues.MaximumBodyBytes,
            new HashSet<string>(StringComparer.Ordinal) { "databaseCommandCapture" }));
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var table = new DataTable();
        table.Columns.Add("id", typeof(int));
        table.Rows.Add(42);
        table.Rows.Add(43);
        table.Rows.Add(44);
        using var connection = new SqlConnection("Server=server.example.test;Database=school;Integrated Security=true");
        using var command = new BufferedReaderCommand(connection, table);
        var capture = new HttpInspectorDatabaseCapture(adapter, new DatabaseCommandOwnership(), 1024, 10, 256, 10);

        await using var reader = await capture.ExecuteReaderAsync(command);
        var enumerated = 0;
        foreach (var _ in reader) enumerated++;

        Assert.Equal(3, enumerated);
        _ = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(3UL, completed["result"]!["rowsObserved"]!.GetValue<ulong>());
        Assert.Equal(3, completed["result"]!["rowsCaptured"]!.GetValue<int>());
        Assert.False(completed["result"]!["truncated"]!.GetValue<bool>());
        Assert.Null(completed["result"]!["reason"]);
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

    private sealed class CapturedRow
    {
        public int Id { get; init; }
        public int Sequence { get; init; }
    }

    private sealed class BufferedReaderConnection(DataTable table) : DbConnection
    {
        private ConnectionState _state;

        public int ReaderExecutions { get; private set; }
        public override string ConnectionString { get; set; } = "Server=server.example.test;Database=school";
        public override string Database => "school";
        public override string DataSource => "server.example.test";
        public override string ServerVersion => "1.0";
        public override ConnectionState State => _state;
        public override int ConnectionTimeout => 0;

        public override void ChangeDatabase(string databaseName) { }
        public override void Close() => _state = ConnectionState.Closed;
        public override void Open() => _state = ConnectionState.Open;
        public override Task OpenAsync(CancellationToken cancellationToken) { Open(); return Task.CompletedTask; }
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => throw new NotSupportedException();
        protected override DbCommand CreateDbCommand() => new BufferedReaderCommand(this, table, () => ReaderExecutions++);
    }

    private sealed class BufferedReaderCommand(DbConnection connection, DataTable table, Action? onReaderExecution = null) : DbCommand
    {
        private readonly SqlCommand _parametersOwner = new();

        public int ReaderExecutions { get; private set; }
        public override string CommandText { get; set; } = "select id, name from dbo.students";
        public override int CommandTimeout { get; set; }
        public override CommandType CommandType { get; set; } = CommandType.Text;
        public override bool DesignTimeVisible { get; set; }
        public override UpdateRowSource UpdatedRowSource { get; set; }
        protected override DbConnection? DbConnection { get; set; } = connection;
        protected override DbParameterCollection DbParameterCollection => _parametersOwner.Parameters;
        protected override DbTransaction? DbTransaction { get; set; }

        public override void Cancel() { }
        public override int ExecuteNonQuery() => 1;
        public override object? ExecuteScalar() => 1;
        public override void Prepare() { }
        protected override DbParameter CreateDbParameter() => _parametersOwner.CreateParameter();

        protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
        {
            ReaderExecutions++;
            onReaderExecution?.Invoke();
            return table.CreateDataReader();
        }

        protected override Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken)
        {
            return Task.FromResult(ExecuteDbDataReader(behavior));
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) _parametersOwner.Dispose();
            base.Dispose(disposing);
        }
    }
}
