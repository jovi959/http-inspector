using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http;

namespace HttpInspector.Adapter;

public sealed class HttpInspectorOptions
{
    public string? Endpoint { get; set; }
    public string ApplicationName { get; set; } = AppDomain.CurrentDomain.FriendlyName;
    public string ServiceName { get; set; } = AppDomain.CurrentDomain.FriendlyName;
    public string? Environment { get; set; }
    public string? DeviceName { get; set; }
    public string? BuildVersion { get; set; }
    public string? BaseUrl { get; set; }
    public JsonObject SourceMetadata { get; set; } = [];
    public int QueueCapacity { get; set; } = 256;
    public int DatabaseQueueCapacity { get; set; } = 128;
    public ulong MaximumDatabaseCaptureBytes { get; set; } = 1024UL * 1024UL;
    public ulong MaximumDatabaseResultCaptureBytes { get; set; } = 256UL * 1024UL;
    public int MaximumDatabaseResultRows { get; set; } = 100;
    public ulong MaximumDatabaseResultCellBytes { get; set; } = 16UL * 1024UL;
    public int MaximumDatabaseResultColumns { get; set; } = 50;
    public TimeSpan HeartbeatInterval { get; set; } = TimeSpan.FromSeconds(15);

    internal AdapterConfig ToAdapterConfig() => new()
    {
        Endpoint = Endpoint,
        ApplicationName = ApplicationName,
        ServiceName = ServiceName,
        Environment = Environment,
        DeviceName = DeviceName,
        BuildVersion = BuildVersion,
        BaseUrl = BaseUrl,
        SourceMetadata = SourceMetadata,
        QueueCapacity = QueueCapacity,
        DatabaseQueueCapacity = DatabaseQueueCapacity,
        MaximumDatabaseCaptureBytes = MaximumDatabaseCaptureBytes,
        HeartbeatInterval = HeartbeatInterval,
    };
}

public static class HttpInspectorServiceCollectionExtensions
{
    public static IServiceCollection AddHttpInspectorAdapter(this IServiceCollection services, Action<HttpInspectorOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(services);
        var options = new HttpInspectorOptions();
        configure?.Invoke(options);
        services.TryAddSingleton(_ => HttpInspectorAdapter.Create(options.ToAdapterConfig()));
        // Reader-aware capture is opt-in: projects use this service only from their Dapper connection factory path.
        services.TryAddSingleton<DatabaseCommandOwnership>();
        services.TryAddSingleton<IHttpInspectorDatabaseCapture>(provider => new HttpInspectorDatabaseCapture(
            provider.GetRequiredService<HttpInspectorAdapter>(), provider.GetRequiredService<DatabaseCommandOwnership>(),
            options.MaximumDatabaseResultCaptureBytes, options.MaximumDatabaseResultRows, options.MaximumDatabaseResultCellBytes,
            options.MaximumDatabaseResultColumns));
        services.TryAddTransient<HttpInspectorHandler>();
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHttpMessageHandlerBuilderFilter, HttpInspectorMessageHandlerBuilderFilter>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, SystemNetHttpDiagnosticBridge>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, SqlClientDiagnosticBridge>());
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IHostedService, HttpInspectorHostedService>());
        return services;
    }

    public static IHttpClientBuilder AddHttpInspectorAdapter(this IHttpClientBuilder builder, Action<HttpInspectorOptions>? configure = null)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Services.AddHttpInspectorAdapter(configure);
        return builder.AddHttpMessageHandler<HttpInspectorHandler>();
    }
}

internal sealed class HttpInspectorHostedService(HttpInspectorAdapter adapter) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        adapter.Start();
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => adapter.StopAsync();
}
