import { isJsonCandidate } from "@/domain/body-presentation/jsonPresentation";
import { isXmlCandidate } from "@/domain/body-presentation/xmlPresentation";
import type { HttpBody } from "@/generated/contracts";

export type BodyView = "headers" | "json" | "xml" | "text" | "hex" | "raw";

/** The registry keeps body-type growth open without forcing inspector-shell edits. */
export function getAvailableBodyViews(body: HttpBody | null): readonly BodyView[] {
  const text = getInlineText(body);
  if (!body?.content) return ["headers", "raw"];
  if (text === null) return ["headers", "hex", "raw"];
  if (isJsonCandidate(body.mediaType, text)) return ["headers", "json", "text", "hex", "raw"];
  if (isXmlCandidate(body.mediaType)) return ["headers", "xml", "text", "hex", "raw"];
  return ["headers", "text", "hex", "raw"];
}

/** Returns only adapter-supplied inline text; binary and attachment content remain opaque here. */
export function getInlineText(body: HttpBody | null): string | null {
  return body?.content?.kind === "inlineText" ? body.content.value : null;
}
