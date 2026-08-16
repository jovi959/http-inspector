using System.ServiceModel;
using HttpInspector.Adapter;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class HttpInspectorWcfTests
{
    [Fact]
    public async Task WCF_001_attach_is_idempotent_for_generated_client_base_types()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        using var client = new TestWcfClient(new BasicHttpBinding(), new EndpointAddress("http://localhost:53663/soap"));

        HttpInspectorWcf.Attach(client, adapter);
        HttpInspectorWcf.Attach(client, adapter);

        Assert.Single(client.Endpoint.EndpointBehaviors, behavior => behavior.GetType().Name == "HttpInspectorWcfEndpointBehavior");
    }

    [Fact]
    public async Task WCF_002_attach_rejects_a_client_that_is_no_longer_in_the_created_state()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        using var client = new TestWcfClient(new BasicHttpBinding(), new EndpointAddress("http://localhost:53663/soap"));
        client.Abort();

        var exception = Assert.Throws<InvalidOperationException>(() => HttpInspectorWcf.Attach(client, adapter));

        Assert.Contains("before the WCF client is opened", exception.Message, StringComparison.Ordinal);
    }

    [ServiceContract]
    private interface ITestWcfContract
    {
        [OperationContract]
        string Ping();
    }

    private sealed class TestWcfClient(BasicHttpBinding binding, EndpointAddress address) : ClientBase<ITestWcfContract>(binding, address), ITestWcfContract
    {
        public string Ping() => Channel.Ping();
    }
}
