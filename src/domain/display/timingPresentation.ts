/** Uses an em dash for timing that an interceptor cannot yet know. */
export function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(2)} s` : `${durationMs} ms`;
}
