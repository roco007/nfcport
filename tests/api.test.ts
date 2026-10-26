import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "../lib/_core/api";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@/constants/oauth", () => ({ getApiBaseUrl: () => "" }));
vi.mock("@/lib/api-host", () => ({
  getConfiguredApiHost: () => "https://backend.example.test",
}));
vi.mock("../lib/_core/auth", () => ({ getSessionToken: async () => null }));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("API request failure logging", () => {
  it.each([undefined, new Error("Superseded request")])(
    "keeps cancellation rejection without logging an error (reason: %s)",
    async (reason) => {
      const controller = new AbortController();
      vi.stubGlobal(
        "fetch",
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      );

      const result = apiCall("/api/server-mappings", {
        signal: controller.signal,
      });
      controller.abort(reason);

      await expect(result).rejects.toBe(controller.signal.reason);
      expect(console.error).not.toHaveBeenCalled();
    },
  );

  it("does not require fetch's AbortError to be the signal's reason object", async () => {
    const controller = new AbortController();
    controller.abort();
    const failure = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });

    await expect(
      apiCall("/api/server-mappings", { signal: controller.signal }),
    ).rejects.toBe(failure);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "still logs a network failure when signal.aborted is %s",
    async (abort) => {
      const controller = new AbortController();
      const failure = new TypeError("Network request failed");
      vi.stubGlobal("fetch", async () => {
        if (abort) controller.abort();
        throw failure;
      });

      await expect(
        apiCall("/api/server-mappings", { signal: controller.signal }),
      ).rejects.toBe(failure);
      expect(console.error).toHaveBeenCalledWith("[API] Request failed");
    },
  );

  it("still logs an HTTP failure when the signal also aborts", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async () => {
      controller.abort();
      return new Response(JSON.stringify({ error: "Unavailable" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    });

    await expect(
      apiCall("/api/server-mappings", { signal: controller.signal }),
    ).rejects.toMatchObject({ status: 503, message: "Unavailable" });
    expect(console.error).toHaveBeenCalledWith("[API] Request failed");
  });

  it("logs an AbortError when this request's signal was not aborted", async () => {
    const failure = new DOMException("Unrelated abort", "AbortError");
    vi.stubGlobal("fetch", async () => {
      throw failure;
    });

    await expect(
      apiCall("/api/server-mappings", { signal: new AbortController().signal }),
    ).rejects.toBe(failure);
    expect(console.error).toHaveBeenCalledWith("[API] Request failed");
  });
});
