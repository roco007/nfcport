import { describe, expect, it } from "vitest";
import {
  findActionsForTag,
  formatNfcSerial,
  getConfiguredDestinations,
  normalizeNfcSerial,
  parseNfcConfig,
} from "../lib/nfc/tag-routing";

describe("NFC configuration and tag routing", () => {
  const config = parseNfcConfig({
    "1D:CF:1B:BA:1A:10:80": [
      { actionType: "open_url", val: "https://my-portfolio-liard-gamma-98.vercel.app/" },
    ],
    "1D:80:36:BA:1A:10:80": [
      { ationType: "open_url", val: "https://roco007.github.io/my-portfolio/" },
      { actionType: "open_application", val: "Youtube" },
    ],
  });

  it("looks up configured tasks after normalizing the scanned serial", () => {
    expect(findActionsForTag(config, "1d-cf-1b-ba-1a-10-80")?.[0].val).toBe(
      "https://my-portfolio-liard-gamma-98.vercel.app/",
    );
    expect(findActionsForTag(config, "1D:80:36:BA:1A:10:80")).toHaveLength(2);
  });

  it("accepts the example payload's `ationType` property", () => {
    expect(config["1D:80:36:BA:1A:10:80"][1]).toEqual({
      actionType: "open_application",
      val: "Youtube",
    });
  });

  it("creates destination display rows from URL actions only", () => {
    expect(getConfiguredDestinations(config)).toHaveLength(2);
    expect(getConfiguredDestinations(config)[0].url).toBe(
      "https://my-portfolio-liard-gamma-98.vercel.app/",
    );
  });

  it("normalizes casing and common separators", () => {
    expect(normalizeNfcSerial("1d-cf-1b-ba-1a-10-80")).toBe("1DCF1BBA1A1080");
  });

  it("does not route unknown serials and rejects invalid configuration", () => {
    expect(findActionsForTag(config, "AA:BB:CC:DD")).toBeUndefined();
    expect(findActionsForTag(config, undefined)).toBeUndefined();
    expect(() => parseNfcConfig({ tag: [{ actionType: "delete", val: "x" }] })).toThrow();
  });

  it("formats an unknown serial for feedback", () => {
    expect(formatNfcSerial("aa-bb-cc-dd")).toBe("AA:BB:CC:DD");
    expect(formatNfcSerial(null)).toBe("Serial unavailable");
  });
});
