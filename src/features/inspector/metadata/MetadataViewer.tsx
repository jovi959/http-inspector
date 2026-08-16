import type { ReactNode } from "react";

export interface MetadataSection {
  readonly title: string;
  readonly value: unknown;
}

interface MetadataViewerProps {
  readonly sections: readonly MetadataSection[];
}

/** Recursively presents contract-bounded metadata as text, never interpreted markup. */
export function MetadataViewer({ sections }: MetadataViewerProps) {
  return (
    <div className="metadata-viewer">
      {sections.map((section) => <section key={section.title} className="metadata-section"><h3>{section.title}</h3><MetadataValue value={section.value} /></section>)}
    </div>
  );
}

function MetadataValue({ value }: { readonly value: unknown }): ReactNode {
  if (value === null) return <span className="metadata-scalar">null</span>;
  if (value === undefined) return <span className="metadata-scalar">—</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return <span className="metadata-scalar">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="metadata-scalar">[]</span>;
    return <ol className="metadata-array">{value.map((item, index) => <li key={index}><MetadataValue value={item} /></li>)}</ol>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="metadata-scalar">&#123;&#125;</span>;
    return <dl className="metadata-list">{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd><MetadataValue value={item} /></dd></div>)}</dl>;
  }
  return <span className="metadata-scalar">{String(value)}</span>;
}
