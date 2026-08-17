import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

import { findTextSearchMatches } from "@/domain/body-presentation/bodySearch";

interface ResponseSearchHighlight {
  readonly end: number;
  readonly isActive: boolean;
  readonly start: number;
}

const setResponseSearchHighlights = StateEffect.define<readonly ResponseSearchHighlight[]>();

const responseSearchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setResponseSearchHighlights)) {
        return Decoration.set(effect.value.map((match) => Decoration.mark({ class: match.isActive ? "cm-response-search-active" : "cm-response-search-match" }).range(match.start, match.end)), true);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Keeps response-search matches visibly marked even while the search input owns focus. */
export const responseSearchHighlighting: Extension = responseSearchHighlightField;

export function createResponseSearchHighlightEffect(content: string, query: string, activeMatchIndex: number): StateEffect<readonly ResponseSearchHighlight[]> {
  const matches = findTextSearchMatches(content, query);
  return setResponseSearchHighlights.of(matches.map((match, index) => ({ ...match, isActive: index === activeMatchIndex })));
}
