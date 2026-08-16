using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class RecoveryTests
{
    [Fact]
    public async Task LIF_003_and_LIF_004_failures_and_cancellations_keep_the_start_exchange_identity()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var failedHandle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureFailed(failedHandle, new CapturedFailure("transport", "socket reset", true));
        var cancelledHandle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCancelled(cancelledHandle, "cancellationToken");
        var emitted = new[]
        {
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
        };

        Assert.Equal("exchange.failed", emitted[1]["type"]!.GetValue<string>());
        Assert.Equal(emitted[0]["exchangeId"]!.GetValue<string>(), emitted[1]["exchangeId"]!.GetValue<string>());
        Assert.Equal("transport", emitted[1]["failure"]!["category"]!.GetValue<string>());
        Assert.Equal("exchange.cancelled", emitted[3]["type"]!.GetValue<string>());
        Assert.Equal(emitted[2]["exchangeId"]!.GetValue<string>(), emitted[3]["exchangeId"]!.GetValue<string>());
        Assert.Equal("cancellationToken", emitted[3]["origin"]!.GetValue<string>());
    }

    [Fact]
    public async Task LIF_006_unknown_network_timing_is_null_with_unavailable_provenance()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handle, TestValues.ResponseA());
        await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Null(completed["timing"]!["dns"]!["milliseconds"]);
        Assert.Equal("unavailable", completed["timing"]!["dns"]!["provenance"]!.GetValue<string>());
        Assert.Null(completed["timing"]!["tls"]!["milliseconds"]);
    }

    [Fact]
    public async Task LIF_007_and_LIF_008_emit_one_logical_exchange_per_callback_and_relate_observable_attempts_by_operation_id()
    {
        var transport = new FakeCaptureTransport();
        var ids = new[]
        {
            Guid.Parse(TestValues.SourceId),
            Guid.Parse(TestValues.ExchangeA),
            Guid.Parse(TestValues.MessageStartA),
            Guid.Parse(TestValues.MessageCompleteA),
            Guid.Parse(TestValues.ExchangeB),
            Guid.Parse(TestValues.MessageStartB),
            Guid.Parse(TestValues.MessageCompleteB),
        };
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, ids: ids));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var context = new CaptureContext(OperationId: "logical-operation");
        var first = adapter.CaptureStarted(TestValues.RequestA(), context);
        adapter.CaptureCompleted(first, TestValues.ResponseA());
        var second = adapter.CaptureStarted(TestValues.RequestA(), context);
        adapter.CaptureCompleted(second, TestValues.ResponseA());
        var messages = new[]
        {
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
            await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1)),
        };

        Assert.Equal(TestValues.ExchangeA, messages[0]["exchangeId"]!.GetValue<string>());
        Assert.Equal(TestValues.ExchangeB, messages[2]["exchangeId"]!.GetValue<string>());
        Assert.Equal("logical-operation", messages[0]["correlation"]!["operationId"]!.GetValue<string>());
        Assert.Equal("logical-operation", messages[2]["correlation"]!["operationId"]!.GetValue<string>());
    }

    [Fact]
    public async Task LIF_009_indefinite_streams_remain_in_flight_until_the_host_stack_reports_a_terminal_state()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        adapter.CaptureStarted(TestValues.RequestA());
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Equal("exchange.started", started["type"]!.GetValue<string>());
        Assert.Single(transport.RecordedMessages);
    }

    [Fact]
    public async Task REC_001_REC_003_and_REC_006_reconnect_with_a_fresh_hello_and_recovery_snapshot_while_retaining_source_and_exchange_identity()
    {
        var transport = new FakeCaptureTransport { AutoAcceptMessages = false };
        transport.QueueConnection(new NegotiatedSession("11111111-2222-4333-8444-55555555d002", TestValues.SessionId, TestValues.MaximumMessageBytes, TestValues.MaximumBodyBytes));
        var delay = new FakeDelay();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport, delay: delay));
        adapter.Start();
        var firstHello = await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        adapter.CaptureStarted(TestValues.RequestA());
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        transport.Fail(started["messageId"]!.GetValue<string>(), new CaptureTransportException("listenerRestarted", "closed", true));
        await WaitForAsync(() => delay.Scheduled.Contains(TimeSpan.FromMilliseconds(250)));
        delay.Advance(TimeSpan.FromMilliseconds(250));
        var secondHello = await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => transport.RecordedMessages.Any(message => message["type"]?.GetValue<string>() == "exchange.snapshot"));
        var snapshot = transport.RecordedMessages.Last(message => message["type"]?.GetValue<string>() == "exchange.snapshot");

        Assert.Equal(TestValues.SourceId, firstHello["source"]!["instanceId"]!.GetValue<string>());
        Assert.Equal(TestValues.SourceId, secondHello["source"]!["instanceId"]!.GetValue<string>());
        Assert.Equal(TestValues.ExchangeA, snapshot["exchangeId"]!.GetValue<string>());
        Assert.True(snapshot["revision"]!.GetValue<ulong>() >= 3);
        Assert.Equal(2, transport.ConnectCount);
    }

    [Fact]
    public async Task REC_002_uses_bounded_exponential_backoff_and_REC_004_keeps_the_explicit_endpoint_pinned()
    {
        var transport = new FakeCaptureTransport();
        transport.ConnectException = new InvalidOperationException("refused");
        var delay = new FakeDelay();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(TestValues.AlternateEndpoint), TestValues.Dependencies(transport, delay: delay, environment: new FakeEnvironment(TestValues.Endpoint)));
        adapter.Start();

        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => delay.Scheduled.Contains(TimeSpan.FromMilliseconds(250)));
        delay.Advance(TimeSpan.FromMilliseconds(250));
        await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        await WaitForAsync(() => delay.Scheduled.Contains(TimeSpan.FromMilliseconds(500)));

        Assert.Equal(TestValues.AlternateEndpoint, adapter.EffectiveEndpoint.ToString());
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
