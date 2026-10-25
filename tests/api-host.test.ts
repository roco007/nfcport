import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  storedHost: null as string | null,
  cachedActions: "saved actions" as string | null,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => state.storedHost,
    setItem: async (_key: string, value: string) => {
      state.storedHost = value;
    },
    removeItem: async () => {
      state.storedHost = null;
    },
  },
}));
vi.mock("@/constants/oauth", () => ({
  API_BASE_URL: "https://default.example",
  getApiBaseUrl: () => "https://default.example",
}));
vi.mock("../lib/nfc/background-routing", () => ({
  clearBackgroundNfcConfig: () => {
    state.cachedActions = null;
  },
}));

import {
  getConfiguredApiHost,
  loadConfiguredApiHost,
  saveConfiguredApiHost,
} from "../lib/api-host";

beforeEach(async () => {
  state.storedHost = "https://original.example";
  state.cachedActions = "saved actions";
  await loadConfiguredApiHost();
});

describe("backend host changes and saved NFC actions", () => {
  it.each(["abc", "ftp://example.com"])(
    "rejects %s without losing working saved actions",
    async (host) => {
      await expect(saveConfiguredApiHost(host)).rejects.toThrow();
      expect(state.cachedActions).toBe("saved actions");
      expect(state.storedHost).toBe("https://original.example");
      expect(getConfiguredApiHost()).toBe("https://original.example");
    },
  );

  it("invalidates previous actions when switching backend", async () => {
    await saveConfiguredApiHost(" https://new.example/ ");
    expect(state.cachedActions).toBeNull();
    expect(state.storedHost).toBe("https://new.example");
    expect(getConfiguredApiHost()).toBe("https://new.example");
  });

  it("preserves saved actions when saving the same normalized host", async () => {
    await saveConfiguredApiHost(" https://original.example/ ");
    expect(state.cachedActions).toBe("saved actions");
  });

  it("invalidates previous actions when returning to the default backend", async () => {
    await saveConfiguredApiHost("");
    expect(state.cachedActions).toBeNull();
    expect(getConfiguredApiHost()).toBe("https://default.example");
  });
});
