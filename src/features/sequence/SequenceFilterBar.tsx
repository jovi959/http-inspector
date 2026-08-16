interface SequenceFilterBarProps {
  readonly filterError: string | null;
  readonly filterInput: string;
  readonly focusedGroupId: string | null;
  readonly selectedGroupId: string | null;
  readonly totalCount: number;
  readonly visibleCount: number;
  onClearFilter(): void;
  onFilterInputChange(input: string): void;
  onToggleFocused(): void;
}

/** Owns filter controls only; filtering itself remains a shared summary selector. */
export function SequenceFilterBar({
  filterError,
  filterInput,
  focusedGroupId,
  selectedGroupId,
  totalCount,
  visibleCount,
  onClearFilter,
  onFilterInputChange,
  onToggleFocused,
}: SequenceFilterBarProps) {
  const canFocus = focusedGroupId !== null || selectedGroupId !== null;
  return (
    <div className="sequence-filter-bar">
      <label className="sequence-filter">
        <span>Filter</span>
        <input value={filterInput} placeholder="method:POST status:400-499 source:flutter" onChange={(event) => onFilterInputChange(event.target.value)} />
      </label>
      <div className="sequence-filter-actions">
        <span>{visibleCount}/{totalCount} visible</span>
        <button disabled={!filterInput} type="button" onClick={onClearFilter}>Clear</button>
        <button aria-pressed={focusedGroupId !== null} disabled={!canFocus} type="button" onClick={onToggleFocused}>{focusedGroupId ? "Unfocus" : "Focused"}</button>
      </div>
      {filterError && <span className="filter-error" role="status">{filterError}</span>}
    </div>
  );
}
