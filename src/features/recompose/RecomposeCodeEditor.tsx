import { useEffect, useRef } from "react";

import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { bracketMatching, HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

interface RecomposeCodeEditorProps {
  readonly language: "json" | "xml";
  readonly value: string;
  onChange(value: string): void;
  onDiagnostic(message: string | null): void;
}

const recomposeHighlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.tagName], color: "var(--json-property)" },
  { tag: [tags.string, tags.attributeValue], color: "var(--json-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--json-number)" },
  { tag: tags.attributeName, color: "var(--xml-attribute)" },
  { tag: tags.comment, color: "var(--xml-comment)" },
]);

/** Provides a large editable structured-body surface without normalizing developer input. */
export function RecomposeCodeEditor({ language, value, onChange, onDiagnostic }: RecomposeCodeEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onDiagnosticRef = useRef(onDiagnostic);
  onChangeRef.current = onChange;
  onDiagnosticRef.current = onDiagnostic;

  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          bracketMatching(),
          language === "json" ? json() : xml(),
          syntaxHighlighting(recomposeHighlight),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const nextValue = update.state.doc.toString();
            onChangeRef.current(nextValue);
            onDiagnosticRef.current(diagnosticFor(language, nextValue, update.state));
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "var(--surface-code)", color: "var(--text)", fontSize: "13px" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
            ".cm-content": { minHeight: "320px", padding: "14px 0 28px" },
            ".cm-gutters": { backgroundColor: "var(--surface-muted)", border: "none", color: "var(--muted)" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-tint)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--surface-active)" },
          }),
        ],
      }),
    });
    viewRef.current = view;
    onDiagnosticRef.current(diagnosticFor(language, value, view.state));
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={parent} className="recompose-code-editor" />;
}

function diagnosticFor(language: "json" | "xml", value: string, state: EditorState): string | null {
  if (value.trim() === "") return null;
  if (language === "json") {
    try { JSON.parse(value); return null; } catch (error) { return error instanceof Error ? error.message : "Invalid JSON."; }
  }
  let invalid = false;
  syntaxTree(state).iterate({ enter: (node) => { if (node.type.isError) invalid = true; } });
  return invalid ? "XML contains an incomplete or invalid construct." : null;
}
