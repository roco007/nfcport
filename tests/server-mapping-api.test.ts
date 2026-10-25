import { beforeEach, describe, expect, it, vi } from "vitest";

const apiCall = vi.hoisted(() => vi.fn());
vi.mock("../lib/_core/api", () => ({ apiCall }));

import {
  fetchServerMappings,
  saveServerMapping,
} from "../lib/nfc/server-mapping-api";
import { ApiError } from "../lib/_core/api-error";

const adminKey = "test-only-admin-api-key-at-least-32-chars";

beforeEach(() => {
  apiCall.mockReset();
});

describe("server mapping API", () => {
  it("explains a missing backend route instead of suggesting an empty catalog", async () => {
    apiCall.mockRejectedValue(new ApiError("Not found", 404));
    await expect(fetchServerMappings()).rejects.toThrow(
      /updated.*backend|update.*backend/i,
    );
  });

  it("parses the server list and forwards cancellation without app credentials", async () => {
    const controller = new AbortController();
    apiCall.mockResolvedValue({
      servers: [
        { id: 3, serverName: " RC's Mac ", ipAddress: " 192.168.0.105 " },
        { id: 8, serverName: "Office", ipAddress: "2001:db8::8" },
      ],
    });

    await expect(fetchServerMappings(controller.signal)).resolves.toEqual([
      { id: 3, serverName: "RC's Mac", ipAddress: "192.168.0.105" },
      { id: 8, serverName: "Office", ipAddress: "2001:db8::8" },
    ]);
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("/api/server-mappings", {
      credentials: "omit",
      signal: controller.signal,
    });
  });

  it("accepts an empty database result", async () => {
    apiCall.mockResolvedValue({ servers: [] });

    await expect(fetchServerMappings()).resolves.toEqual([]);
  });

  it.each([
    {},
    { servers: null },
    { servers: [{ id: 0, serverName: "Mac", ipAddress: "192.168.0.105" }] },
  ])(
    "rejects malformed list responses instead of inventing an empty list",
    async (response) => {
      apiCall.mockResolvedValue(response);

      await expect(fetchServerMappings()).rejects.toThrow(/response.*invalid/i);
    },
  );

  it("adds a normalized server without an update ID and sends only the supplied API key", async () => {
    apiCall.mockResolvedValue({
      server: { id: 23, serverName: "RC's Mac", ipAddress: "192.168.0.105" },
    });

    await expect(
      saveServerMapping(
        { serverName: " RC's Mac ", ipAddress: " 192.168.0.105 " },
        `  ${adminKey}  `,
      ),
    ).resolves.toEqual({
      id: 23,
      serverName: "RC's Mac",
      ipAddress: "192.168.0.105",
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("/api/server-mappings", {
      method: "POST",
      credentials: "omit",
      headers: { "X-API-Key": adminKey },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(apiCall.mock.calls[0][1].body)).toEqual({
      serverName: "RC's Mac",
      ipAddress: "192.168.0.105",
    });
  });

  it("retains the selected database ID when updating an address", async () => {
    apiCall.mockResolvedValue({
      server: { id: 23, serverName: "Office Mac", ipAddress: "2001:db8::23" },
    });

    await expect(
      saveServerMapping(
        { id: 23, serverName: " Office Mac ", ipAddress: " 2001:db8::23 " },
        adminKey,
      ),
    ).resolves.toEqual({
      id: 23,
      serverName: "Office Mac",
      ipAddress: "2001:db8::23",
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall).toHaveBeenCalledWith("/api/server-mappings", {
      method: "POST",
      credentials: "omit",
      headers: { "X-API-Key": adminKey },
      body: expect.any(String),
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(apiCall.mock.calls[0][1].body)).toEqual({
      id: 23,
      serverName: "Office Mac",
      ipAddress: "2001:db8::23",
    });
  });

  it.each(["", " \t\n "])(
    "does not send a write without a usable API key",
    async (apiKey) => {
      await expect(
        saveServerMapping(
          { serverName: "Mac", ipAddress: "192.168.0.105" },
          apiKey,
        ),
      ).rejects.toThrow(/API key/i);
      expect(apiCall).not.toHaveBeenCalled();
    },
  );

  it.each([
    { serverName: " ", ipAddress: "192.168.0.105" },
    { serverName: "Mac", ipAddress: "http://192.168.0.105:3001" },
    { id: 0, serverName: "Mac", ipAddress: "192.168.0.105" },
  ])("rejects invalid mapping input before any write", async (input) => {
    await expect(saveServerMapping(input, adminKey)).rejects.toThrow();
    expect(apiCall).not.toHaveBeenCalled();
  });

  it.each([
    { ok: true },
    { server: null },
    { server: { serverName: "Mac", ipAddress: "192.168.0.105" } },
    { server: { id: 23, serverName: "Mac", ipAddress: "not-an-ip" } },
  ])(
    "does not report a save when the backend response is malformed",
    async (response) => {
      apiCall.mockResolvedValue(response);

      await expect(
        saveServerMapping(
          { serverName: "Mac", ipAddress: "192.168.0.105" },
          adminKey,
        ),
      ).rejects.toThrow(/saved server response.*invalid.*refresh/i);
      expect(apiCall).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves a list failure instead of treating an unavailable backend as empty", async () => {
    const unavailable = new Error("The backend is unavailable.");
    apiCall.mockRejectedValue(unavailable);

    await expect(fetchServerMappings()).rejects.toBe(unavailable);
  });

  it("preserves backend authorization errors instead of reporting a successful save", async () => {
    const unauthorized = new Error("A valid API key is required.");
    apiCall.mockRejectedValue(unauthorized);

    await expect(
      saveServerMapping(
        { serverName: "Mac", ipAddress: "192.168.0.105" },
        "incorrect-key",
      ),
    ).rejects.toBe(unauthorized);
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled save and tells the caller to check the saved state before retrying", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    apiCall.mockImplementation(
      (_endpoint: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal ?? undefined;
          requestSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    try {
      const result = saveServerMapping(
        { serverName: "Mac", ipAddress: "192.168.0.105" },
        adminKey,
      ).catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(15_000);

      expect(requestSignal?.aborted).toBe(true);
      await expect(result).resolves.toMatchObject({
        message: expect.stringMatching(/timed out.*refresh.*retry/i),
      });
      expect(apiCall).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
