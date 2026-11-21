import { afterEach, describe, expect, test, vi } from "vitest";

import { defaultDisplayPreferences, loadDisplayPreferences } from "./displayPreferences";

const storageKey = "http-inspector.display-preferences.v1";

function stubSavedPreferences(saved: unknown): void {
  const store = new Map<string, string>([[storageKey, JSON.stringify(saved)]]);
  vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) } });
}

afterEach(() => vi.unstubAllGlobals());

describe("display preferences", () => {
  test("shows source value names by default, including for preferences saved before the option existed", () => {
    const savedBeforeOption: Record<string, unknown> = { ...defaultDisplayPreferences, theme: "dark" };
    delete savedBeforeOption.showDataverseValueNames;
    stubSavedPreferences(savedBeforeOption);

    const loaded = loadDisplayPreferences();

    expect(defaultDisplayPreferences.showDataverseValueNames).toBe(true);
    expect(loaded.theme).toBe("dark");
    expect(loaded.showDataverseValueNames).toBe(true);
  });

  test("keeps source value names off once the user turned them off", () => {
    stubSavedPreferences({ ...defaultDisplayPreferences, showDataverseValueNames: false });

    expect(loadDisplayPreferences().showDataverseValueNames).toBe(false);
  });
});
