import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";

import { decodeCapturedBodyText } from "./bodyTextDecoder";

describe("captured body text decoding", () => {
  test("decodes a gzip-compressed inline base64 XML body without changing the original body", async () => {
    const xml = "<s:Envelope xmlns:s=\"urn:soap\"><s:Body><result>ready</result></s:Body></s:Envelope>";
    const body = {
      availability: "captured" as const,
      mediaType: "text/xml",
      charset: null,
      contentEncoding: "gzip",
      declaredByteLength: null,
      observedByteLength: null,
      capturedByteLength: null,
      sha256: null,
      content: { kind: "inlineBase64" as const, value: gzipSync(xml).toString("base64") },
      truncationReason: null,
    };

    await expect(decodeCapturedBodyText(body)).resolves.toEqual({ kind: "text", value: xml, decoded: true });
    expect(body.content.kind).toBe("inlineBase64");
  });

  test("uses UTF-8 for inline base64 text when the response did not declare a charset", async () => {
    const xml = "<result>café</result>";
    const body = {
      availability: "captured" as const,
      mediaType: "text/xml",
      charset: null,
      contentEncoding: null,
      declaredByteLength: null,
      observedByteLength: null,
      capturedByteLength: null,
      sha256: null,
      content: { kind: "inlineBase64" as const, value: Buffer.from(xml, "utf8").toString("base64") },
      truncationReason: null,
    };

    await expect(decodeCapturedBodyText(body)).resolves.toEqual({ kind: "text", value: xml, decoded: true });
  });
});
