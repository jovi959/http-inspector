import { useEffect, useMemo, useRef } from "react";

import type { ColumnDef, ColumnSizingState, Updater } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { formatDuration } from "@/domain/display/timingPresentation";
import { getStatusPresentation } from "@/domain/display/statusPresentation";
import { getUrlDisplay } from "@/domain/display/urlPresentation";
import type { HttpExchange } from "@/generated/contracts";
import type { SequenceSort, SequenceSortColumn } from "@/state/sequence/sequenceSelectors";
import type { SequenceColumnId, SequenceColumnWidths } from "@/state/preferences/displayPreferences";

export interface SequenceEntry {
  readonly id: string;
  readonly exchange: HttpExchange;
}

interface SequenceGridProps {
  readonly columnOrder: readonly SequenceColumnId[];
  readonly columnWidths: SequenceColumnWidths;
  readonly entries: readonly SequenceEntry[];
  readonly isAtLiveEdge: boolean;
  readonly selectedExchangeId: string | null;
  readonly sequenceSort: SequenceSort | null;
  onColumnOrderChange(order: readonly SequenceColumnId[]): void;
  onColumnWidthsChange(widths: SequenceColumnWidths): void;
  onLiveEdgeChange(isAtLiveEdge: boolean): void;
  onRecompose(exchange: HttpExchange, x: number, y: number): void;
  onSelectExchange(id: string): void;
  onSetSequenceSort(sort: SequenceSort | null): void;
}

