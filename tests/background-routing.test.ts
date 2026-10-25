import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  os: "android",
  cached: "",
  native: null as null | {
    saveConfig: (json: string) => boolean;
    clearConfig: () => boolean;
    openApplication?: (name: string) => boolean;
  },
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => state.native }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return state.os;
    },
  },
}));

import {
  openClientApplication,
  saveBackgroundNfcConfig,
} from "../lib/nfc/background-routing";
import { parseNfcConfig } from "../lib/nfc/tag-routing";

beforeEach(() => {
  state.os = "android";
  state.cached = "";
  state.native = {
    saveConfig: (json) => {
      state.cached = json;
      return true;
    },
    clearConfig: () => true,
  };
});

describe("native action cache", () => {
  it("lowers only server actions into HTTP triggers without changing saved mappings", () => {
    const config = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        color: "sage",
        actions: [
          {
            target: "server",
            serverBaseUrl: "http://laptop.local:3001",
            actionType: "open_application",
            val: "Visual Studio Code",
            displayName: "Editor",
            icon: "code",
          },
          {
            target: "server",
            serverBaseUrl: "http://laptop.local:3001",
            actionType: "open_url",
            val: "https://example.com/?a=1&b=2",
          },
          { actionType: "open_application", val: "WhatsApp" },
          { actionType: "trigger", val: "http://laptop.local:3001/custom" },
        ],
      },
    });
    const original = JSON.stringify(config);
    expect(saveBackgroundNfcConfig(config)).toBe(true);
    expect(JSON.parse(state.cached)).toEqual({
      "AA:BB": {
        name: "Desk",
        color: "sage",
        actions: [
          {
            actionType: "trigger",
            val: "http://laptop.local:3001/open/Visual%20Studio%20Code",
            displayName: "Editor",
            icon: "code",
          },
          {
            actionType: "trigger",
            val: "http://laptop.local:3001/open-url?url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2",
          },
          { actionType: "open_application", val: "WhatsApp" },
          { actionType: "trigger", val: "http://laptop.local:3001/custom" },
        ],
      },
    });
    expect(JSON.stringify(config)).toBe(original);
  });

  it("does not replace working cache when a server destination is invalid", () => {
    state.cached = "working cache";
    expect(() =>
      saveBackgroundNfcConfig({
        "AA:BB": {
          name: "Desk",
          actions: [
            {
              target: "server",
              serverBaseUrl: "http://laptop.local:3001",
              actionType: "open_url",
              val: "file:///tmp/local",
            },
          ],
        },
      }),
    ).toThrow(/HTTP/i);
    expect(state.cached).toBe("working cache");
  });
});

describe("native client application bridge", () => {
  it("returns unavailable for an older native build, Expo Go, and other platforms", async () => {
    expect(await openClientApplication("Notes")).toBe(false);
    state.native = null;
    expect(await openClientApplication("Notes")).toBe(false);
    state.os = "web";
    expect(await openClientApplication("Notes")).toBe(false);
  });

  it("sends a trimmed app name to native code and propagates a descriptive failure", async () => {
    let launched = "";
    state.native!.openApplication = (name) => {
      launched = name;
      return true;
    };
    expect(await openClientApplication(" Notes ")).toBe(true);
    expect(launched).toBe("Notes");
    state.native!.openApplication = () => {
      throw new Error("No installed application named Missing was found.");
    };
    await expect(openClientApplication("Missing")).rejects.toThrow(
      /No installed application/,
    );
  });
});
