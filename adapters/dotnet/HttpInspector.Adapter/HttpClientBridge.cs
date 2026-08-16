using System.Diagnostics;
using System.Net.Http.Headers;

namespace HttpInspector.Adapter;

public sealed class HttpInspectorHandler : DelegatingHandler
{
    private readonly HttpInspectorAdapter _adapter;
    private readonly CaptureOrigin _origin;

    public HttpInspectorHandler(HttpInspectorAdapter adapter) : this(adapter, CaptureOrigin.HttpClientFactory)
    {
    }

    internal HttpInspectorHandler(HttpInspectorAdapter adapter, CaptureOrigin origin)
    {
        _adapter = adapter;
        _origin = origin;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var activity = Activity.Current;
        HttpInspectorRequestMarker.Mark(request);
        var handle = _adapter.CaptureStarted(
            await HttpClientCaptureMapper.ToCapturedRequestAsync(request, _adapter.MaximumBodyBytes, cancellationToken),
            activity is null ? null : new CaptureContext(activity.TraceId.ToString(), activity.SpanId.ToString(), activity.ParentSpanId.ToString(), activity.Id),
            _origin);
        try
        {
            var response = await base.SendAsync(request, cancellationToken);
            if (handle.IsCaptured)
            {
                HttpClientCaptureMapper.ObserveResponse(
                    response,
                    _adapter.MaximumBodyBytes,
                    captured => _adapter.CaptureCompleted(handle, captured),
                    (captured, exception) => _adapter.CaptureFailed(
                        handle,
                        new CapturedFailure("interceptor", exception.Message, false, exception.GetType().FullName),
                        captured));
            }
            return response;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _adapter.CaptureCancelled(handle, "cancellationToken");
            throw;
        }
        catch (OperationCanceledException exception)
        {
            _adapter.CaptureFailed(handle, new CapturedFailure("timeout", exception.Message, true));
            throw;
        }
        catch (HttpRequestException exception)
        {
            _adapter.CaptureFailed(handle, new CapturedFailure("transport", exception.Message, true, exception.StatusCode?.ToString()));
            throw;
        }
        catch (Exception exception)
        {
            _adapter.CaptureFailed(handle, new CapturedFailure("interceptor", exception.Message, false, exception.GetType().FullName));
            throw;
        }
    }
}

public static class HttpClientCaptureMapper
{
    public static CapturedRequest ToCapturedRequest(HttpRequestMessage request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var uri = request.RequestUri;
        return new CapturedRequest(
            request.Method.Method,
            uri?.AbsoluteUri ?? string.Empty,
            Headers(request.Headers, request.Content?.Headers),
            Query(uri),
            RequestBody(request.Content),
            request.Method.Method,
            uri?.Scheme,
            uri?.Host,
            uri?.IsDefaultPort == false ? uri.Port : null,
            uri?.AbsolutePath,
            PathSegments(uri),
            uri?.Fragment is { Length: > 0 } fragment ? fragment[1..] : null,
            null);
    }

    public static CapturedResponse ToCapturedResponse(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);
        return new CapturedResponse(
            (int)response.StatusCode,
            Headers(response.Headers, response.Content?.Headers),
            ResponseBody(response.Content),
            response.ReasonPhrase,
            $"HTTP/{response.Version.Major}.{response.Version.Minor}");
    }

    internal static async Task<CapturedRequest> ToCapturedRequestAsync(HttpRequestMessage request, ulong maximumBodyBytes, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var uri = request.RequestUri;
        var body = await HttpContentObservation.CaptureReplayableRequestAsync(request.Content, maximumBodyBytes, cancellationToken);
        return new CapturedRequest(
            request.Method.Method,
            uri?.AbsoluteUri ?? string.Empty,
            Headers(request.Headers, request.Content?.Headers),
            Query(uri),
            body,
            request.Method.Method,
            uri?.Scheme,
            uri?.Host,
            uri?.IsDefaultPort == false ? uri.Port : null,
            uri?.AbsolutePath,
            PathSegments(uri),
            uri?.Fragment is { Length: > 0 } fragment ? fragment[1..] : null,
            null);
    }

    internal static void ObserveResponse(
        HttpResponseMessage response,
        ulong maximumBodyBytes,
        Action<CapturedResponse> completed,
        Action<CapturedResponse, Exception> failed)
    {
        ArgumentNullException.ThrowIfNull(response);
        ArgumentNullException.ThrowIfNull(completed);
        ArgumentNullException.ThrowIfNull(failed);
        _ = response.Content?.Headers.ContentLength;
        var captured = new CapturedResponse(
            (int)response.StatusCode,
            Headers(response.Headers, response.Content?.Headers),
            null,
            response.ReasonPhrase,
            $"HTTP/{response.Version.Major}.{response.Version.Minor}");
        if (response.Content is null)
        {
            completed(captured);
            return;
        }

        if (response.Content.Headers.ContentLength == 0)
        {
            completed(captured with { Body = ResponseBody(response.Content) });
            return;
        }

        response.Content = HttpContentObservation.WrapResponse(
            response.Content,
            maximumBodyBytes,
            body => completed(captured with { Body = body.Body, Raw = body.Raw }),
            (body, exception) => failed(captured with { Body = body.Body, Raw = body.Raw }, exception));
    }

    private static IReadOnlyList<CapturedHeader> Headers(HttpHeaders headers, HttpContentHeaders? contentHeaders)
    {
        var result = new List<CapturedHeader>();
        AddHeaders(result, headers);
        if (contentHeaders is not null)
        {
            AddHeaders(result, contentHeaders);
        }

        return result;
    }

    private static void AddHeaders(ICollection<CapturedHeader> destination, HttpHeaders headers)
    {
        foreach (var header in headers.NonValidated)
        {
            foreach (var value in header.Value)
            {
                destination.Add(new CapturedHeader(header.Key, value));
            }
        }
    }

    private static IReadOnlyList<CapturedQuery> Query(Uri? uri)
    {
        if (uri is null || string.IsNullOrEmpty(uri.Query))
        {
            return [];
        }

        var query = uri.Query[1..];
        var result = new List<CapturedQuery>();
        foreach (var part in query.Split('&', StringSplitOptions.None))
        {
            var separator = part.IndexOf('=');
            result.Add(separator < 0
                ? new CapturedQuery(part, null)
                : new CapturedQuery(part[..separator], part[(separator + 1)..]));
        }

        return result;
    }

    private static IReadOnlyList<string> PathSegments(Uri? uri)
    {
        if (uri is null || string.IsNullOrEmpty(uri.AbsolutePath))
        {
            return [];
        }

        return uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
    }

    private static CapturedBody? RequestBody(HttpContent? content)
    {
        if (content is null)
        {
            return null;
        }

        return UnavailableBody(content);
    }

    private static CapturedBody? ResponseBody(HttpContent? content)
    {
        if (content is null)
        {
            return null;
        }

        return UnavailableBody(content);
    }

    private static CapturedBody UnavailableBody(HttpContent content)
    {
        var contentType = content.Headers.ContentType;
        if (content.Headers.ContentLength == 0)
        {
            return CapturedBody.Empty(contentType?.MediaType, contentType?.CharSet, HeaderValue(content.Headers.ContentEncoding));
        }

        return CapturedBody.Unavailable(
            contentType?.MediaType,
            contentType?.CharSet,
            HeaderValue(content.Headers.ContentEncoding),
            content.Headers.ContentLength);
    }

    private static string? HeaderValue(ICollection<string> values) => values.Count == 0 ? null : string.Join(",", values);
}
