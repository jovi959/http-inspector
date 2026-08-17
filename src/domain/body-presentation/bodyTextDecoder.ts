import type { HttpBody } from "@/generated/contracts";

export type CapturedBodyText =
  | { readonly kind: "text"; readonly value: string; readonly decoded: boolean }
  | { readonly kind: "unavailable"; readonly error: string | null };

/** Decodes an adapter-captured semantic body for text views while raw and hex retain the original wire bytes. */
export async function decodeCapturedBodyText(body: HttpBody | null): Promise<CapturedBodyText> {
  if (body?.content?.kind === "inlineText") return { kind: "text", value: body.content.value, decoded: false };
  if (body?.content?.kind !== "inlineBase64") return { kind: "unavailable", error: null };

  try {
    const bytes = await decodeContentEncoding(decodeBase64(body.content.value), body.contentEncoding);
    return { kind: "text", value: new TextDecoder(normalizeCharset(body.charset)).decode(bytes), decoded: true };
  } catch (error) {
    return { kind: "unavailable", error: error instanceof Error ? error.message : "The captured binary body could not be decoded." };
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function decodeContentEncoding(bytes: Uint8Array, contentEncoding: string | null): Promise<Uint8Array> {
  const encodings = (contentEncoding ?? "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => value && value !== "identity");
  let decoded = bytes;
  for (let index = encodings.length - 1; index >= 0; index--) decoded = await decodeLayer(decoded, encodings[index]!);
  return decoded;
}

async function decodeLayer(bytes: Uint8Array, contentEncoding: string): Promise<Uint8Array> {
  const format = contentEncoding === "x-gzip" ? "gzip" : contentEncoding;
  if (format === "br") throw new Error("Brotli-compressed bodies are not supported by this runtime.");
  if (format !== "gzip" && format !== "deflate") throw new Error(`Unsupported Content-Encoding: ${contentEncoding}.`);
  if (typeof DecompressionStream === "undefined") throw new Error("This runtime cannot decompress captured HTTP content.");
  const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function normalizeCharset(charset: string | null): string {
  const normalized = charset?.trim().toLowerCase();
  return normalized && normalized !== "unknown" ? normalized : "utf-8";
}
