import { useState } from "react";

import type { HeaderEntry } from "@/generated/contracts";

interface HeadersViewerProps {
  readonly countLabel?: string;
  readonly emptyMessage?: string;
  readonly headers: readonly HeaderEntry[];
}

/** Shows ordered duplicate-preserving headers rather than collapsing them into a map. */
export function HeadersViewer({ countLabel = "headers", emptyMessage = "No captured headers.", headers }: HeadersViewerProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
  };
  if (headers.length === 0) return <p className="empty-copy">{emptyMessage}</p>;
  return (
    <section className="headers-viewer">
      <div className="headers-toolbar">
        <span>{headers.length} captured {countLabel}</span>
        <button type="button" onClick={() => void copy(headers.map((header) => `${header.name}: ${header.value}`).join("\n"), "all headers")}>Copy all</button>
        {copied && <span className="copy-feedback">Copied {copied}</span>}
      </div>
      <dl className="headers-list">
        {headers.map((header, index) => (
          <div key={`${header.name}-${index}`}>
            <dt>{header.name}</dt>
            <dd><span>{header.value}</span><span className="header-copy-actions"><button type="button" onClick={() => void copy(header.name, "name")}>Copy name</button><button type="button" onClick={() => void copy(header.value, "value")}>Copy value</button></span></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
