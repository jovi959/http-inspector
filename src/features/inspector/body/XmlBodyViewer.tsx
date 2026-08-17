import { useEffect, useRef, useState } from "react";

import { xml } from "@codemirror/lang-xml";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { keymap, lineNumbers, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { createXmlPresentation } from "@/domain/body-presentation/xmlPresentation";
import { findTextSearchMatches } from "@/domain/body-presentation/bodySearch";
import { createResponseSearchHighlightEffect, responseSearchHighlighting } from "@/features/inspector/body/responseSearchHighlighting";

interface XmlBodyViewerProps {
  readonly content: string;
  readonly searchMatchIndex?: number;
  readonly searchQuery?: string;
}

const charlesXmlHighlight = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--xml-tag)" },
  { tag: tags.attributeName, color: "var(--xml-attribute)" },
  { tag: tags.string, color: "var(--xml-string)" },
  { tag: tags.comment, color: "var(--xml-comment)" },
  { tag: [tags.punctuation, tags.brace], color: "var(--text)" },
]);

/** Displays formatted XML as read-only, syntax-highlighted source while retaining the captured original. */
export function XmlBodyViewer({ content, searchMatchIndex = 0, searchQuery = "" }: XmlBodyViewerProps) {
  const editorElement = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const [copied, setCopied] = useState<"original" | "pretty" | null>(null);
  const presentation = createXmlPresentation(content);
  const document = presentation.kind === "valid" ? presentation.pretty : presentation.original;

  useEffect(() => {
    if (!editorElement.current) return;
    const view = new EditorView({
      parent: editorElement.current,
      state: EditorState.create({
        doc: document,
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          xml(),
          foldGutter(),
          bracketMatching(),
          search(),
          responseSearchHighlighting,
          keymap.of([...foldKeymap, ...searchKeymap]),
          syntaxHighlighting(charlesXmlHighlight),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "var(--surface-code)", color: "var(--text)", fontSize: "13px" },
            ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)" },
            ".cm-content": { padding: "14px 0 28px" },
            ".cm-gutters": { backgroundColor: "var(--surface-muted)", border: "none", color: "var(--muted)" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--surface-tint)" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--surface-active)" },
          }),
        ],
      }),
    });
    editorView.current = view;
    return () => {
      editorView.current = null;
      view.destroy();
    };
  }, [document]);

  useEffect(() => {
    const view = editorView.current;
    if (!view) return;
    const match = findTextSearchMatches(view.state.doc.toString(), searchQuery)[searchMatchIndex] ?? null;
    view.dispatch({
      effects: [createResponseSearchHighlightEffect(view.state.doc.toString(), searchQuery, searchMatchIndex), ...(match ? [EditorView.scrollIntoView(match.start, { y: "center" })] : [])],
    });
  }, [document, searchMatchIndex, searchQuery]);

  const copy = async (kind: "original" | "pretty") => {
    const copyText = kind === "original" ? content : presentation.kind === "valid" ? presentation.pretty : null;
    if (copyText === null) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(kind);
  };

  return (
    <div className="xml-body-viewer">
      <div className="code-toolbar">
        <span className={presentation.kind === "valid" ? "code-valid" : "code-invalid"}>{presentation.kind === "valid" ? "Pretty XML · 2 spaces" : "Invalid XML · original preserved"}</span>
        <div><button type="button" onClick={() => void copy("original")}>Copy original</button><button disabled={presentation.kind !== "valid"} type="button" onClick={() => void copy("pretty")}>Copy pretty</button>{copied && <span className="copy-feedback">Copied {copied}</span>}</div>
      </div>
      {presentation.kind === "invalid" && <p className="json-diagnostic">{presentation.diagnostics.join(" · ")}</p>}
      <div ref={editorElement} className="xml-editor" />
    </div>
  );
}

export default XmlBodyViewer;
