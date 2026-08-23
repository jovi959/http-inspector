using System.Net;

namespace HttpInspector.Adapter;

internal static class HttpContentObservation
{
    public static HttpContent WrapResponse(
        HttpContent content,
        ulong maximumBodyBytes,
        Action<ObservedCapturedBody> completed,
        Action<ObservedCapturedBody, Exception> failed,
        string? responseContentEncoding = null) =>
        new ObservedHttpContent(content, new HttpBodyObservationState(HttpBodyMetadata.From(content.Headers, responseContentEncoding), maximumBodyBytes, completed, failed, captureResponseBody: true));

    public static HttpContent WrapRequest(
        HttpContent content,
        ulong maximumBodyBytes,
        Action<CapturedBody> completed,
        Action<CapturedBody, Exception> failed) =>
        new ObservedHttpContent(content, new HttpBodyObservationState(
            HttpBodyMetadata.From(content.Headers),
            maximumBodyBytes,
            observed => completed(observed.Body),
            (observed, exception) => failed(observed.Body, exception),
            captureResponseBody: false));

    private sealed class ObservedHttpContent : HttpContent
    {
        private readonly HttpContent _inner;
        private readonly HttpBodyObservationState _state;

        public ObservedHttpContent(HttpContent inner, HttpBodyObservationState state)
        {
            _inner = inner;
            _state = state;
            foreach (var header in inner.Headers)
            {
                Headers.TryAddWithoutValidation(header.Key, header.Value);
            }
        }

        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
        {
            var observing = new ObservingWriteStream(stream, _state);
            try
            {
                await _inner.CopyToAsync(observing);
                _state.Complete();
            }
            catch (Exception exception)
            {
                _state.Fail(exception);
                throw;
            }
        }

        protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context, CancellationToken cancellationToken)
        {
            var observing = new ObservingWriteStream(stream, _state);
            try
            {
                await _inner.CopyToAsync(observing, cancellationToken);
                _state.Complete();
            }
            catch (Exception exception)
            {
                _state.Fail(exception);
                throw;
            }
        }

        protected override async Task<Stream> CreateContentReadStreamAsync()
        {
            try
            {
                return new ObservingReadStream(await _inner.ReadAsStreamAsync(), _state);
            }
            catch (Exception exception)
            {
                _state.Fail(exception);
                throw;
            }
        }

        protected override async Task<Stream> CreateContentReadStreamAsync(CancellationToken cancellationToken)
        {
            try
            {
                return new ObservingReadStream(await _inner.ReadAsStreamAsync(cancellationToken), _state);
            }
            catch (Exception exception)
            {
                _state.Fail(exception);
                throw;
            }
        }

        protected override bool TryComputeLength(out long length)
        {
            if (_inner.Headers.ContentLength is long contentLength)
            {
                length = contentLength;
                return true;
            }

            length = 0;
            return false;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _state.DisposeObservation();
                _inner.Dispose();
            }

            base.Dispose(disposing);
        }
    }

}
