import { useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import type { HttpBody } from "@/generated/contracts";

const bytesPerRow = 16;
const rowsPerPage = 32;
const bytesPerPage = bytesPerRow * rowsPerPage;

interface HexBodyViewerProps {
  readonly body: HttpBody | null;
}

/** Presents captured bytes in bounded pages without altering their captured values. */
export function HexBodyViewer({ body }: HexBodyViewerProps) {
  const result = useMemo(() => getCapturedBytes(body), [body]);
  const [page, setPage] = useState(0);
  const scrollElement = useRef<HTMLDivElement>(null);
  const pageCount = result.bytes ? Math.max(1, Math.ceil(result.bytes.length / bytesPerPage)) : 0;

  useEffect(() => setPage(0), [result.bytes]);

  if (!result.bytes) return <p className="empty-copy">{result.message}</p>;
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * bytesPerPage;
  const pageBytes = result.bytes.slice(start, start + bytesPerPage);
  const rowCount = Math.ceil(pageBytes.length / bytesPerRow);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => 24,
    overscan: 8,
  });

  useEffect(() => {
    scrollElement.current?.scrollTo({ top: 0 });
  }, [safePage]);

  return (
    <div className="hex-body-viewer">
      <div className="code-toolbar">
        <span>{result.label} · {result.bytes.length.toLocaleString()} bytes</span>
        <div>
          <button disabled={safePage === 0} type="button" onClick={() => setPage((current) => current - 1)}>Previous</button>
          <span>Page {safePage + 1} of {pageCount}</span>
          <button disabled={safePage + 1 === pageCount} type="button" onClick={() => setPage((current) => current + 1)}>Next</button>
        </div>
      </div>
      <div ref={scrollElement} className="hex-body-content" role="region" aria-label="Hexadecimal body bytes">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => <code key={virtualRow.key} className="hex-body-row" style={{ transform: `translateY(${virtualRow.start}px)` }}>{formatRow(pageBytes, start + virtualRow.index * bytesPerRow, virtualRow.index * bytesPerRow)}</code>)}
        </div>
      </div>
    </div>
  );
}

function getCapturedBytes(body: HttpBody | null): { readonly bytes: Uint8Array | null; readonly label: string; readonly message: string } {
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

function formatRow(bytes: Uint8Array, offset: number, index: number): string {
  const row = bytes.slice(index, index + bytesPerRow);
  const hex = Array.from(row, (byte) => byte.toString(16).padStart(2, "0")).join(" ").padEnd(bytesPerRow * 3 - 1, " ");
  const ascii = Array.from(row, (byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".").join("");
  return `${offset.toString(16).padStart(8, "0")}  ${hex}  |${ascii}|`;
}
