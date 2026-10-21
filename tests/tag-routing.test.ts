import { describe, expect, it } from "vitest";
import {
  findTagForSerial,
  formatNfcSerial,
  getConfiguredTags,
  normalizeNfcSerial,
  parseNfcConfig,
} from "../lib/nfc/tag-routing";

const config = parseNfcConfig({
  "1D:CF:1B:BA:1A:10:80": {
    name: "TagT0",
    actions: [
      {
        actionType: "open_url",
        val: "https://my-portfolio-liard-gamma-98.vercel.app/",
      },
    ],
  },
  "1D:80:36:BA:1A:10:80": {
    name: "TagT1",
    actions: [
      {
        actionType: "open_url",
        val: "https://roco007.github.io/my-portfolio/",
      },
      { actionType: "open_application", val: "Youtube" },
    ],
  },
});

describe("NFC named tag configuration", () => {
  it("preserves tag names and configured actions", () => {
    expect(config["1D:CF:1B:BA:1A:10:80"].name).toBe("TagT0");
    expect(config["1D:80:36:BA:1A:10:80"].actions[1]).toEqual({
      actionType: "open_application",
      val: "Youtube",
    });
  });

  it("finds a tag after normalizing the scanned serial", () => {
    const tag = findTagForSerial(config, "1d-80-36-ba-1a-10-80");
    expect(tag?.name).toBe("TagT1");
    expect(tag?.serial).toBe("1D:80:36:BA:1A:10:80");
    expect(tag?.actions).toHaveLength(2);
  });

  it("returns every configured tag for the collapsed tag-name list", () => {
    expect(getConfiguredTags(config).map((tag) => tag.name)).toEqual([
      "TagT0",
      "TagT1",
    ]);
  });

  it("accepts the earlier serial-to-array response for compatibility", () => {
    const legacy = parseNfcConfig({
      "AA:BB": [{ actionType: "open_url", val: "https://example.com" }],
    });
    expect(legacy["AA:BB"].actions[0].val).toBe("https://example.com");
  });

  it("rejects invalid tag names and action types", () => {
    expect(() => parseNfcConfig({ tag: { name: "", actions: [] } })).toThrow();
    expect(() =>
      parseNfcConfig({
        tag: { name: "Tag", actions: [{ actionType: "delete", val: "x" }] },
      }),
    ).toThrow();
  });

  it("normalizes serials and formats unknown tags for feedback", () => {
    expect(normalizeNfcSerial("1d-80-36-ba-1a-10-80")).toBe("1D8036BA1A1080");
    expect(findTagForSerial(config, "AA:BB:CC:DD")).toBeUndefined();
    expect(findTagForSerial(config, undefined)).toBeUndefined();
    expect(formatNfcSerial("aa-bb-cc-dd")).toBe("AA:BB:CC:DD");
    expect(formatNfcSerial(null)).toBe("Serial unavailable");
  });
});
