import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const withNfcIntentFilters = require("../plugins/withNfcIntentFilters.js");
const nfcActions = [
  "android.nfc.action.NDEF_DISCOVERED",
  "android.nfc.action.TECH_DISCOVERED",
  "android.nfc.action.TAG_DISCOVERED",
];
const dispatcherName = "expo.modules.nfcbackground.NfcDispatchActivity";
const actionFilter = (name: string) => ({
  action: [{ $: { "android:name": name } }],
});

async function applyPlugin(manifest: object) {
  const config = withNfcIntentFilters({ name: "NFC", slug: "nfc" });
  return (
    await config.mods.android.manifest({
      ...config,
      modResults: manifest,
      modRequest: {
        projectRoot: process.cwd(),
        platform: "android",
        modName: "manifest",
      },
    })
  ).modResults;
}

describe("Android NFC entry point", () => {
  it("routes cold NFC scans to the native dispatcher and preserves normal app links", async () => {
    const launcher = actionFilter("android.intent.action.MAIN");
    const deepLink = actionFilter("android.intent.action.VIEW");
    const result = await applyPlugin({
      manifest: {
        application: [
          {
            activity: [
              {
                $: { "android:name": ".MainActivity" },
                "intent-filter": [
                  launcher,
                  deepLink,
                  ...nfcActions.map(actionFilter),
                ],
                "meta-data": [
                  {
                    $: {
                      "android:name": nfcActions[1],
                      "android:resource": "@xml/old_filter",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const activities = result.manifest.application[0].activity;
    expect(activities[0]["intent-filter"]).toEqual([launcher, deepLink]);
    expect(activities[0]["meta-data"]).toEqual([]);
    const dispatcher = activities.find(
      (activity: any) => activity.$["android:name"] === dispatcherName,
    );
    expect(dispatcher).toBeDefined();
    expect(
      dispatcher["intent-filter"].flatMap((filter: any) =>
        filter.action.map((action: any) => action.$["android:name"]),
      ),
    ).toEqual(nfcActions);
    expect(dispatcher["meta-data"]).toContainEqual({
      $: {
        "android:name": nfcActions[1],
        "android:resource": "@xml/nfc_tech_filter",
      },
    });
  });

  it("does not duplicate routing when prebuild runs again", async () => {
    const first = await applyPlugin({
      manifest: {
        application: [
          { activity: [{ $: { "android:name": ".MainActivity" } }] },
        ],
      },
    });
    const second = await applyPlugin(structuredClone(first));
    expect(second).toEqual(first);
    expect(
      second.manifest.application[0].activity.filter(
        (activity: any) => activity.$["android:name"] === dispatcherName,
      ),
    ).toHaveLength(1);
  });
});
