import type { ReplayBody, ReplayExecutionReceipt, ReplayProtocol } from "@/data/ports/CaptureController";

export type RecomposeMode = "url" | "headers" | "authentication" | "text" | "json" | "xml" | "raw";

export interface RecomposeQueryRow {
  readonly id: string;
  readonly name: string;
  readonly value: string | null;
  readonly encodedName: string | null;
  readonly encodedValue: string | null;
  readonly edited: boolean;
}

export interface RecomposeHeaderRow {
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

export interface RecomposeWorkingCopy {
  readonly method: string;
  readonly baseUrl: string;
  readonly fragment: string | null;
  readonly protocol: ReplayProtocol;
  readonly query: readonly RecomposeQueryRow[];
  readonly headers: readonly RecomposeHeaderRow[];
  readonly body: ReplayBody | null;
  readonly bodyUnavailable: boolean;
}

export interface RecomposeDraft {
  readonly id: string;
  readonly sourceExchangeId: string;
  readonly baseline: RecomposeWorkingCopy;
  readonly working: RecomposeWorkingCopy;
  readonly selectedMode: RecomposeMode;
  readonly rawText: string | null;
  readonly rawError: string | null;
  readonly dirty: boolean;
  readonly hasExecuted: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly latestExecution: ReplayExecutionReceipt | null;
}

export interface RecomposeSlice {
  readonly activeRecomposeDraft: RecomposeDraft | null;
  readonly selectedRecomposeDraftId: string | null;
  openRecomposeDraft(draft: RecomposeDraft): void;
  selectRecomposeDraft(): void;
  setRecomposeMode(mode: RecomposeMode): void;
  setRecomposeWorking(working: RecomposeWorkingCopy): void;
  setRecomposeRawText(rawText: string): void;
  setRecomposeRawError(rawError: string | null): void;
  beginRecomposeExecution(): void;
  completeRecomposeExecution(receipt: ReplayExecutionReceipt): void;
  failRecomposeExecution(message: string): void;
  revertRecomposeDraft(): void;
  cancelRecomposeDraft(): void;
}
