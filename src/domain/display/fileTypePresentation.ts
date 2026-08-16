import { isJsonCandidate } from "@/domain/body-presentation/jsonPresentation";
import { isXmlCandidate } from "@/domain/body-presentation/xmlPresentation";
import type { HttpBody, HttpExchange } from "@/generated/contracts";

export type StructureFileType = "json" | "xml" | "text" | "binary";

/** Chooses the Structure leaf icon from the captured response, then request, body type. */
export function getExchangeFileType(exchange: HttpExchange): StructureFileType {
  return getBodyFileType(exchange.response?.body) ?? getBodyFileType(exchange.request.body) ?? "binary";
}

function getBodyFileType(body: HttpBody | null | undefined): StructureFileType | null {
  if (!body) return null;
  const text = body.content?.kind === "inlineText" ? body.content.value : "";
  if (isJsonCandidate(body.mediaType, text)) return "json";
  if (isXmlCandidate(body.mediaType)) return "xml";
  if (body.mediaType?.split(";", 1)[0]?.trim().toLowerCase().startsWith("text/") || body.content?.kind === "inlineText") return "text";
  return "binary";
}
