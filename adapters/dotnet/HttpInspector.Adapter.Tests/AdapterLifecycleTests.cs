using System.Text.Json.Nodes;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class AdapterLifecycleTests
{
    [Fact]
    public async Task HSK_001_and_HSK_002_hello_is_first_and_uses_configured_v1_source_values()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();

        var hello = await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal(1, hello["schemaVersion"]!["major"]!.GetValue<int>());
        Assert.Equal(0, hello["schemaVersion"]!["minor"]!.GetValue<int>());
        Assert.Equal(TestValues.SourceId, hello["source"]!["instanceId"]!.GetValue<string>());
        Assert.Equal("test-application", hello["source"]!["applicationName"]!.GetValue<string>());
        Assert.Equal("test-service", hello["source"]!["serviceName"]!.GetValue<string>());
        Assert.Equal(0, transport.MessageCount);
    }

    [Fact]
    public async Task HSK_003_capture_started_returns_without_waiting_for_hello_acceptance()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        var dependencies = TestValues.Dependencies(transport);
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), dependencies);
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var handle = adapter.CaptureStarted(TestValues.RequestA());

        Assert.Equal(Guid.Parse(TestValues.ExchangeA), handle.ExchangeId);
        Assert.Equal(0, transport.MessageCount);
    }

    [Fact]
    public async Task HSK_004_stores_negotiated_connection_values()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => adapter.NegotiatedSession is not null);

        Assert.Equal(TestValues.ConnectionId, adapter.NegotiatedSession!.ConnectionId);
        Assert.Equal(TestValues.SessionId, adapter.NegotiatedSession.SessionId);
        Assert.Equal(TestValues.MaximumBodyBytes, adapter.NegotiatedSession.MaximumBodyBytes);
    }

    [Fact]
    public async Task HSK_005_non_retryable_hello_error_disables_reconnect_and_reports_protocol_mismatch()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.RejectNextConnection("protocolMismatch", retryable: false);
        var delay = new FakeDelay();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, delay: delay));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => adapter.Diagnostics.Any(diagnostic => diagnostic.Code == "protocolMismatch"));

        Assert.Equal(1, transport.ConnectCount);
    }

    [Fact]
    public async Task HSK_006_retryable_hello_failure_uses_bounded_backoff_without_throwing_into_capture()
    {
        var transport = new FakeCaptureTransport(acceptInitialConnection: false);
        transport.RejectNextConnection("connectionRefused", retryable: true);
        transport.QueueConnection(new NegotiatedSession(TestValues.ConnectionId, TestValues.SessionId, TestValues.MaximumMessageBytes, TestValues.MaximumBodyBytes));
        var delay = new FakeDelay();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, delay: delay));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => delay.Scheduled.Contains(TimeSpan.FromMilliseconds(250)));

        delay.Advance(TimeSpan.FromMilliseconds(250));
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => adapter.NegotiatedSession is not null);

        Assert.Equal(2, transport.ConnectCount);
    }

    [Fact]
    public async Task HSK_007_one_adapter_uses_one_connection_for_many_exchanges()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(queueCapacity: 256), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        for (var index = 0; index < 100; index++)
        {
            adapter.CaptureStarted(TestValues.RequestA());
        }

        await WaitForAsync(() => transport.MessageCount > 0);
        Assert.Equal(1, transport.ConnectCount);
    }

    [Fact]
    public async Task HSK_008_stop_flushes_closes_and_is_idempotent()
    {
        var transport = new FakeCaptureTransport();
        var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        await adapter.StopAsync();
        await adapter.StopAsync();

        Assert.Equal(1, transport.FlushCount);
        Assert.True(transport.CloseCount >= 1);
        await adapter.DisposeAsync();
    }

    [Fact]
    public async Task COR_001_and_LIF_001_start_and_completion_share_exchange_identity_and_use_distinct_message_ids()
    {
        var transport = new FakeCaptureTransport();
        var clock = new FakeClock(TestValues.StartedAt);
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, clock));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var handle = adapter.CaptureStarted(TestValues.RequestA());
        clock.Timestamp = 40;
        clock.CurrentUtcNow = TestValues.StartedAt.AddMilliseconds(40);
        adapter.CaptureCompleted(handle, TestValues.ResponseA());

        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
        Assert.Equal(TestValues.ExchangeA, started["exchangeId"]!.GetValue<string>());
        Assert.Equal(TestValues.MessageStartA, started["messageId"]!.GetValue<string>());
        Assert.Equal(1UL, started["revision"]!.GetValue<ulong>());
        Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
        Assert.Equal(TestValues.ExchangeA, completed["exchangeId"]!.GetValue<string>());
        Assert.Equal(TestValues.MessageCompleteA, completed["messageId"]!.GetValue<string>());
        Assert.Equal(2UL, completed["revision"]!.GetValue<ulong>());
        Assert.NotEqual(started["messageId"]!.GetValue<string>(), completed["messageId"]!.GetValue<string>());
        Assert.Equal(40UL, completed["timing"]!["total"]!["milliseconds"]!.GetValue<ulong>());
    }

    [Fact]
    public async Task COR_002_identical_requests_complete_in_reverse_order_using_their_local_handles()
    {
        var transport = new FakeCaptureTransport { AutoAcceptMessages = false };
        var ids = new[]
        {
            Guid.Parse(TestValues.SourceId),
            Guid.Parse(TestValues.ExchangeA),
            Guid.Parse(TestValues.MessageStartA),
            Guid.Parse(TestValues.ExchangeB),
            Guid.Parse(TestValues.MessageStartB),
            Guid.Parse(TestValues.MessageCompleteB),
            Guid.Parse(TestValues.MessageCompleteA),
        };
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, ids: ids));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        var handleA = adapter.CaptureStarted(TestValues.RequestA());
        var handleB = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handleB, TestValues.ResponseA());
        adapter.CaptureCompleted(handleA, TestValues.ResponseA());

        var emitted = new[]
        {
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
        };

        Assert.Collection(emitted,
            message => Assert.Equal(("exchange.started", TestValues.ExchangeA), (message["type"]!.GetValue<string>(), message["exchangeId"]!.GetValue<string>())),
            message => Assert.Equal(("exchange.started", TestValues.ExchangeB), (message["type"]!.GetValue<string>(), message["exchangeId"]!.GetValue<string>())),
            message => Assert.Equal(("exchange.completed", TestValues.ExchangeB), (message["type"]!.GetValue<string>(), message["exchangeId"]!.GetValue<string>())),
            message => Assert.Equal(("exchange.completed", TestValues.ExchangeA), (message["type"]!.GetValue<string>(), message["exchangeId"]!.GetValue<string>())));
    }

    [Fact]
    public async Task COR_003_acknowledgements_resolve_by_message_id_even_when_completed_out_of_order()
    {
        var transport = new FakeCaptureTransport { AutoAcceptMessages = false };
        var ids = new[] { Guid.Parse(TestValues.SourceId), Guid.Parse(TestValues.ExchangeA), Guid.Parse(TestValues.MessageStartA), Guid.Parse(TestValues.ExchangeB), Guid.Parse(TestValues.MessageStartB) };
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, ids: ids));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureStarted(TestValues.RequestA());
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        transport.Accept(TestValues.MessageStartB);
        transport.Accept(TestValues.MessageStartA);

        await WaitForAsync(() => adapter.Diagnostics.Count == 0);
        Assert.Empty(adapter.Diagnostics);
    }

    [Fact]
    public async Task COR_005_COR_006_and_COR_007_emit_at_most_one_terminal_with_the_original_exchange_id()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureFailed(handle, new CapturedFailure("transport", "failed", true));
        adapter.CaptureCompleted(handle, TestValues.ResponseA());
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var failed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
        Assert.Equal("exchange.failed", failed["type"]!.GetValue<string>());
        Assert.Equal(started["exchangeId"]!.GetValue<string>(), failed["exchangeId"]!.GetValue<string>());
        Assert.Equal(2UL, failed["revision"]!.GetValue<ulong>());
    }

    [Fact]
    public async Task LIF_002_4xx_and_5xx_responses_are_completed_not_failed()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handle, TestValues.ResponseA() with { StatusCode = 500 });
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("exchange.completed", completed["type"]!.GetValue<string>());
        Assert.Equal(500, completed["response"]!["statusCode"]!.GetValue<int>());
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
