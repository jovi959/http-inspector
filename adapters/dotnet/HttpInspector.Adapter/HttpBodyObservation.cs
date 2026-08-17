using System.Net.Http.Headers;
using System.Buffers;
using System.IO.Compression;
using System.Text;

namespace HttpInspector.Adapter;

internal sealed class HttpBodyObservationState
{
    private readonly object _gate = new();
    private readonly HttpBodyMetadata _metadata;
    private readonly ulong _maximumBodyBytes;
    private readonly Action<ObservedCapturedBody> _completed;
    private readonly Action<ObservedCapturedBody, Exception> _failed;
    private readonly bool _captureResponseBody;
    private MemoryStream? _buffer = new();
    private long _observedByteLength;
    private bool _terminal;

    public HttpBodyObservationState(HttpBodyMetadata metadata, ulong maximumBodyBytes, Action<ObservedCapturedBody> completed, Action<ObservedCapturedBody, Exception> failed, bool captureResponseBody)
    {
        _metadata = metadata;
        _maximumBodyBytes = maximumBodyBytes;
        _completed = completed;
        _failed = failed;
        _captureResponseBody = captureResponseBody;
    }

    public void Observe(ReadOnlySpan<byte> bytes)
    {
        ObservedCapturedBody? terminalBody = null;
        lock (_gate)
        {
            if (_terminal || bytes.IsEmpty)
            {
                return;
            }

            _observedByteLength = checked(_observedByteLength + bytes.Length);
            if (_buffer is not null)
            {
                if ((ulong)_observedByteLength <= _maximumBodyBytes)
                {
                    _buffer.Write(bytes);
                }
                else
                {
                    _buffer.Dispose();
                    _buffer = null;
                }
            }

            if (HasComparableDeclaredLength && _metadata.DeclaredByteLength is long declaredByteLength && _observedByteLength >= declaredByteLength)
            {
                terminalBody = FinishLocked(_observedByteLength == declaredByteLength && _buffer is not null
                    ? Captured(_buffer.ToArray())
                    : Unavailable());
            }
        }

        if (terminalBody is not null)
        {
            InvokeCompleted(terminalBody);
        }
    }

    public void Complete()
    {
        ObservedCapturedBody? body;
        lock (_gate)
        {
            body = FinishLocked(_buffer is null
                ? Unavailable()
                : HasComparableDeclaredLength && _metadata.DeclaredByteLength is long declaredByteLength && _observedByteLength != declaredByteLength
                    ? Unavailable()
                    : _observedByteLength == 0
                    ? Empty()
                    : Captured(_buffer.ToArray()));
        }

        if (body is not null)
        {
            InvokeCompleted(body);
        }
    }

    public void Fail(Exception exception)
    {
        ObservedCapturedBody? body;
        lock (_gate)
        {
            body = FinishLocked(Unavailable());
        }

        if (body is null)
        {
            return;
        }

        try
        {
            _failed(body, exception);
        }
        catch
        {
        }
    }

    public void DisposeObservation()
    {
        ObservedCapturedBody? body;
        lock (_gate)
        {
            body = FinishLocked(_observedByteLength == 0 && _metadata.DeclaredByteLength == 0
                ? Empty()
                : Unavailable());
        }

        if (body is not null)
        {
            InvokeCompleted(body);
        }
    }

    private ObservedCapturedBody? FinishLocked(ObservedCapturedBody body)
    {
        if (_terminal)
        {
            return null;
        }

        _terminal = true;
        _buffer?.Dispose();
        _buffer = null;
        return body;
    }

    private void InvokeCompleted(ObservedCapturedBody body)
    {
        try
        {
            _completed(body);
        }
        catch
        {
        }
    }

    private ObservedCapturedBody Captured(byte[] bytes) => _captureResponseBody
        ? _metadata.CapturedResponse(bytes, _maximumBodyBytes)
        : new ObservedCapturedBody(_metadata.Captured(bytes));

    private ObservedCapturedBody Empty() => new(_metadata.Empty());

    private ObservedCapturedBody Unavailable() => new(_metadata.Unavailable());

    private bool HasComparableDeclaredLength => !_captureResponseBody || string.IsNullOrWhiteSpace(_metadata.ContentEncoding);
}

