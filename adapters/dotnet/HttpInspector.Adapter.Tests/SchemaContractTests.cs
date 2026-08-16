using System.Text.Json.Nodes;
using HttpInspector.Adapter;
using Json.Schema;
using Xunit;

namespace HttpInspector.Adapter.Tests;

public sealed class SchemaContractTests
{
    [Fact]
    public async Task CONTRACT_001_emitted_hello_started_and_completed_messages_parse_as_camel_case_v1_contract_objects()
    {
        var transport = new FakeCaptureTransport();
        await using var adapter = HttpInspectorAdapter.Create(TestValues.Config(), TestValues.Dependencies(transport));
        adapter.Start();
        var hello = await transport.ReadHelloAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var handle = adapter.CaptureStarted(TestValues.RequestA());
        adapter.CaptureCompleted(handle, TestValues.ResponseA());
        var started = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));
        var completed = await transport.ReadMessageAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(1));

        Assert.NotNull(JsonNode.Parse(hello.ToJsonString()));
        Assert.NotNull(JsonNode.Parse(started.ToJsonString()));
        Assert.NotNull(JsonNode.Parse(completed.ToJsonString()));
        Assert.True(Validate("ClientHello", hello).IsValid);
        Assert.True(Validate("CaptureMessage", started).IsValid);
        Assert.True(Validate("CaptureMessage", completed).IsValid);
        Assert.NotNull(started["sourceInstanceId"]);
        Assert.Null(started["source_instance_id"]);
    }

    [Fact]
    public void CONTRACT_002_committed_valid_and_invalid_exchange_fixtures_are_accepted_and_rejected_by_the_schema()
    {
        var root = InspectorRoot();
        var valid = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "fixtures/captures/valid-completed.json")))!;
        var invalid = JsonNode.Parse(File.ReadAllText(Path.Combine(root, "fixtures/captures/invalid-status.json")))!;

        Assert.True(Validate("HttpExchange", valid).IsValid);
        Assert.False(Validate("HttpExchange", invalid).IsValid);
    }

    private static EvaluationResults Validate(string definition, JsonNode instance)
    {
        var schemaRoot = JsonNode.Parse(File.ReadAllText(Path.Combine(InspectorRoot(), "contracts/http-inspector.v1.schema.json")))!.AsObject();
        var schema = new JsonObject
        {
            ["$schema"] = schemaRoot["$schema"]!.DeepClone(),
            ["$defs"] = schemaRoot["$defs"]!.DeepClone(),
            ["$ref"] = $"#/$defs/{definition}",
        };
        var parsedInstance = JsonNode.Parse(instance.ToJsonString())!;
        return JsonSchema.FromText(schema.ToJsonString()).Evaluate(parsedInstance, new EvaluationOptions { OutputFormat = OutputFormat.List });
    }

    private static string InspectorRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "contracts/http-inspector.v1.schema.json")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException("Could not locate the HTTP Inspector contract root.");
    }
}
