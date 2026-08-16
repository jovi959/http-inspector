namespace HttpInspector.Adapter;

internal static class HttpInspectorRequestMarker
{
    private static readonly HttpRequestOptionsKey<bool> CaptureKey = new("HttpInspector.Adapter.Captured");

    public static void Mark(HttpRequestMessage request) => request.Options.Set(CaptureKey, true);

    public static bool IsMarked(HttpRequestMessage request) => request.Options.TryGetValue(CaptureKey, out var marked) && marked;
}