internal sealed class ObservingReadStream(Stream inner, HttpBodyObservationState state) : Stream
{
    public override bool CanRead => inner.CanRead;
    public override bool CanSeek => inner.CanSeek;
    public override bool CanWrite => false;
    public override long Length => inner.Length;
    public override long Position { get => inner.Position; set => inner.Position = value; }
    public override void Flush() => inner.Flush();
    public override Task FlushAsync(CancellationToken cancellationToken) => inner.FlushAsync(cancellationToken);
    public override int Read(byte[] buffer, int offset, int count)
    {
        try
        {
            var bytesRead = inner.Read(buffer, offset, count);
            ObserveRead(buffer.AsSpan(offset, bytesRead), bytesRead);
            return bytesRead;
        }
        catch (Exception exception)
        {
            state.Fail(exception);
            throw;
        }
    }
    public override int Read(Span<byte> buffer)
    {
        try
        {
            var bytesRead = inner.Read(buffer);
            ObserveRead(buffer[..bytesRead], bytesRead);
            return bytesRead;
        }
        catch (Exception exception)
        {
            state.Fail(exception);
            throw;
        }
    }
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        try
        {
            var bytesRead = await inner.ReadAsync(buffer, cancellationToken);
            ObserveRead(buffer.Span[..bytesRead], bytesRead);
            return bytesRead;
        }
        catch (Exception exception)
        {
            state.Fail(exception);
            throw;
        }
    }
    public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            state.DisposeObservation();
            inner.Dispose();
        }

        base.Dispose(disposing);
    }

    private void ObserveRead(ReadOnlySpan<byte> bytes, int bytesRead)
    {
        if (bytesRead == 0)
        {
            state.Complete();
        }
        else
        {
            state.Observe(bytes);
        }
    }
}

internal sealed class ObservingWriteStream(Stream inner, HttpBodyObservationState state) : Stream
{
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => inner.CanWrite;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
    public override void Flush() => inner.Flush();
    public override Task FlushAsync(CancellationToken cancellationToken) => inner.FlushAsync(cancellationToken);
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count)
    {
        inner.Write(buffer, offset, count);
        state.Observe(buffer.AsSpan(offset, count));
    }
    public override void Write(ReadOnlySpan<byte> buffer)
    {
        inner.Write(buffer);
        state.Observe(buffer);
    }
    public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default)
    {
        await inner.WriteAsync(buffer, cancellationToken);
        state.Observe(buffer.Span);
    }
}

internal sealed record ObservedCapturedBody(CapturedBody Body, CapturedBody? Raw = null);

