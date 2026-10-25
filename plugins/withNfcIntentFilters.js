const { withAndroidManifest } = require("@expo/config-plugins");

const NFC_ACTIONS = {
  ndef: "android.nfc.action.NDEF_DISCOVERED",
  tech: "android.nfc.action.TECH_DISCOVERED",
  tag: "android.nfc.action.TAG_DISCOVERED",
};
const DISPATCH_ACTIVITY = "expo.modules.nfcbackground.NfcDispatchActivity";

function hasAction(intentFilter, actionName) {
  return intentFilter.action?.some(
    (action) => action.$?.["android:name"] === actionName,
  );
}

function makeFilter(actionName, includeMimeType) {
  const filter = {
    action: [{ $: { "android:name": actionName } }],
    category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }],
  };

  if (includeMimeType) {
    filter.data = [{ $: { "android:mimeType": "*/*" } }];
  }

  return filter;
}

module.exports = function withNfcIntentFilters(config) {
  return withAndroidManifest(config, (configWithManifest) => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const mainActivity = activities.find((activity) =>
      activity.$?.["android:name"]?.endsWith("MainActivity"),
    );

    if (!application || !mainActivity) {
      throw new Error("NFC routing requires an Android MainActivity.");
    }

    // Migrate existing prebuilds as well as clean builds. Launcher/deep-link
    // intents still open React; system NFC intents must never do so.
    mainActivity["intent-filter"] = (mainActivity["intent-filter"] ?? [])
      .map((filter) => ({
        ...filter,
        action: (filter.action ?? []).filter(
          (action) =>
            !Object.values(NFC_ACTIONS).includes(action.$?.["android:name"]),
        ),
      }))
      .filter((filter) => filter.action.length > 0);
    if (mainActivity["meta-data"]) {
      mainActivity["meta-data"] = mainActivity["meta-data"].filter(
        (entry) => entry.$?.["android:name"] !== NFC_ACTIONS.tech,
      );
    }

    let dispatcher = activities.find(
      (activity) => activity.$?.["android:name"] === DISPATCH_ACTIVITY,
    );
    if (!dispatcher) {
      // Theme, task isolation and lifecycle attributes are supplied by the
      // local module's library manifest during Android manifest merging.
      dispatcher = { $: { "android:name": DISPATCH_ACTIVITY } };
      activities.push(dispatcher);
    }
    const intentFilters = dispatcher["intent-filter"] ?? [];
    const requiredFilters = [
      [NFC_ACTIONS.ndef, true],
      [NFC_ACTIONS.tech, false],
      [NFC_ACTIONS.tag, false],
    ];

    for (const [actionName, includeMimeType] of requiredFilters) {
      if (!intentFilters.some((filter) => hasAction(filter, actionName))) {
        intentFilters.push(makeFilter(actionName, includeMimeType));
      }
    }

    dispatcher["intent-filter"] = intentFilters;
    const metadata = (dispatcher["meta-data"] ?? []).filter(
      (entry) => entry.$?.["android:name"] !== NFC_ACTIONS.tech,
    );
    metadata.push({
      $: {
        "android:name": NFC_ACTIONS.tech,
        "android:resource": "@xml/nfc_tech_filter",
      },
    });
    dispatcher["meta-data"] = metadata;
    return configWithManifest;
  });
};
