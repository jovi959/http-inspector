import type { RecomposeHeaderRow, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

interface RecomposeHeadersEditorProps {
  readonly authenticationOnly: boolean;
  readonly working: RecomposeWorkingCopy;
  onChange(working: RecomposeWorkingCopy): void;
}

export function RecomposeHeadersEditor({ authenticationOnly, working, onChange }: RecomposeHeadersEditorProps) {
  const visible = working.headers.map((header, index) => ({ header, index })).filter(({ header }) => !authenticationOnly || isAuthenticationHeader(header.name));
  const update = (index: number, field: "name" | "value", value: string) => onChange({
    ...working,
    headers: working.headers.map((header, headerIndex) => headerIndex === index ? { ...header, [field]: value } : header),
  });
  const add = () => onChange({ ...working, headers: [...working.headers, { id: crypto.randomUUID(), name: authenticationOnly ? "Authorization" : "", value: "" }] });
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= working.headers.length) return;
    const headers = [...working.headers];
    [headers[index], headers[target]] = [headers[target]!, headers[index]!];
    onChange({ ...working, headers });
  };
  return (
    <section className="recompose-table-editor" aria-label={authenticationOnly ? "Authentication editor" : "Headers editor"}>
      <div className="recompose-editor-heading"><strong>{authenticationOnly ? "Authentication" : "Headers"}</strong><button type="button" onClick={add}>Add</button></div>
      <div className="recompose-table-header"><span>Name</span><span>Value</span><span /></div>
      <div className="recompose-table-rows">
        {visible.length === 0 && <p className="empty-copy">No {authenticationOnly ? "authentication headers" : "headers"} are present.</p>}
        {visible.map(({ header, index }) => <HeaderRow key={header.id} header={header} index={index} working={working} onChange={onChange} onMove={move} onUpdate={update} />)}
      </div>
    </section>
  );
}

function HeaderRow({ header, index, working, onChange, onMove, onUpdate }: {
  readonly header: RecomposeHeaderRow;
  readonly index: number;
  readonly working: RecomposeWorkingCopy;
  onChange(working: RecomposeWorkingCopy): void;
  onMove(index: number, offset: number): void;
  onUpdate(index: number, field: "name" | "value", value: string): void;
}) {
  return <div className="recompose-table-row"><input aria-label={`Header ${index + 1} name`} value={header.name} onChange={(event) => onUpdate(index, "name", event.target.value)} /><input aria-label={`Header ${index + 1} value`} value={header.value} onChange={(event) => onUpdate(index, "value", event.target.value)} /><span className="recompose-row-actions"><button aria-label={`Move header ${index + 1} up`} disabled={index === 0} type="button" onClick={() => onMove(index, -1)}>↑</button><button aria-label={`Move header ${index + 1} down`} disabled={index === working.headers.length - 1} type="button" onClick={() => onMove(index, 1)}>↓</button><button type="button" onClick={() => onChange({ ...working, headers: working.headers.filter((_, headerIndex) => headerIndex !== index) })}>Remove</button></span></div>;
}

function isAuthenticationHeader(name: string): boolean {
  return /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token)$/i.test(name);
}
