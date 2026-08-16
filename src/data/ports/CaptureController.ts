/** Keeps recording controls separate from readers that never need mutation access. */
export interface ReplayHeader {
  readonly name: string;
  readonly value: string;
}

export type ReplayBody =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "base64"; readonly value: string };

export type ReplayProtocol = "auto" | "http11" | "http2";

export interface ReplayOrigin {
  readonly sourceInstanceId: string;
  readonly exchangeId: string;
  readonly draftId: string;
  readonly edited: boolean;
}

export interface ReplayRequest {
  readonly method: string;
  readonly url: string;
  readonly protocol: ReplayProtocol;
  readonly headers: readonly ReplayHeader[];
  readonly body: ReplayBody | null;
  readonly origin: ReplayOrigin;
}

export interface ReplayExecutionReceipt {
  readonly exchangeKey: {
    readonly sourceInstanceId: string;
    readonly exchangeId: string;
  };
  readonly revision: number;
}

export interface CaptureController {
  clearSession(): Promise<void>;
  setRecording(recording: boolean): Promise<void>;
  executeReplay(request: ReplayRequest): Promise<ReplayExecutionReceipt>;
  retryConnection(): void;
}
