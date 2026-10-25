import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ServerMappingSelector } from "@/components/server-mapping-selector";
import type { ActionDraft } from "@/lib/nfc/mapping-editor";
import { serverActionUrl, type NfcActionTarget } from "@/lib/nfc/tag-routing";
import {
  serverMappingBaseUrl,
  type ServerMapping,
} from "@/lib/nfc/server-mappings";

const GROUPS = [
  {
    target: "client",
    label: "Client Action",
    description: "Runs on this phone",
    icon: "phone-portrait-outline",
  },
  {
    target: "server",
    label: "Server Action",
    description: "Runs on your connected computer",
    icon: "desktop-outline",
  },
] as const;
const CHOICES = [
  { type: "open_application", label: "Open App", icon: "apps-outline" },
  { type: "open_url", label: "Open URL", icon: "globe-outline" },
] as const;
const SERVER_CHOICES = [
  ...CHOICES,
  { type: "command", label: "Commands", icon: "terminal-outline" },
] as const;

type Props = {
  action: ActionDraft;
  label: string;
  disabled: boolean;
  defaultServerBaseUrl: string;
  onChange: (patch: Partial<ActionDraft>) => void;
  onRememberServerBaseUrl: (value: string) => Promise<void>;
  serverMappings: readonly ServerMapping[];
  serverMappingsLoading: boolean;
  serverMappingsError: string | null;
  onRefreshServers: () => void;
  onManageServers: (onSelected?: (server: ServerMapping) => void) => void;
};

