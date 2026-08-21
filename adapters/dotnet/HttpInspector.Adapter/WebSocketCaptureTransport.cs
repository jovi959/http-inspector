using System.Buffers;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;

namespace HttpInspector.Adapter;

public sealed class WebSocketCaptureTransport : ICaptureTransport
{
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<MessageAcknowledgement>> _acknowledgements = [];
    private readonly object _gate = new();
    private ClientWebSocket? _socket;
    private CancellationTokenSource? _receiveCancellation;
    private Task? _receiveLoop;
    private TaskCompletionSource<NegotiatedSession>? _hello;

    public async Task<NegotiatedSession> ConnectAsync(Uri endpoint, JsonObject clientHello, CancellationToken cancellationToken)
    {
        await CloseAsync(CancellationToken.None);

        var socket = new ClientWebSocket();
        await socket.ConnectAsync(endpoint, cancellationToken);
        var receiveCancellation = new CancellationTokenSource();
        var hello = new TaskCompletionSource<NegotiatedSession>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_gate)
        {
            _socket = socket;
            _receiveCancellation = receiveCancellation;
            _hello = hello;
            _receiveLoop = Task.Run(() => ReceiveLoopAsync(socket, receiveCancellation.Token));
        }

        try
        {
            await SendJsonAsync(clientHello, cancellationToken);
            using var helloTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            helloTimeout.CancelAfter(TimeSpan.FromSeconds(3));
            return await hello.Task.WaitAsync(helloTimeout.Token);
        }
        catch
        {
            await CloseAsync(CancellationToken.None);
            throw;
        }
    }

    public async Task<MessageAcknowledgement> SendAsync(JsonObject message, CancellationToken cancellationToken)
    {
        var messageId = message["messageId"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(messageId))
        {
            throw new CaptureTransportException("serialization", "Capture messages must include a messageId.", false);
        }

        var acknowledgement = new TaskCompletionSource<MessageAcknowledgement>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_acknowledgements.TryAdd(messageId, acknowledgement))
        {
            throw new CaptureTransportException("serialization", "A duplicate messageId was generated.", false);
        }

        try
        {
            await SendJsonAsync(message, cancellationToken);
            return await acknowledgement.Task.WaitAsync(cancellationToken);
        }
        finally
        {
            _acknowledgements.TryRemove(messageId, out _);
        }
    }

    public Task FlushAsync(TimeSpan timeout, CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task CloseAsync(CancellationToken cancellationToken)
    {
        ClientWebSocket? socket;
        CancellationTokenSource? receiveCancellation;
        Task? receiveLoop;
        lock (_gate)
        {
            socket = _socket;
            receiveCancellation = _receiveCancellation;
            receiveLoop = _receiveLoop;
            _socket = null;
            _receiveCancellation = null;
            _receiveLoop = null;
            _hello = null;
        }

        receiveCancellation?.Cancel();
        if (socket is not null)
        {
            try
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                {
                    await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "adapter stopping", cancellationToken);
                }
            }
            catch
            {
            }
            finally
            {
                socket.Dispose();
            }
        }

        if (receiveLoop is not null)
        {
            try
            {
                await receiveLoop;
            }
            catch
            {
            }
        }

        receiveCancellation?.Dispose();
        FailPending(new CaptureTransportException("listenerRestarted", "The capture WebSocket closed before acknowledgement.", true));
    }

    private async Task SendJsonAsync(JsonObject payload, CancellationToken cancellationToken)
    {
        ClientWebSocket socket;
        lock (_gate)
        {
            socket = _socket ?? throw new CaptureTransportException("endpointUnreachable", "The capture WebSocket is not connected.", true);
        }

        var bytes = Encoding.UTF8.GetBytes(payload.ToJsonString());
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task ReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested && socket.State is WebSocketState.Open or WebSocketState.CloseSent)
            {
                var text = await ReceiveTextAsync(socket, cancellationToken);
                if (text is null)
                {
                    break;
                }

                ProcessServerMessage(text);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            FailPending(new CaptureTransportException("endpointUnreachable", exception.Message, true, exception));
        }
        finally
        {
            FailPending(new CaptureTransportException("listenerRestarted", "The capture WebSocket disconnected.", true));
        }
    }

    private static async Task<string?> ReceiveTextAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        var bytes = new ArrayBufferWriter<byte>();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close)
            {
                return null;
            }

            if (result.MessageType != WebSocketMessageType.Text)
            {
                throw new CaptureTransportException("protocolMismatch", "The capture listener sent a non-text frame.", false);
            }

            bytes.Write(buffer.AsSpan(0, result.Count));
        }
        while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(bytes.WrittenSpan);
    }

    private void ProcessServerMessage(string text)
    {
        var message = JsonNode.Parse(text)?.AsObject() ?? throw new CaptureTransportException("protocolMismatch", "The capture listener sent invalid JSON.", false);
        var type = message["type"]?.GetValue<string>();
        switch (type)
        {
            case "hello.accepted":
                var value = message["value"]?.AsObject() ?? throw new CaptureTransportException("protocolMismatch", "The listener acceptance was missing its value.", false);
                var acceptedCapabilities = new HashSet<string>(StringComparer.Ordinal);
                if (value["acceptedCapabilities"] is JsonArray capabilities)
                {
                    foreach (var capability in capabilities)
                    {
                        if (capability?.GetValue<string>() is { Length: > 0 } valueName)
                        {
                            acceptedCapabilities.Add(valueName);
                        }
                    }
                }

                _hello?.TrySetResult(new NegotiatedSession(
                    value["connectionId"]!.GetValue<string>(),
                    value["sessionId"]!.GetValue<string>(),
                    value["maximumMessageBytes"]!.GetValue<ulong>(),
                    value["maximumBodyBytes"]!.GetValue<ulong>(),
                    acceptedCapabilities));
                break;
            case "hello.error":
                var helloError = message["value"]?.AsObject() ?? throw new CaptureTransportException("protocolMismatch", "The listener rejection was missing its value.", false);
                _hello?.TrySetException(new CaptureTransportException(
                    helloError["code"]!.GetValue<string>(),
                    helloError["message"]!.GetValue<string>(),
                    helloError["retryable"]!.GetValue<bool>()));
                break;
            case "message.accepted":
                CompleteAcknowledgement(message["messageId"]?.GetValue<string>(), true, null, null, false);
                break;
            case "message.error":
                var error = message["error"]?.AsObject();
                CompleteAcknowledgement(
                    message["messageId"]?.GetValue<string>(),
                    false,
                    error?["code"]?.GetValue<string>(),
                    error?["message"]?.GetValue<string>(),
                    error?["retryable"]?.GetValue<bool>() ?? false);
                break;
            default:
                throw new CaptureTransportException("protocolMismatch", "The capture listener sent an unsupported message type.", false);
        }
    }

    private void CompleteAcknowledgement(string? messageId, bool accepted, string? errorCode, string? errorMessage, bool retryable)
    {
        if (!string.IsNullOrWhiteSpace(messageId) && _acknowledgements.TryGetValue(messageId, out var acknowledgement))
        {
            acknowledgement.TrySetResult(new MessageAcknowledgement(messageId, accepted, errorCode, errorMessage, retryable));
        }
    }

    private void FailPending(Exception exception)
    {
        foreach (var acknowledgement in _acknowledgements.Values)
        {
            acknowledgement.TrySetException(exception);
        }
    }
}
