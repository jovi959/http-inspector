import type { DatabaseCaptureDataSource } from "@/data/ports/DatabaseCaptureDataSource";
import type { DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta } from "@/generated/contracts";

/** Hosted development reads the database routes separately from the existing HTTP browser source. */
export class BrowserDatabaseCaptureDataSource implements DatabaseCaptureDataSource {
  getInitialSnapshot(): Promise<readonly DatabaseCommandSummary[]> {
    return this.request<readonly DatabaseCommandSummary[]>("/api/database/commands");
  }

  async getCommand(key: DatabaseCommandKey): Promise<DatabaseCommand | null> {
    const path = `/api/database/commands/${encodeURIComponent(key.sourceInstanceId)}/${encodeURIComponent(key.commandId)}`;
    const response = await fetch(path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP Inspector service returned ${response.status}`);
    return response.json() as Promise<DatabaseCommand>;
  }

  subscribe(listener: (deltas: readonly DatabaseUiDelta[]) => void): () => void {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;
    const connect = () => {
      if (disposed) return;
      socket?.close();
      socket = new WebSocket(this.socketUrl());
      socket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        try {
          listener(JSON.parse(event.data) as readonly DatabaseUiDelta[]);
        } catch {
          socket?.close();
        }
      });
      socket.addEventListener("close", () => {
        if (!disposed && retryTimer === null) {
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            connect();
          }, 1_000);
        }
      });
    };
    connect();
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP Inspector service returned ${response.status}`);
    return response.json() as Promise<T>;
  }

  private socketUrl(): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws/database-ui`;
  }
}
