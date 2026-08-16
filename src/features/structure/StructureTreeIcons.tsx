import type { StructureFileType } from "@/domain/display/fileTypePresentation";

/** Original vector icons keep the Structure tree crisp without depending on platform emoji glyphs. */
export function StructureHostIcon() {
  return (
    <svg className="tree-icon tree-host-icon" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#0b67bf" />
      <path d="M3 16h26M16 2c5 5 5 23 0 28M16 2c-5 5-5 23 0 28M5.5 9h21M5.5 23h21" fill="none" stroke="#d9f2ff" strokeWidth="1.6" />
      <circle cx="12" cy="11" r="2" fill="#fff" opacity=".9" />
    </svg>
  );
}

export function StructureFolderIcon() {
  return (
    <svg className="tree-icon tree-folder-icon" viewBox="0 0 34 27" aria-hidden="true">
      <path d="M2.5 7.5V4.8c0-1.3 1-2.3 2.3-2.3h9l3.2 3.3h12.2c1.3 0 2.3 1 2.3 2.3v2.1H2.5Z" fill="#d9ecfb" stroke="#7aa4c7" />
      <path d="M1.7 9.2h30.6l-4.2 14.2c-.4 1.2-1.4 2.1-2.7 2.1H4.3c-1.8 0-2.8-1.7-2.2-3.2L6.3 10.8c.2-.9.8-1.6 1.8-1.6Z" fill="#1686d3" stroke="#0865a8" />
      <path d="M6.2 11.2h25.1l-3.8 10.3H2.6l3.6-9.4Z" fill="#6bc0f4" opacity=".9" />
    </svg>
  );
}

export function StructureFileIcon({ type }: { readonly type: StructureFileType }) {
  const symbol = type === "json" ? "{}" : type === "xml" ? "<>" : type === "text" ? "TXT" : "•";
  return (
    <svg className={`tree-icon tree-file-icon tree-file-icon-${type}`} viewBox="0 0 24 28" role="img" aria-label={`${type} file`}>
      <path d="M4.5 1.5h10l5 5v20H4.5z" fill="var(--file-icon-surface)" stroke="var(--file-icon-border)" />
      <path d="M14.5 1.5v5h5" fill="var(--file-icon-fold)" stroke="var(--file-icon-border)" />
      <text x="12" y="19" fill="var(--file-icon-text)" fontFamily="var(--font-mono)" fontSize={type === "text" ? "5.5" : "10"} fontWeight="700" textAnchor="middle">{symbol}</text>
    </svg>
  );
}

export function StructureDraftIcon() {
  return (
    <svg className="tree-icon tree-draft-icon" viewBox="0 0 28 28" role="img" aria-label="editable replay draft">
      <path d="m5 20 1.2-5.2L18.8 2.2a2.4 2.4 0 0 1 3.4 0l3.6 3.6a2.4 2.4 0 0 1 0 3.4L13.2 21.8 8 23Z" fill="#f5a623" stroke="#925811" strokeWidth="1.2" />
      <path d="m6.2 14.8 7 7M18.8 2.2l7 7" fill="none" stroke="#fff2c7" strokeWidth="2" />
      <path d="m5 20 3 3-4 1Z" fill="#374151" />
    </svg>
  );
}
