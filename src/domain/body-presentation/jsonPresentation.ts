import { applyEdits, format, parse, printParseErrorCode, type ParseError } from "jsonc-parser";

export const jsonWorkerThresholdBytes = 256 * 1024;

/** Avoids synchronous formatting when the UTF-8 capture crosses the worker threshold. */
export function requiresJsonWorker(content: string): boolean {
  if (content.length >= jsonWorkerThresholdBytes) return true;
  if (content.length * 3 < jsonWorkerThresholdBytes) return false;
  return new TextEncoder().encode(content).byteLength >= jsonWorkerThresholdBytes;
}

export type JsonPresentation =
  | { readonly kind: "valid"; readonly original: string; readonly pretty: string }
  | { readonly kind: "invalid"; readonly original: string; readonly diagnostics: readonly string[] };

/** Detects JSON without treating a claimed content type as proof that the payload is valid. */
export function isJsonCandidate(contentType: string | null, content: string): boolean {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized === "application/json" || normalized.endsWith("+json") || (content.length <= jsonWorkerThresholdBytes && isStrictJson(content));
}

/** Creates a derived Pretty document using whitespace edits, preserving the captured original text. */
export function createJsonPresentation(original: string): JsonPresentation {
  const errors: ParseError[] = [];
  parse(original, errors, { allowTrailingComma: false, disallowComments: true });
  if (errors.length > 0) {
    return {
      kind: "invalid",
      original,
      diagnostics: errors.map((error) => `${printParseErrorCode(error.error)} at character ${error.offset + 1}`),
    };
  }

  const edits = format(original, undefined, { insertSpaces: true, tabSize: 2, eol: "\n" });
  return { kind: "valid", original, pretty: applyEdits(original, edits) };
}

function isStrictJson(content: string): boolean {
  const errors: ParseError[] = [];
  parse(content, errors, { allowTrailingComma: false, disallowComments: true });
  return errors.length === 0;
}
