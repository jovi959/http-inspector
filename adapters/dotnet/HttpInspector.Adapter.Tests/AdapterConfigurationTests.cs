using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class AdapterConfigurationTests
{
    [Fact]
    public void CFG_004_development_fallback_uses_the_v1_loopback_endpoint()
    {
        var config = new AdapterConfig
        {
            ApplicationName = "test-application",
            ServiceName = "test-service",
        };

        var adapter = HttpInspectorAdapter.Create(config);

        Assert.Equal("ws://127.0.0.1:53662/v1/capture", adapter.EffectiveEndpoint.ToString());
    }

    [Fact]
    public void CFG_001_explicit_endpoint_wins_over_environment()
    {
        var adapter = HttpInspectorAdapter.Create(
            TestValues.Config(TestValues.AlternateEndpoint),
            TestValues.Dependencies(new FakeCaptureTransport(), environment: new FakeEnvironment(TestValues.Endpoint)));

        Assert.Equal(TestValues.AlternateEndpoint, adapter.EffectiveEndpoint.ToString());
    }

    [Fact]
    public void CFG_002_environment_endpoint_is_used_when_no_explicit_endpoint_exists()
    {
        var adapter = HttpInspectorAdapter.Create(
            TestValues.Config(null),
            TestValues.Dependencies(new FakeCaptureTransport(), environment: new FakeEnvironment(TestValues.AlternateEndpoint)));

        Assert.Equal(TestValues.AlternateEndpoint, adapter.EffectiveEndpoint.ToString());
    }

    [Theory]
    [InlineData("http://127.0.0.1:53662/v1/capture")]
    [InlineData("ws://127.0.0.1/v1/capture")]
    [InlineData("ws://127.0.0.1:53662/other")]
    public void CFG_005_invalid_endpoint_fails_before_workers_start(string endpoint)
    {
        Assert.Throws<ArgumentException>(() => HttpInspectorAdapter.Create(TestValues.Config(endpoint)));
    }

    [Theory]
    [InlineData("same-origin-relay-v1")]
    [InlineData("http-batch-v1")]
    [InlineData("unknown")]
    public void CFG_006_deferred_or_unknown_transport_profile_is_rejected(string profile)
    {
        var config = TestValues.Config();
        config = new AdapterConfig
        {
            Endpoint = config.Endpoint,
            ApplicationName = config.ApplicationName,
            ServiceName = config.ServiceName,
            TransportProfile = profile,
        };

        Assert.Throws<ArgumentException>(() => HttpInspectorAdapter.Create(config));
    }

    [Fact]
    public async Task CFG_007_hello_contains_no_pairing_or_authentication_configuration()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();

        var hello = await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.Null(hello["pairingToken"]);
        Assert.Null(hello["authenticationToken"]);
        Assert.Null(hello["rotationState"]);
    }
}