internal sealed record HttpBodyMetadata(
    string? MediaType,
    string? Charset,
    string? ContentEncoding,
    long? DeclaredByteLength)
{
    public static HttpBodyMetadata From(HttpContentHeaders headers, string? responseContentEncoding = null) => new(
        headers.ContentType?.MediaType,
        headers.ContentType?.CharSet,
        string.IsNullOrWhiteSpace(responseContentEncoding)
            ? headers.ContentEncoding.Count == 0 ? null : string.Join(",", headers.ContentEncoding)
            : responseContentEncoding,
        headers.ContentLength);

    public CapturedBody Empty() => CapturedBody.Empty(MediaType, Charset, ContentEncoding);

    public CapturedBody Unavailable() => CapturedBody.Unavailable(MediaType, Charset, ContentEncoding, DeclaredByteLength);

    public CapturedBody Captured(byte[] bytes)
    {
        if (!string.IsNullOrWhiteSpace(ContentEncoding) || !IsTextMediaType(MediaType))
        {
            return CapturedBody.BinaryBody(bytes, MediaType, DeclaredByteLength, ContentEncoding);
        }

        try
        {
            var encoding = StrictEncoding(Charset);
            var text = encoding.GetString(bytes);
            return encoding.GetBytes(text).AsSpan().SequenceEqual(bytes)
                ? CapturedBody.TextBody(text, MediaType, Charset, DeclaredByteLength, ContentEncoding)
                : CapturedBody.BinaryBody(bytes, MediaType, DeclaredByteLength, ContentEncoding);
        }
        catch (DecoderFallbackException)
        {
            return CapturedBody.BinaryBody(bytes, MediaType, DeclaredByteLength, ContentEncoding);
        }
    }

    public ObservedCapturedBody CapturedResponse(byte[] bytes, ulong maximumBodyBytes)
    {
        var raw = Captured(bytes);
        if (string.IsNullOrWhiteSpace(ContentEncoding))
        {
            return new ObservedCapturedBody(raw);
        }

        if (!TryDecodeContentEncoding(bytes, maximumBodyBytes, out var decoded))
        {
            // Some HttpMessageHandler implementations transparently decompress the
            // stream while retaining Content-Encoding on the response headers. In
            // that case the bytes are already readable; do not turn them into a
            // binary-only body just because a second decode is impossible.
            if (IsTextMediaType(MediaType) && IsValidText(bytes))
            {
                var transportDecoded = (this with { ContentEncoding = null }).Captured(bytes);
                return new ObservedCapturedBody(transportDecoded, raw);
            }

            return new ObservedCapturedBody(raw);
        }

        return new ObservedCapturedBody((this with { ContentEncoding = null }).Captured(decoded), raw);
    }

    private bool TryDecodeContentEncoding(byte[] bytes, ulong maximumBodyBytes, out byte[] decoded)
    {
        var encodings = ContentEncoding!
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.ToLowerInvariant())
            .Where(value => value != "identity")
            .ToArray();
        if (encodings.Length == 0)
        {
            decoded = bytes;
            return true;
        }

        var current = bytes;
        for (var index = encodings.Length - 1; index >= 0; index--)
        {
            if (!TryDecodeLayer(current, encodings[index], maximumBodyBytes, out current))
            {
                decoded = [];
                return false;
            }
        }

        decoded = current;
        return true;
    }

    private static bool TryDecodeLayer(byte[] encoded, string contentEncoding, ulong maximumBodyBytes, out byte[] decoded)
    {
        try
        {
            using var input = new MemoryStream(encoded, writable: false);
            using Stream decompressor = contentEncoding switch
            {
                "gzip" or "x-gzip" => new GZipStream(input, CompressionMode.Decompress),
                "deflate" => new DeflateStream(input, CompressionMode.Decompress),
                "br" => new BrotliStream(input, CompressionMode.Decompress),
                _ => throw new InvalidDataException($"Unsupported content encoding: {contentEncoding}"),
            };
            using var output = new MemoryStream();
            var buffer = ArrayPool<byte>.Shared.Rent(81920);
            try
            {
                long total = 0;
                int count;
                while ((count = decompressor.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total = checked(total + count);
                    if ((ulong)total > maximumBodyBytes)
                    {
                        decoded = [];
                        return false;
                    }

                    output.Write(buffer, 0, count);
                }
            }
            finally
            {
                ArrayPool<byte>.Shared.Return(buffer);
            }

            decoded = output.ToArray();
            return true;
        }
        catch
        {
            decoded = [];
            return false;
        }
    }

    private static bool IsTextMediaType(string? mediaType) =>
        mediaType?.StartsWith("text/", StringComparison.OrdinalIgnoreCase) == true
        || mediaType?.EndsWith("+json", StringComparison.OrdinalIgnoreCase) == true
        || mediaType?.EndsWith("+xml", StringComparison.OrdinalIgnoreCase) == true
        || mediaType is not null && TextMediaTypes.Contains(mediaType);

    private static Encoding StrictEncoding(string? charset)
    {
        var encoding = CapturedBody.GetEncoding(charset);
        return Encoding.GetEncoding(encoding.CodePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
    }

    private bool IsValidText(byte[] bytes)
    {
        try
        {
            var encoding = StrictEncoding(Charset);
            var text = encoding.GetString(bytes);
            return encoding.GetBytes(text).AsSpan().SequenceEqual(bytes);
        }
        catch (DecoderFallbackException)
        {
            return false;
        }
    }

    private static readonly HashSet<string> TextMediaTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/graphql",
        "application/javascript",
        "application/json",
        "application/soap+xml",
        "application/x-www-form-urlencoded",
        "application/xml",
    };
}
