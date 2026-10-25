import { describe, expect, it } from "vitest";
import {
  findTagForSerial,
  formatNfcSerial,
  getConfiguredTags,
  isServerAction,
  normalizeServerBaseUrl,
  normalizeNfcSerial,
  parseNfcConfig,
  parseNfcConfigJson,
  serverActionUrl,
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

describe("client and server action mappings", () => {
  it.each([
    ["unlock", "unlock", "http://nfc-lappy.local:3001/unlock"],
    [" /unlock/ ", "unlock", "http://nfc-lappy.local:3001/unlock"],
    [
      " /system/lock screen/ ",
      "system/lock screen",
      "http://nfc-lappy.local:3001/system/lock%20screen",
    ],
  ])("normalizes and routes server command %s", (val, savedValue, endpoint) => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        actions: [
          {
            target: "server",
            serverBaseUrl: " HTTP://NFC-LAPPY.local:3001/// ",
            actionType: "command",
            val,
          },
        ],
      },
    });
    expect(parsed["AA:BB"].actions[0]).toMatchObject({
      target: "server",
      actionType: "command",
      serverBaseUrl: "http://nfc-lappy.local:3001",
      val: savedValue,
    });
    expect(serverActionUrl(parsed["AA:BB"].actions[0])).toBe(endpoint);
  });

  it("appends a command to the configured server base path", () => {
    expect(
      serverActionUrl({
        target: "server",
        serverBaseUrl: " https://host/launcher/// ",
        actionType: "command",
        val: " /unlock/ ",
      }),
    ).toBe("https://host/launcher/unlock");
  });

  it.each([
    "",
    " / ",
    "https://other.example/unlock",
    "https:unlock",
    "unlock?force=true",
    "unlock#fragment",
    "power\\unlock",
    ".",
    "../unlock",
    "power/./unlock",
    "power/../unlock",
    "power//unlock",
    "%2e%2e/unlock",
    "lock%20screen",
    "un\nlock",
  ])("rejects ambiguous command path %j before saving or executing", (val) => {
    const action = {
      target: "server" as const,
      serverBaseUrl: "http://nfc-lappy.local:3001",
      actionType: "command" as const,
      val,
    };
    expect(() =>
      parseNfcConfig({ "AA:BB": { name: "Desk", actions: [action] } }),
    ).toThrow();
    expect(() => serverActionUrl(action)).toThrow(/command/i);
  });

  it.each([undefined, "client"])(
    "rejects a command without a server target (%s)",
    (target) => {
      expect(() =>
        parseNfcConfig({
          "AA:BB": {
            name: "Desk",
            actions: [{ actionType: "command", val: "unlock", target }],
          },
        }),
      ).toThrow(/server/i);
    },
  );

  it("normalizes server mappings while retaining plain app and URL values", () => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        actions: [
          {
            target: "server",
            serverBaseUrl: " HTTP://NFC-LAPPY.local:3001/ ",
            actionType: "open_application",
            val: " Visual Studio Code ",
            color: "blue",
          },
          {
            target: "server",
            serverBaseUrl: "http://nfc-lappy.local:3001",
            actionType: "open_url",
            val: " https://example.com/hello world?q=a&b=c ",
          },
        ],
      },
    });
    expect(parsed["AA:BB"].actions).toEqual([
      {
        target: "server",
        serverBaseUrl: "http://nfc-lappy.local:3001",
        actionType: "open_application",
        val: "Visual Studio Code",
        color: "blue",
      },
      {
        target: "server",
        serverBaseUrl: "http://nfc-lappy.local:3001",
        actionType: "open_url",
        val: "https://example.com/hello%20world?q=a&b=c",
      },
    ]);
    expect(serverActionUrl(parsed["AA:BB"].actions[0])).toBe(
      "http://nfc-lappy.local:3001/open/Visual%20Studio%20Code",
    );
    expect(serverActionUrl(parsed["AA:BB"].actions[1])).toBe(
      "http://nfc-lappy.local:3001/open-url?url=https%3A%2F%2Fexample.com%2Fhello%2520world%3Fq%3Da%26b%3Dc",
    );
  });

  it("keeps client serialization compatible and removes stale server settings", () => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        actions: [
          {
            target: "client",
            serverBaseUrl: "http://old.local:3001",
            actionType: "open_application",
            val: "whatsapp://send",
          },
          {
            serverBaseUrl: "http://old.local:3001",
            actionType: "open_url",
            val: "https://example.com",
          },
        ],
      },
    });
    expect(JSON.parse(JSON.stringify(parsed))["AA:BB"].actions).toEqual([
      { actionType: "open_application", val: "whatsapp://send" },
      { actionType: "open_url", val: "https://example.com" },
    ]);
    expect(isServerAction(parsed["AA:BB"].actions[0])).toBe(false);
    expect(() => serverActionUrl(parsed["AA:BB"].actions[0])).toThrow(
      /server/i,
    );
  });

  it.each([
    "",
    "nfc-lappy.local:3001",
    "ftp://host",
    "https://user:password@host",
    "https://host/?q=1",
    "https://host/#fragment",
    "https://host/?",
    "https://host/#",
  ])("rejects invalid server base %s", (value) => {
    expect(() => normalizeServerBaseUrl(value)).toThrow(/server/i);
  });

  it("joins a normalized server base path and encodes app names as one path segment", () => {
    const action = {
      target: "server" as const,
      serverBaseUrl: " https://host/launcher/// ",
      actionType: "open_application" as const,
      val: " App/One & Two ",
    };
    expect(isServerAction(action)).toBe(true);
    expect(serverActionUrl(action)).toBe(
      "https://host/launcher/open/App%2FOne%20%26%20Two",
    );
  });

  it.each([
    { target: "other", actionType: "open_url", val: "https://example.com" },
    { target: "server", actionType: "open_application", val: "Notes" },
    {
      target: "server",
      serverBaseUrl: "http://host:3001",
      actionType: "open_url",
      val: "javascript:alert(1)",
    },
    {
      target: "server",
      serverBaseUrl: "http://host:3001",
      actionType: "trigger",
      val: "https://example.com",
    },
  ])("rejects malformed or ambiguous server action %#", (action) => {
    expect(() =>
      parseNfcConfig({ "AA:BB": { name: "Desk", actions: [action] } }),
    ).toThrow();
  });
});

