import { useEffect, useState } from "react";

import { decodeCapturedBodyText } from "@/domain/body-presentation/bodyTextDecoder";
import type { HttpBody } from "@/generated/contracts";

interface BodyTextPresentationResult {
  readonly text: string | null;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly isDecoded: boolean;
}

/** Decodes encoded inline bytes only for readable body views; raw and hex remain wire-faithful. */
export function useBodyTextPresentation(body: HttpBody | null): BodyTextPresentationResult {
  const [result, setResult] = useState<BodyTextPresentationResult>(() => initialResult(body));

  useEffect(() => {
    let disposed = false;
    const initial = initialResult(body);
    setResult(initial);
    if (!requiresDecoding(body)) return;
    setResult({ ...initial, isLoading: true });
    void decodeCapturedBodyText(body).then((decoded) => {
      if (disposed) return;
      setResult(decoded.kind === "text"
        ? { text: decoded.value, error: null, isLoading: false, isDecoded: decoded.decoded }
        : { text: null, error: decoded.error, isLoading: false, isDecoded: false });
    });
    return () => {
      disposed = true;
    };
  }, [body]);

  return result;
}

function initialResult(body: HttpBody | null): BodyTextPresentationResult {
  return body?.content?.kind === "inlineText"
    ? { text: body.content.value, error: null, isLoading: false, isDecoded: false }
    : { text: null, error: null, isLoading: false, isDecoded: false };
}

function requiresDecoding(body: HttpBody | null): boolean {
  return body?.content?.kind === "inlineBase64";
}
