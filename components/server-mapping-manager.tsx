import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  normalizeServerMappingInput,
  serverMappingBaseUrl,
  type ServerMapping,
  type ServerMappingInput,
} from "@/lib/nfc/server-mappings";

type Props = {
  visible: boolean;
  onClose: () => void;
  servers: readonly ServerMapping[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onRefresh: () => void;
  onSave: (input: ServerMappingInput) => Promise<ServerMapping>;
};

export function ServerMappingManager(props: Props) {
  if (!props.visible) return null;
  return <ServerMappingManagerDialog {...props} />;
}

function ServerMappingManagerDialog({
  visible,
  onClose,
  servers,
  loading,
  error,
  saving,
  saveError,
  apiKey,
  onApiKeyChange,
  onRefresh,
  onSave,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [serverName, setServerName] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [formError, setFormError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const session = useRef(0);
  const busy = saving || submitting;

  useEffect(() => {
    return () => {
      session.current += 1;
    };
  }, []);

  const clearFeedback = () => {
    setFormError("");
    setAttempted(false);
    setSuccess("");
  };

  const editServer = (server?: ServerMapping) => {
    if (busy) return;
    setEditingId(server?.id ?? null);
    setServerName(server?.serverName ?? "");
    setIpAddress(server?.ipAddress ?? "");
    clearFeedback();
  };

  const save = async () => {
    if (busy || submitLock.current) return;
    clearFeedback();
    let input: ServerMappingInput;
    try {
      input = normalizeServerMappingInput({
        ...(editingId === null ? {} : { id: editingId }),
        serverName,
        ipAddress,
      });
      if (!apiKey.trim())
        throw new Error("Enter the admin API key to save server data.");
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Check the server name and IP address.",
      );
      return;
    }
    const savingSession = session.current;
    submitLock.current = true;
    setSubmitting(true);
    setAttempted(true);
    try {
      const saved = await onSave(input);
      if (session.current !== savingSession) return;
      setEditingId(saved.id);
      setServerName(saved.serverName);
      setIpAddress(saved.ipAddress);
      setSuccess(
        `${saved.serverName} ${input.id === undefined ? "added" : "updated"}.`,
      );
      setAttempted(false);
    } catch (error) {
      if (session.current !== savingSession) return;
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not save this server. Try again.",
      );
    } finally {
      submitLock.current = false;
      if (session.current === savingSession) setSubmitting(false);
    }
  };

  let previewUrl = "";
  try {
    previewUrl = serverMappingBaseUrl(ipAddress);
  } catch {
    /* Allow incomplete IP input. */
  }
  const displayedError = formError || (attempted ? saveError : null);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.backdrop}
      >
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.headingCopy}>
              <Text accessibilityRole="header" style={styles.title}>
                Add/Update Server Data
              </Text>
              <Text style={styles.hint}>
                Save a name and IP address for each computer.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close server manager"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onClose}
              style={[styles.close, busy && styles.disabled]}
            >
              <Ionicons name="close" size={22} color="#1D3A30" />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>SAVED SERVERS</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh server mappings"
                accessibilityState={{ disabled: loading || busy }}
                disabled={loading || busy}
                onPress={onRefresh}
                style={[
                  styles.smallButton,
                  (loading || busy) && styles.disabled,
                ]}
              >
                <Ionicons name="refresh-outline" size={16} color="#1D3A30" />
                <Text style={styles.smallButtonText}>Refresh</Text>
              </Pressable>
            </View>
            {loading ? (
              <View style={styles.notice}>
                <ActivityIndicator size="small" color="#1D3A30" />
                <Text accessibilityLiveRegion="polite" style={styles.hint}>
                  Loading servers…
                </Text>
              </View>
            ) : null}
            {error ? (
              <View style={styles.errorBox}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading server mappings"
                  accessibilityState={{ disabled: loading || busy }}
                  disabled={loading || busy}
                  onPress={onRefresh}
                  style={styles.smallButton}
                >
                  <Text style={styles.retryText}>Retry loading servers</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={styles.serverList}>
              {servers.map((server) => {
                const selected = editingId === server.id;
                return (
                  <Pressable
                    key={server.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${server.serverName}, ${server.ipAddress}`}
                    accessibilityState={{ selected, disabled: busy }}
                    disabled={busy}
                    onPress={() => editServer(server)}
                    style={({ pressed }) => [
                      styles.serverRow,
                      selected && styles.selectedRow,
                      pressed && styles.pressed,
                      busy && styles.disabled,
                    ]}
                  >
                    <Ionicons name="server-outline" size={19} color="#1D3A30" />
                    <View style={styles.rowCopy}>
                      <Text style={styles.serverName}>{server.serverName}</Text>
                      <Text style={styles.hint}>{server.ipAddress}</Text>
                    </View>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "create-outline"}
                      size={19}
                      color={selected ? "#17633F" : "#596861"}
                    />
                  </Pressable>
                );
              })}
              {!loading && !error && servers.length === 0 ? (
                <Text style={styles.empty}>
                  No server mappings yet. Add your first server below.
                </Text>
              ) : null}
            </View>
            <View style={styles.formHeading}>
              <Text style={styles.formTitle}>
                {editingId === null ? "New server" : "Edit server"}
              </Text>
              {editingId !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add a new server instead"
                  accessibilityState={{ disabled: busy }}
                  disabled={busy}
                  onPress={() => editServer()}
                  style={styles.smallButton}
                >
                  <Ionicons name="add-outline" size={17} color="#1D3A30" />
                  <Text style={styles.smallButtonText}>New server</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.fieldLabel}>SERVER NAME</Text>
            <TextInput
              accessibilityLabel="Server name"
              autoCapitalize="words"
              editable={!busy}
              maxLength={255}
              onChangeText={(value) => {
                setServerName(value);
                clearFeedback();
              }}
              placeholder="e.g. My laptop"
              placeholderTextColor="#78877F"
              style={styles.input}
              value={serverName}
            />
            <Text style={styles.fieldLabel}>IP ADDRESS</Text>
            <TextInput
              accessibilityLabel="Server IP address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              maxLength={45}
              onChangeText={(value) => {
                setIpAddress(value);
                clearFeedback();
              }}
              placeholder="e.g. 192.168.1.10"
              placeholderTextColor="#78877F"
              spellCheck={false}
              style={styles.input}
              value={ipAddress}
            />
            <Text style={styles.hint}>
              Enter an IPv4 or IPv6 address without http:// or a port. Server
              actions use port 3001.
            </Text>
            {previewUrl ? (
              <Text
                accessibilityLabel="Server URL preview"
                selectable
                style={styles.urlPreview}
              >
                {previewUrl}
              </Text>
            ) : null}
            <Text style={styles.fieldLabel}>ADMIN API KEY</Text>
            <TextInput
              accessibilityLabel="Admin API key"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              editable={!busy}
              onChangeText={(value) => {
                onApiKeyChange(value);
                clearFeedback();
              }}
              placeholder="Enter admin API key"
              placeholderTextColor="#78877F"
              secureTextEntry
              spellCheck={false}
              style={styles.input}
              value={apiKey}
            />
            <Text style={styles.hint}>
              Kept only for this session; required to save.
            </Text>
            <Text style={styles.snapshotNote}>
              Existing tag actions keep their saved address. Select the server
              again in an action to use an updated IP.
            </Text>
            {displayedError ? (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.errorText}
              >
                {displayedError}
              </Text>
            ) : null}
            {success ? (
              <Text accessibilityLiveRegion="polite" style={styles.successText}>
                {success}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add/Update Server Data"
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              onPress={() => void save()}
              style={({ pressed }) => [
                styles.saveButton,
                pressed && !busy && styles.savePressed,
                busy && styles.disabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="save-outline" size={18} color="#FFFFFF" />
              )}
              <Text style={styles.saveText}>
                {busy ? "Saving server…" : "Add/Update Server Data"}
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    backgroundColor: "rgba(16,39,31,0.45)",
  },
  dialog: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "92%",
    borderRadius: 18,
    backgroundColor: "#FFFEFB",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#DCE3DA",
  },
  header: {
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#DCE3DA",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 6 },
  title: { color: "#10271F", fontSize: 20, lineHeight: 25, fontWeight: "800" },
  close: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#F4F2EA",
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 18, gap: 8 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  sectionLabel: {
    color: "#596861",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  smallButton: {
    minHeight: 44,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
  },
  smallButtonText: { color: "#1D3A30", fontSize: 12, fontWeight: "700" },
  hint: { color: "#596861", fontSize: 12, lineHeight: 18 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  serverList: { borderRadius: 12, overflow: "hidden", gap: 4 },
  serverRow: {
    minHeight: 60,
    padding: 12,
    borderWidth: 1,
    borderColor: "#DCE3DA",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedRow: { backgroundColor: "#EDF8D9", borderColor: "#8DA77C" },
  pressed: { backgroundColor: "#E8EEE4" },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  serverName: { color: "#152720", fontSize: 13, fontWeight: "700" },
  empty: { color: "#596861", fontSize: 12, lineHeight: 18, paddingVertical: 8 },
  formHeading: {
    marginTop: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#DCE3DA",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  formTitle: { color: "#10271F", fontSize: 15, fontWeight: "800" },
  fieldLabel: {
    marginTop: 8,
    color: "#596861",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D3DDD1",
    backgroundColor: "#FFFEFB",
    color: "#152720",
    fontSize: 14,
  },
  urlPreview: { color: "#17633F", fontSize: 12, lineHeight: 18 },
  snapshotNote: {
    marginVertical: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F4F2EA",
    color: "#596861",
    fontSize: 12,
    lineHeight: 18,
  },
  errorBox: { padding: 12, borderRadius: 10, backgroundColor: "#FFF0E2" },
  errorText: { color: "#874316", fontSize: 12, lineHeight: 18 },
  retryText: { color: "#874316", fontSize: 12, fontWeight: "700" },
  successText: { color: "#17633F", fontSize: 12, lineHeight: 18 },
  saveButton: {
    minHeight: 50,
    padding: 12,
    marginTop: 4,
    borderRadius: 12,
    backgroundColor: "#10271F",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  savePressed: { backgroundColor: "#244536" },
  saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
