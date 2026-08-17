import { describe, expect, it } from "vitest";

import { findTextSearchMatches, getSearchMatchIndex } from "@/domain/body-presentation/bodySearch";

describe("body search", () => {
  it("finds all literal matches across content that is not currently visible", () => {
    expect(findTextSearchMatches("top\ncontent\nneedle\nmore needle", "NEEDLE")).toEqual([
      { start: 12, end: 18 },
      { start: 24, end: 30 },
    ]);
  });

  it("does not search for an empty or whitespace-only value", () => {
    expect(findTextSearchMatches("captured response", "   ")).toEqual([]);
  });

  it("wraps both search navigation directions", () => {
    expect(getSearchMatchIndex(2, 3, "next")).toBe(0);
    expect(getSearchMatchIndex(0, 3, "previous")).toBe(2);
  });
});
