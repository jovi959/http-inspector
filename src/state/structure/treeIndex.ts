import type { HttpExchangeSummary } from "@/generated/contracts";

import { changeAggregate, emptyStructureAggregate } from "./treeAggregates";
import type { StructureAggregate } from "./treeAggregates";

export interface StructureNode {
  readonly id: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly exchangeIds: readonly string[];
  readonly aggregate: StructureAggregate;
  readonly activityRevision: number;
}

export interface StructureTreeIndex {
  readonly nodesById: Readonly<Record<string, StructureNode>>;
  readonly rootIds: readonly string[];
  readonly exchangeToPath: Readonly<Record<string, readonly string[]>>;
}

export interface StructureGroup extends StructureNode {
  readonly children: readonly StructureGroup[];
}

export const emptyStructureTreeIndex: StructureTreeIndex = { nodesById: {}, rootIds: [], exchangeToPath: {} };

/** Applies an upsert incrementally, first removing the previous path so host/path changes cannot leave ghost rows. */
export function upsertStructureSummary(
  index: StructureTreeIndex,
  exchangeId: string,
  previous: HttpExchangeSummary | undefined,
  next: HttpExchangeSummary,
): StructureTreeIndex {
  const removed = previous ? removeStructureSummary(index, exchangeId, previous) : index;
  const path = structurePath(next);
  const nodesById = { ...removed.nodesById };
  const rootIds = [...removed.rootIds];
  for (let position = 0; position < path.length; position += 1) {
    const segment = path[position]!;
    const parentId = position === 0 ? null : path[position - 1]!.id;
    const existing = nodesById[segment.id];
    const node: StructureNode = existing
      ? { ...existing, aggregate: changeAggregate(existing.aggregate, next, 1), activityRevision: existing.activityRevision + 1 }
      : { id: segment.id, label: segment.label, parentId, childIds: [], exchangeIds: [], aggregate: changeAggregate(emptyStructureAggregate, next, 1), activityRevision: 1 };
    nodesById[segment.id] = node;
    if (parentId === null) {
      if (!rootIds.includes(segment.id)) rootIds.push(segment.id);
    } else {
      const parent = nodesById[parentId]!;
      if (!parent.childIds.includes(segment.id)) nodesById[parentId] = { ...parent, childIds: [...parent.childIds, segment.id] };
    }
  }
  const leaf = path.at(-1)!;
  const leafNode = nodesById[leaf.id]!;
  nodesById[leaf.id] = { ...leafNode, exchangeIds: [...leafNode.exchangeIds, exchangeId] };
  return { nodesById, rootIds, exchangeToPath: { ...removed.exchangeToPath, [exchangeId]: path.map((segment) => segment.id) } };
}

/** Removes one retained exchange and prunes its empty path while subtracting only its own known aggregate values. */
export function removeStructureSummary(index: StructureTreeIndex, exchangeId: string, summary: HttpExchangeSummary): StructureTreeIndex {
  const path = index.exchangeToPath[exchangeId];
  if (!path) return index;
  const nodesById = { ...index.nodesById };
  let rootIds = [...index.rootIds];
  const leaf = nodesById[path.at(-1)!];
  if (leaf) nodesById[leaf.id] = { ...leaf, exchangeIds: leaf.exchangeIds.filter((value) => value !== exchangeId) };
  for (const nodeId of [...path].reverse()) {
    const node = nodesById[nodeId];
    if (!node) continue;
    const aggregate = changeAggregate(node.aggregate, summary, -1);
    const nextNode = { ...node, aggregate };
    if (aggregate.exchangeCount === 0 && nextNode.childIds.length === 0) {
      delete nodesById[nodeId];
      if (nextNode.parentId === null) rootIds = rootIds.filter((value) => value !== nodeId);
      else {
        const parent = nodesById[nextNode.parentId];
        if (parent) nodesById[parent.id] = { ...parent, childIds: parent.childIds.filter((value) => value !== nodeId) };
      }
    } else {
      nodesById[nodeId] = nextNode;
    }
  }
  const { [exchangeId]: removedPath, ...exchangeToPath } = index.exchangeToPath;
  void removedPath;
  return { nodesById, rootIds, exchangeToPath };
}

/** Builds a stable immutable tree only when a view asks for it; the index itself is maintained incrementally. */
export function structureGroups(index: StructureTreeIndex, visibleExchangeIds?: ReadonlySet<string>): readonly StructureGroup[] {
  return index.rootIds.flatMap((id) => toGroup(index, id, visibleExchangeIds));
}

function toGroup(index: StructureTreeIndex, id: string, visibleExchangeIds?: ReadonlySet<string>): readonly StructureGroup[] {
  const node = index.nodesById[id];
  if (!node) return [];
  const exchangeIds = visibleExchangeIds ? node.exchangeIds.filter((exchangeId) => visibleExchangeIds.has(exchangeId)) : node.exchangeIds;
  const children = node.childIds.flatMap((childId) => toGroup(index, childId, visibleExchangeIds));
  return exchangeIds.length === 0 && children.length === 0 ? [] : [{ ...node, exchangeIds, children }];
}

function structurePath(summary: HttpExchangeSummary): readonly { id: string; label: string }[] {
  if (!summary.host || summary.path === null) return [{ id: "invalid-url", label: "<invalid-url>" }];
  const host = `${summary.scheme ?? "unknown"}://${summary.host}${summary.port === null ? "" : `:${summary.port}`}`;
  const root = { id: `host:${escapeId(summary.scheme ?? "unknown")}:${escapeId(summary.host)}:${summary.port ?? ""}`, label: host };
  const segments = summary.path.split("/").filter(Boolean).map((segment) => decodeSegment(segment));
  return segments.slice(0, -1).reduce<readonly { id: string; label: string }[]>((path, segment) => [
    ...path,
    { id: `${path.at(-1)!.id}/path:${escapeId(segment.raw)}`, label: segment.label },
  ], [root]);
}

function decodeSegment(raw: string): { raw: string; label: string } {
  try { return { raw, label: decodeURIComponent(raw) }; } catch { return { raw, label: raw }; }
}

function escapeId(value: string): string {
  return encodeURIComponent(value);
}
