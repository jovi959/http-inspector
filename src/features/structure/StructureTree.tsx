import { useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

import type { HttpExchange } from "@/generated/contracts";
import { StructureDraftRow, StructureExchangeRow, StructureGroupRow } from "@/features/structure/StructureRows";
import { flattenStructureGroups } from "@/state/structure/treeSelectors";
import type { StructureVisibleRow } from "@/state/structure/treeSelectors";
import type { StructureGroup } from "@/state/structure/treeIndex";
import type { RecomposeDraft } from "@/state/recompose/recomposeTypes";

interface StructureTreeProps {
  readonly groups: readonly StructureGroup[];
  readonly exchangeById: Readonly<Record<string, HttpExchange>>;
  readonly selectedExchangeId: string | null;
  readonly selectedGroupId: string | null;
  readonly forcedExpandedNodeIds: ReadonlySet<string>;
  readonly draft: RecomposeDraft | null;
  readonly selectedDraftId: string | null;
  onSelectExchange(id: string): void;
  onSelectGroup(id: string): void;
  onSelectDraft(): void;
  onRecompose(exchange: HttpExchange, x: number, y: number): void;
}

/** Renders a virtual, flattened host/path tree over the shared capture entities. */
export function StructureTree({
  groups,
  exchangeById,
  selectedExchangeId,
  selectedGroupId,
  forcedExpandedNodeIds,
  draft,
  selectedDraftId,
  onSelectExchange,
  onSelectGroup,
  onSelectDraft,
  onRecompose,
}: StructureTreeProps) {
  const knownGroupIds = useRef<Set<string>>(new Set());
  const scrollElement = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLButtonElement>());
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const groupIds = useMemo(() => getGroupIds(groups), [groups]);

  useEffect(() => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      for (const id of groupIds) {
        if (!knownGroupIds.current.has(id)) next.add(id);
        knownGroupIds.current.add(id);
      }
      return next;
    });
  }, [groupIds]);

  const rows = useMemo(
    () => flattenStructureGroups(groups, expandedNodeIds, forcedExpandedNodeIds, draft),
    [draft, expandedNodeIds, forcedExpandedNodeIds, groups],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => 30,
    getItemKey: (index) => rows[index]!.key,
    overscan: 12,
  });
  const toggle = (id: string) => setExpandedNodeIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const focusRow = (row: StructureVisibleRow | undefined) => row && rowElements.current.get(row.key)?.focus();
  const onRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, row: StructureVisibleRow) => {
    const index = rows.findIndex((candidate) => candidate.key === row.key);
    if (index < 0) return;
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
    } else if (event.key === "ArrowRight" && row.kind === "group") {
      event.preventDefault();
      if (row.hasChildren && !row.expanded) toggle(row.id);
      else if (row.expanded) focusRow(rows[index + 1]);
    } else if (event.key === "ArrowLeft" && row.kind === "group") {
      event.preventDefault();
      if (row.expanded) toggle(row.id);
      else focusRow(rows.find((candidate) => candidate.kind === "group" && candidate.id === row.parentId));
    } else if (event.key === "ArrowLeft" && (row.kind === "exchange" || row.kind === "draft")) {
      event.preventDefault();
      focusRow(rows.find((candidate) => candidate.kind === "group" && candidate.id === row.parentId));
    }
  };

  if (rows.length === 0) return <p className="empty-copy">No requests match the current Structure view.</p>;

  return (
    <div ref={scrollElement} className="structure-tree" role="tree" aria-label="Captured HTTP structure">
      <div className="virtual-list-canvas" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]!;
          return (
            <div key={row.key} className="virtual-list-row" style={{ transform: `translateY(${virtualRow.start}px)` }}>
              {row.kind === "group" ? (
                <StructureGroupRow
                  expanded={row.expanded}
                  group={row.group}
                  isSelected={selectedGroupId === row.id}
                  rowRef={(element) => setRowElement(rowElements.current, row.key, element)}
                  style={{ paddingInlineStart: `${8 + row.depth * 16}px` }}
                  onKeyDown={(event) => onRowKeyDown(event, row)}
                  onSelect={() => onSelectGroup(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ) : row.kind === "exchange" ? (
                <StructureExchangeRow
                  exchange={exchangeById[row.id]}
                  isSelected={selectedExchangeId === row.id}
                  rowRef={(element) => setRowElement(rowElements.current, row.key, element)}
                  style={{ paddingInlineStart: `${8 + row.depth * 16}px` }}
                  onKeyDown={(event) => onRowKeyDown(event, row)}
                  onRecompose={(event, exchange) => onRecompose(exchange, event.clientX, event.clientY)}
                  onSelect={() => onSelectExchange(row.id)}
                />
              ) : draft ? (
                <StructureDraftRow
                  draft={draft}
                  isSelected={selectedDraftId === row.id}
                  rowRef={(element) => setRowElement(rowElements.current, row.key, element)}
                  style={{ paddingInlineStart: `${8 + row.depth * 16}px` }}
                  onKeyDown={(event) => onRowKeyDown(event, row)}
                  onSelect={onSelectDraft}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function setRowElement(rows: Map<string, HTMLButtonElement>, key: string, element: HTMLButtonElement | null): void {
  if (element) rows.set(key, element);
  else rows.delete(key);
}

function getGroupIds(groups: readonly StructureGroup[]): readonly string[] {
  return groups.flatMap((group) => [group.id, ...getGroupIds(group.children)]);
}