export function NfcActionEditor({
  action,
  label,
  disabled,
  defaultServerBaseUrl,
  onChange,
  onRememberServerBaseUrl,
  serverMappings,
  serverMappingsLoading,
  serverMappingsError,
  onRefreshServers,
  onManageServers,
}: Props) {
  const [baseMessage, setBaseMessage] = useState("");
  const legacyTrigger = action.actionType === "trigger";
  const serverAction = action.target === "server" && !legacyTrigger;
  const appAction = action.actionType === "open_application";
  const commandAction = action.actionType === "command";

  const rememberBase = async (value = action.serverBaseUrl) => {
    if (!serverAction) return;
    try {
      await onRememberServerBaseUrl(value);
      setBaseMessage("");
    } catch (error) {
      setBaseMessage(
        error instanceof Error
          ? error.message
          : "Could not remember the server URL.",
      );
    }
  };

  const choose = (
    target: NfcActionTarget,
    actionType: Exclude<ActionDraft["actionType"], "trigger">,
  ) => {
    if (serverAction) void rememberBase();
    setBaseMessage("");
    onChange({
      target,
      actionType,
      val: action.actionType === actionType ? action.val : "",
      serverBaseUrl:
        target === "server" && action.target !== "server"
          ? defaultServerBaseUrl
          : action.serverBaseUrl,
    });
  };

  const selectServer = (server: ServerMapping) => {
    try {
      const serverBaseUrl = serverMappingBaseUrl(server.ipAddress);
      setBaseMessage("");
      onChange({ serverBaseUrl });
      void rememberBase(serverBaseUrl);
    } catch (error) {
      setBaseMessage(
        error instanceof Error
          ? error.message
          : "Choose a server with a valid IP address.",
      );
    }
  };
  let commandUrl = "";
  if (serverAction && commandAction) {
    try {
      commandUrl = serverActionUrl(action);
    } catch {
      // Keep the draft editable while the base URL or command is incomplete.
    }
  }

  return (
    <View style={styles.editor}>
      {GROUPS.map((group) => {
        const selected = legacyTrigger
          ? group.target === "server"
          : action.target === group.target;
        return (
          <View
            key={group.target}
            style={[styles.group, selected && styles.groupSelected]}
          >
            <View style={styles.groupHeading}>
              <Ionicons name={group.icon} size={19} color="#1D3A30" />
              <View style={styles.headingCopy}>
                <Text style={styles.groupTitle}>{group.label}</Text>
                <Text style={styles.hint}>{group.description}</Text>
              </View>
            </View>
            <View style={styles.choices}>
              {(group.target === "server" ? SERVER_CHOICES : CHOICES).map(
                (choice) => {
                  const checked =
                    !legacyTrigger &&
                    action.target === group.target &&
                    action.actionType === choice.type;
                  return (
                    <Pressable
                      key={choice.type}
                      accessibilityRole="radio"
                      accessibilityLabel={`${group.label}: ${choice.label} for ${label}`}
                      accessibilityState={{ checked, disabled }}
                      disabled={disabled}
                      onPress={() => choose(group.target, choice.type)}
                      style={({ pressed }) => [
                        styles.choice,
                        checked && styles.choiceSelected,
                        pressed && !checked && styles.choicePressed,
                        disabled && styles.disabled,
                      ]}
                    >
                      <Ionicons
                        name={choice.icon}
                        size={17}
                        color={checked ? "#FFFFFF" : "#1D3A30"}
                      />
                      <Text
                        style={[
                          styles.choiceText,
                          checked && styles.choiceTextSelected,
                        ]}
                      >
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                },
              )}
            </View>
            {group.target === "server" && legacyTrigger ? (
              <Text style={styles.legacy}>
                Existing HTTP trigger. It will keep working; choose an option
                above to replace it.
              </Text>
            ) : null}
            {group.target === "server" && serverAction ? (
              <View>
                <Text style={styles.fieldLabel}>SERVER</Text>
                <ServerMappingSelector
                  label={label}
                  value={action.serverBaseUrl}
                  servers={serverMappings}
                  loading={serverMappingsLoading}
                  error={serverMappingsError}
                  disabled={disabled}
                  onSelect={selectServer}
                  onRefresh={onRefreshServers}
                  onManage={() => onManageServers(selectServer)}
                />
                <Text
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.hint,
                    styles.inputHint,
                    baseMessage ? styles.error : undefined,
                  ]}
                >
                  {baseMessage ||
                    "Remembered automatically for your next server action."}
                </Text>
              </View>
            ) : null}
          </View>
        );
      })}

      <Text style={styles.fieldLabel}>
        {appAction
          ? "APP NAME"
          : commandAction
            ? "COMMAND"
            : legacyTrigger
              ? "EXISTING TRIGGER URL"
              : "URL TO OPEN"}
      </Text>
      <TextInput
        accessibilityLabel={`Target for ${label}`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        keyboardType={appAction || commandAction ? "default" : "url"}
        onChangeText={(val) => onChange({ val })}
        placeholder={
          appAction
            ? serverAction
              ? "e.g. Spotify or Calculator"
              : "e.g. WhatsApp or YouTube"
            : commandAction
              ? "unlock"
              : legacyTrigger
                ? "http://nfc-lappy.local:3001/health"
                : "Paste a website, video or playlist link"
        }
        placeholderTextColor="#78877F"
        spellCheck={false}
        style={styles.input}
        value={action.val}
      />
      <Text style={[styles.hint, styles.inputHint]}>
        {legacyTrigger
          ? "Sends a request without opening anything on your phone."
          : commandAction
            ? "Sends a request directly to this command on your server."
            : serverAction
              ? appAction
                ? "Use the app name as it appears on your computer."
                : "YouTube and YouTube Music media links play in their installed web apps. Other links open on your computer."
              : appAction
                ? "Use the installed Android app name. Package IDs and existing deep links also work."
                : "Opens on this device using its default app for the link."}
      </Text>
      {serverAction && commandAction ? (
        <View style={styles.commandPreview}>
          <Text style={styles.previewLabel}>EFFECTIVE URL</Text>
          <Text
            accessibilityLabel={`Effective URL for ${label}`}
            accessibilityLiveRegion="polite"
            selectable
            style={styles.previewUrl}
          >
            {commandUrl ||
              "Enter a valid server URL and command to preview the request."}
          </Text>
        </View>
      ) : null}
      <Text style={styles.fieldLabel}>
        DISPLAY NAME <Text style={styles.optional}>(optional)</Text>
      </Text>
      <TextInput
        accessibilityLabel={`Display name for ${label}`}
        editable={!disabled}
        onChangeText={(displayName) => onChange({ displayName })}
        placeholder="e.g. Start my playlist"
        placeholderTextColor="#78877F"
        style={styles.input}
        value={action.displayName}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { gap: 0 },
  group: {
    padding: 12,
    marginBottom: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DCE3DA",
    backgroundColor: "#FFFEFB",
  },
  groupSelected: { borderColor: "#8DA77C", backgroundColor: "#F4F9EC" },
  groupHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 10,
  },
  headingCopy: { flex: 1 },
  groupTitle: { color: "#10271F", fontSize: 14, fontWeight: "800" },
  hint: { color: "#596861", fontSize: 12, lineHeight: 17 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    flexGrow: 1,
    minHeight: 46,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE3DA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#FFFEFB",
  },
  choiceSelected: { borderColor: "#10271F", backgroundColor: "#10271F" },
  choicePressed: { backgroundColor: "#E8EEE4" },
  choiceText: { color: "#1D3A30", fontSize: 12, fontWeight: "800" },
  choiceTextSelected: { color: "#FFFFFF" },
  disabled: { opacity: 0.55 },
  fieldLabel: {
    marginTop: 12,
    color: "#596861",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  optional: { fontWeight: "500", letterSpacing: 0 },
  input: {
    minHeight: 48,
    marginTop: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D3DDD1",
    backgroundColor: "#FFFEFB",
    color: "#152720",
    fontSize: 14,
  },
  inputHint: { marginTop: 6 },
  commandPreview: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#EDF8D9",
    gap: 5,
  },
  previewLabel: {
    color: "#596861",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  previewUrl: { color: "#1D3A30", fontSize: 12, lineHeight: 18 },
  error: { color: "#874316" },
  legacy: { marginTop: 9, color: "#874316", fontSize: 12, lineHeight: 18 },
});
