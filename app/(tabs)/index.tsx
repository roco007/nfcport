import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { NfcActionEditor } from "@/components/nfc-action-editor";
import { ServerMappingManager } from "@/components/server-mapping-manager";
import { useServerMappings } from "@/hooks/use-server-mappings";
import type {
  ServerMapping,
  ServerMappingInput,
} from "@/lib/nfc/server-mappings";
import {
  findTagForSerial,
  formatNfcSerial,
  getConfiguredTags,
  parseNfcConfig,
  type ConfiguredNfcTag,
  type NfcAction,
  isServerAction,
  normalizeServerBaseUrl,
  type NfcConfig,
} from "@/lib/nfc/tag-routing";
import {
  configFromDraft,
  draftFingerprint,
  draftFromConfig,
  exportDraftAsJson,
  importDraftFromJson,
  newActionDraft,
  newTagDraft,
  type TagDraft,
} from "@/lib/nfc/mapping-editor";
import {
  exportMappingJsonFile,
  pickMappingJsonFile,
} from "@/lib/nfc/mapping-file-io";
import { apiCall } from "@/lib/_core/api";
import { saveBackgroundNfcConfig } from "@/lib/nfc/background-routing";
import { executeNfcAction } from "@/lib/nfc/action-execution";
import {
  DEFAULT_SERVER_BASE_URL,
  loadServerBaseUrl,
  saveServerBaseUrl,
} from "@/lib/nfc/server-preferences";
import {
  getConfiguredApiHost,
  loadConfiguredApiHost,
  saveConfiguredApiHost,
} from "@/lib/api-host";
import type { TagEvent } from "react-native-nfc-manager";

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

type MappingMessage = {
  kind: "success" | "error";
  text: string;
};

type ActionRouteStatus = {
  kind: "running" | "success" | "error";
  text: string;
};

type MappingView = "cards" | "editor";

const NFC_CONFIG_USER_NAME = "rc007";
const NFC_CONFIG_ENDPOINT = `/api/nfc-config?userName=${encodeURIComponent(NFC_CONFIG_USER_NAME)}`;
const ACTION_PRESENTATION = {
  open_url: { icon: "globe-outline", label: "Open URL" },
  open_application: { icon: "apps-outline", label: "Open application" },
  command: { icon: "terminal-outline", label: "Command" },
  trigger: { icon: "flash-outline", label: "Trigger URL" },
} as const;

const COLORS = {
  paper: "#F4F2EA",
  surface: "#FFFEFB",
  ink: "#10271F",
  inkSoft: "#1D3A30",
  lime: "#C8F26E",
  limeSoft: "#EDF8D9",
  text: "#152720",
  muted: "#596861",
  line: "#DCE3DA",
  white: "#FFFFFF",
  warning: "#874316",
  warningBg: "#FFF0E2",
  success: "#17633F",
  successBg: "#DEF4E6",
  blue: "#DAE8FF",
  blueInk: "#315888",
  coral: "#FF7A59",
};

