import { Channel, invoke } from "@tauri-apps/api/core";

import type { DatabaseCaptureDataSource } from "@/data/ports/DatabaseCaptureDataSource";
import type { DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta } from "@/generated/contracts";

/** Uses dedicated native commands so database events do not enter the HTTP capture store. */
export class TauriDatabaseCaptureDataSource implements DatabaseCaptureDataSource {
  getInitialSnapshot(): Promise<readonly DatabaseCommandSummary[]> {
    return invoke<readonly DatabaseCommandSummary[]>("database_capture_snapshot");
  }

  getCommand(key: DatabaseCommandKey): Promise<DatabaseCommand | null> {
    return invoke<DatabaseCommand | null>("database_capture_command", { sourceInstanceId: key.sourceInstanceId, commandId: key.commandId });
  }

  subscribe(listener: (deltas: readonly DatabaseUiDelta[]) => void): () => void {
    let disposed = false;
    const channel = new Channel<readonly DatabaseUiDelta[]>((deltas) => {
      if (!disposed) listener(deltas);
    });
    void invoke("subscribe_database_capture_deltas", { channel }).catch(() => {
      if (!disposed) listener([]);
    });
    return () => {
      disposed = true;
    };
  }
}
