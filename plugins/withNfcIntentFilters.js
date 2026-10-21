const { withAndroidManifest } = require("@expo/config-plugins");

const NFC_ACTIONS = {
  ndef: "android.nfc.action.NDEF_DISCOVERED",
  tech: "android.nfc.action.TECH_DISCOVERED",
  tag: "android.nfc.action.TAG_DISCOVERED",
};

function hasAction(intentFilter, actionName) {
  return intentFilter.action?.some(
    (action) => action.$?.["android:name"] === actionName,
  );
}

function makeFilter(actionName, includeMimeType) {
  const filter = {
    $: { "data-nfc-background": "true" },
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

    if (!mainActivity) return configWithManifest;

    const intentFilters = mainActivity["intent-filter"] ?? [];
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

    mainActivity["intent-filter"] = intentFilters;
    return configWithManifest;
  });
};