const scanCopy: Record<ScannerState["kind"], { title: string; body: string }> =
  {
    idle: {
      title: "Ready when you are",
      body: "The NFC scanner starts automatically. Hold your phone close to a linked tag.",
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
      title: "Couldn’t complete the configured action",
      body: "The tag matched, but one of its actions failed. Check the target and your connection, then try again.",
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
  const { width: windowWidth } = useWindowDimensions();
  const [scannerState, setScannerState] = useState<ScannerState>({
    kind: "idle",
  });
  const [nfcConfig, setNfcConfig] = useState<NfcConfig>({});
  const [closedAppScanStatus, setClosedAppScanStatus] = useState<
    "pending" | "saved" | "unavailable" | "error"
  >("pending");
  const [configStatus, setConfigStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [mappingLoaded, setMappingLoaded] = useState(false);
  const [hostDraft, setHostDraft] = useState("");
  const [serverCatalogHost, setServerCatalogHost] = useState<string | null>(
    null,
  );
  const [adminApiKey, setAdminApiKey] = useState("");
  const serverCatalog = useServerMappings(serverCatalogHost, adminApiKey);
  const [serverManagerVisible, setServerManagerVisible] = useState(false);
  const serverSelection = useRef<((server: ServerMapping) => void) | undefined>(
    undefined,
  );

  const openServerManager = (onSelected?: (server: ServerMapping) => void) => {
    serverSelection.current = onSelected;
    serverCatalog.clearSaveError();
    setServerManagerVisible(true);
    void serverCatalog.refresh();
  };

  const closeServerManager = () => {
    if (serverCatalog.saving) return;
    serverSelection.current = undefined;
    setServerManagerVisible(false);
  };

  const saveServerData = async (input: ServerMappingInput) => {
    const server = await serverCatalog.save(input);
    if (serverSelection.current) {
      serverSelection.current(server);
      serverSelection.current = undefined;
      setServerManagerVisible(false);
    }
    return server;
  };
  const [rememberedServerBaseUrl, setRememberedServerBaseUrl] = useState(
    DEFAULT_SERVER_BASE_URL,
  );
  const serverPreferenceVersion = useRef(0);

  useEffect(() => {
    let active = true;
    const version = serverPreferenceVersion.current;
    void loadServerBaseUrl()
      .then((value) => {
        if (active && version === serverPreferenceVersion.current)
          setRememberedServerBaseUrl(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const rememberServerBaseUrl = useCallback(async (value: string) => {
    const normalized = normalizeServerBaseUrl(value);
    serverPreferenceVersion.current += 1;
    // New actions use the latest valid edit even while storage is busy.
    setRememberedServerBaseUrl(normalized);
    await saveServerBaseUrl(normalized);
  }, []);
  const [hostSaving, setHostSaving] = useState(false);
  const [hostMessage, setHostMessage] = useState("");
  const [mappingDraft, setMappingDraft] = useState<TagDraft[]>([]);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingMessage, setMappingMessage] = useState<MappingMessage | null>(
    null,
  );
  const [mappingFileMessage, setMappingFileMessage] =
    useState<MappingMessage | null>(null);
  const [mappingFileBusy, setMappingFileBusy] = useState(false);
  const [actionRouteStatuses, setActionRouteStatuses] = useState<
    Record<string, ActionRouteStatus>
  >({});
  const [pendingMappingImport, setPendingMappingImport] = useState<{
    name: string;
    draft: TagDraft[];
    baseValue: string;
  } | null>(null);
  const [mappingConflict, setMappingConflict] = useState(false);
  const [mappingHasUnsavedChanges, setMappingHasUnsavedChanges] =
    useState(false);
  const [expandedTagSerial, setExpandedTagSerial] = useState<string | null>(
    null,
  );
  const [expandedEditTagId, setExpandedEditTagId] = useState<string | null>(
    null,
  );
  const [mappingView, setMappingView] = useState<MappingView>("cards");
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const scanLock = useRef(false);
  const configRefreshInFlight = useRef(false);
  const configMutationVersion = useRef(0);
  const mappingDirty = useRef(false);
  const mappingBaseValue = useRef("");
  const mappingBaseFingerprint = useRef("");
  const mappingDraftRef = useRef<TagDraft[]>([]);
  const nextDraftId = useRef(0);
  const mappingRemoteChanged = useRef(false);
  const mappingWriteInFlight = useRef(false);
  const mappingFileInFlight = useRef(false);
  const actionRoutesInFlight = useRef(new Set<string>());
  const backgroundManager = useRef<
    (typeof import("react-native-nfc-manager"))["default"] | undefined
  >(undefined);
  const backgroundRegistration = useRef(false);

  const cacheAcceptedConfig = useCallback((config: NfcConfig) => {
    if (Platform.OS !== "android") return;
    try {
      setClosedAppScanStatus(
        saveBackgroundNfcConfig(config) ? "saved" : "unavailable",
      );
    } catch {
      setClosedAppScanStatus("error");
    }
  }, []);

  const makeDraftId = useCallback(() => {
    nextDraftId.current += 1;
    return `mapping-${nextDraftId.current}`;
  }, []);

  const updateMappingDraft = useCallback(
    (update: (current: TagDraft[]) => TagDraft[]) => {
      if (!mappingLoaded || mappingWriteInFlight.current) return;
      const next = update(mappingDraftRef.current);
      mappingDraftRef.current = next;
      const hasChanges =
        draftFingerprint(next) !== mappingBaseFingerprint.current;
      mappingDirty.current = hasChanges;
      setMappingHasUnsavedChanges(hasChanges);
      setMappingDraft(next);
      setMappingMessage(null);
      setMappingFileMessage(null);
    },
    [mappingLoaded],
  );

  const applyConfigResponse = useCallback(
    (response: unknown) => {
      const parsed = parseNfcConfig(response);
      cacheAcceptedConfig(parsed);
      setNfcConfig(parsed);
      setMappingLoaded(true);
      const formattedMapping = JSON.stringify(parsed, null, 2);
      if (mappingDirty.current) {
        const remoteChanged = mappingBaseValue.current !== formattedMapping;
        mappingRemoteChanged.current = remoteChanged;
        setMappingConflict(remoteChanged);
        if (remoteChanged) setMappingMessage(null);
        return parsed;
      }

      const previousBase = mappingBaseValue.current;
      mappingBaseValue.current = formattedMapping;
      mappingRemoteChanged.current = false;
      setMappingConflict(false);
      if (previousBase !== formattedMapping) {
        const next = draftFromConfig(parsed, makeDraftId);
        mappingBaseFingerprint.current = draftFingerprint(next);
        mappingDraftRef.current = next;
        setMappingDraft(next);
        setExpandedEditTagId(next[0]?.id ?? null);
      }
      return parsed;
    },
    [cacheAcceptedConfig, makeDraftId],
  );

  const refreshConfig = useCallback(
    async (showLoading = false) => {
      if (configRefreshInFlight.current || mappingWriteInFlight.current) return;
      configRefreshInFlight.current = true;
      const mutationVersion = configMutationVersion.current;
      if (showLoading) setConfigStatus("loading");
      try {
        const response = await apiCall<unknown>(NFC_CONFIG_ENDPOINT, {
          credentials: "omit",
        });
        if (mutationVersion !== configMutationVersion.current) return;
        applyConfigResponse(response);
        setConfigStatus("ready");
      } catch {
        if (mutationVersion === configMutationVersion.current) {
          setConfigStatus("error");
        }
      } finally {
        configRefreshInFlight.current = false;
      }
    },
    [applyConfigResponse],
  );

  useEffect(() => {
    let active = true;
    let refreshInterval: ReturnType<typeof setInterval> | undefined;

    const initializeConfigRefresh = async () => {
      try {
        const host = await loadConfiguredApiHost();
        if (!active) return;

        setHostDraft(host);
        setServerCatalogHost(host);
        await refreshConfig(true);
        if (active) {
          refreshInterval = setInterval(() => {
            void refreshConfig();
          }, 5000);
        }
      } catch {
        if (active) setConfigStatus("error");
      }
    };

    void initializeConfigRefresh();

    return () => {
      active = false;
      if (refreshInterval) clearInterval(refreshInterval);
    };
  }, [refreshConfig]);

  const applyHost = async () => {
    if (serverCatalog.saving) return;
    const nextHost = hostDraft.trim().replace(/\/+$/, "");
    if (mappingDirty.current && nextHost !== getConfiguredApiHost()) {
      setHostMessage(
        "Reload or update the mapping before switching backend hosts.",
      );
      return;
    }

    setHostSaving(true);
    setHostMessage("");
    configMutationVersion.current += 1;
    try {
      const previousHost = getConfiguredApiHost();
      await saveConfiguredApiHost(hostDraft);
      if (getConfiguredApiHost() !== previousHost) {
        setAdminApiKey("");
        setServerManagerVisible(false);
        serverSelection.current = undefined;
        setClosedAppScanStatus("pending");
        setNfcConfig({});
        setMappingLoaded(false);
        mappingDirty.current = false;
        mappingBaseValue.current = "";
        mappingBaseFingerprint.current = draftFingerprint([]);
        mappingDraftRef.current = [];
        mappingRemoteChanged.current = false;
        setMappingDraft([]);
        setMappingHasUnsavedChanges(false);
        setMappingConflict(false);
        setMappingMessage(null);
        setMappingFileMessage(null);
        setPendingMappingImport(null);
        setExpandedEditTagId(null);
        setExpandedTagSerial(null);
        setConfigStatus("loading");
      }
      setHostDraft(getConfiguredApiHost());
      setServerCatalogHost(getConfiguredApiHost());
      if (getConfiguredApiHost() === previousHost) void serverCatalog.refresh();
      setHostMessage("Host saved. Checking backend…");
      try {
        const response = await apiCall<unknown>(NFC_CONFIG_ENDPOINT, {
          credentials: "omit",
        });
        applyConfigResponse(response);
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

  const reloadMapping = async () => {
    if (mappingWriteInFlight.current || hostSaving) return;
    const next = draftFromConfig(nfcConfig, makeDraftId);
    mappingDirty.current = false;
    mappingBaseValue.current = JSON.stringify(nfcConfig, null, 2);
    mappingBaseFingerprint.current = draftFingerprint(next);
    mappingDraftRef.current = next;
    mappingRemoteChanged.current = false;
    setMappingConflict(false);
    setMappingHasUnsavedChanges(false);
    setMappingMessage(null);
    setMappingFileMessage(null);
    setPendingMappingImport(null);
    setMappingDraft(next);
    setExpandedEditTagId(next[0]?.id ?? null);
    await refreshConfig(true);
  };

  const saveMapping = async () => {
    if (mappingWriteInFlight.current || !mappingLoaded) return;

    setMappingMessage(null);
    setMappingFileMessage(null);
    if (mappingRemoteChanged.current) {
      setMappingMessage({
        kind: "error",
        text: "The backend mapping changed while you were editing. Reload it before saving.",
      });
      return;
    }

    let parsed: NfcConfig;
    try {
      parsed = configFromDraft(mappingDraftRef.current);
    } catch (error) {
      setMappingMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The mapping could not be validated.",
      });
      return;
    }

    mappingWriteInFlight.current = true;
    configMutationVersion.current += 1;
    setMappingSaving(true);
    try {
      const result = await apiCall<{ ok: boolean; userName: string }>(
        NFC_CONFIG_ENDPOINT,
        {
          method: "POST",
          credentials: "omit",
          headers: adminApiKey.trim()
            ? { "X-API-Key": adminApiKey.trim() }
            : {},
          body: JSON.stringify(parsed),
        },
      );
      cacheAcceptedConfig(parsed);
      const formattedMapping = JSON.stringify(parsed, null, 2);
      const next = draftFromConfig(parsed, makeDraftId);
      mappingDirty.current = false;
      mappingBaseValue.current = formattedMapping;
      mappingBaseFingerprint.current = draftFingerprint(next);
      mappingDraftRef.current = next;
      mappingRemoteChanged.current = false;
      setMappingConflict(false);
      setMappingHasUnsavedChanges(false);
      setMappingDraft(next);
      setExpandedEditTagId(next[0]?.id ?? null);
      setNfcConfig(parsed);
      setConfigStatus("ready");
      setMappingMessage({
        kind: "success",
        text: `Mapping updated for ${result.userName || NFC_CONFIG_USER_NAME}.`,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The mapping could not be updated.";
      setMappingMessage({
        kind: "error",
        text: /valid api key is required/i.test(message)
          ? "Enter a valid Admin API key in Connection settings, then save again. Your edits remain in this draft."
          : message,
      });
    } finally {
      mappingWriteInFlight.current = false;
      setMappingSaving(false);
    }
  };

  const importMappingJson = async () => {
    if (
      mappingFileInFlight.current ||
      mappingWriteInFlight.current ||
      hostSaving ||
      !mappingLoaded
    ) {
      return;
    }

    mappingFileInFlight.current = true;
    const baseValue = mappingBaseValue.current;
    setMappingFileBusy(true);
    setMappingFileMessage(null);
    setPendingMappingImport(null);
    try {
      const selected = await pickMappingJsonFile();
      if (!selected) return;
      const draft = importDraftFromJson(selected.contents, makeDraftId);
      setPendingMappingImport({ name: selected.name, draft, baseValue });
    } catch (error) {
      setPendingMappingImport(null);
      setMappingFileMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The JSON file could not be imported.",
      });
    } finally {
      mappingFileInFlight.current = false;
      setMappingFileBusy(false);
    }
  };

  const confirmMappingImport = () => {
    if (!pendingMappingImport || mappingWriteInFlight.current || hostSaving) {
      return;
    }
    if (
      mappingRemoteChanged.current ||
      pendingMappingImport.baseValue !== mappingBaseValue.current
    ) {
      setPendingMappingImport(null);
      setMappingFileMessage({
        kind: "error",
        text: "The backend mapping changed while you were importing. Select the JSON file again after reviewing the latest tags.",
      });
      return;
    }
    const { name, draft } = pendingMappingImport;
    const hasChanges =
      draftFingerprint(draft) !== mappingBaseFingerprint.current;
    updateMappingDraft(() => draft);
    setExpandedEditTagId(draft[0]?.id ?? null);
    setPendingMappingImport(null);
    setMappingFileMessage({
      kind: "success",
      text: hasChanges
        ? `Loaded ${draft.length} ${draft.length === 1 ? "tag" : "tags"} from ${name} into the draft. Review, then save changes to update the backend.`
        : `Loaded ${name}. Its tags match the backend mapping.`,
    });
  };

  const exportMappingJson = async () => {
    if (
      mappingFileInFlight.current ||
      mappingWriteInFlight.current ||
      hostSaving ||
      !mappingLoaded
    ) {
      return;
    }

    mappingFileInFlight.current = true;
    setMappingFileBusy(true);
    setMappingFileMessage(null);
    try {
      const contents = exportDraftAsJson(mappingDraftRef.current);
      await exportMappingJsonFile(
        contents,
        `nfc-tags-${NFC_CONFIG_USER_NAME}.json`,
      );
      setMappingFileMessage({
        kind: "success",
        text: "JSON prepared from the current editor draft.",
      });
    } catch (error) {
      setMappingFileMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The JSON file could not be exported.",
      });
    } finally {
      mappingFileInFlight.current = false;
      setMappingFileBusy(false);
    }
  };

  const runCardAction = async (action: NfcAction, routeKey: string) => {
    if (actionRoutesInFlight.current.has(routeKey)) return;

    actionRoutesInFlight.current.add(routeKey);
    setActionRouteStatuses((current) => ({
      ...current,
      [routeKey]: { kind: "running", text: "Running action…" },
    }));
    try {
      await executeNfcAction(action);
      setActionRouteStatuses((current) => ({
        ...current,
        [routeKey]: {
          kind: "success",
          text:
            action.actionType === "trigger"
              ? "HTTP request completed."
              : isServerAction(action)
                ? "Server request completed."
                : "Opened on this device.",
        },
      }));
    } catch (error) {
      setActionRouteStatuses((current) => ({
        ...current,
        [routeKey]: {
          kind: "error",
          text:
            error instanceof Error
              ? `Could not run action: ${error.message}`
              : "Could not run this action.",
        },
      }));
    } finally {
      actionRoutesInFlight.current.delete(routeKey);
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
          await executeNfcAction(action);
        }
      } catch {
        setScannerState({ kind: "open-error", tag: matchedTag });
      }
    }
  };

  const handleDetectedTag = useCallback(
    async (tag: TagEvent | null | undefined) => {
      if (scanLock.current) return;
      scanLock.current = true;
      setScannerState({ kind: "scanning" });

      try {
        const configuredTag = findTagForSerial(nfcConfig, tag?.id);
        if (!configuredTag?.actions.length) {
          setScannerState({
            kind: "unknown",
            serial: formatNfcSerial(tag?.id),
          });
          return;
        }

        setScannerState({ kind: "matched", tag: configuredTag });
        for (const action of configuredTag.actions) {
          await executeNfcAction(action);
        }
      } catch {
        const configuredTag = findTagForSerial(nfcConfig, tag?.id);
        if (configuredTag) {
          setScannerState({ kind: "open-error", tag: configuredTag });
        } else {
          setScannerState({ kind: "error" });
        }
      } finally {
        scanLock.current = false;
      }
    },
    [nfcConfig],
  );

  useEffect(() => {
    if (Platform.OS !== "android" || configStatus !== "ready") return;

    let disposed = false;
    let manager:
      | (typeof import("react-native-nfc-manager"))["default"]
      | undefined;

    const handleBackgroundTag = (tag: unknown) => {
      if (!disposed) void handleDetectedTag(tag as TagEvent | null);
    };

    const startAlwaysOnScanner = async () => {
      try {
        const nfcModule = await import("react-native-nfc-manager");
        manager = nfcModule.default;
        if (disposed) return;

        await manager.start();
        const supported = await manager.isSupported(nfcModule.NfcTech.Ndef);
        if (!supported) {
          setScannerState({ kind: "unsupported" });
          return;
        }
        if (!(await manager.isEnabled())) {
          setScannerState({ kind: "disabled" });
          return;
        }

        manager.setEventListener(
          nfcModule.NfcEvents.DiscoverTag,
          handleBackgroundTag,
        );
        manager.setEventListener(
          nfcModule.NfcEvents.DiscoverBackgroundTag,
          handleBackgroundTag,
        );
        await manager.registerTagEvent({
          isReaderModeEnabled: false,
          invalidateAfterFirstRead: false,
        });
        backgroundManager.current = manager;
        backgroundRegistration.current = true;
        setScannerState({ kind: "scanning" });

        // Android may launch the activity with an NFC intent while the app
        // was backgrounded or not running. Read that pending tag after setup.
        const launchTag = await manager.getLaunchTagEvent();
        if (launchTag) handleBackgroundTag(launchTag);
      } catch (error) {
        if (disposed) return;
        if (isPermissionError(error)) {
          setScannerState({ kind: "permission" });
        } else if (isMissingNativeModule(error)) {
          setScannerState({ kind: "native-build-required" });
        } else {
          setScannerState({ kind: "error" });
        }
      }
    };

    void startAlwaysOnScanner();
    return () => {
      disposed = true;
      if (manager) {
        manager.setEventListener("NfcManagerDiscoverTag" as never, null);
        manager.setEventListener(
          "NfcManagerDiscoverBackgroundTag" as never,
          null,
        );
        if (backgroundRegistration.current) {
          void manager.unregisterTagEvent();
        }
      }
      backgroundManager.current = undefined;
      backgroundRegistration.current = false;
    };
  }, [configStatus, handleDetectedTag]);

  const configuredTags = getConfiguredTags(nfcConfig);
  const mappingDraftValidation = useMemo(() => {
    try {
      return { config: configFromDraft(mappingDraft), error: null };
    } catch (error) {
      return {
        config: null,
        error:
          error instanceof Error
            ? error.message
            : "Complete the tag fields before saving.",
      };
    }
  }, [mappingDraft]);
  const mappingDraftConfig = mappingDraftValidation.config;
  const mappingDraftError = mappingDraftValidation.error;
  const mappingPreviewTags =
    mappingHasUnsavedChanges && mappingDraftConfig
      ? getConfiguredTags(mappingDraftConfig)
      : configuredTags;
  const totalActionCount = mappingPreviewTags.reduce(
    (total, tag) => total + tag.actions.length,
    0,
  );
  const mappingDraftIsValid = mappingDraftConfig !== null;
  const mappingFieldsReady = mappingLoaded && mappingDraftIsValid;
  const isWideLayout = windowWidth >= 860;
  const isCompactLayout = windowWidth < 390;
  const isNarrowEditor = windowWidth < 480;
  const displayHost =
    hostDraft
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "") || "Not configured";
  const mappingStatus = mappingSaving
    ? "saving"
    : mappingConflict
      ? "conflict"
      : mappingHasUnsavedChanges && !mappingDraftIsValid
        ? "invalid"
        : mappingHasUnsavedChanges
          ? "unsaved"
          : configStatus === "loading"
            ? "loading"
            : configStatus === "error"
              ? "offline"
              : "synced";
  const mappingStatusLabel =
    mappingStatus === "saving"
      ? "Saving…"
      : mappingStatus === "conflict"
        ? "Remote update"
        : mappingStatus === "invalid"
          ? "Needs attention"
          : mappingStatus === "unsaved"
            ? "Unsaved changes"
            : mappingStatus === "loading"
              ? "Loading"
              : mappingStatus === "offline"
                ? "Offline"
                : "Synced";
  const mappingSaveDisabled =
    mappingSaving ||
    hostSaving ||
    mappingConflict ||
    !mappingLoaded ||
    !mappingDraftIsValid ||
    !mappingHasUnsavedChanges;
  const editorBusy =
    mappingSaving || hostSaving || mappingFileBusy || !mappingLoaded;
  const copy = scanCopy[scannerState.kind];
  const isScanning = scannerState.kind === "scanning";
  const isAlwaysOnAndroid = Platform.OS === "android";
  const isBackgroundListening = isAlwaysOnAndroid && isScanning;
  const isFeedback = scannerState.kind !== "idle" && !isBackgroundListening;
  const feedbackTone =
    scannerState.kind === "matched"
      ? "success"
      : scannerState.kind === "scanning"
        ? "neutral"
        : "warning";

  return (
    <ScreenContainer
      edges={["top", "left", "right", "bottom"]}
      containerClassName="bg-[#F4F2EA]"
      safeAreaClassName="bg-[#F4F2EA]"
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topline}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Ionicons name="radio-outline" size={19} color={COLORS.lime} />
            </View>
            <View>
              <Text style={styles.brandName}>PORTFOLIO PASS</Text>
              <Text style={styles.brandCaption}>NFC CONTROL DESK</Text>
            </View>
          </View>
          <View style={styles.readyPill}>
            {configStatus === "loading" ? (
              <ActivityIndicator size="small" color={COLORS.inkSoft} />
            ) : (
              <View
                style={[
                  styles.readyDot,
                  configStatus === "error" ? styles.readyDotOffline : undefined,
                ]}
              />
            )}
            <Text style={styles.readyLabel}>
              {configStatus === "loading"
                ? "CONNECTING"
                : configStatus === "error"
                  ? "OFFLINE"
                  : "SYSTEM READY"}
            </Text>
          </View>
        </View>

        <View style={[styles.workspace, isWideLayout && styles.workspaceWide]}>
          <View
            style={[styles.scanColumn, isWideLayout && styles.scanColumnWide]}
          >
            <View style={styles.intro}>
              <Text style={styles.kicker}>YOUR NFC WORKSPACE</Text>
              <Text accessibilityRole="header" style={styles.headline}>
                {"Tap. Launch.\nStay in flow."}
              </Text>
              <Text style={styles.introCopy}>
                Scan a tag, preview every action, and keep your destinations in
                sync from one place.
              </Text>
            </View>

            <View style={styles.scanCard}>
              <View style={styles.cardTopline}>
                <Text style={styles.cardEyebrow}>
                  {isBackgroundListening
                    ? "BACKGROUND SCANNER ACTIVE"
                    : "CONTACTLESS ACCESS"}
                </Text>
                <Ionicons
                  name="arrow-up-right-box"
                  size={19}
                  color={COLORS.lime}
                />
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
                {isBackgroundListening
                  ? "Bring a linked tag close to your phone to run its actions."
                  : isScanning
                    ? "Hold the top of your phone close to the tag."
                    : "Ready to find the right portfolio and open it for you."}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  isBackgroundListening
                    ? "NFC scanner active"
                    : isScanning
                      ? "Scanning for NFC tag"
                      : "Scan an NFC tag"
                }
                accessibilityState={{
                  busy: isScanning,
                  disabled: isScanning || configStatus !== "ready",
                }}
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
                {isBackgroundListening ? (
                  <Ionicons name="radio" size={20} color={COLORS.ink} />
                ) : isScanning ? (
                  <ActivityIndicator size="small" color={COLORS.ink} />
                ) : (
                  <Ionicons name="scan-outline" size={20} color={COLORS.ink} />
                )}
                <Text style={styles.scanButtonText}>
                  {isScanning
                    ? isBackgroundListening
                      ? "Listening for NFC tags"
                      : "Scanning…"
                    : configStatus === "loading"
                      ? "Loading tags…"
                      : configStatus === "error"
                        ? "Connection needed"
                        : isAlwaysOnAndroid
                          ? "Scan a tag now"
                          : "Scan a tag"}
                </Text>
                {!isScanning && (
                  <Ionicons name="arrow-forward" size={18} color={COLORS.ink} />
                )}
              </Pressable>
              {Platform.OS === "android" && (
                <Text style={styles.cardCopy} accessibilityLiveRegion="polite">
                  {closedAppScanStatus === "saved"
                    ? "Actions saved on this phone. Scan with the phone unlocked, even after closing this app."
                    : closedAppScanStatus === "unavailable"
                      ? "Install the updated Android build to run actions without opening this screen."
                      : closedAppScanStatus === "error"
                        ? "Could not save actions for use with the app closed. Reload the mapping to retry."
                        : "Connect and load your mappings once to enable scans with the app closed."}
                </Text>
              )}
            </View>

            {isFeedback && (
              <View
                accessibilityLiveRegion="polite"
                style={[
                  styles.feedback,
                  feedbackTone === "success"
                    ? styles.feedbackSuccess
                    : undefined,
                  feedbackTone === "warning"
                    ? styles.feedbackWarning
                    : undefined,
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
                    <Text style={styles.serialValue}>
                      {scannerState.serial}
                    </Text>
                  )}
                  {scannerState.kind === "matched" && (
                    <Text style={styles.serialValue}>
                      {scannerState.tag.name}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </View>

          <View
            style={[
              styles.studioColumn,
              isWideLayout && styles.studioColumnWide,
            ]}
          >
            <View style={styles.mappingCard}>
              <View style={styles.studioHero}>
                <View style={styles.mappingTopline}>
                  <View style={styles.studioLabelGroup}>
                    <View style={styles.studioIcon}>
                      <Ionicons
                        name="git-network-outline"
                        size={18}
                        color={COLORS.ink}
                      />
                    </View>
                    <View>
                      <Text style={styles.studioEyebrow}>TAG STUDIO</Text>
                      <Text style={styles.studioOwner}>
                        Mapping owner · {NFC_CONFIG_USER_NAME}
                      </Text>
                    </View>
                  </View>
                  <View
                    style={[
                      styles.mappingStatusPill,
                      mappingStatus === "synced"
                        ? styles.mappingStatusSynced
                        : mappingStatus === "saving" ||
                            mappingStatus === "loading"
                          ? styles.mappingStatusNeutral
                          : styles.mappingStatusWarning,
                    ]}
                  >
                    <Ionicons
                      name={
                        mappingStatus === "synced"
                          ? "checkmark-circle"
                          : mappingStatus === "saving" ||
                              mappingStatus === "loading"
                            ? "sync"
                            : "alert-circle"
                      }
                      size={14}
                      color={
                        mappingStatus === "synced"
                          ? COLORS.lime
                          : mappingStatus === "saving" ||
                              mappingStatus === "loading"
                            ? COLORS.white
                            : "#FFD0B5"
                      }
                    />
                    <Text style={styles.mappingStatusText}>
                      {mappingStatusLabel}
                    </Text>
                  </View>
                </View>

                <Text accessibilityRole="header" style={styles.studioTitle}>
                  Make every tap do more.
                </Text>
                <Text style={styles.studioCopy}>
                  See exactly how each NFC tag routes to an app or destination,
                  then fine-tune the mapping when you need to.
                </Text>

                <View
                  style={[
                    styles.flowRail,
                    isCompactLayout ? styles.flowRailCompact : undefined,
                  ]}
                >
                  <View
                    style={[
                      styles.flowNode,
                      isCompactLayout ? styles.flowNodeCompact : undefined,
                    ]}
                  >
                    <Ionicons
                      name="radio-outline"
                      size={15}
                      color={COLORS.lime}
                    />
                    <Text style={styles.flowNodeText}>NFC tag</Text>
                  </View>
                  <Ionicons
                    name={isCompactLayout ? "arrow-down" : "arrow-forward"}
                    size={14}
                    color="#91A099"
                  />
                  <View
                    style={[
                      styles.flowNode,
                      isCompactLayout ? styles.flowNodeCompact : undefined,
                    ]}
                  >
                    <Ionicons
                      name="flash-outline"
                      size={15}
                      color={COLORS.lime}
                    />
                    <Text style={styles.flowNodeText}>Action</Text>
                  </View>
                  <Ionicons
                    name={isCompactLayout ? "arrow-down" : "arrow-forward"}
                    size={14}
                    color="#91A099"
                  />
                  <View
                    style={[
                      styles.flowNode,
                      isCompactLayout ? styles.flowNodeCompact : undefined,
                    ]}
                  >
                    <Ionicons
                      name="navigate-outline"
                      size={15}
                      color={COLORS.lime}
                    />
                    <Text style={styles.flowNodeText}>Destination</Text>
                  </View>
                </View>

                <View style={styles.metricRow}>
                  <View style={styles.metricTile}>
                    <Text style={styles.metricValue}>
                      {String(mappingPreviewTags.length).padStart(2, "0")}
                    </Text>
                    <Text style={styles.metricLabel}>TAGS</Text>
                  </View>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricTile}>
                    <Text style={styles.metricValue}>
                      {String(totalActionCount).padStart(2, "0")}
                    </Text>
                    <Text style={styles.metricLabel}>ACTIONS</Text>
                  </View>
                  <View style={styles.metricDivider} />
                  <View style={styles.metricTile}>
                    <Text style={styles.metricValueSmall}>
                      {configStatus === "ready"
                        ? "ONLINE"
                        : configStatus === "loading"
                          ? "CHECKING"
                          : "OFFLINE"}
                    </Text>
                    <Text style={styles.metricLabel}>CONNECTION</Text>
                  </View>
                </View>
              </View>

              <View style={styles.studioBody}>
                {mappingConflict && (
                  <View
                    accessibilityLiveRegion="polite"
                    accessibilityRole="alert"
                    style={styles.conflictBanner}
                  >
                    <View style={styles.noticeIcon}>
                      <Ionicons
                        name="git-compare-outline"
                        size={18}
                        color={COLORS.warning}
                      />
                    </View>
                    <View style={styles.noticeText}>
                      <Text style={styles.noticeTitle}>
                        Remote update detected
                      </Text>
                      <Text style={styles.noticeCopy}>
                        Your draft is still here. Reload the latest mapping
                        before saving to avoid overwriting newer changes.
                      </Text>
                    </View>
                  </View>
                )}

                <View style={styles.segmentedControl}>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mappingView === "cards" }}
                    onPress={() => setMappingView("cards")}
                    style={[
                      styles.segmentButton,
                      mappingView === "cards"
                        ? styles.segmentButtonActive
                        : undefined,
                    ]}
                  >
                    <Ionicons
                      name="albums-outline"
                      size={16}
                      color={
                        mappingView === "cards" ? COLORS.ink : COLORS.muted
                      }
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        mappingView === "cards"
                          ? styles.segmentTextActive
                          : undefined,
                      ]}
                    >
                      Tag cards
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mappingView === "editor" }}
                    onPress={() => setMappingView("editor")}
                    style={[
                      styles.segmentButton,
                      mappingView === "editor"
                        ? styles.segmentButtonActive
                        : undefined,
                    ]}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={
                        mappingView === "editor" ? COLORS.ink : COLORS.muted
                      }
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        mappingView === "editor"
                          ? styles.segmentTextActive
                          : undefined,
                      ]}
                    >
                      Edit tags
                    </Text>
                  </Pressable>
                </View>

                {mappingView === "editor" ? (
                  <View style={styles.editorWorkspace}>
                    <View style={styles.editorHeader}>
                      <View style={styles.editorHeaderText}>
                        <Text style={styles.editorTitle}>Edit your tags</Text>
                        <View style={styles.validityRow}>
                          <Ionicons
                            name={
                              mappingFieldsReady
                                ? "checkmark-circle"
                                : "alert-circle"
                            }
                            size={14}
                            color={
                              mappingFieldsReady
                                ? COLORS.success
                                : COLORS.warning
                            }
                          />
                          <Text
                            style={[
                              styles.validityText,
                              !mappingFieldsReady
                                ? styles.validityTextError
                                : undefined,
                            ]}
                          >
                            {!mappingLoaded
                              ? configStatus === "loading"
                                ? "Loading mapping"
                                : "Connect to load tags"
                              : mappingDraftIsValid
                                ? mappingHasUnsavedChanges
                                  ? "Ready to save"
                                  : "All fields ready"
                                : "Finish required fields"}
                          </Text>
                        </View>
                      </View>
                    </View>
                    <Text style={styles.editorHint}>
                      Open a card to edit its name, serial, and action routes.
                    </Text>
                    <View
                      style={[
                        styles.editorToolbar,
                        isNarrowEditor ? styles.editorToolbarNarrow : undefined,
                      ]}
                    >
                      <Pressable
                        accessibilityLabel="Add tag"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: editorBusy }}
                        disabled={editorBusy}
                        onPress={() => {
                          const tag = newTagDraft(makeDraftId());
                          updateMappingDraft((current) => [...current, tag]);
                          setExpandedEditTagId(tag.id);
                        }}
                        style={({ pressed }) => [
                          styles.addTagButton,
                          isNarrowEditor
                            ? styles.editorToolbarAddNarrow
                            : undefined,
                          pressed ? styles.addTagButtonPressed : undefined,
                          editorBusy ? styles.buttonDisabled : undefined,
                        ]}
                      >
                        <Ionicons name="add" size={18} color={COLORS.ink} />
                        <Text style={styles.addTagButtonText}>Add tag</Text>
                      </Pressable>
                      <View
                        style={[
                          styles.editorFileActions,
                          isNarrowEditor
                            ? styles.editorFileActionsNarrow
                            : undefined,
                        ]}
                      >
                        <Pressable
                          accessibilityLabel="Import JSON mapping file"
                          accessibilityRole="button"
                          accessibilityState={{ disabled: editorBusy }}
                          disabled={editorBusy}
                          onPress={() => void importMappingJson()}
                          style={({ pressed }) => [
                            styles.editorFileButton,
                            isNarrowEditor
                              ? styles.editorFileButtonNarrow
                              : undefined,
                            pressed
                              ? styles.editorFileButtonPressed
                              : undefined,
                            editorBusy ? styles.buttonDisabled : undefined,
                          ]}
                        >
                          <Ionicons
                            name="document-text-outline"
                            size={17}
                            color={COLORS.inkSoft}
                          />
                          <Text style={styles.editorFileButtonText}>
                            Import JSON
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityLabel="Export current tag draft as JSON"
                          accessibilityRole="button"
                          accessibilityState={{
                            disabled: editorBusy || !mappingDraftIsValid,
                          }}
                          disabled={editorBusy || !mappingDraftIsValid}
                          onPress={() => void exportMappingJson()}
                          style={({ pressed }) => [
                            styles.editorFileButton,
                            isNarrowEditor
                              ? styles.editorFileButtonNarrow
                              : undefined,
                            pressed
                              ? styles.editorFileButtonPressed
                              : undefined,
                            editorBusy || !mappingDraftIsValid
                              ? styles.buttonDisabled
                              : undefined,
                          ]}
                        >
                          <Ionicons
                            name="download-outline"
                            size={17}
                            color={COLORS.inkSoft}
                          />
                          <Text style={styles.editorFileButtonText}>
                            Export JSON
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                    {pendingMappingImport && (
                      <View
                        accessibilityLiveRegion="polite"
                        style={styles.importPrompt}
                      >
                        <Text style={styles.importPromptTitle}>
                          Replace the current draft?
                        </Text>
                        <Text style={styles.importPromptCopy}>
                          {pendingMappingImport.name} contains{" "}
                          {pendingMappingImport.draft.length}{" "}
                          {pendingMappingImport.draft.length === 1
                            ? "tag"
                            : "tags"}
                          . Importing replaces all cards in this editor. It does
                          not save to the backend.
                        </Text>
                        <View style={styles.importPromptActions}>
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setPendingMappingImport(null)}
                            style={styles.importCancelButton}
                          >
                            <Text style={styles.importCancelButtonText}>
                              Cancel
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ disabled: editorBusy }}
                            disabled={editorBusy}
                            onPress={confirmMappingImport}
                            style={[
                              styles.importConfirmButton,
                              editorBusy ? styles.buttonDisabled : undefined,
                            ]}
                          >
                            <Text style={styles.importConfirmButtonText}>
                              Replace draft
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    )}
                    {mappingFileMessage && (
                      <View
                        accessibilityLiveRegion="polite"
                        accessibilityRole={
                          mappingFileMessage.kind === "error" ? "alert" : "none"
                        }
                        style={[
                          styles.editorMessage,
                          mappingFileMessage.kind === "success"
                            ? styles.editorMessageSuccess
                            : styles.editorMessageError,
                        ]}
                      >
                        <Ionicons
                          name={
                            mappingFileMessage.kind === "success"
                              ? "checkmark-circle-outline"
                              : "alert-circle-outline"
                          }
                          size={18}
                          color={
                            mappingFileMessage.kind === "success"
                              ? COLORS.success
                              : COLORS.warning
                          }
                        />
                        <Text
                          style={[
                            styles.editorMessageText,
                            mappingFileMessage.kind === "success"
                              ? styles.mappingMessageSuccess
                              : styles.mappingMessageError,
                          ]}
                        >
                          {mappingFileMessage.text}
                        </Text>
                      </View>
                    )}
                    {mappingHasUnsavedChanges && mappingDraftError && (
                      <View
                        accessibilityRole="alert"
                        style={styles.validationBanner}
                      >
                        <Ionicons
                          name="alert-circle-outline"
                          size={17}
                          color={COLORS.warning}
                        />
                        <Text style={styles.validationText}>
                          {mappingDraftError}
                        </Text>
                      </View>
                    )}
                    <View style={styles.editTagList}>
                      {!mappingLoaded && configStatus === "loading" ? (
                        <View style={styles.mappingEmptyState}>
                          <ActivityIndicator
                            size="small"
                            color={COLORS.inkSoft}
                          />
                          <Text style={styles.mappingEmptyTitle}>
                            Loading your tags…
                          </Text>
                        </View>
                      ) : !mappingLoaded ? (
                        <View style={styles.mappingEmptyState}>
                          <View style={styles.emptyIcon}>
                            <Ionicons
                              name="cloud-offline-outline"
                              size={22}
                              color={COLORS.warning}
                            />
                          </View>
                          <Text style={styles.mappingEmptyTitle}>
                            Mapping unavailable
                          </Text>
                          <Text style={styles.mappingEmptyCopy}>
                            Check Connection settings, then reload the mapping.
                          </Text>
                        </View>
                      ) : mappingDraft.length === 0 ? (
                        <View style={styles.mappingEmptyState}>
                          <View style={styles.emptyIcon}>
                            <Ionicons
                              name="pricetag-outline"
                              size={22}
                              color={COLORS.inkSoft}
                            />
                          </View>
                          <Text style={styles.mappingEmptyTitle}>
                            No tags in this mapping
                          </Text>
                          <Text style={styles.mappingEmptyCopy}>
                            Add a tag to enter its serial and configure what it
                            does.
                          </Text>
                        </View>
                      ) : (
                        mappingDraft.map((tag, index) => {
                          const isExpanded = expandedEditTagId === tag.id;
                          const tagLabel = tag.name.trim() || "New tag";
                          return (
                            <View key={tag.id} style={styles.tagCard}>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${tagLabel}, ${isExpanded ? "hide" : "show"} editable fields`}
                                accessibilityState={{ expanded: isExpanded }}
                                onPress={() =>
                                  setExpandedEditTagId(
                                    isExpanded ? null : tag.id,
                                  )
                                }
                                style={({ pressed }) => [
                                  styles.destinationRow,
                                  pressed ? styles.tagRowPressed : undefined,
                                ]}
                              >
                                <View
                                  style={[
                                    styles.destinationIndex,
                                    index % 2 === 0
                                      ? styles.tagGlyphLime
                                      : styles.tagGlyphBlue,
                                  ]}
                                >
                                  <Ionicons
                                    name="radio-outline"
                                    size={18}
                                    color={
                                      index % 2 === 0
                                        ? COLORS.inkSoft
                                        : COLORS.blueInk
                                    }
                                  />
                                </View>
                                <View style={styles.destinationDetails}>
                                  <Text
                                    style={styles.destinationName}
                                    numberOfLines={1}
                                  >
                                    {tagLabel}
                                  </Text>
                                  <Text
                                    style={styles.destinationSerial}
                                    numberOfLines={1}
                                  >
                                    {tag.serial.trim() || "Add a tag serial"}
                                  </Text>
                                </View>
                                <View style={styles.tagMeta}>
                                  <Text style={styles.tagActionCount}>
                                    {tag.actions.length}{" "}
                                    {tag.actions.length === 1
                                      ? "action"
                                      : "actions"}
                                  </Text>
                                  <View style={styles.chevronButton}>
                                    <Ionicons
                                      name={
                                        isExpanded
                                          ? "chevron-up"
                                          : "chevron-down"
                                      }
                                      size={17}
                                      color={COLORS.inkSoft}
                                    />
                                  </View>
                                </View>
                              </Pressable>

                              <View style={styles.actionChipRow}>
                                {tag.actions.slice(0, 2).map((action) => (
                                  <View
                                    key={action.id}
                                    style={styles.actionChip}
                                  >
                                    <Ionicons
                                      name={
                                        ACTION_PRESENTATION[action.actionType]
                                          .icon
                                      }
                                      size={14}
                                      color={COLORS.inkSoft}
                                    />
                                    <Text
                                      style={styles.actionChipText}
                                      numberOfLines={1}
                                    >
                                      {action.displayName.trim() ||
                                        action.val.trim() ||
                                        "New action"}
                                    </Text>
                                  </View>
                                ))}
                                {tag.actions.length > 2 && (
                                  <View style={styles.moreChip}>
                                    <Text style={styles.moreChipText}>
                                      +{tag.actions.length - 2}
                                    </Text>
                                  </View>
                                )}
                                {tag.actions.length === 0 && (
                                  <Text style={styles.noActionsText}>
                                    No action configured
                                  </Text>
                                )}
                              </View>

                              {isExpanded && (
                                <View style={styles.tagExpansion}>
                                  <View style={styles.expansionRule} />
                                  <Text style={styles.detailLabel}>
                                    TAG NAME
                                  </Text>
                                  <TextInput
                                    accessibilityLabel={`Tag name for ${tag.serial || "new tag"}`}
                                    editable={!editorBusy}
                                    onChangeText={(name) =>
                                      updateMappingDraft((current) =>
                                        current.map((item) =>
                                          item.id === tag.id
                                            ? { ...item, name }
                                            : item,
                                        ),
                                      )
                                    }
                                    placeholder="e.g. TagT234"
                                    placeholderTextColor="#91A099"
                                    style={styles.editInput}
                                    value={tag.name}
                                  />
                                  <Text
                                    style={[
                                      styles.detailLabel,
                                      styles.editFieldLabel,
                                    ]}
                                  >
                                    FULL TAG SERIAL
                                  </Text>
                                  <TextInput
                                    accessibilityLabel={`Full serial for ${tagLabel}`}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    editable={!editorBusy}
                                    onChangeText={(serial) =>
                                      updateMappingDraft((current) =>
                                        current.map((item) =>
                                          item.id === tag.id
                                            ? { ...item, serial }
                                            : item,
                                        ),
                                      )
                                    }
                                    placeholder="1D:80:36:BA:1A:10:80"
                                    placeholderTextColor="#91A099"
                                    spellCheck={false}
                                    style={[
                                      styles.editInput,
                                      styles.editInputMono,
                                    ]}
                                    value={tag.serial}
                                  />
                                  <Text
                                    style={[
                                      styles.detailLabel,
                                      styles.actionsLabel,
                                    ]}
                                  >
                                    ACTION ROUTES
                                  </Text>
                                  {tag.actions.map((action, actionIndex) => (
                                    <View
                                      key={action.id}
                                      style={styles.editActionCard}
                                    >
                                      <View style={styles.editActionHeader}>
                                        <View style={styles.actionIcon}>
                                          <Ionicons
                                            name={
                                              ACTION_PRESENTATION[
                                                action.actionType
                                              ].icon
                                            }
                                            size={17}
                                            color={COLORS.inkSoft}
                                          />
                                        </View>
                                        <View
                                          style={styles.editActionTitleWrap}
                                        >
                                          <Text style={styles.editActionTitle}>
                                            Action {actionIndex + 1}
                                          </Text>
                                          <Text
                                            style={styles.editActionSubtitle}
                                            numberOfLines={1}
                                          >
                                            {action.displayName.trim() ||
                                              action.val.trim() ||
                                              "Choose a type and target"}
                                          </Text>
                                        </View>
                                        <Pressable
                                          accessibilityLabel={`Remove action ${actionIndex + 1} from ${tagLabel}`}
                                          accessibilityRole="button"
                                          accessibilityState={{
                                            disabled: editorBusy,
                                          }}
                                          disabled={editorBusy}
                                          onPress={() =>
                                            updateMappingDraft((current) =>
                                              current.map((item) =>
                                                item.id === tag.id
                                                  ? {
                                                      ...item,
                                                      actions:
                                                        item.actions.filter(
                                                          (candidate) =>
                                                            candidate.id !==
                                                            action.id,
                                                        ),
                                                    }
                                                  : item,
                                              ),
                                            )
                                          }
                                          style={({ pressed }) => [
                                            styles.removeActionButton,
                                            pressed
                                              ? styles.removeButtonPressed
                                              : undefined,
                                            editorBusy
                                              ? styles.buttonDisabled
                                              : undefined,
                                          ]}
                                        >
                                          <Ionicons
                                            name="trash-outline"
                                            size={17}
                                            color={COLORS.warning}
                                          />
                                        </Pressable>
                                      </View>
                                      <NfcActionEditor
                                        action={action}
                                        label={`action ${actionIndex + 1} in ${tagLabel}`}
                                        disabled={editorBusy}
                                        defaultServerBaseUrl={
                                          rememberedServerBaseUrl
                                        }
                                        onRememberServerBaseUrl={
                                          rememberServerBaseUrl
                                        }
                                        serverMappings={serverCatalog.servers}
                                        serverMappingsLoading={
                                          serverCatalog.loading
                                        }
                                        serverMappingsError={
                                          serverCatalog.error
                                        }
                                        onRefreshServers={serverCatalog.refresh}
                                        onManageServers={openServerManager}
                                        onChange={(patch) =>
                                          updateMappingDraft((current) =>
                                            current.map((item) =>
                                              item.id === tag.id
                                                ? {
                                                    ...item,
                                                    actions: item.actions.map(
                                                      (candidate) =>
                                                        candidate.id ===
                                                        action.id
                                                          ? {
                                                              ...candidate,
                                                              ...patch,
                                                            }
                                                          : candidate,
                                                    ),
                                                  }
                                                : item,
                                            ),
                                          )
                                        }
                                      />
                                    </View>
                                  ))}
                                  <Pressable
                                    accessibilityLabel={`Add action to ${tagLabel}`}
                                    accessibilityRole="button"
                                    accessibilityState={{
                                      disabled: editorBusy,
                                    }}
                                    disabled={editorBusy}
                                    onPress={() =>
                                      updateMappingDraft((current) =>
                                        current.map((item) =>
                                          item.id === tag.id
                                            ? {
                                                ...item,
                                                actions: [
                                                  ...item.actions,
                                                  newActionDraft(
                                                    makeDraftId(),
                                                    rememberedServerBaseUrl,
                                                  ),
                                                ],
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                    style={({ pressed }) => [
                                      styles.addActionButton,
                                      pressed
                                        ? styles.addActionButtonPressed
                                        : undefined,
                                      editorBusy
                                        ? styles.buttonDisabled
                                        : undefined,
                                    ]}
                                  >
                                    <Ionicons
                                      name="add-circle-outline"
                                      size={18}
                                      color={COLORS.inkSoft}
                                    />
                                    <Text style={styles.addActionButtonText}>
                                      Add action
                                    </Text>
                                  </Pressable>
                                  <View style={styles.editTagFooter}>
                                    <Pressable
                                      accessibilityLabel={`Remove tag ${tagLabel}`}
                                      accessibilityRole="button"
                                      accessibilityState={{
                                        disabled: editorBusy,
                                      }}
                                      disabled={editorBusy}
                                      onPress={() => {
                                        updateMappingDraft((current) =>
                                          current.filter(
                                            (item) => item.id !== tag.id,
                                          ),
                                        );
                                        setExpandedEditTagId(
                                          mappingDraft.find(
                                            (item) => item.id !== tag.id,
                                          )?.id ?? null,
                                        );
                                      }}
                                      style={({ pressed }) => [
                                        styles.removeTagButton,
                                        pressed
                                          ? styles.removeButtonPressed
                                          : undefined,
                                        editorBusy
                                          ? styles.buttonDisabled
                                          : undefined,
                                      ]}
                                    >
                                      <Ionicons
                                        name="trash-outline"
                                        size={16}
                                        color={COLORS.warning}
                                      />
                                      <Text style={styles.removeTagButtonText}>
                                        Remove tag
                                      </Text>
                                    </Pressable>
                                  </View>
                                </View>
                              )}
                            </View>
                          );
                        })
                      )}
                    </View>
                    <View style={styles.replaceNotice}>
                      <Ionicons
                        name="information-circle-outline"
                        size={17}
                        color={COLORS.muted}
                      />
                      <Text style={styles.replaceNoticeText}>
                        Saving replaces the full mapping for{" "}
                        {NFC_CONFIG_USER_NAME}.
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.editorActions,
                        isNarrowEditor
                          ? styles.editorActionsStacked
                          : undefined,
                      ]}
                    >
                      <Pressable
                        accessibilityLabel={`Save mapping changes for ${NFC_CONFIG_USER_NAME}`}
                        accessibilityRole="button"
                        accessibilityState={{
                          busy: mappingSaving,
                          disabled: mappingSaveDisabled,
                        }}
                        disabled={mappingSaveDisabled}
                        onPress={saveMapping}
                        style={({ pressed }) => [
                          styles.hostButton,
                          isNarrowEditor
                            ? styles.editorActionFullWidth
                            : undefined,
                          pressed && !mappingSaveDisabled
                            ? styles.scanButtonPressed
                            : undefined,
                          mappingSaveDisabled
                            ? styles.buttonDisabled
                            : undefined,
                        ]}
                      >
                        {mappingSaving ? (
                          <ActivityIndicator
                            size="small"
                            color={COLORS.white}
                          />
                        ) : (
                          <View style={styles.mappingButtonContent}>
                            <Ionicons
                              name="cloud-upload-outline"
                              size={17}
                              color={COLORS.white}
                            />
                            <Text style={styles.hostButtonText}>
                              Save changes
                            </Text>
                          </View>
                        )}
                      </Pressable>
                      <Pressable
                        accessibilityLabel={
                          mappingHasUnsavedChanges
                            ? "Discard mapping edits and reload from backend"
                            : "Reload mapping from backend"
                        }
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: mappingSaving || hostSaving,
                        }}
                        disabled={mappingSaving || hostSaving}
                        onPress={() => void reloadMapping()}
                        style={({ pressed }) => [
                          styles.mappingReloadButton,
                          isNarrowEditor
                            ? styles.editorActionFullWidth
                            : undefined,
                          pressed && !mappingSaving && !hostSaving
                            ? styles.mappingReloadButtonPressed
                            : undefined,
                          mappingSaving || hostSaving
                            ? styles.buttonDisabled
                            : undefined,
                        ]}
                      >
                        <Ionicons
                          name="refresh"
                          size={16}
                          color={COLORS.inkSoft}
                        />
                        <Text style={styles.mappingReloadButtonText}>
                          {mappingHasUnsavedChanges
                            ? "Discard edits and reload"
                            : "Reload from backend"}
                        </Text>
                      </Pressable>
                    </View>
                    {mappingMessage && (
                      <View
                        accessibilityLiveRegion="polite"
                        accessibilityRole={
                          mappingMessage.kind === "error" ? "alert" : "none"
                        }
                        style={[
                          styles.editorMessage,
                          mappingMessage.kind === "success"
                            ? styles.editorMessageSuccess
                            : styles.editorMessageError,
                        ]}
                      >
                        <Ionicons
                          name={
                            mappingMessage.kind === "success"
                              ? "checkmark-circle-outline"
                              : "alert-circle-outline"
                          }
                          size={18}
                          color={
                            mappingMessage.kind === "success"
                              ? COLORS.success
                              : COLORS.warning
                          }
                        />
                        <Text
                          style={[
                            styles.editorMessageText,
                            mappingMessage.kind === "success"
                              ? styles.mappingMessageSuccess
                              : styles.mappingMessageError,
                          ]}
                        >
                          {mappingMessage.text}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.cardsWorkspace}>
                    <View style={styles.sectionHeader}>
                      <View>
                        <Text style={styles.sectionKicker}>
                          MAPPING OVERVIEW
                        </Text>
                        <Text
                          accessibilityRole="header"
                          style={styles.sectionTitle}
                        >
                          {configStatus === "error" &&
                          mappingPreviewTags.length === 0
                            ? "Configuration unavailable"
                            : "Your tags at a glance"}
                        </Text>
                        <Text style={styles.sectionDescription}>
                          {mappingHasUnsavedChanges && mappingDraftIsValid
                            ? "Previewing your unsaved draft"
                            : mappingHasUnsavedChanges
                              ? "Showing the last synced mapping until the tag fields are complete"
                              : configStatus === "error"
                                ? "Showing the last synced mapping while the backend is offline"
                                : configStatus === "loading" &&
                                    mappingPreviewTags.length > 0
                                  ? "Refreshing while your last synced mapping stays visible"
                                  : "Tap a tag, then tap an action route to run it"}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.destinationList}>
                      {configStatus === "loading" &&
                        mappingPreviewTags.length === 0 && (
                          <View style={styles.mappingEmptyState}>
                            <ActivityIndicator
                              size="small"
                              color={COLORS.inkSoft}
                            />
                            <Text style={styles.mappingEmptyTitle}>
                              Loading your tags…
                            </Text>
                            <Text style={styles.mappingEmptyCopy}>
                              Fetching the latest mapping from the backend.
                            </Text>
                          </View>
                        )}
                      {configStatus === "loading" &&
                        mappingPreviewTags.length > 0 && (
                          <View style={styles.staleBanner}>
                            <ActivityIndicator
                              size="small"
                              color={COLORS.inkSoft}
                            />
                            <Text style={styles.staleBannerText}>
                              Refreshing mapping…
                            </Text>
                          </View>
                        )}
                      {configStatus === "error" &&
                        mappingPreviewTags.length === 0 && (
                          <View style={styles.mappingEmptyState}>
                            <View style={styles.emptyIcon}>
                              <Ionicons
                                name="cloud-offline-outline"
                                size={22}
                                color={COLORS.warning}
                              />
                            </View>
                            <Text style={styles.mappingEmptyTitle}>
                              Mapping unavailable
                            </Text>
                            <Text style={styles.mappingEmptyCopy}>
                              Check Connection settings, then reload the
                              mapping.
                            </Text>
                          </View>
                        )}
                      {configStatus === "error" &&
                        mappingPreviewTags.length > 0 && (
                          <View style={styles.staleBanner}>
                            <Ionicons
                              name="cloud-offline-outline"
                              size={17}
                              color={COLORS.warning}
                            />
                            <Text style={styles.staleBannerText}>
                              Offline · showing the last synced mapping
                            </Text>
                          </View>
                        )}
                      {configStatus === "ready" &&
                        mappingPreviewTags.length === 0 && (
                          <View style={styles.mappingEmptyState}>
                            <View style={styles.emptyIcon}>
                              <Ionicons
                                name="pricetag-outline"
                                size={22}
                                color={COLORS.inkSoft}
                              />
                            </View>
                            <Text style={styles.mappingEmptyTitle}>
                              No tags mapped yet
                            </Text>
                            <Text style={styles.mappingEmptyCopy}>
                              Open Edit tags to add your first NFC tag.
                            </Text>
                          </View>
                        )}
                      {mappingPreviewTags.length > 0 &&
                        mappingPreviewTags.map((tag, index) => {
                          const isExpanded =
                            expandedTagSerial === tag.normalizedSerial;
                          return (
                            <View
                              key={tag.normalizedSerial}
                              style={styles.tagCard}
                            >
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={
                                  tag.name +
                                  ", " +
                                  (isExpanded ? "hide" : "show") +
                                  " tag details"
                                }
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
                                <View
                                  style={[
                                    styles.destinationIndex,
                                    index % 2 === 0
                                      ? styles.tagGlyphLime
                                      : styles.tagGlyphBlue,
                                  ]}
                                >
                                  <Ionicons
                                    name="radio-outline"
                                    size={18}
                                    color={
                                      index % 2 === 0
                                        ? COLORS.inkSoft
                                        : COLORS.blueInk
                                    }
                                  />
                                </View>
                                <View style={styles.destinationDetails}>
                                  <Text style={styles.destinationName}>
                                    {tag.name}
                                  </Text>
                                  <Text
                                    style={styles.destinationSerial}
                                    numberOfLines={1}
                                  >
                                    {tag.serial}
                                  </Text>
                                </View>
                                <View style={styles.tagMeta}>
                                  <Text style={styles.tagActionCount}>
                                    {tag.actions.length}{" "}
                                    {tag.actions.length === 1
                                      ? "action"
                                      : "actions"}
                                  </Text>
                                  <View style={styles.chevronButton}>
                                    <Ionicons
                                      name={
                                        isExpanded
                                          ? "chevron-up"
                                          : "chevron-down"
                                      }
                                      size={17}
                                      color={COLORS.inkSoft}
                                    />
                                  </View>
                                </View>
                              </Pressable>

                              <View style={styles.actionChipRow}>
                                {tag.actions
                                  .slice(0, 2)
                                  .map((action, actionIndex) => (
                                    <View
                                      key={
                                        tag.normalizedSerial +
                                        "-chip-" +
                                        String(actionIndex)
                                      }
                                      style={styles.actionChip}
                                    >
                                      <Ionicons
                                        name={
                                          ACTION_PRESENTATION[action.actionType]
                                            .icon
                                        }
                                        size={14}
                                        color={COLORS.inkSoft}
                                      />
                                      <Text
                                        style={styles.actionChipText}
                                        numberOfLines={1}
                                      >
                                        {action.displayName ?? action.val}
                                      </Text>
                                    </View>
                                  ))}
                                {tag.actions.length > 2 && (
                                  <View style={styles.moreChip}>
                                    <Text style={styles.moreChipText}>
                                      +{tag.actions.length - 2}
                                    </Text>
                                  </View>
                                )}
                                {tag.actions.length === 0 && (
                                  <Text style={styles.noActionsText}>
                                    No action configured
                                  </Text>
                                )}
                              </View>

                              {isExpanded && (
                                <View style={styles.tagExpansion}>
                                  <View style={styles.expansionRule} />
                                  <Text style={styles.detailLabel}>
                                    FULL TAG SERIAL
                                  </Text>
                                  <View style={styles.serialPanel}>
                                    <Text style={styles.serialFull} selectable>
                                      {tag.serial}
                                    </Text>
                                  </View>
                                  <Text style={styles.detailLabel}>
                                    ACTION ROUTES
                                  </Text>
                                  {tag.actions.map((action, actionIndex) => {
                                    const actionLabel =
                                      action.displayName ??
                                      ACTION_PRESENTATION[action.actionType]
                                        .label;
                                    const routeKey = JSON.stringify([
                                      tag.normalizedSerial,
                                      actionIndex,
                                      action.actionType,
                                      action.target,
                                      action.serverBaseUrl,
                                      action.val,
                                    ]);
                                    const routeStatus =
                                      actionRouteStatuses[routeKey];
                                    const routeRunning =
                                      routeStatus?.kind === "running";
                                    return (
                                      <Pressable
                                        key={routeKey}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Run ${actionLabel} for ${tag.name}: ${action.val}`}
                                        accessibilityHint="Executes this action now."
                                        accessibilityState={{
                                          busy: routeRunning,
                                          disabled: routeRunning,
                                        }}
                                        disabled={routeRunning}
                                        onPress={() =>
                                          void runCardAction(action, routeKey)
                                        }
                                        style={({ pressed }) => [
                                          styles.actionRow,
                                          pressed
                                            ? styles.actionRowPressed
                                            : undefined,
                                          routeRunning
                                            ? styles.actionRowRunning
                                            : undefined,
                                        ]}
                                      >
                                        <View style={styles.actionIcon}>
                                          <Ionicons
                                            name={
                                              ACTION_PRESENTATION[
                                                action.actionType
                                              ].icon
                                            }
                                            size={17}
                                            color={COLORS.inkSoft}
                                          />
                                        </View>
                                        <View style={styles.actionDetails}>
                                          <Text style={styles.actionType}>
                                            {action.actionType === "trigger"
                                              ? "HTTP trigger"
                                              : isServerAction(action)
                                                ? "Server"
                                                : "Client"}{" "}
                                            · {actionLabel}
                                          </Text>
                                          {action.target === "server" ? (
                                            <Text
                                              style={styles.actionServerBase}
                                            >
                                              {action.serverBaseUrl}
                                            </Text>
                                          ) : null}
                                          <Text style={styles.actionValue}>
                                            {action.val}
                                          </Text>
                                          {routeStatus && (
                                            <Text
                                              accessibilityLiveRegion="polite"
                                              accessibilityRole={
                                                routeStatus.kind === "error"
                                                  ? "alert"
                                                  : "none"
                                              }
                                              style={[
                                                styles.actionRouteStatus,
                                                routeStatus.kind === "success"
                                                  ? styles.actionRouteSuccess
                                                  : routeStatus.kind === "error"
                                                    ? styles.actionRouteError
                                                    : undefined,
                                              ]}
                                            >
                                              {routeStatus.text}
                                            </Text>
                                          )}
                                        </View>
                                        {routeRunning ? (
                                          <ActivityIndicator
                                            size="small"
                                            color={COLORS.inkSoft}
                                          />
                                        ) : (
                                          <Ionicons
                                            name="arrow-forward"
                                            size={15}
                                            color={COLORS.muted}
                                          />
                                        )}
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setMappingView("editor")}
                      style={({ pressed }) => [
                        styles.openEditorButton,
                        pressed ? styles.openEditorButtonPressed : undefined,
                      ]}
                    >
                      <View style={styles.openEditorIcon}>
                        <Ionicons
                          name="create-outline"
                          size={17}
                          color={COLORS.inkSoft}
                        />
                      </View>
                      <View style={styles.openEditorTextWrap}>
                        <Text style={styles.openEditorTitle}>
                          Edit tags and actions
                        </Text>
                        <Text style={styles.openEditorCopy}>
                          Add, change, or remove tag cards and their action
                          routes.
                        </Text>
                      </View>
                      <Ionicons
                        name="arrow-forward"
                        size={17}
                        color={COLORS.inkSoft}
                      />
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.connectionCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add/Update Server Data"
            disabled={hostSaving}
            onPress={() => openServerManager()}
            style={styles.connectionHeader}
          >
            <View style={styles.connectionIcon}>
              <Ionicons
                name="desktop-outline"
                size={19}
                color={COLORS.inkSoft}
              />
            </View>
            <View style={styles.connectionSummary}>
              <Text style={styles.connectionTitle}>Add/Update Server Data</Text>
              <Text style={styles.connectionHost}>
                {serverCatalog.loading
                  ? "Loading saved servers…"
                  : `${serverCatalog.servers.length} saved server${serverCatalog.servers.length === 1 ? "" : "s"} · Names and IP addresses`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </Pressable>
        </View>

        <View style={styles.connectionCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${connectionExpanded ? "Hide" : "Show"} backend connection settings`}
            accessibilityState={{ expanded: connectionExpanded }}
            onPress={() => setConnectionExpanded((current) => !current)}
            style={({ pressed }) => [
              styles.connectionHeader,
              pressed ? styles.connectionHeaderPressed : undefined,
            ]}
          >
            <View style={styles.connectionIcon}>
              <Ionicons
                name="server-outline"
                size={19}
                color={COLORS.inkSoft}
              />
            </View>
            <View style={styles.connectionSummary}>
              <Text style={styles.connectionTitle}>Connection settings</Text>
              <Text style={styles.connectionHost} numberOfLines={1}>
                {displayHost}
              </Text>
            </View>
            <View style={styles.connectionState}>
              <View
                style={[
                  styles.connectionDot,
                  configStatus === "error"
                    ? styles.connectionDotOffline
                    : configStatus === "loading"
                      ? styles.connectionDotChecking
                      : undefined,
                ]}
              />
              <Text style={styles.connectionStateText}>
                {configStatus === "ready"
                  ? "Connected"
                  : configStatus === "loading"
                    ? "Checking"
                    : "Unavailable"}
              </Text>
            </View>
            <Ionicons
              name={connectionExpanded ? "chevron-up" : "chevron-down"}
              size={18}
              color={COLORS.muted}
            />
          </Pressable>

          {connectionExpanded && (
            <View style={styles.connectionPanel}>
              <Text style={styles.connectionLabel}>BACKEND HOST URL</Text>
              <Text style={styles.connectionHint}>
                The app fetches and publishes tag actions through this address.
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
              <Text style={styles.connectionLabel}>ADMIN API KEY</Text>
              <Text style={styles.connectionHint}>
                Required to save tag actions and server data. Kept only for this
                session; cleared when you change backend hosts.
              </Text>
              <TextInput
                accessibilityLabel="Backend Admin API key"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!mappingSaving && !serverCatalog.saving}
                onChangeText={setAdminApiKey}
                value={adminApiKey}
                style={styles.hostInput}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  busy: hostSaving,
                  disabled: hostSaving || mappingSaving || serverCatalog.saving,
                }}
                disabled={hostSaving || mappingSaving || serverCatalog.saving}
                onPress={applyHost}
                style={({ pressed }) => [
                  styles.connectionButton,
                  pressed && !hostSaving && !mappingSaving
                    ? styles.scanButtonPressed
                    : undefined,
                  hostSaving || mappingSaving
                    ? styles.buttonDisabled
                    : undefined,
                ]}
              >
                {hostSaving ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <>
                    <Text style={styles.connectionButtonText}>
                      Save and connect
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={17}
                      color={COLORS.white}
                    />
                  </>
                )}
              </Pressable>
              {!!hostMessage && (
                <Text style={styles.hostMessage}>{hostMessage}</Text>
              )}
            </View>
          )}
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
      <ServerMappingManager
        visible={serverManagerVisible}
        onClose={closeServerManager}
        servers={serverCatalog.servers}
        loading={serverCatalog.loading}
        error={serverCatalog.error}
        saving={serverCatalog.saving}
        saveError={serverCatalog.saveError}
        onRefresh={serverCatalog.refresh}
        onSave={saveServerData}
        apiKey={adminApiKey}
        onApiKeyChange={setAdminApiKey}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    width: "100%",
    maxWidth: 1120,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 40,
  },
  topline: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingBottom: 2,
  },
  brandLockup: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandMark: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  brandName: {
    marginLeft: 10,
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  brandCaption: {
    marginTop: 2,
    marginLeft: 10,
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  readyPill: {
    marginLeft: "auto",
    minHeight: 32,
    borderRadius: 20,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  readyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#61A76C",
  },
  readyDotOffline: {
    backgroundColor: COLORS.coral,
  },
  readyLabel: {
    color: COLORS.text,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  workspace: {
    width: "100%",
  },
  workspaceWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 24,
  },
  scanColumn: {
    width: "100%",
  },
  scanColumnWide: {
    width: "36%",
    maxWidth: 390,
  },
  studioColumn: {
    width: "100%",
    marginTop: 24,
  },
  studioColumnWide: {
    flex: 1,
    width: "auto",
    marginTop: 34,
  },
  intro: {
    marginTop: 34,
    marginBottom: 20,
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
    fontSize: 40,
    lineHeight: 43,
    fontWeight: "800",
    letterSpacing: -1.6,
  },
  introCopy: {
    maxWidth: 390,
    marginTop: 12,
    color: COLORS.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  scanCard: {
    overflow: "hidden",
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 19,
    paddingBottom: 20,
    backgroundColor: COLORS.ink,
  },
  cardTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardEyebrow: {
    color: "#B4C2BC",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.25,
  },
  signalStage: {
    height: 116,
    alignItems: "center",
    justifyContent: "center",
  },
  signalOuter: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    borderColor: "rgba(201,242,122,0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  signalInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.inkSoft,
  },
  signalPulse: {
    position: "absolute",
    top: 15,
    right: "25%",
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.lime,
  },
  cardTitle: {
    color: COLORS.white,
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.45,
  },
  cardCopy: {
    marginTop: 6,
    marginBottom: 18,
    color: "#B0BDB7",
    fontSize: 14,
    lineHeight: 20,
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
  mappingCard: {
    overflow: "hidden",
    borderRadius: 28,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: "#D5DDD3",
  },
  mappingTopline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  userBadge: {
    marginLeft: "auto",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#EFF3EB",
  },
  userBadgeText: {
    color: COLORS.inkSoft,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.45,
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
    minHeight: 50,
    marginTop: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    fontSize: 14,
  },
  hostButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  mappingButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mappingReloadButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 10,
    backgroundColor: "#EDF1EA",
  },
  mappingReloadButtonPressed: {
    backgroundColor: "#E3E9DE",
  },
  mappingReloadButtonText: {
    color: COLORS.inkSoft,
    fontSize: 13,
    fontWeight: "700",
  },
  hostButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "800",
  },
  hostMessage: {
    marginTop: 8,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  mappingMessage: {
    marginTop: 9,
    fontSize: 11,
    lineHeight: 16,
  },
  mappingMessageSuccess: {
    color: COLORS.success,
  },
  mappingMessageError: {
    color: COLORS.warning,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 16,
  },
  sectionKicker: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  sectionTitle: {
    marginTop: 6,
    color: COLORS.text,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  sectionDescription: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
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
    gap: 10,
  },
  tagCard: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
  },
  destinationRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 13,
  },
  destinationIndex: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tagGlyphLime: {
    backgroundColor: COLORS.limeSoft,
  },
  tagGlyphBlue: {
    backgroundColor: COLORS.blue,
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
    marginRight: 10,
  },
  tagRowPressed: {
    backgroundColor: "#F5F6F0",
  },
  tagDivider: {
    height: 1,
    marginLeft: 14,
    backgroundColor: COLORS.line,
  },
  tagExpansion: {
    paddingHorizontal: 14,
    paddingBottom: 15,
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
    minHeight: 58,
    padding: 11,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4EE",
  },
  actionRowPressed: {
    backgroundColor: "#E8EEDF",
  },
  actionRowRunning: {
    backgroundColor: COLORS.limeSoft,
  },
  actionServerBase: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 11,
  },
  actionType: {
    color: COLORS.inkSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  actionValue: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  actionRouteStatus: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  actionRouteSuccess: {
    color: COLORS.success,
  },
  actionRouteError: {
    color: COLORS.warning,
  },
  destinationName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
  },
  destinationSerial: {
    marginTop: 5,
    color: COLORS.muted,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.15,
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
  studioHero: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 22,
    backgroundColor: COLORS.ink,
  },
  studioLabelGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  studioIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: COLORS.lime,
  },
  studioEyebrow: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  studioOwner: {
    marginTop: 3,
    color: "#AAB9B2",
    fontSize: 11,
    fontWeight: "600",
  },
  mappingStatusPill: {
    minHeight: 30,
    maxWidth: 150,
    paddingHorizontal: 9,
    borderRadius: 99,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  mappingStatusSynced: {
    backgroundColor: "rgba(200,242,110,0.14)",
  },
  mappingStatusNeutral: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  mappingStatusWarning: {
    backgroundColor: "rgba(255,122,89,0.15)",
  },
  mappingStatusText: {
    flexShrink: 1,
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "800",
  },
  studioTitle: {
    marginTop: 24,
    color: COLORS.white,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  studioCopy: {
    maxWidth: 520,
    marginTop: 8,
    color: "#B4C1BB",
    fontSize: 14,
    lineHeight: 20,
  },
  flowRail: {
    marginTop: 19,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  flowRailCompact: {
    flexDirection: "column",
  },
  flowNode: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 8,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  flowNodeCompact: {
    flex: 0,
    width: "100%",
  },
  flowNodeText: {
    color: "#E8EEEB",
    fontSize: 11,
    fontWeight: "700",
  },
  metricRow: {
    marginTop: 18,
    minHeight: 63,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  metricTile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  metricDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  metricValue: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  metricValueSmall: {
    color: COLORS.lime,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.55,
  },
  metricLabel: {
    marginTop: 3,
    color: "#91A099",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  studioBody: {
    padding: 18,
    backgroundColor: COLORS.surface,
  },
  conflictBanner: {
    marginBottom: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: "#F0CFB9",
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: COLORS.warningBg,
  },
  noticeIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: "#FFE0CA",
  },
  noticeText: {
    flex: 1,
  },
  noticeTitle: {
    color: COLORS.warning,
    fontSize: 13,
    fontWeight: "800",
  },
  noticeCopy: {
    marginTop: 3,
    color: "#704C35",
    fontSize: 12,
    lineHeight: 17,
  },
  segmentedControl: {
    minHeight: 50,
    padding: 4,
    borderRadius: 15,
    flexDirection: "row",
    gap: 4,
    backgroundColor: "#ECEFE8",
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  segmentButtonActive: {
    backgroundColor: COLORS.surface,
    shadowColor: "#1D3A30",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.09,
    shadowRadius: 4,
    elevation: 1,
  },
  segmentText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  segmentTextActive: {
    color: COLORS.ink,
    fontWeight: "800",
  },
  editorWorkspace: {
    marginTop: 20,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  editorHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  editorTitle: {
    color: COLORS.text,
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.35,
  },
  validityRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  validityText: {
    color: COLORS.success,
    fontSize: 11,
    fontWeight: "700",
  },
  validityTextError: {
    color: COLORS.warning,
  },
  addTagButton: {
    minHeight: 44,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#BADF72",
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: COLORS.lime,
  },
  addTagButtonPressed: {
    backgroundColor: "#BCE45E",
  },
  addTagButtonText: {
    color: COLORS.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  editorHint: {
    marginTop: 13,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  editorToolbar: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  editorToolbarNarrow: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  editorToolbarAddNarrow: {
    width: "100%",
  },
  editorFileActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editorFileActionsNarrow: {
    width: "100%",
  },
  editorFileButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#F3F5EF",
  },
  editorFileButtonNarrow: {
    flex: 1,
    paddingHorizontal: 8,
  },
  editorFileButtonPressed: {
    backgroundColor: "#E9EEE5",
  },
  editorFileButtonText: {
    color: COLORS.inkSoft,
    fontSize: 12,
    fontWeight: "800",
  },
  importPrompt: {
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BEDD83",
    borderRadius: 14,
    backgroundColor: COLORS.limeSoft,
  },
  importPromptTitle: {
    color: COLORS.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  importPromptCopy: {
    marginTop: 5,
    color: COLORS.inkSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  importPromptActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  importCancelButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#BEDD83",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  importCancelButtonText: {
    color: COLORS.inkSoft,
    fontSize: 12,
    fontWeight: "800",
  },
  importConfirmButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.ink,
  },
  importConfirmButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "800",
  },
  validationBanner: {
    marginTop: 13,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#F0CFB9",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.warningBg,
  },
  validationText: {
    flex: 1,
    color: COLORS.warning,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  editTagList: {
    marginTop: 15,
    gap: 10,
  },
  editFieldLabel: {
    marginTop: 13,
  },
  editInput: {
    minHeight: 46,
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D3DDD1",
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    fontSize: 14,
  },
  editInputMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
  },
  editActionCard: {
    marginTop: 8,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#E4E9E0",
    backgroundColor: "#F3F4EE",
  },
  editActionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  editActionTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  editActionTitle: {
    color: COLORS.inkSoft,
    fontSize: 13,
    fontWeight: "800",
  },
  editActionSubtitle: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 11,
  },
  removeActionButton: {
    width: 44,
    height: 44,
    marginLeft: 6,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF5EB",
  },
  removeButtonPressed: {
    backgroundColor: "#FDE3D0",
  },
  addActionButton: {
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD7C8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: COLORS.limeSoft,
  },
  addActionButtonPressed: {
    backgroundColor: "#E1F0CA",
  },
  addActionButtonText: {
    color: COLORS.inkSoft,
    fontSize: 12,
    fontWeight: "800",
  },
  editTagFooter: {
    marginTop: 13,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  removeTagButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFF5EB",
  },
  removeTagButtonText: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: "800",
  },
  replaceNotice: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  replaceNoticeText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  editorActions: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
  },
  editorActionsStacked: {
    flexDirection: "column",
  },
  editorActionFullWidth: {
    flex: 0,
    width: "100%",
  },
  editorMessage: {
    marginTop: 12,
    padding: 12,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  editorMessageSuccess: {
    backgroundColor: COLORS.successBg,
  },
  editorMessageError: {
    backgroundColor: COLORS.warningBg,
  },
  editorMessageText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  cardsWorkspace: {
    marginTop: 20,
  },
  mappingEmptyState: {
    minHeight: 190,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F7F2",
  },
  staleBanner: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#E5D4BD",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF7EA",
  },
  staleBannerText: {
    flex: 1,
    color: COLORS.warning,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  emptyIcon: {
    width: 46,
    height: 46,
    marginBottom: 10,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.limeSoft,
  },
  mappingEmptyTitle: {
    marginTop: 10,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "800",
  },
  mappingEmptyCopy: {
    maxWidth: 300,
    marginTop: 5,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  tagMeta: {
    alignItems: "flex-end",
  },
  tagActionCount: {
    marginBottom: 5,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  chevronButton: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF1EA",
  },
  actionChipRow: {
    paddingHorizontal: 13,
    paddingBottom: 13,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 7,
  },
  actionChip: {
    maxWidth: "42%",
    minHeight: 30,
    paddingHorizontal: 9,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EEF2E9",
  },
  actionChipText: {
    flexShrink: 1,
    color: COLORS.inkSoft,
    fontSize: 11,
    fontWeight: "700",
  },
  moreChip: {
    minHeight: 30,
    minWidth: 30,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blue,
  },
  moreChipText: {
    color: COLORS.blueInk,
    fontSize: 11,
    fontWeight: "800",
  },
  noActionsText: {
    color: COLORS.warning,
    fontSize: 11,
    fontWeight: "700",
  },
  expansionRule: {
    height: 1,
    marginBottom: 13,
    backgroundColor: COLORS.line,
  },
  serialPanel: {
    marginTop: 7,
    marginBottom: 13,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: "#EEF1EA",
  },
  serialFull: {
    color: COLORS.inkSoft,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },
  actionIcon: {
    width: 34,
    height: 34,
    marginRight: 10,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.surface,
  },
  actionDetails: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  openEditorButton: {
    minHeight: 70,
    marginTop: 12,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: "#CBD7C8",
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.limeSoft,
  },
  openEditorButtonPressed: {
    backgroundColor: "#E4F2CA",
  },
  openEditorIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: COLORS.surface,
  },
  openEditorTextWrap: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  openEditorTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "800",
  },
  openEditorCopy: {
    marginTop: 3,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  connectionCard: {
    overflow: "hidden",
    marginTop: 18,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
  },
  connectionHeader: {
    minHeight: 76,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  connectionHeaderPressed: {
    backgroundColor: "#F4F5EF",
  },
  connectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
    backgroundColor: "#EEF1EA",
  },
  connectionSummary: {
    flex: 1,
    minWidth: 0,
    marginRight: 12,
  },
  connectionTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "800",
  },
  connectionHost: {
    marginTop: 4,
    color: COLORS.muted,
    fontSize: 11,
  },
  connectionState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginRight: 10,
  },
  connectionDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.success,
  },
  connectionDotOffline: {
    backgroundColor: COLORS.coral,
  },
  connectionDotChecking: {
    backgroundColor: "#D99B3D",
  },
  connectionStateText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "700",
  },
  connectionPanel: {
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
    backgroundColor: "#F7F7F2",
  },
  connectionLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.15,
  },
  connectionHint: {
    marginTop: 6,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  connectionButton: {
    minHeight: 48,
    marginTop: 10,
    paddingHorizontal: 15,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.ink,
  },
  connectionButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "800",
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
