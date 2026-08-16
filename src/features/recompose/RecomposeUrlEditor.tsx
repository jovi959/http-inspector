import type { RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

import { createQueryRow } from "./recomposeUrl";

interface RecomposeUrlEditorProps {
  readonly working: RecomposeWorkingCopy;
  onChange(working: RecomposeWorkingCopy): void;
}

export function RecomposeUrlEditor({ working, onChange }: RecomposeUrlEditorProps) {
  const updateRow = (index: number, field: "name" | "value", value: string | null) => onChange({
    ...working,
    query: working.query.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value, edited: true } : row),
  });
  const moveRow = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= working.query.length) return;
    const query = [...working.query];
    [query[index], query[target]] = [query[target]!, query[index]!];
    onChange({ ...working, query });
  };
  return (
    <section className="recompose-table-editor" aria-label="Query parameters editor">
      <div className="recompose-editor-heading"><strong>Query parameters</strong><button type="button" onClick={() => onChange({ ...working, query: [...working.query, createQueryRow()] })}>Add</button></div>
      <div className="recompose-table-header"><span>Name</span><span>Value</span><span /></div>
      <div className="recompose-table-rows">
        {working.query.length === 0 && <p className="empty-copy">This request has no query parameters. Add one if needed.</p>}
        {working.query.map((row, index) => <div key={row.id} className="recompose-table-row">
          <input aria-label={`Query parameter ${index + 1} name`} value={row.name} onChange={(event) => updateRow(index, "name", event.target.value)} />
          <span className="recompose-query-value"><input aria-label={`Query parameter ${index + 1} value`} disabled={row.value === null} placeholder={row.value === null ? "No value" : undefined} value={row.value ?? ""} onChange={(event) => updateRow(index, "value", event.target.value)} /><button type="button" onClick={() => updateRow(index, "value", row.value === null ? "" : null)}>{row.value === null ? "Add value" : "No value"}</button></span>
          <span className="recompose-row-actions"><button aria-label={`Move query parameter ${index + 1} up`} disabled={index === 0} type="button" onClick={() => moveRow(index, -1)}>↑</button><button aria-label={`Move query parameter ${index + 1} down`} disabled={index === working.query.length - 1} type="button" onClick={() => moveRow(index, 1)}>↓</button><button type="button" onClick={() => onChange({ ...working, query: working.query.filter((_, rowIndex) => rowIndex !== index) })}>Remove</button></span>
        </div>)}
      </div>
    </section>
  );
}