/** Renders stable, virtualized Sequence rows while the shared selector owns ordering. */
export function SequenceGrid({ columnOrder, columnWidths, entries, isAtLiveEdge, selectedExchangeId, sequenceSort, onColumnOrderChange, onColumnWidthsChange, onLiveEdgeChange, onRecompose, onSelectExchange, onSetSequenceSort }: SequenceGridProps) {
  const scrollElement = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLDivElement>());
  const draggedColumnIdRef = useRef<SequenceColumnId | null>(null);
  const columns = useMemo<ColumnDef<SequenceEntry>[]>(() => [
    { id: "status", header: "Status", size: 92, cell: ({ row }) => <StatusCell exchange={row.original.exchange} /> },
    { id: "method", header: "Method", size: 86, cell: ({ row }) => row.original.exchange.request.method },
    { id: "host", header: "Host", size: 180, cell: ({ row }) => getUrlDisplay(row.original.exchange.request.url).host },
    { id: "path", header: "Path", size: 300, cell: ({ row }) => getUrlDisplay(row.original.exchange.request.url).path },
    { id: "source", header: "Source", size: 150, cell: ({ row }) => row.original.exchange.source.applicationName },
    { id: "arrival", header: "Start", size: 110, cell: ({ row }) => new Date(row.original.exchange.lifecycle.startedAt).toLocaleTimeString() },
    { id: "duration", header: "Duration", size: 100, cell: ({ row }) => formatDuration(row.original.exchange.timing.total.milliseconds) },
  ], []);
  const tableEntries = useMemo(() => [...entries], [entries]);
  const table = useReactTable({
    columns,
    data: tableEntries,
    enableColumnResizing: true,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    state: { columnOrder: [...columnOrder], columnSizing: columnWidths },
    onColumnSizingChange: (update) => onColumnWidthsChange(resolveColumnSizing(update, columnWidths)),
  });
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => 34,
    getItemKey: (index) => rows[index]!.original.id,
    overscan: 12,
  });
  const scrollToLiveEdge = () => scrollElement.current?.scrollTo({ top: scrollElement.current.scrollHeight });
  const resumeLive = () => {
    onLiveEdgeChange(true);
    scrollToLiveEdge();
  };
  const updateLiveEdge = (element = scrollElement.current) => {
    if (element) onLiveEdgeChange(isScrollAtLiveEdge(element));
  };
  const scheduleLiveEdgeUpdate = () => window.requestAnimationFrame(() => updateLiveEdge());
  useEffect(() => {
    const element = scrollElement.current;
    if (!element) return;
    const onNativeScroll = () => updateLiveEdge(element);
    element.addEventListener("scroll", onNativeScroll, { passive: true });
    return () => element.removeEventListener("scroll", onNativeScroll);
  }, [onLiveEdgeChange, rows.length]);
  useEffect(() => {
    if (isAtLiveEdge) scrollToLiveEdge();
  }, [entries.length, isAtLiveEdge]);
  const gridTemplateColumns = table.getVisibleLeafColumns().map((column) => `${column.getSize()}px`).join(" ");
  const focusRow = (row: typeof rows[number] | undefined) => row && rowElements.current.get(row.original.id)?.focus();
  const onRowKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number, id: string) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(rows[index + 1]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(rows[index - 1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(rows[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.at(-1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectExchange(id);
    }
  };
  const toggleSort = (column: SequenceSortColumn) => {
    if (sequenceSort?.column !== column) onSetSequenceSort({ column, direction: "ascending" });
    else if (sequenceSort.direction === "ascending") onSetSequenceSort({ column, direction: "descending" });
    else onSetSequenceSort(null);
  };
  const moveColumnWithKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, column: SequenceColumnId) => {
    if (!event.altKey || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const index = columnOrder.indexOf(column);
    const target = columnOrder[index + (event.key === "ArrowLeft" ? -1 : 1)];
    if (!target) return;
    event.preventDefault();
    onColumnOrderChange(reorderColumns(columnOrder, column, target));
  };
  if (rows.length === 0) return <p className="empty-copy">No requests match the current Sequence view.</p>;
  return (
    <div ref={scrollElement} className="sequence-scroll" role="grid" aria-label="Captured HTTP sequence" onScroll={scheduleLiveEdgeUpdate} onWheel={scheduleLiveEdgeUpdate}>
      {!isAtLiveEdge && <button className="resume-live-button" type="button" onClick={resumeLive}>Resume live</button>}
      <div className="sequence-grid" style={{ minWidth: `${table.getTotalSize()}px` }}>
        <div className="sequence-grid-header" role="row" style={{ gridTemplateColumns }}>
          {table.getFlatHeaders().map((header) => {
            const column = header.column;
            const sort = sequenceSort?.column === column.id ? sequenceSort.direction : null;
            return (
              <div key={header.id} className="sequence-grid-header-cell" draggable role="columnheader" style={{ width: header.getSize() }} onDragEnd={() => {
                draggedColumnIdRef.current = null;
              }} onDragOver={(event) => event.preventDefault()} onDragStart={() => {
                draggedColumnIdRef.current = column.id as SequenceColumnId;
              }} onDrop={() => {
                const draggedColumn = draggedColumnIdRef.current;
                if (draggedColumn && draggedColumn !== column.id) onColumnOrderChange(reorderColumns(columnOrder, draggedColumn, column.id as SequenceColumnId));
              }}>
                <button aria-keyshortcuts="Alt+Shift+ArrowLeft Alt+Shift+ArrowRight" type="button" onClick={() => toggleSort(column.id as SequenceSortColumn)} onKeyDown={(event) => moveColumnWithKeyboard(event, column.id as SequenceColumnId)}>{flexRender(header.column.columnDef.header, header.getContext())}{sort === "ascending" ? " ↑" : sort === "descending" ? " ↓" : ""}</button>
                <div className="column-resize-handle" role="separator" aria-orientation="vertical" onDoubleClick={() => column.resetSize()} onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} />
              </div>
            );
          })}
        </div>
        <div className="virtual-list-canvas" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            const id = row.original.id;
            return (
              <div
                key={row.id}
                ref={(element) => setRowElement(rowElements.current, id, element)}
                aria-selected={selectedExchangeId === id}
                className={`sequence-grid-row ${selectedExchangeId === id ? "is-selected" : ""}`}
                role="row"
                style={{ gridTemplateColumns, transform: `translateY(${virtualRow.start}px)` }}
                tabIndex={0}
                onClick={() => onSelectExchange(id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelectExchange(id);
                  onRecompose(row.original.exchange, event.clientX, event.clientY);
                }}
                onKeyDown={(event) => onRowKeyDown(event, virtualRow.index, id)}
              >
                {row.getVisibleCells().map((cell) => <div key={cell.id} className="sequence-grid-cell" role="gridcell">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function resolveColumnSizing(update: Updater<ColumnSizingState>, current: SequenceColumnWidths): SequenceColumnWidths {
  return typeof update === "function" ? update(current) : update;
}

function reorderColumns(order: readonly SequenceColumnId[], moved: SequenceColumnId, target: SequenceColumnId): readonly SequenceColumnId[] {
  const withoutMoved = order.filter((column) => column !== moved);
  const targetIndex = withoutMoved.indexOf(target);
  return [...withoutMoved.slice(0, targetIndex), moved, ...withoutMoved.slice(targetIndex)];
}

function StatusCell({ exchange }: { readonly exchange: HttpExchange }) {
  const status = getStatusPresentation(exchange.lifecycle.state, exchange.response?.statusCode ?? null);
  return <><span className={`status-dot tone-${status.tone}`} aria-label={status.accessibleLabel} title={status.tooltip} />{exchange.response?.statusCode ?? status.label}</>;
}

function setRowElement(rows: Map<string, HTMLDivElement>, id: string, element: HTMLDivElement | null): void {
  if (element) rows.set(id, element);
  else rows.delete(id);
}

function isScrollAtLiveEdge(element: HTMLDivElement): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
}
