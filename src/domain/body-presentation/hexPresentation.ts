import type { HttpBody } from "@/generated/contracts";

const bytesPerRow = 16;

export interface HexPresentation {
  readonly bytes: Uint8Array | null;
  readonly label: string;
  readonly message: string;
}

/** Keeps hex inspection and search based on the same immutable captured bytes. */
export function getHexPresentation(body: HttpBody | null): HexPresentation {
  if (!body?.content) return { bytes: null, label: "", message: "No captured body bytes are available." };
  if (body.content.kind === "inlineText") return { bytes: new TextEncoder().encode(body.content.value), label: "UTF-8 text bytes", message: "" };
  if (body.content.kind === "inlineBase64") {
    try {
      const decoded = atob(body.content.value);
      return { bytes: Uint8Array.from(decoded, (character) => character.charCodeAt(0)), label: "Captured binary bytes", message: "" };
    } catch {
      return { bytes: null, label: "", message: "Captured binary content is not valid base64." };
    }
  }
  return { bytes: null, label: "", message: "This body is stored as an attachment and is not loaded yet." };
}

/** Produces the same full textual representation displayed by the paged hex viewer. */
export function getHexSearchText(bytes: Uint8Array | null): string {
  if (!bytes) return "";
  const rows: string[] = [];
  for (let index = 0; index < bytes.length; index += bytesPerRow) rows.push(formatHexRow(bytes, index, index));
  return rows.join("\n");
}

export function formatHexRow(bytes: Uint8Array, offset: number, index: number): string {
  const row = bytes.slice(index, index + bytesPerRow);
  const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(bytesPerRow * 3 - 1, " ");
  const ascii = Array.from(row, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("");
  return `${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`;
}
