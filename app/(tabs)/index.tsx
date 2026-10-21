import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import {
  findTagForSerial,
  formatNfcSerial,
  getConfiguredTags,
  parseNfcConfig,
  type ConfiguredNfcTag,
  type NfcAction,
  type NfcConfig,
} from "@/lib/nfc/tag-routing";
import { apiCall } from "@/lib/_core/api";
import {
  getConfiguredApiHost,
  loadConfiguredApiHost,
  saveConfiguredApiHost,
} from "@/lib/api-host";

type ScannerState =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "matched"; tag: ConfiguredNfcTag }
  | { kind: "unknown"; serial: string }
  | { kind: "unsupported" }
  | { kind: "disabled" }
  | { kind: "native-build-required" }
  | { kind: "permission" }
  | { kind: "open-error"; tag: ConfiguredNfcTag }
  | { kind: "error" };

const COLORS = {
  paper: "#F3F5F1",
  ink: "#14231F",
  inkSoft: "#223530",
  lime: "#C9F27A",
  text: "#182722",
  muted: "#73817B",
  line: "#E1E7DF",
  white: "#FFFFFF",
  warning: "#A65E22",
  warningBg: "#FFF1DF",
  success: "#1C6B4A",
  successBg: "#E4F5E9",
};

const scanCopy: Record<ScannerState["kind"], { title: string; body: string }> =
  {
    idle: {
      title: "Ready when you are",
      body: "Tap below, then hold your phone close to one of the linked tags.",
    },
    scanning: {
      title: "Looking for your tag…",
      body: "Hold the top of your phone near the NFC tag until it is recognized.",
    },
    matched: {
      title: "Tag recognized",
      body: "The configured actions are running.",
    },
    unknown: {
      title: "Tag not linked",
      body: "This serial does not match either portfolio in this app.",
    },
    unsupported: {
      title: "NFC isn’t available",
      body: "Use an NFC-capable phone to scan a portfolio tag.",
    },
    disabled: {
      title: "Turn on NFC",
      body: "NFC is switched off. Enable it in your phone settings and try again.",
    },
    "native-build-required": {
      title: "A native build is needed",
      body: "Expo Go can preview the interface, but it does not include this NFC module. Install an NFC-enabled development build to scan tags.",
    },
    permission: {
      title: "NFC permission needed",
      body: "Allow NFC access in your device settings, then try scanning again.",
    },
    "open-error": {
      title: "Couldn’t open the configured action",
      body: "The tag matched, but this device could not open one of its configured targets.",
    },
    error: {
      title: "Scan didn’t finish",
      body: "Keep the tag still near the top of your phone and try once more.",
    },
  };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  return String(error).toLowerCase();
}

function isPermissionError(error: unknown): boolean {
  return /permission|denied|authorization|authorised|unauthorized/.test(
    errorMessage(error),
  );
}

function isMissingNativeModule(error: unknown): boolean {
  return /native module|nfcmanager|turbo.?module|not registered|could not be found|cannot find native/.test(
    errorMessage(error),
  );
}

