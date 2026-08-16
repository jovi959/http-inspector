using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http;

namespace HttpInspector.Adapter;

internal sealed class HttpInspectorMessageHandlerBuilderFilter : IHttpMessageHandlerBuilderFilter
{
    public Action<HttpMessageHandlerBuilder> Configure(Action<HttpMessageHandlerBuilder> next) => builder =>
    {
        next(builder);

        // The filter runs after each client registration so Refit and ordinary factory clients
        // share one final capture seam without project-specific fluent-chain edits.
        if (builder.AdditionalHandlers.Any(handler => handler is HttpInspectorHandler))
        {
            return;
        }

        builder.AdditionalHandlers.Add(builder.Services.GetRequiredService<HttpInspectorHandler>());
    };
}