describe("NFC named tag configuration", () => {
  it("accepts a trigger URL and its display name in editable mappings", () => {
    const action = {
      val: "http://192.168.0.105:3001/open/Whatsapp",
      actionType: "trigger",
      displayName: "Whatsapp",
    };
    const parsed = parseNfcConfigJson(
      JSON.stringify({ "AA:BB": { name: "Desk", actions: [action] } }),
    );
    expect(parsed["AA:BB"].actions).toEqual([action]);
  });

  it.each(["whatsapp://send", "file:///tmp/action", "not a URL", "http://"])(
    "rejects non-HTTP trigger target %s",
    (val) => {
      expect(() =>
        parseNfcConfig({
          "AA:BB": { name: "Desk", actions: [{ actionType: "trigger", val }] },
        }),
      ).toThrow();
    },
  );

  it("normalizes trigger URLs before saving them for native Android dispatch", () => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        actions: [
          {
            actionType: "trigger",
            val: " https://bücher.example/open/hello world ",
          },
        ],
      },
    });
    expect(parsed["AA:BB"].actions[0].val).toBe(
      "https://xn--bcher-kva.example/open/hello%20world",
    );
  });

  it("keeps unknown tag and action fields through parsing", () => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: " Desk ",
        color: "sage",
        metadata: { owner: "rc007" },
        actions: [
          {
            actionType: "trigger",
            val: " https://example.com/open/hello world ",
            displayName: " Launch ",
            method: "POST",
            headers: { "X-Source": "tag" },
          },
        ],
      },
    });

    expect(JSON.parse(JSON.stringify(parsed))).toEqual({
      "AA:BB": {
        name: "Desk",
        color: "sage",
        metadata: { owner: "rc007" },
        actions: [
          {
            actionType: "trigger",
            val: "https://example.com/open/hello%20world",
            displayName: "Launch",
            method: "POST",
            headers: { "X-Source": "tag" },
          },
        ],
      },
    });
  });

  it("uses the mapping key for scan serials even when tag metadata has serial fields", () => {
    const parsed = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        serial: "FF:EE",
        normalizedSerial: "FFEE",
        actions: [],
      },
    });

    expect(findTagForSerial(parsed, "AA-BB")).toMatchObject({
      serial: "AA:BB",
      normalizedSerial: "AABB",
    });
    expect(getConfiguredTags(parsed)[0]).toMatchObject({
      serial: "AA:BB",
      normalizedSerial: "AABB",
    });
    expect(JSON.parse(JSON.stringify(parsed))["AA:BB"].serial).toBe("FF:EE");
  });

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

  it("parses editable mapping JSON and reports invalid syntax clearly", () => {
    const parsed = parseNfcConfigJson(
      JSON.stringify({
        "AA:BB:CC:DD": {
          name: "Desk tag",
          actions: [{ actionType: "open_application", val: "Youtube" }],
        },
      }),
    );

    expect(parsed["AA:BB:CC:DD"].name).toBe("Desk tag");
    expect(() => parseNfcConfigJson('{"AA:BB"')).toThrow(
      "Mapping JSON is invalid. Check the commas, quotes, and brackets.",
    );
  });

  it("normalizes serials and formats unknown tags for feedback", () => {
    expect(normalizeNfcSerial("1d-80-36-ba-1a-10-80")).toBe("1D8036BA1A1080");
    expect(findTagForSerial(config, "AA:BB:CC:DD")).toBeUndefined();
    expect(findTagForSerial(config, undefined)).toBeUndefined();
    expect(formatNfcSerial("aa-bb-cc-dd")).toBe("AA:BB:CC:DD");
    expect(formatNfcSerial(null)).toBe("Serial unavailable");
  });
});
