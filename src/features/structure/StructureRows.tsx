import type { CSSProperties, KeyboardEvent, MouseEvent, Ref } from "react";

import { getExchangeFileType } from "@/domain/display/fileTypePresentation";
import { StructureDraftIcon, StructureFileIcon, StructureFolderIcon, StructureHostIcon } from "@/features/structure/StructureTreeIcons";
import type { HttpExchange } from "@/generated/contracts";
import type { StructureGroup } from "@/state/structure/treeIndex";
import type { RecomposeDraft } from "@/state/recompose/recomposeTypes";

interface StructureGroupRowProps {
  readonly expanded: boolean;
  readonly group: StructureGroup;
  readonly isSelected: boolean;
  readonly rowRef: Ref<HTMLButtonElement>;
  readonly style: CSSProperties;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onSelect(): void;
  onToggle(): void;
}

/** Keeps virtual tree row presentation separate from flattening and keyboard navigation. */
export function StructureGroupRow({ expanded, group, isSelected, rowRef, style, onKeyDown, onSelect, onToggle }: StructureGroupRowProps) {
  const hasChildren = group.children.length > 0 || group.exchangeIds.length > 0;
  const isHost = group.parentId === null;
  return (
    <div className="structure-group-row" role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-level={group.id.split("/").length} style={style}>
      <span key={`${group.id}-${group.activityRevision}`} className="activity-pulse" aria-hidden="true" />
      <button className="tree-disclosure-button" aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`} disabled={!hasChildren} type="button" onClick={onToggle}>
        {hasChildren && <span className={`tree-disclosure ${expanded ? "is-expanded" : "is-collapsed"}`} aria-hidden="true" />}
      </button>
      <button
        ref={rowRef}
        aria-current={isSelected ? "true" : undefined}
        className={`structure-row-button ${isSelected ? "is-selected" : ""}`}
        type="button"
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        {isHost ? <StructureHostIcon /> : <StructureFolderIcon />}
        <span className={`tree-label ${isHost ? "tree-host-label" : ""}`}>{group.label}</span>
      </button>
    </div>
  );
}

interface StructureExchangeRowProps {
  readonly exchange: HttpExchange | undefined;
  readonly isSelected: boolean;
  readonly rowRef: Ref<HTMLButtonElement>;
  readonly style: CSSProperties;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onRecompose(event: MouseEvent<HTMLButtonElement>, exchange: HttpExchange): void;
  onSelect(): void;
}

export function StructureExchangeRow({ exchange, isSelected, rowRef, style, onKeyDown, onRecompose, onSelect }: StructureExchangeRowProps) {
  if (!exchange) return null;
  const fileType = getExchangeFileType(exchange);
  return (
    <button
      ref={rowRef}
      role="treeitem"
      aria-level={exchange.request.url.split("/").length}
      className={`structure-exchange-row ${isSelected ? "is-selected" : ""}`}
      style={style}
      type="button"
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
        onRecompose(event, exchange);
      }}
      onKeyDown={onKeyDown}
    >
      <span key={`${exchange.id}-${exchange.revision}`} className="activity-pulse" aria-hidden="true" />
      <span className="tree-disclosure-placeholder" aria-hidden="true" />
      <StructureFileIcon type={fileType} />
      <span className="tree-label">{getLeafLabel(exchange.request.url)}</span>
    </button>
  );
}

interface StructureDraftRowProps {
  readonly draft: RecomposeDraft;
  readonly isSelected: boolean;
  readonly rowRef: Ref<HTMLButtonElement>;
  readonly style: CSSProperties;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  onSelect(): void;
}

export function StructureDraftRow({ draft, isSelected, rowRef, style, onKeyDown, onSelect }: StructureDraftRowProps) {
  return (
    <button
      ref={rowRef}
      role="treeitem"
      aria-label={`Editable replay draft for ${getLeafLabel(draft.working.baseUrl)}`}
      className={`structure-exchange-row structure-draft-row ${isSelected ? "is-selected" : ""}`}
      style={style}
      type="button"
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <span className="tree-disclosure-placeholder" aria-hidden="true" />
      <StructureDraftIcon />
      <span className="tree-label">{getLeafLabel(draft.working.baseUrl)}</span>
    </button>
  );
}

function getLeafLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "/";
    try { return decodeURIComponent(endpoint); } catch { return endpoint; }
  } catch {
    return url.split("?")[0] ?? url;
  }
}
