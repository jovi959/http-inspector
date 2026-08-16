using System.ServiceModel;
using System.ServiceModel.Channels;
using System.ServiceModel.Description;
using System.ServiceModel.Dispatcher;
using System.Text;
using System.Text.Json.Nodes;
using System.Xml;

namespace HttpInspector.Adapter;

public static class HttpInspectorWcf
{
    public static ClientBase<TChannel> Attach<TChannel>(ClientBase<TChannel> client, HttpInspectorAdapter adapter) where TChannel : class
    {
        ArgumentNullException.ThrowIfNull(client);
        ArgumentNullException.ThrowIfNull(adapter);
        if (client.State != CommunicationState.Created)
        {
            throw new InvalidOperationException("Attach HTTP Inspector before the WCF client is opened, closed, or faulted.");
        }
        if (!client.Endpoint.EndpointBehaviors.OfType<HttpInspectorWcfEndpointBehavior>().Any())
        {
            client.Endpoint.EndpointBehaviors.Add(new HttpInspectorWcfEndpointBehavior(adapter));
        }

        return client;
    }
}

internal sealed class HttpInspectorWcfEndpointBehavior(HttpInspectorAdapter adapter) : IEndpointBehavior
{
    public void AddBindingParameters(ServiceEndpoint endpoint, BindingParameterCollection bindingParameters)
    {
        if (IsHttp(endpoint))
        {
            // WCF owns the primary handler; wrapping its supplied handler retains certificates,
            // proxies, and client settings while adding the same capture bridge used by HttpClient.
            bindingParameters.Add(new Func<HttpClientHandler, HttpMessageHandler>(handler => new HttpInspectorHandler(adapter, CaptureOrigin.WcfHttpTransport) { InnerHandler = handler }));
        }
    }

    public void ApplyClientBehavior(ServiceEndpoint endpoint, ClientRuntime clientRuntime)
    {
        if (!IsHttp(endpoint) && !clientRuntime.ClientMessageInspectors.OfType<HttpInspectorWcfMessageInspector>().Any())
        {
            clientRuntime.ClientMessageInspectors.Add(new HttpInspectorWcfMessageInspector(adapter));
        }
    }

    public void ApplyDispatchBehavior(ServiceEndpoint endpoint, EndpointDispatcher endpointDispatcher)
    {
    }

    public void Validate(ServiceEndpoint endpoint)
    {
    }

    private static bool IsHttp(ServiceEndpoint endpoint) =>
        string.Equals(endpoint.Address?.Uri.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
        || string.Equals(endpoint.Address?.Uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
}

internal sealed class HttpInspectorWcfMessageInspector(HttpInspectorAdapter adapter) : IClientMessageInspector
{
    public object BeforeSendRequest(ref Message request, IClientChannel channel)
    {
        var body = CopyBody(ref request, adapter.MaximumBodyBytes);
        var uri = channel.RemoteAddress?.Uri;
        var headers = new List<CapturedHeader>();
        if (!string.IsNullOrWhiteSpace(request.Headers.Action))
        {
            headers.Add(new CapturedHeader("SOAPAction", request.Headers.Action));
        }

        if (request.Headers.To is not null)
        {
            headers.Add(new CapturedHeader("To", request.Headers.To.AbsoluteUri));
        }

        var captured = new CapturedRequest(
            "POST",
            uri?.AbsoluteUri ?? string.Empty,
            headers,
            [],
            body,
            "POST",
            uri?.Scheme,
            uri?.Host,
            uri?.IsDefaultPort == false ? uri.Port : null,
            uri?.AbsolutePath,
            uri?.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries),
            null,
            request.Version.Envelope.ToString(),
            body);
        return adapter.CaptureStarted(captured, null, CaptureOrigin.WcfMessageInspector);
    }

    public void AfterReceiveReply(ref Message reply, object correlationState)
    {
        if (correlationState is not ExchangeHandle handle)
        {
            return;
        }

        var body = CopyBody(ref reply, adapter.MaximumBodyBytes);
        var headers = new List<CapturedHeader>();
        var statusCode = 200;
        string? reason = null;
        if (reply.Properties.TryGetValue(HttpResponseMessageProperty.Name, out var property) && property is HttpResponseMessageProperty response)
        {
            statusCode = (int)response.StatusCode;
            reason = response.StatusDescription;
            foreach (var header in response.Headers.AllKeys)
            {
                if (header is not null && response.Headers[header] is { } value)
                {
                    headers.Add(new CapturedHeader(header, value));
                }
            }
        }

        var metadata = reply.IsFault ? new CompletionData(new JsonObject { ["soapFault"] = true }) : null;
        adapter.CaptureCompleted(handle, new CapturedResponse(statusCode, headers, body, reason, reply.Version.Envelope.ToString(), body), metadata);
    }

    private static CapturedBody CopyBody(ref Message message, ulong maximumBodyBytes)
    {
        try
        {
            var buffer = message.CreateBufferedCopy(MaximumBufferSize(maximumBodyBytes));
            using var capture = buffer.CreateMessage();
            message = buffer.CreateMessage();
            var builder = new StringBuilder();
            using var writer = XmlWriter.Create(builder, new XmlWriterSettings { OmitXmlDeclaration = false, Indent = false, Encoding = Encoding.UTF8 });
            capture.WriteMessage(writer);
            writer.Flush();
            return CapturedBody.TextBody(builder.ToString(), "application/soap+xml", "utf-8");
        }
        catch
        {
            return CapturedBody.Unavailable("application/soap+xml", "utf-8");
        }
    }

    private static int MaximumBufferSize(ulong maximumBodyBytes) => (int)Math.Min(maximumBodyBytes, (ulong)int.MaxValue);
}
