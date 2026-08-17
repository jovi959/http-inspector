export interface TextSearchMatch {
  readonly end: number;
  readonly start: number;
}

const maximumSearchMatches = 1_000;

/** Finds literal, case-insensitive matches across the complete captured representation. */
export function findTextSearchMatches(content: string, query: string, maximumMatches = maximumSearchMatches): readonly TextSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || maximumMatches <= 0) return [];

  const normalizedContent = content.toLowerCase();
  const matches: TextSearchMatch[] = [];
  let start = 0;
  while (matches.length < maximumMatches) {
    const matchStart = normalizedContent.indexOf(normalizedQuery, start);
    if (matchStart < 0) return matches;
    matches.push({ start: matchStart, end: matchStart + normalizedQuery.length });
    start = matchStart + normalizedQuery.length;
  }
  return matches;
}

/** Keeps response-search navigation within the discovered matches. */
export function getSearchMatchIndex(currentIndex: number, matchCount: number, direction: "next" | "previous"): number {
  if (matchCount === 0) return 0;
  return direction === "next"
    ? (currentIndex + 1) % matchCount
    : (currentIndex - 1 + matchCount) % matchCount;
}
