/**
 * Tests for Russian plural rules — the worst place to have an off-by-one bug
 * because users only notice ugly text like "5 трек" instead of "5 треков".
 */
import { describe, expect, it } from "vitest";
import { pluralEn, pluralRu } from "../lib/i18n";

describe("pluralRu", () => {
  // Singular: 1, 21, 31, ..., but NOT 11
  it.each([1, 21, 31, 101, 121])("returns 'one' for %i", (n) => {
    expect(pluralRu(n)).toBe("one");
  });

  // Few: 2-4, 22-24, 32-34, but NOT 12-14
  it.each([2, 3, 4, 22, 23, 24, 102, 103, 104])("returns 'few' for %i", (n) => {
    expect(pluralRu(n)).toBe("few");
  });

  // Many: 0, 5-20, 25-30, ...
  it.each([0, 5, 6, 7, 10, 11, 12, 13, 14, 15, 20, 25, 100, 111, 112])("returns 'many' for %i", (n) => {
    expect(pluralRu(n)).toBe("many");
  });
});

describe("pluralEn", () => {
  it("returns 'one' for 1", () => {
    expect(pluralEn(1)).toBe("one");
  });

  it.each([0, 2, 3, 100])("returns 'many' for %i", (n) => {
    expect(pluralEn(n)).toBe("many");
  });
});
