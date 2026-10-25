import { describe, expect, it } from "vitest";
import {
  configFromDraft,
  draftFingerprint,
  draftFromConfig,
  exportDraftAsJson,
  importDraftFromJson,
  newActionDraft,
  newTagDraft,
} from "../lib/nfc/mapping-editor";
import { normalizeNfcSerial, parseNfcConfig } from "../lib/nfc/tag-routing";

const ids = () => {
  let next = 0;
  return () => `draft-${++next}`;
};

describe("editable NFC mapping drafts", () => {
  it.each([
    {
      legacy: "http://laptop.local:3001/open/Visual%20Studio%20Code",
      actionType: "open_application",
      val: "Visual Studio Code",
    },
    {
      legacy:
        "http://laptop.local:3001/open-url?url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2",
      actionType: "open_url",
      val: "https://example.com/?a=1&b=2",
    },
    {
      legacy:
        "http://laptop.local:3001/play?url=https%3A%2F%2Fexample.com%2Fvideo",
      actionType: "open_url",
      val: "https://example.com/video",
    },
  ])(
    "presents known legacy endpoint $legacy as an editable server action",
    ({ legacy, actionType, val }) => {
      const original = parseNfcConfig({
        "AA:BB": {
          name: "Desk",
          actions: [
            {
              actionType: "trigger",
              val: legacy,
              displayName: "Launch",
              icon: "play",
            },
          ],
        },
      });
      const draft = draftFromConfig(original, ids());
      expect(original["AA:BB"].actions[0]).toMatchObject({
        actionType: "trigger",
        val: legacy,
      });
      expect(draft[0].actions[0]).toMatchObject({
        target: "server",
        serverBaseUrl: "http://laptop.local:3001",
        actionType,
        val,
        displayName: "Launch",
        extra: { icon: "play" },
      });
      const exported = JSON.parse(exportDraftAsJson(draft));
      expect(exported["AA:BB"].actions[0]).toEqual({
        target: "server",
        serverBaseUrl: "http://laptop.local:3001",
        actionType,
        val,
        displayName: "Launch",
        icon: "play",
      });
      expect(
        configFromDraft(importDraftFromJson(JSON.stringify(exported), ids())),
      ).toEqual(exported);
    },
  );

  it.each([
    "http://laptop.local:3001/custom",
    "http://laptop.local:3001/open/Notes?mode=quiet",
    "http://laptop.local:3001/open/Notes/extra",
    "http://user:pass@laptop.local:3001/open/Notes",
    "http://laptop.local:3001/open/Notes#fragment",
    "http://laptop.local:3001/open/%E0%A4%A",
    "http://laptop.local:3001/open-url?url=https://example.com&mode=quiet",
    "http://laptop.local:3001/open-url?url=https://one.example&url=https://two.example",
    "http://laptop.local:3001/play?url=spotify://track/abc",
  ])("preserves unrecognized or ambiguous legacy endpoint %s", (val) => {
    const original = parseNfcConfig({
      "AA:BB": { name: "Desk", actions: [{ actionType: "trigger", val }] },
    });
    const draft = draftFromConfig(original, ids());
    expect(draft[0].actions[0]).toMatchObject({
      target: "client",
      actionType: "trigger",
      val: original["AA:BB"].actions[0].val,
    });
    expect(configFromDraft(draft)).toEqual(original);
  });

  it("gives new actions the remembered server without changing legacy client output", () => {
    const action = newActionDraft("action-1", "http://remembered.local:3001");
    expect(action).toMatchObject({
      target: "client",
      serverBaseUrl: "http://remembered.local:3001",
    });
    expect(newActionDraft("action-2").serverBaseUrl).toBe(
      "http://nfc-lappy.local:3001",
    );
    const tags = [
      {
        ...newTagDraft("tag-1"),
        serial: "AA:BB",
        name: "Desk",
        actions: [{ ...action, val: "https://example.com" }],
      },
    ];
    expect(JSON.parse(exportDraftAsJson(tags))["AA:BB"].actions).toEqual([
      { actionType: "open_url", val: "https://example.com" },
    ]);
  });

  it("roundtrips server fields and tracks target or server edits", () => {
    const original = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        actions: [
          {
            target: "server",
            serverBaseUrl: "http://desktop.local:3001",
            actionType: "open_application",
            val: "Visual Studio Code",
            icon: "code",
          },
        ],
      },
    });
    const draft = draftFromConfig(original, ids());
    expect(draft[0].actions[0]).toMatchObject({
      target: "server",
      serverBaseUrl: "http://desktop.local:3001",
      extra: { icon: "code" },
    });
    expect(configFromDraft(draft)).toEqual(original);
    for (const change of [
      { target: "client" as const },
      { serverBaseUrl: "http://laptop.local:3001" },
    ]) {
      const updated = [
        { ...draft[0], actions: [{ ...draft[0].actions[0], ...change }] },
      ];
      expect(draftFingerprint(updated)).not.toBe(draftFingerprint(draft));
    }
    const client = [
      {
        ...draft[0],
        actions: [{ ...draft[0].actions[0], target: "client" as const }],
      },
    ];
    expect(JSON.parse(exportDraftAsJson(client))["AA:BB"].actions[0]).toEqual({
      actionType: "open_application",
      val: "Visual Studio Code",
      icon: "code",
    });
  });

  it("imports a full mapping document with its extra tag and action fields", () => {
    const imported = importDraftFromJson(
      JSON.stringify({
        "AA:BB": {
          name: "Desk",
          color: "sage",
          actions: [
            {
              actionType: "trigger",
              val: "http://192.168.0.105:3001/custom/Whatsapp",
              displayName: "Whatsapp",
              retry: { attempts: 2 },
            },
          ],
        },
      }),
      ids(),
    );

    expect(imported).toMatchObject([
      {
        serial: "AA:BB",
        name: "Desk",
        extra: { color: "sage" },
        actions: [
          {
            actionType: "trigger",
            val: "http://192.168.0.105:3001/custom/Whatsapp",
            displayName: "Whatsapp",
            extra: { retry: { attempts: 2 } },
          },
        ],
      },
    ]);
  });

  it("rejects imported JSON whose serials are malformed or duplicate after normalization", () => {
    expect(() =>
      importDraftFromJson(
        JSON.stringify({ "not-a-serial": { name: "Desk", actions: [] } }),
        ids(),
      ),
    ).toThrow(/serial/i);
    expect(() =>
      importDraftFromJson(
        JSON.stringify({
          "aa-bb": { name: "One", actions: [] },
          "AA:BB": { name: "Two", actions: [] },
        }),
        ids(),
      ),
    ).toThrow(/duplicates another tag/i);
  });

  it("rejects a prototype-like serial instead of silently importing an empty mapping", () => {
    expect(() =>
      importDraftFromJson(
        '{"__proto__":{"name":"Hidden tag","actions":[]}}',
        ids(),
      ),
    ).toThrow(/serial/i);
  });

  it("exports current unsaved draft edits as a complete pretty JSON mapping", () => {
    const draft = draftFromConfig(
      parseNfcConfig({
        "AA:BB": {
          name: "Desk",
          color: "sage",
          actions: [{ actionType: "open_url", val: "https://old.example" }],
        },
      }),
      ids(),
    );
    const changed = [
      {
        ...draft[0],
        name: "Office",
        actions: [
          {
            ...draft[0].actions[0],
            val: "https://new.example",
            displayName: "Portfolio",
          },
        ],
      },
    ];

    const json = exportDraftAsJson(changed);

    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json)).toEqual({
      "AA:BB": {
        color: "sage",
        name: "Office",
        actions: [
          {
            actionType: "open_url",
            val: "https://new.example",
            displayName: "Portfolio",
          },
        ],
      },
    });
    expect(json).toContain('  "AA:BB": {');
  });

  it("refuses to export an incomplete draft", () => {
    expect(() => exportDraftAsJson([newTagDraft("tag-1")])).toThrow(/serial/i);
  });

  it("roundtrips edits, additions, removals, action order, and unknown fields", () => {
    const source = parseNfcConfig({
      "AA:BB": {
        name: "Desk",
        color: "sage",
        actions: [
          { actionType: "open_url", val: "https://example.com", icon: "globe" },
          { actionType: "open_application", val: "Youtube" },
          {
            actionType: "trigger",
            val: "https://example.com/custom/WhatsApp",
            displayName: "WhatsApp",
            retry: { attempts: 2 },
          },
        ],
      },
      "CC:DD": {
        name: "Remove me",
        actions: [{ actionType: "open_url", val: "https://old.example" }],
      },
    });
    const drafts = draftFromConfig(source, ids());

    expect(drafts[0].extra).toEqual({ color: "sage" });
    expect(drafts[0].actions[0].extra).toEqual({ icon: "globe" });
    expect(drafts[0].actions[2].extra).toEqual({ retry: { attempts: 2 } });

    const renamedAndReordered = {
      ...drafts[0],
      name: "Office",
      actions: [
        { ...drafts[0].actions[2], val: "https://example.com/custom/Mail" },
        { ...drafts[0].actions[0], displayName: "Portfolio" },
      ],
    };
    const addedTag = {
      ...newTagDraft("new-tag"),
      serial: "EE-FF",
      name: "Phone stand",
      actions: [
        {
          ...newActionDraft("new-action"),
          actionType: "trigger" as const,
          val: "http://192.168.0.105:3001/open/Whatsapp",
          displayName: "Whatsapp",
        },
      ],
    };

    const saved = configFromDraft([renamedAndReordered, addedTag]);
    expect(JSON.parse(JSON.stringify(saved))).toEqual({
      "AA:BB": {
        name: "Office",
        color: "sage",
        actions: [
          {
            actionType: "trigger",
            val: "https://example.com/custom/Mail",
            displayName: "WhatsApp",
            retry: { attempts: 2 },
          },
          {
            actionType: "open_url",
            val: "https://example.com",
            displayName: "Portfolio",
            icon: "globe",
          },
        ],
      },
      "EE-FF": {
        name: "Phone stand",
        actions: [
          {
            actionType: "trigger",
            val: "http://192.168.0.105:3001/open/Whatsapp",
            displayName: "Whatsapp",
          },
        ],
      },
    });
    expect(Object.keys(saved)).toEqual(["AA:BB", "EE-FF"]);
  });

  it("allows a new tag without actions and trims its fields", () => {
    const saved = configFromDraft([
      {
        ...newTagDraft("tag-1"),
        serial: "  aA - bb : CC dd  ",
        name: "  Spare  ",
      },
    ]);

    expect(Object.keys(saved)).toEqual(["aA - bb : CC dd"]);
    expect(normalizeNfcSerial(Object.keys(saved)[0])).toBe("AABBCCDD");
    expect(saved["aA - bb : CC dd"]).toEqual({ name: "Spare", actions: [] });
  });

  it("rejects serials that are not nonempty, even-length hexadecimal bytes", () => {
    for (const serial of ["", "--", "A", "ABC", "AA:BG", "AA/BB", "0xAA"]) {
      expect(() =>
        configFromDraft([{ ...newTagDraft("tag-1"), serial, name: "Desk" }]),
      ).toThrow(/serial/i);
    }
  });

  it("rejects serials that normalize to the same tag", () => {
    expect(() =>
      configFromDraft([
        { ...newTagDraft("tag-1"), serial: "aa-bb", name: "First" },
        { ...newTagDraft("tag-2"), serial: "AA:BB", name: "Second" },
      ]),
    ).toThrow(/serial/i);
  });

  it("rejects blank names and action values before saving", () => {
    expect(() =>
      configFromDraft([
        { ...newTagDraft("tag-1"), serial: "AA:BB", name: " " },
      ]),
    ).toThrow(/name/i);

    expect(() =>
      configFromDraft([
        {
          ...newTagDraft("tag-1"),
          serial: "AA:BB",
          name: "Desk",
          actions: [{ ...newActionDraft("action-1"), val: "  " }],
        },
      ]),
    ).toThrow(/action/i);
  });

  it("normalizes trigger URLs and rejects unsupported trigger targets", () => {
    const action = {
      ...newActionDraft("action-1"),
      actionType: "trigger" as const,
      val: " https://bücher.example/open/hello world ",
    };
    const tag = {
      ...newTagDraft("tag-1"),
      serial: "AA:BB",
      name: "Desk",
      actions: [action],
    };

    expect(configFromDraft([tag])["AA:BB"].actions[0].val).toBe(
      "https://xn--bcher-kva.example/open/hello%20world",
    );
    expect(() =>
      configFromDraft([
        { ...tag, actions: [{ ...action, val: "whatsapp://send" }] },
      ]),
    ).toThrow(/HTTP or HTTPS URL/i);
  });

  it("tracks content changes without depending on UI-only draft ids", () => {
    const initial = draftFromConfig(
      parseNfcConfig({
        "AA:BB": {
          name: "Desk",
          actions: [
            {
              actionType: "open_url",
              val: "https://example.com",
              displayName: "Site",
            },
          ],
        },
      }),
      ids(),
    );
    const newIds = initial.map((tag) => ({
      ...tag,
      id: "replacement-tag",
      actions: tag.actions.map((action) => ({
        ...action,
        id: "replacement-action",
      })),
    }));

    expect(draftFingerprint(newIds)).toBe(draftFingerprint(initial));
    expect(
      draftFingerprint([
        {
          ...initial[0],
          actions: [
            { ...initial[0].actions[0], val: "https://changed.example" },
          ],
        },
      ]),
    ).not.toBe(draftFingerprint(initial));
  });
});
