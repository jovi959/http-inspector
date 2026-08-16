/** URL parsing is guarded because invalid adapter input must remain inspectable. */
export function getUrlDisplay(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host, path: parsed.pathname || "/" };
  } catch {
    return { host: "<invalid-url>", path: url };
  }
}
