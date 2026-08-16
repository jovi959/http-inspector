import { createJsonPresentation } from "@/domain/body-presentation/jsonPresentation";

interface JsonWorkerRequest {
  readonly id: string;
  readonly content: string;
}

/** Formats costly JSON documents off the UI thread without changing the captured source. */
self.onmessage = (event: MessageEvent<JsonWorkerRequest>) => {
  self.postMessage({ id: event.data.id, presentation: createJsonPresentation(event.data.content) });
};
