/**
 * Tests for slugifyForFile — used to name exported stem files. Bad slug =
 * unreadable downloads ("song%20name.wav") or filesystem errors on Windows.
 */
import { describe, expect, it } from "vitest";
import { slugifyForFile } from "../lib/export-stems";

describe("slugifyForFile", () => {
  it("returns 'stems' for empty input", () => {
    expect(slugifyForFile("")).toBe("stems");
    expect(slugifyForFile(null)).toBe("stems");
    expect(slugifyForFile(undefined)).toBe("stems");
  });

  it("lowercases and replaces spaces with dashes", () => {
    expect(slugifyForFile("Hello World")).toBe("hello-world");
  });

  it("preserves Cyrillic", () => {
    expect(slugifyForFile("Привет Мир")).toBe("привет-мир");
  });

  it("strips punctuation", () => {
    expect(slugifyForFile("Song! (Live)")).toBe("song-live");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugifyForFile("---Song---")).toBe("song");
  });

  it("truncates at 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugifyForFile(long).length).toBeLessThanOrEqual(60);
  });

  it("returns 'stems' when input slugifies to empty", () => {
    expect(slugifyForFile("!!!")).toBe("stems");
    expect(slugifyForFile("   ")).toBe("stems");
  });
});
