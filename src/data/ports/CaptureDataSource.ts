import type { CaptureController } from "@/data/ports/CaptureController";
import type { CaptureListenerController } from "@/data/ports/CaptureListener";
import type { CaptureReader } from "@/data/ports/CaptureReader";
import type { CaptureSubscription } from "@/data/ports/CaptureSubscription";

/** The UI depends only on these composed capabilities, not on Fixture, Browser, or Tauri. */
export interface CaptureDataSource extends CaptureReader, CaptureSubscription, CaptureController {
  readonly listener?: CaptureListenerController;
  /** Hosted runtimes expose their active capture endpoint without adding native listener controls. */
  getIntegrationEndpoint?(): Promise<string | null>;
}
