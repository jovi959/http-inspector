/** Native-only listener controls remain optional so fixture and hosted browser sources stay interchangeable. */
export interface CaptureListenerSettings {
  readonly port: number;
  readonly lanEnabled: boolean;
}

export interface CaptureListenerStatus {
  readonly running: boolean;
  readonly bindAddress: string | null;
  readonly endpoint: string | null;
  readonly port: number | null;
  readonly lanEnabled: boolean;
  readonly errorMessage: string | null;
}

export interface CaptureListenerController {
  getListenerStatus(): Promise<CaptureListenerStatus>;
  startListener(settings: CaptureListenerSettings): Promise<CaptureListenerStatus>;
  stopListener(): Promise<CaptureListenerStatus>;
}
