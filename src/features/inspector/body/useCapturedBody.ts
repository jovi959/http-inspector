import { useEffect, useState } from "react";

import type { CaptureDataSource } from "@/data/ports/CaptureDataSource";
import type { CapturedBodyPart } from "@/data/ports/CaptureReader";
import type { ExchangeKey, HttpBody } from "@/generated/contracts";

interface CapturedBodyResult {
  readonly body: HttpBody | null;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isComplete: boolean;
}

/** Resolves attachment-backed content only when the selected detail exposes an attachment reference. */
export function useCapturedBody(dataSource: CaptureDataSource, key: ExchangeKey, part: CapturedBodyPart, initialBody: HttpBody | null): CapturedBodyResult {
  const [result, setResult] = useState<CapturedBodyResult>(() => initialResult(initialBody));
  const attachmentId = initialBody?.content?.kind === "attachmentRef" ? initialBody.content.attachmentId : null;

  useEffect(() => {
    const initial = initialResult(initialBody);
    setResult(initial);
    if (!attachmentId) return;
    let disposed = false;
    setResult({ ...initial, isLoading: true });
    void dataSource.getBodyChunk({ key, part, offset: 0, maximumBytes: 1_048_576 }).then((chunk) => {
      if (disposed) return;
      setResult({ body: chunk.body, error: null, isLoading: false, isComplete: chunk.complete });
    }).catch((error: unknown) => {
      if (disposed) return;
      setResult({ body: initialBody, error: error instanceof Error ? error.message : "The captured body could not be loaded.", isLoading: false, isComplete: false });
    });
    return () => {
      disposed = true;
    };
  }, [attachmentId, dataSource, initialBody, key.exchangeId, key.sourceInstanceId, part]);

  return result;
}

function initialResult(body: HttpBody | null): CapturedBodyResult {
  return { body, error: null, isLoading: false, isComplete: body?.availability !== "truncated" };
}
