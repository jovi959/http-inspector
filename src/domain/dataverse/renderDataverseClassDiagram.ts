import type { DataverseExpansion, DataverseFilter, DataverseMap, DataverseRecord, DataverseRecordValue } from "@/domain/dataverse/dataverseMapTypes";
import { createDataverseRecordValuePresentation } from "@/domain/dataverse/dataverseRecordValuePresentation";

interface ExpansionNode {
  readonly expansion: DataverseExpansion;
  readonly id: string;
  readonly children: readonly ExpansionNode[];
}

/** Converts a parsed Dataverse request to Mermaid source without letting Mermaid influence parser behavior. */
export function renderDataverseClassDiagram(map: DataverseMap, record: DataverseRecord | null = null): string {
  const lines = [
    "---",
    "config:",
    "  class:",
    "    hideEmptyMembersBox: true",
    "---",
    "classDiagram",
    "    direction TB",
    "",
    `    class REQUEST["${escapeLabel(map.requestLabel)}"]`,
    "",
    ...renderClass(map.entityName, map.entityName, map.selectedColumns, record),
    "",
    "    class ALL",
    "    class EXPAND",
    "",
    `    REQUEST --> ${map.entityName}`,
    `    ${map.entityName} --> ALL : FILTER`,
    `    ${map.entityName} --> EXPAND : EXPAND`,
  ];

  map.filters.forEach((filter, index) => {
    lines.push("", ...renderFilter(filter, index + 1));
  });

  const expansions = createExpansionNodes(map.expansions);
  expansions.forEach((expansion) => lines.push("", ...renderExpansion(expansion, record)));
  if (expansions.length > 0) lines.push("", ...renderExpansionEdges("EXPAND", expansions, false));
  return `${lines.join("\n")}\n`;
}

function renderFilter(filter: DataverseFilter, index: number): readonly string[] {
  const fieldId = `F${index}`;
  const valueId = `V${index}`;
  if (filter.kind === "comparison") {
    return [`    class ${fieldId}["${escapeLabel(filter.field)}"]`, `    class ${valueId}["${escapeLabel(filter.value)}"]`, `    ALL --> ${fieldId} : AND`, `    ${fieldId} --> ${valueId} : ${filter.operator}`];
  }
  if (filter.kind === "anyOf") {
    const values = filter.values.flatMap((value, valueIndex) => [`    class ${valueId}${alphabeticSuffix(valueIndex)}["${escapeLabel(value)}"]`]);
    const edges = filter.values.map((_, valueIndex) => `    ${fieldId} --> ${valueId}${alphabeticSuffix(valueIndex)} : OR ${filter.operator}`);
    return [`    class ${fieldId}["${escapeLabel(filter.field)}"]`, ...values, `    ALL --> ${fieldId} : AND`, ...edges];
  }
  if (filter.kind === "any" || filter.kind === "notAny") {
    return [
      `    class ${fieldId}["${escapeLabel(filter.relationship)}"]`,
      `    class ${valueId}["${escapeLabel(filter.value)}"]`,
      `    ALL --> ${fieldId} : ${filter.kind === "any" ? "AND ANY" : "AND NOT ANY"}`,
      `    ${fieldId} --> ${valueId} : ${filter.field} ${filter.operator}`,
    ];
  }
  if (filter.kind === "contains") {
    return [`    class ${fieldId}["${escapeLabel(filter.field)}"]`, `    class ${valueId}["${escapeLabel(filter.value)}"]`, `    ALL --> ${fieldId} : AND`, `    ${fieldId} --> ${valueId} : CONTAINS`];
  }
  return [`    class ${fieldId}["${escapeLabel(filter.expression)}"]`, `    ALL --> ${fieldId} : AND UNSUPPORTED`];
}

function createExpansionNodes(expansions: readonly DataverseExpansion[]): readonly ExpansionNode[] {
  const usedIds = new Set(["REQUEST", "ALL", "EXPAND"]);
  return expansions.map((expansion) => createExpansionNode(expansion, usedIds));
}

function createExpansionNode(expansion: DataverseExpansion, usedIds: Set<string>): ExpansionNode {
  const preferredId = expansion.name.startsWith("bpf_") ? "BPF" : expansion.name;
  const id = uniqueClassId(preferredId, usedIds);
  usedIds.add(id);
  return { expansion, id, children: expansion.expansions.map((child) => createExpansionNode(child, usedIds)) };
}

function uniqueClassId(candidate: string, usedIds: ReadonlySet<string>): string {
  const normalized = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(candidate) ? candidate : "EXPANSION";
  if (!usedIds.has(normalized)) return normalized;
  let index = 2;
  while (usedIds.has(`${normalized}_${index}`)) index++;
  return `${normalized}_${index}`;
}

function renderExpansion(node: ExpansionNode, parentRecord: DataverseRecord | null): readonly string[] {
  const record = firstReturnedExpansionRecord(parentRecord, node.expansion.name);
  const classLines = renderClass(node.id, node.expansion.name, node.expansion.selectedColumns, record);
  return [...classLines, ...node.children.flatMap((child) => ["", ...renderExpansion(child, record)])];
}

function renderExpansionEdges(parentId: string, nodes: readonly ExpansionNode[], nested: boolean): readonly string[] {
  return nodes.flatMap((node) => [
    `    ${parentId} --> ${node.id}${nested ? " : EXPAND" : ""}`,
    ...(node.children.length > 0 ? ["", ...renderExpansionEdges(node.id, node.children, true)] : []),
  ]);
}

function renderClass(id: string, label: string, columns: readonly string[], record: DataverseRecord | null): readonly string[] {
  const members = columns.map((column) => renderMember(column, record));
  if (id !== label) {
    return [`    class ${id}["${escapeLabel(label)}"]`, ...members.map((member) => `    ${id} : ${member}`)];
  }
  return [`    class ${id} {`, ...members.map((member) => `        ${member}`), "    }"];
}

function firstReturnedExpansionRecord(parentRecord: DataverseRecord | null, relationship: string): DataverseRecord | null {
  if (!parentRecord) return null;
  const value = parentRecord[relationship];
  if (isDataverseRecord(value)) return value;
  if (!Array.isArray(value)) return null;
  return value.find(isDataverseRecord) ?? null;
}

function renderMember(column: string, record: DataverseRecord | null): string {
  if (!record) return escapeMember(column);
  return `${escapeMember(column)} = ${escapeMember(createDataverseRecordValuePresentation(record[column]).text)}`;
}

function isDataverseRecord(value: DataverseRecordValue | undefined): value is DataverseRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function alphabeticSuffix(index: number): string {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function escapeLabel(value: string): string {
  const label = value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;").replaceAll("\n", " ").trim();
  return label || "(empty)";
}

function escapeMember(value: string): string {
  const member = value.replaceAll("\r", " ").replaceAll("\n", " ").replaceAll("{", "(").replaceAll("}", ")").trim();
  if (member.startsWith("\"") && member.endsWith("\"")) return `'${member.slice(1, -1).replaceAll("\\\"", "“")}'`;
  return member || "(empty)";
}
