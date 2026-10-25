import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => new Map<string, string>());
const storageBehavior = vi.hoisted(() => ({ delayWrites: false }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => stored.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (storageBehavior.delayWrites)
        await new Promise((resolve) =>
          setTimeout(resolve, value.includes("first") ? 30 : 1),
        );
      stored.set(key, value);
    },
  },
}));

import {
  loadServerBaseUrl,
  saveServerBaseUrl,
} from "../lib/nfc/server-preferences";

beforeEach(() => {
  stored.clear();
  storageBehavior.delayWrites = false;
});

describe("remembered launcher server", () => {
  it("keeps the latest address when several input blurs save concurrently", async () => {
    storageBehavior.delayWrites = true;
    await Promise.all([
      saveServerBaseUrl("http://first.local:3001"),
      saveServerBaseUrl("http://second.local:3001"),
    ]);
    expect(await loadServerBaseUrl()).toBe("http://second.local:3001");
  });

  it("defaults to the laptop address and persists a normalized replacement independently of the API host", async () => {
    stored.set("nfcport_api_host", "https://mapping.example");
    expect(await loadServerBaseUrl()).toBe("http://nfc-lappy.local:3001");
    expect(await saveServerBaseUrl(" HTTP://DESKTOP.local:3001/ ")).toBe(
      "http://desktop.local:3001",
    );
    expect(await loadServerBaseUrl()).toBe("http://desktop.local:3001");
    expect(stored.get("nfcport_api_host")).toBe("https://mapping.example");
    await vi.resetModules();
    const reloaded = await import("../lib/nfc/server-preferences");
    expect(await reloaded.loadServerBaseUrl()).toBe(
      "http://desktop.local:3001",
    );
  });

  it.each([
    "",
    "not a URL",
    "ftp://host",
    "http://user:pass@host",
    "http://host/?query",
    "http://host/#fragment",
  ])("rejects %s without replacing the remembered server", async (value) => {
    await saveServerBaseUrl("http://working.local:3001");
    await expect(saveServerBaseUrl(value)).rejects.toThrow(/server/i);
    expect(await loadServerBaseUrl()).toBe("http://working.local:3001");
  });
});
