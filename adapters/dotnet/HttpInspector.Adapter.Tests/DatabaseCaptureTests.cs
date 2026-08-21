using Microsoft.Data.SqlClient;
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
}
