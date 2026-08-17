import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";

import { findTextSearchMatches } from "@/domain/body-presentation/bodySearch";

interface CodeBodyViewerProps {
  readonly content: string;
  readonly preserveHttpLines?: boolean;
  readonly searchMatchIndex?: number;
  readonly searchQuery?: string;
}

/** Plain text and raw views preserve captured source exactly in a safe text container. */
export function CodeBodyViewer({ content, preserveHttpLines = false, searchMatchIndex = 0, searchQuery = "" }: CodeBodyViewerProps) {
  const activeMatch = useRef<HTMLElement>(null);
  const matches = useMemo(() => findTextSearchMatches(content, searchQuery), [content, searchQuery]);

  useEffect(() => {
    activeMatch.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [searchMatchIndex, searchQuery]);

  return (
    <pre className={`code-body-viewer ${preserveHttpLines ? "is-raw" : ""}`}>
      {renderContent(content, matches, searchMatchIndex, activeMatch)}
    </pre>
  );
}

function renderContent(content: string, matches: ReturnType<typeof findTextSearchMatches>, activeMatchIndex: number, activeMatch: RefObject<HTMLElement | null>) {
  if (matches.length === 0) return content;
  let cursor = 0;
  return matches.flatMap((match, index) => {
    const nodes: ReactNode[] = [];
    if (match.start > cursor) nodes.push(content.slice(cursor, match.start));
    nodes.push(<mark key={`match-${match.start}-${index}`} ref={index === activeMatchIndex ? activeMatch : undefined} className={index === activeMatchIndex ? "is-active" : ""}>{content.slice(match.start, match.end)}</mark>);
    cursor = match.end;
    if (index + 1 === matches.length && cursor < content.length) nodes.push(content.slice(cursor));
    return nodes;
  });
}
