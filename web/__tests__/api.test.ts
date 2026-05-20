/**
 * Tests for web/lib/api.ts — ApiError classification and request helpers.
 *
 * Critical surface: isTrackLimitError / isDailyLimitError. If these break, the
 * UI shows raw error text instead of the upgrade prompt (anon user) or the
 * track-limit modal (logged-in student). This is one of the few places where a
 * silent regression is invisible until a user complains.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  ApiError,
  isDailyLimitError,
  isTrackLimitError,
  login,
  listTracks,
} from "../lib/api";

describe("ApiError", () => {
  it("formats string detail in message", () => {
    const err = new ApiError("upload", 500, "internal server error");
    expect(err.message).toContain("upload");
    expect(err.message).toContain("500");
    expect(err.message).toContain("internal server error");
  });

  it("formats object detail with 'message' field", () => {
    const err = new ApiError("submit", 429, { message: "too many" });
    expect(err.message).toContain("too many");
  });

  it("stringifies unknown detail shape", () => {
    const err = new ApiError("x", 400, { foo: 1 });
    expect(err.message).toContain('"foo":1');
  });
});

describe("isTrackLimitError", () => {
  it("true for 403 with code=track_limit_reached", () => {
    const err = new ApiError("upload", 403, { code: "track_limit_reached", limit: 10 });
    expect(isTrackLimitError(err)).toBe(true);
  });

  it("false for 403 with different code", () => {
    const err = new ApiError("upload", 403, { code: "forbidden" });
    expect(isTrackLimitError(err)).toBe(false);
  });

  it("false for 429 (that's daily limit, not track limit)", () => {
    const err = new ApiError("upload", 429, { code: "track_limit_reached" });
    expect(isTrackLimitError(err)).toBe(false);
  });

  it("false for non-ApiError", () => {
    expect(isTrackLimitError(new Error("oops"))).toBe(false);
    expect(isTrackLimitError("oops")).toBe(false);
    expect(isTrackLimitError(null)).toBe(false);
  });
});

describe("isDailyLimitError", () => {
  it("true for 429 with code=daily_limit_reached", () => {
    const err = new ApiError("upload", 429, { code: "daily_limit_reached", limit: 2 });
    expect(isDailyLimitError(err)).toBe(true);
  });

  it("false for 429 with different code", () => {
    const err = new ApiError("upload", 429, { code: "rate_limited" });
    expect(isDailyLimitError(err)).toBe(false);
  });

  it("false for 403 (track limit, not daily)", () => {
    const err = new ApiError("upload", 403, { code: "daily_limit_reached" });
    expect(isDailyLimitError(err)).toBe(false);
  });
});

describe("login", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /be/auth/login with json body", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: "u1", email: "a@b.com" } }),
    });

    const result = await login("a@b.com", "secret");

    expect(fetch).toHaveBeenCalledWith(
      "/be/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(result.user.email).toBe("a@b.com");
  });

  it("throws on non-ok response", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid credentials",
    });
    await expect(login("a@b.com", "wrong")).rejects.toThrow(/401/);
  });
});

describe("listTracks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests /be/tracks with cache:no-store and credentials", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await listTracks();
    expect(fetch).toHaveBeenCalledWith(
      "/be/tracks",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });
});