export default function HomeScreen() {
  const [scannerState, setScannerState] = useState<ScannerState>({
    kind: "idle",
  });
  const [nfcConfig, setNfcConfig] = useState<NfcConfig>({});
  const [configStatus, setConfigStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [hostDraft, setHostDraft] = useState("");
  const [hostSaving, setHostSaving] = useState(false);
  const [hostMessage, setHostMessage] = useState("");
  const [expandedTagSerial, setExpandedTagSerial] = useState<string | null>(
    null,
  );
  const scanLock = useRef(false);

  const refreshConfig = async () => {
    setConfigStatus("loading");
    try {
      const response = await apiCall<unknown>("/api/nfc-config", {
        credentials: "omit",
      });
      setNfcConfig(parseNfcConfig(response));
      setConfigStatus("ready");
    } catch {
      setConfigStatus("error");
    }
  };

  useEffect(() => {
    let active = true;
    loadConfiguredApiHost()
      .then((host) => {
        if (active) {
          setHostDraft(host);
          return refreshConfig();
        }
      })
      .catch(() => {
        if (active) setConfigStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const applyHost = async () => {
    setHostSaving(true);
    setHostMessage("");
    try {
      await saveConfiguredApiHost(hostDraft);
      setHostDraft(getConfiguredApiHost());
      setHostMessage("Host saved. Checking backend…");
      try {
        const response = await apiCall<unknown>("/api/nfc-config", {
          credentials: "omit",
        });
        setNfcConfig(parseNfcConfig(response));
        setConfigStatus("ready");
        setHostMessage("Host saved and backend connected.");
      } catch {
        setConfigStatus("error");
        setHostMessage("Host saved, but the backend could not be reached.");
      }
    } catch (error) {
      setHostMessage(
        error instanceof Error ? error.message : "Could not save host URL.",
      );
    } finally {
      setHostSaving(false);
    }
  };

  const scanForPortfolio = async () => {
    if (scanLock.current) return;
    scanLock.current = true;
    setScannerState({ kind: "scanning" });

    let nfcManager:
      | (typeof import("react-native-nfc-manager"))["default"]
      | undefined;
    let requestAttempted = false;
    let nextState: ScannerState | undefined;
    let matchedTag: ConfiguredNfcTag | undefined;
    let matchedActions: NfcAction[] | undefined;

    try {
      if (Platform.OS === "web") {
        nextState = { kind: "native-build-required" };
      } else {
        const nfcModule = await import("react-native-nfc-manager");
        nfcManager = nfcModule.default;

        const supported = await nfcManager.isSupported(nfcModule.NfcTech.Ndef);
        if (!supported) {
          nextState = { kind: "unsupported" };
        } else {
          await nfcManager.start();
          const enabled = await nfcManager.isEnabled();
          if (!enabled) {
            nextState = { kind: "disabled" };
          } else {
            requestAttempted = true;
            await nfcManager.requestTechnology(nfcModule.NfcTech.Ndef);
            const tag = await nfcManager.getTag();
            const configuredTag = findTagForSerial(nfcConfig, tag?.id);

            if (configuredTag?.actions.length) {
              matchedTag = configuredTag;
              matchedActions = configuredTag.actions;
              nextState = { kind: "matched", tag: configuredTag };
            } else {
              nextState = {
                kind: "unknown",
                serial: formatNfcSerial(tag?.id),
              };
            }
          }
        }
      }
    } catch (error) {
      if (isPermissionError(error)) {
        nextState = { kind: "permission" };
      } else if (Platform.OS !== "web" && isMissingNativeModule(error)) {
        nextState = { kind: "native-build-required" };
      } else {
        nextState = { kind: "error" };
      }
    } finally {
      if (nfcManager && requestAttempted) {
        try {
          await nfcManager.cancelTechnologyRequest();
        } catch {
          // A completed or cancelled reader session may already be closed.
        }
      }
      scanLock.current = false;
    }

    if (nextState) setScannerState(nextState);
    if (matchedTag && matchedActions) {
      try {
        for (const action of matchedActions) {
          if (action.actionType === "open_url") {
            await Linking.openURL(action.val);
          } else {
            const appSchemes: Record<string, string> = {
              youtube: "youtube://",
            };
            await Linking.openURL(
              appSchemes[action.val.trim().toLowerCase()] ?? action.val,
            );
          }
        }
      } catch {
        setScannerState({ kind: "open-error", tag: matchedTag });
      }
    }
  };

  const configuredTags = getConfiguredTags(nfcConfig);
  const copy = scanCopy[scannerState.kind];
  const isScanning = scannerState.kind === "scanning";
  const isFeedback = scannerState.kind !== "idle";
  const feedbackTone =
    scannerState.kind === "matched"
      ? "success"
      : scannerState.kind === "scanning"
        ? "neutral"
        : "warning";

  return (
    <ScreenContainer
      edges={["top", "left", "right", "bottom"]}
      containerClassName="bg-[#F3F5F1]"
      safeAreaClassName="bg-[#F3F5F1]"
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topline}>
          <View style={styles.brandMark}>
            <Ionicons name="radio-outline" size={19} color={COLORS.lime} />
          </View>
          <Text style={styles.brandName}>PORTFOLIO PASS</Text>
          <View style={styles.readyPill}>
            <View style={styles.readyDot} />
            <Text style={styles.readyLabel}>
              {configStatus === "loading"
                ? "LOADING"
                : `${configuredTags.length} TAGS`}
            </Text>
          </View>
        </View>

        <View style={styles.intro}>
          <Text style={styles.kicker}>NFC LINK READER</Text>
          <Text style={styles.headline}>{"Tap in.\nGo anywhere."}</Text>
          <Text style={styles.introCopy}>
            Scan one of your portfolio tags. The matching page opens
            automatically.
          </Text>
        </View>

        <View style={styles.scanCard}>
          <View style={styles.cardTopline}>
            <Text style={styles.cardEyebrow}>CONTACTLESS ACCESS</Text>
            <Ionicons name="arrow-up-right-box" size={19} color={COLORS.lime} />
          </View>
          <View style={styles.signalStage}>
            <View style={styles.signalOuter}>
              <View style={styles.signalInner}>
                <Ionicons
                  name={isScanning ? "radio" : "wifi"}
                  size={31}
                  color={COLORS.lime}
                />
              </View>
            </View>
            <View style={styles.signalPulse} />
          </View>
          <Text style={styles.cardTitle}>Your work, one tap away.</Text>
          <Text style={styles.cardCopy}>
            {isScanning
              ? "Hold the top of your phone close to the tag."
              : "Ready to find the right portfolio and open it for you."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isScanning ? "Scanning for NFC tag" : "Scan an NFC tag"
            }
            disabled={isScanning || configStatus !== "ready"}
            onPress={scanForPortfolio}
            style={({ pressed }) => [
              styles.scanButton,
              pressed && !isScanning && configStatus === "ready"
                ? styles.scanButtonPressed
                : undefined,
              isScanning || configStatus !== "ready"
                ? styles.scanButtonBusy
                : undefined,
            ]}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={COLORS.ink} />
            ) : (
              <Ionicons name="scan-outline" size={20} color={COLORS.ink} />
            )}
            <Text style={styles.scanButtonText}>
              {isScanning
                ? "Scanning…"
                : configStatus === "loading"
                  ? "Loading tags…"
                  : "Scan a tag"}
            </Text>
            {!isScanning && (
              <Ionicons name="arrow-forward" size={18} color={COLORS.ink} />
            )}
          </Pressable>
        </View>

        {isFeedback && (
          <View
            accessibilityLiveRegion="polite"
            style={[
              styles.feedback,
              feedbackTone === "success" ? styles.feedbackSuccess : undefined,
              feedbackTone === "warning" ? styles.feedbackWarning : undefined,
            ]}
          >
            <View style={styles.feedbackIcon}>
              <Ionicons
                name={
                  feedbackTone === "success"
                    ? "checkmark-circle-outline"
                    : scannerState.kind === "scanning"
                      ? "radio-outline"
                      : "information-circle-outline"
                }
                size={21}
                color={
                  feedbackTone === "success"
                    ? COLORS.success
                    : feedbackTone === "warning"
                      ? COLORS.warning
                      : COLORS.inkSoft
                }
              />
            </View>
            <View style={styles.feedbackTextWrap}>
              <Text style={styles.feedbackTitle}>{copy.title}</Text>
              <Text style={styles.feedbackCopy}>{copy.body}</Text>
              {scannerState.kind === "unknown" && (
                <Text style={styles.serialValue}>{scannerState.serial}</Text>
              )}
              {scannerState.kind === "matched" && (
                <Text style={styles.serialValue}>{scannerState.tag.name}</Text>
              )}
            </View>
          </View>
        )}

        <View style={styles.hostCard}>
          <Text style={styles.sectionKicker}>BACKEND CONNECTION</Text>
          <Text style={styles.hostTitle}>Host URL</Text>
          <Text style={styles.hostHint}>
            Set the backend address the app should fetch tag actions from.
          </Text>
          <TextInput
            accessibilityLabel="Backend host URL"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setHostDraft}
            placeholder="http://192.168.1.10:3002"
            placeholderTextColor={COLORS.muted}
            value={hostDraft}
            style={styles.hostInput}
          />
          <Pressable
            accessibilityRole="button"
            disabled={hostSaving}
            onPress={applyHost}
            style={({ pressed }) => [
              styles.hostButton,
              pressed && !hostSaving ? styles.scanButtonPressed : undefined,
            ]}
          >
            {hostSaving ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.hostButtonText}>Save and connect</Text>
            )}
          </Pressable>
          {!!hostMessage && (
            <Text style={styles.hostMessage}>{hostMessage}</Text>
          )}
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionKicker}>YOUR TAGS</Text>
            <Text style={styles.sectionTitle}>
              {configStatus === "error"
                ? "Configuration unavailable"
                : "Tap a tag to view its setup"}
            </Text>
          </View>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {String(configuredTags.length).padStart(2, "0")}
            </Text>
          </View>
        </View>

        <View style={styles.destinationList}>
          {configuredTags.map((tag, index) => {
            const isExpanded = expandedTagSerial === tag.normalizedSerial;
            return (
              <View key={tag.normalizedSerial}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${tag.name}, ${isExpanded ? "hide" : "show"} tag details`}
                  accessibilityState={{ expanded: isExpanded }}
                  onPress={() =>
                    setExpandedTagSerial(
                      isExpanded ? null : tag.normalizedSerial,
                    )
                  }
                  style={({ pressed }) => [
                    styles.destinationRow,
                    pressed ? styles.tagRowPressed : undefined,
                  ]}
                >
                  <View style={styles.destinationIndex}>
                    <Text style={styles.destinationIndexText}>
                      {String(index + 1).padStart(2, "0")}
                    </Text>
                  </View>
                  <View style={styles.destinationDetails}>
                    <Text style={styles.destinationName}>{tag.name}</Text>
                  </View>
                  <Ionicons
                    name={isExpanded ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={COLORS.muted}
                  />
                </Pressable>
                {isExpanded && (
                  <View style={styles.tagExpansion}>
                    <Text style={styles.detailLabel}>SERIAL NUMBER</Text>
                    <Text style={styles.destinationSerial} selectable>
                      {tag.serial}
                    </Text>
                    <Text style={[styles.detailLabel, styles.actionsLabel]}>
                      ACTIONS
                    </Text>
                    {tag.actions.map((action, actionIndex) => (
                      <View
                        key={`${tag.normalizedSerial}-${actionIndex}`}
                        style={styles.actionRow}
                      >
                        <Text style={styles.actionType}>
                          {action.actionType === "open_url"
                            ? "Open URL"
                            : "Open application"}
                        </Text>
                        <Text style={styles.actionValue} selectable>
                          {action.val}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
                {index < configuredTags.length - 1 && (
                  <View style={styles.tagDivider} />
                )}
              </View>
            );
          })}
        </View>

        <View style={styles.noteRow}>
          <Ionicons
            name="phone-portrait-outline"
            size={17}
            color={COLORS.muted}
          />
          <Text style={styles.noteText}>
            Expo Go previews the interface. NFC scanning needs an NFC-enabled
            native build.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 34,
  },
  topline: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  brandName: {
    marginLeft: 10,
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.35,
  },
  readyPill: {
    marginLeft: "auto",
    height: 26,
    borderRadius: 20,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
    backgroundColor: "#61A76C",
  },
  readyLabel: {
    color: COLORS.text,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  intro: {
    marginTop: 31,
    marginBottom: 22,
  },
  kicker: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  headline: {
    marginTop: 10,
    color: COLORS.text,
    fontSize: 42,
    lineHeight: 45,
    fontWeight: "800",
    letterSpacing: -1.8,
  },
  introCopy: {
    maxWidth: 330,
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  scanCard: {
    overflow: "hidden",
    borderRadius: 28,
    paddingHorizontal: 23,
    paddingTop: 20,
    paddingBottom: 22,
    backgroundColor: COLORS.ink,
  },
  cardTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardEyebrow: {
    color: "#A6B6AE",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.45,
  },
  signalStage: {
    height: 136,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
  },
  signalOuter: {
    width: 102,
    height: 102,
    borderRadius: 51,
    borderWidth: 1,
    borderColor: "rgba(201,242,122,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  signalInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.inkSoft,
  },
  signalPulse: {
    position: "absolute",
    top: 17,
    right: "23%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.lime,
  },
  cardTitle: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.45,
  },
  cardCopy: {
    marginTop: 6,
    marginBottom: 18,
    color: "#A7B6AF",
    fontSize: 13,
    lineHeight: 19,
  },
  scanButton: {
    minHeight: 54,
    borderRadius: 17,
    paddingHorizontal: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.lime,
  },
  scanButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  scanButtonBusy: {
    opacity: 0.92,
  },
  scanButtonText: {
    flex: 1,
    marginLeft: 10,
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  feedback: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 14,
    borderRadius: 18,
    padding: 15,
    backgroundColor: "#E8ECE7",
  },
  feedbackSuccess: {
    backgroundColor: COLORS.successBg,
  },
  feedbackWarning: {
    backgroundColor: COLORS.warningBg,
  },
  feedbackIcon: {
    marginRight: 10,
    paddingTop: 1,
  },
  feedbackTextWrap: {
    flex: 1,
  },
  feedbackTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
  },
  feedbackCopy: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  serialValue: {
    marginTop: 7,
    color: COLORS.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.45,
  },
  hostCard: {
    marginTop: 24,
    padding: 16,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  hostTitle: {
    marginTop: 5,
    color: COLORS.text,
    fontSize: 17,
    fontWeight: "700",
  },
  hostHint: {
    marginTop: 5,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  hostInput: {
    minHeight: 46,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.text,
    fontSize: 13,
  },
  hostButton: {
    minHeight: 44,
    marginTop: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  hostButtonText: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: "700",
  },
  hostMessage: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: 28,
    marginBottom: 12,
  },
  sectionKicker: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.45,
  },
  sectionTitle: {
    marginTop: 5,
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.35,
  },
  countBadge: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
    backgroundColor: "#E5EBDD",
  },
  countText: {
    color: COLORS.inkSoft,
    fontSize: 10,
    fontWeight: "800",
  },
  destinationList: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 20,
    backgroundColor: COLORS.white,
  },
  destinationRow: {
    minHeight: 90,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  destinationIndex: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF3EB",
  },
  destinationIndexText: {
    color: COLORS.inkSoft,
    fontSize: 10,
    fontWeight: "800",
  },
  destinationDetails: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
    marginRight: 8,
  },
  tagRowPressed: {
    backgroundColor: "#F7F9F5",
  },
  tagDivider: {
    height: 1,
    marginLeft: 14,
    backgroundColor: COLORS.line,
  },
  tagExpansion: {
    paddingLeft: 61,
    paddingRight: 16,
    paddingBottom: 16,
  },
  detailLabel: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  actionsLabel: {
    marginTop: 13,
  },
  actionRow: {
    marginTop: 8,
    padding: 10,
    borderRadius: 11,
    backgroundColor: "#F3F5F1",
  },
  actionType: {
    color: COLORS.inkSoft,
    fontSize: 11,
    fontWeight: "700",
  },
  actionValue: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  destinationName: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "700",
  },
  destinationSerial: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.25,
  },
  destinationUrl: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 14,
    flexWrap: "wrap",
  },
  destinationArrow: {
    alignSelf: "flex-start",
    marginTop: 4,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 17,
    paddingHorizontal: 2,
  },
  noteText: {
    flex: 1,
    marginLeft: 8,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 17,
  },
});
