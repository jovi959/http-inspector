import { useEffect, useRef, useState } from "react";

import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { keymap, lineNumbers, EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { createJsonPresentation, requiresJsonWorker, type JsonPresentation } from "@/domain/body-presentation/jsonPresentation";
import { findTextSearchMatches } from "@/domain/body-presentation/bodySearch";
import { createResponseSearchHighlightEffect, responseSearchHighlighting } from "@/features/inspector/body/responseSearchHighlighting";

interface JsonBodyViewerProps {
  readonly cacheKey: string;
  readonly content: string;
  readonly isComplete: boolean;
  readonly searchMatchIndex?: number;
  readonly searchQuery?: string;
}

const presentationCache = new Map<string, JsonPresentation>();
const maximumCachedPresentations = 24;

const charlesJsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--json-property)" },
  { tag: tags.string, color: "var(--json-string)" },
  { tag: tags.number, color: "var(--json-number)" },
  { tag: tags.bool, color: "var(--json-boolean)" },
  { tag: tags.null, color: "var(--json-null)" },
  { tag: [tags.punctuation, tags.brace], color: "var(--text)" },
]);

/** Hosts the read-only JSON editor while retaining the immutable source for Copy Original. */
export function JsonBodyViewer({ cacheKey, content, isComplete, searchMatchIndex = 0, searchQuery = "" }: JsonBodyViewerProps) {
  const editorElement = useRef<HTMLDivElement>(null);
  const editorView = useRef<EditorView | null>(null);
  const [presentation, setPresentation] = useState<JsonPresentation | null>(() => getCachedPresentation(cacheKey, content));
  const [copied, setCopied] = useState<"original" | "pretty" | null>(null);
  const document = presentation?.kind === "valid" ? presentation.pretty : presentation?.original ?? content;

  useEffect(() => {
    const cached = getCachedPresentation(cacheKey, content);
    setCopied(null);
    if (cached) {
      setPresentation(cached);
      return;
    }
    if (!requiresJsonWorker(content)) {
      setPresentation(cachePresentation(cacheKey, createJsonPresentation(content)));
      return;
    }
    setPresentation(null);
    const worker = new Worker(new URL("../../../workers/jsonPresentation.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ readonly id: string; readonly presentation: JsonPresentation }>) => {
      if (event.data.id === cacheKey) setPresentation(cachePresentation(cacheKey, event.data.presentation));
    };
    worker.onerror = () => setPresentation(cachePresentation(cacheKey, {
      kind: "invalid", original: content, diagnostics: ["JSON formatting could not complete; the original content is preserved."],
    }));
    worker.postMessage({ id: cacheKey, content });
    return () => worker.terminate();
  }, [cacheKey, content]);

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
          json(),
          foldGutter(),
          bracketMatching(),
          search(),
          responseSearchHighlighting,
          keymap.of([...foldKeymap, ...searchKeymap]),
          syntaxHighlighting(charlesJsonHighlight),
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
    const copyText = kind === "original" ? content : presentation?.kind === "valid" && isComplete ? presentation.pretty : null;
    if (copyText === null) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(kind);
  };

  return (
    <div className="json-body-viewer">
      <div className="code-toolbar">
        <span className={presentation?.kind === "valid" ? "code-valid" : "code-invalid"}>
          {presentation === null ? "Formatting JSON… original preserved" : presentation.kind === "valid" ? "Pretty JSON · 2 spaces" : "Invalid JSON · original preserved"}
        </span>
        <div>
          <button type="button" onClick={() => void copy("original")}>Copy original</button>
          <button type="button" disabled={presentation?.kind !== "valid" || !isComplete} onClick={() => void copy("pretty")}>Copy pretty</button>
          {copied && <span className="copy-feedback">Copied {copied}</span>}
        </div>
      </div>
      {presentation?.kind === "invalid" && <p className="json-diagnostic">{presentation.diagnostics.join(" · ")}</p>}
      {presentation?.kind === "valid" && !isComplete && <p className="json-diagnostic">Pretty copy is unavailable until the complete body is captured.</p>}
      <div ref={editorElement} className="json-editor" />
    </div>
  );
}

// The JSON editor is loaded only when a JSON body is selected, keeping capture navigation lightweight.
export default JsonBodyViewer;

function getCachedPresentation(cacheKey: string, content: string): JsonPresentation | null {
  const cached = presentationCache.get(cacheKey);
  return cached?.original === content ? cached : null;
}

function cachePresentation(cacheKey: string, presentation: JsonPresentation): JsonPresentation {
  presentationCache.delete(cacheKey);
  presentationCache.set(cacheKey, presentation);
  if (presentationCache.size > maximumCachedPresentations) presentationCache.delete(presentationCache.keys().next().value!);
  return presentation;
}
