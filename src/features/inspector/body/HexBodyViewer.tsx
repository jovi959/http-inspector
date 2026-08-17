import { useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import { findTextSearchMatches } from "@/domain/body-presentation/bodySearch";
import { formatHexRow, getHexPresentation, getHexSearchText } from "@/domain/body-presentation/hexPresentation";
import type { HttpBody } from "@/generated/contracts";

const bytesPerRow = 16;
const rowsPerPage = 32;
const bytesPerPage = bytesPerRow * rowsPerPage;

interface HexBodyViewerProps {
  readonly body: HttpBody | null;
  readonly searchMatchIndex?: number;
  readonly searchQuery?: string;
}

/** Presents captured bytes in bounded pages without altering their captured values. */
export function HexBodyViewer({ body, searchMatchIndex = 0, searchQuery = "" }: HexBodyViewerProps) {
  const result = useMemo(() => getHexPresentation(body), [body]);
  const [page, setPage] = useState(0);
  const scrollElement = useRef<HTMLDivElement>(null);
  const bytes = result.bytes ?? new Uint8Array();
  const pageCount = Math.max(1, Math.ceil(bytes.length / bytesPerPage));
  const searchText = useMemo(() => getHexSearchText(result.bytes), [result.bytes]);
  const searchMatches = useMemo(() => findTextSearchMatches(searchText, searchQuery), [searchQuery, searchText]);
  const selectedSearchMatch = searchMatches[searchMatchIndex] ?? null;
  const selectedLine = selectedSearchMatch ? searchText.slice(0, selectedSearchMatch.start).split("\n").length - 1 : null;

  useEffect(() => setPage(0), [result.bytes]);
  useEffect(() => {
    if (selectedLine !== null) setPage(Math.floor(selectedLine / rowsPerPage));
  }, [selectedLine]);

  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * bytesPerPage;
  const pageBytes = bytes.slice(start, start + bytesPerPage);
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

  useEffect(() => {
    if (selectedLine !== null && Math.floor(selectedLine / rowsPerPage) === safePage) virtualizer.scrollToIndex(selectedLine % rowsPerPage, { align: "center" });
  }, [safePage, selectedLine, virtualizer]);

  if (!result.bytes) return <p className="empty-copy">{result.message}</p>;

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
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = start / bytesPerRow + virtualRow.index;
            const rowText = formatHexRow(pageBytes, start + virtualRow.index * bytesPerRow, virtualRow.index * bytesPerRow);
            return <code key={virtualRow.key} className={`hex-body-row ${selectedLine === rowIndex ? "is-search-active" : ""}`} style={{ transform: `translateY(${virtualRow.start}px)` }}>{rowText}</code>;
          })}
        </div>
      </div>
    </div>
  );
}
