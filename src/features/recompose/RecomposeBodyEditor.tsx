import { useState } from "react";

import type { RecomposeMode, RecomposeWorkingCopy } from "@/state/recompose/recomposeTypes";

import { RecomposeCodeEditor } from "./RecomposeCodeEditor";
import { buildEditableRawRequest, parseEditableRawRequest } from "./recomposeRaw";

interface RecomposeBodyEditorProps {
  readonly mode: Extract<RecomposeMode, "text" | "json" | "xml" | "raw">;
  readonly rawError: string | null;
  readonly rawText: string | null;
  readonly working: RecomposeWorkingCopy;
  onChange(working: RecomposeWorkingCopy): void;
  onRawError(error: string | null): void;
  onRawText(value: string): void;
}

export function RecomposeBodyEditor({ mode, rawError, rawText, working, onChange, onRawError, onRawText }: RecomposeBodyEditorProps) {
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const value = working.body?.value ?? "";
  const updateBody = (nextValue: string) => onChange({ ...working, body: { kind: "text", value: nextValue }, bodyUnavailable: false });
  if (mode === "raw") {
    const value = rawText ?? buildEditableRawRequest(working);
    const apply = () => {
      const result = parseEditableRawRequest(value, working);
      if (!result.ok) return onRawError(result.error);
      onRawError(null);
      onChange(result.working);
    };
    return <section className="recompose-body-editor"><div className="recompose-editor-heading"><strong>Raw HTTP request</strong><button type="button" onClick={apply}>Apply raw request</button></div>{rawError && <p className="recompose-error">{rawError}</p>}<textarea className="recompose-large-text" spellCheck={false} value={value} onChange={(event) => onRawText(event.target.value)} /></section>;
  }
  if (mode === "json" || mode === "xml") {
    return <section className="recompose-body-editor"><div className="recompose-editor-heading"><strong>{mode === "json" ? "JSON body" : "XML / SOAP body"}</strong><span>Editable source</span></div>{diagnostic && <p className="recompose-diagnostic">{diagnostic}</p>}<RecomposeCodeEditor language={mode} value={value} onChange={updateBody} onDiagnostic={setDiagnostic} /></section>;
  }
  return <section className="recompose-body-editor"><div className="recompose-editor-heading"><strong>Text body</strong><span>Editable source</span></div><textarea className="recompose-large-text" spellCheck={false} value={value} onChange={(event) => updateBody(event.target.value)} /></section>;
}
