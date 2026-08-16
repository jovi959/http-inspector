import type { StructureGroup } from "@/state/structure/treeIndex";
import type { RecomposeDraft } from "@/state/recompose/recomposeTypes";

export interface StructureGroupRow {
  readonly kind: "group";
  readonly key: string;
  readonly id: string;
  readonly parentId: string | null;
  readonly depth: number;
  readonly group: StructureGroup;
  readonly hasChildren: boolean;
  readonly expanded: boolean;
}

export interface StructureExchangeRow {
  readonly kind: "exchange";
  readonly key: string;
  readonly id: string;
  readonly parentId: string;
  readonly depth: number;
}

export interface StructureDraftRow {
  readonly kind: "draft";
  readonly key: string;
  readonly id: string;
  readonly sourceExchangeId: string;
  readonly parentId: string;
  readonly depth: number;
}

export type StructureVisibleRow = StructureGroupRow | StructureExchangeRow | StructureDraftRow;

/**
 * Creates the one visible row sequence used by both the tree's keyboard model
 * and its virtualizer. Forced expansion is derived from a filter and never
 * changes a user's canonical expanded/collapsed choice.
 */
export function flattenStructureGroups(
  groups: readonly StructureGroup[],
  expandedNodeIds: ReadonlySet<string>,
  forcedExpandedNodeIds: ReadonlySet<string> = new Set(),
  draft: RecomposeDraft | null = null,
): readonly StructureVisibleRow[] {
  const rows: StructureVisibleRow[] = [];
  for (const group of groups) appendGroup(rows, group, 0, null, expandedNodeIds, forcedExpandedNodeIds, draft);
  return rows;
}

function appendGroup(
  rows: StructureVisibleRow[],
  group: StructureGroup,
  depth: number,
  parentId: string | null,
  expandedNodeIds: ReadonlySet<string>,
  forcedExpandedNodeIds: ReadonlySet<string>,
  draft: RecomposeDraft | null,
): void {
  const hasChildren = group.children.length > 0 || group.exchangeIds.length > 0;
  const expanded = hasChildren && (expandedNodeIds.has(group.id) || forcedExpandedNodeIds.has(group.id));
  rows.push({ kind: "group", key: `group:${group.id}`, id: group.id, parentId, depth, group, hasChildren, expanded });
  if (!expanded) return;
  for (const child of group.children) appendGroup(rows, child, depth + 1, group.id, expandedNodeIds, forcedExpandedNodeIds, draft);
  for (const id of group.exchangeIds) {
    rows.push({ kind: "exchange", key: `exchange:${id}`, id, parentId: group.id, depth: depth + 1 });
    if (draft?.sourceExchangeId === id) rows.push({ kind: "draft", key: `draft:${draft.id}`, id: draft.id, sourceExchangeId: id, parentId: group.id, depth: depth + 1 });
  }
}
