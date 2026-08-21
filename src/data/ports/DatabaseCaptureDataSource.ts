import type { DatabaseCommand, DatabaseCommandKey, DatabaseCommandSummary, DatabaseUiDelta } from "@/generated/contracts";

/** Keeps database capture retrieval independent from the HTTP capture data-source contract. */
export interface DatabaseCaptureDataSource {
  getInitialSnapshot(): Promise<readonly DatabaseCommandSummary[]>;
  getCommand(key: DatabaseCommandKey): Promise<DatabaseCommand | null>;
  subscribe(listener: (deltas: readonly DatabaseUiDelta[]) => void): () => void;
}
