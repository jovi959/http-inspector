interface ResponseSearchToolbarProps {
  readonly activeMatch: number;
  readonly matchCount: number;
  readonly onChange: (value: string) => void;
  readonly onNavigate: (direction: "next" | "previous") => void;
  readonly value: string;
}

/** Provides a response-wide find field independently of the selected body representation. */
export function ResponseSearchToolbar({ activeMatch, matchCount, onChange, onNavigate, value }: ResponseSearchToolbarProps) {
  const hasQuery = value.trim().length > 0;
  const hasMatches = matchCount > 0;

  return (
    <div className="response-search-toolbar" role="search" aria-label="Find in response">
      <label htmlFor="response-search-input">Find in response</label>
      <input id="response-search-input" type="search" value={value} placeholder="Search captured response" onChange={(event) => onChange(event.target.value)} />
      <span aria-live="polite">{hasQuery ? hasMatches ? `${activeMatch + 1} of ${matchCount}` : "No matches" : "Enter text to search"}</span>
      <div>
        <button type="button" disabled={!hasMatches} onClick={() => onNavigate("previous")}>Previous</button>
        <button type="button" disabled={!hasMatches} onClick={() => onNavigate("next")}>Next</button>
      </div>
    </div>
  );
}
