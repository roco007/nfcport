import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  serverMappingBaseUrl,
  type ServerMapping,
} from "@/lib/nfc/server-mappings";
import { normalizeServerBaseUrl } from "@/lib/nfc/tag-routing";

type Props = {
  value: string;
  label: string;
  servers: readonly ServerMapping[];
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onSelect: (server: ServerMapping) => void;
  onRefresh: () => void;
  onManage: () => void;
};

export function ServerMappingSelector({
  value,
  label,
  servers,
  loading,
  error,
  disabled,
  onSelect,
  onRefresh,
  onManage,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  let selected: ServerMapping | undefined;
  try {
    const currentUrl = normalizeServerBaseUrl(value);
    selected = servers.find(
      (server) =>
        normalizeServerBaseUrl(serverMappingBaseUrl(server.ipAddress)) ===
        currentUrl,
    );
  } catch {
    // Keep a custom saved URL visible while the server list is unavailable.
  }
  const hasCustomUrl = Boolean(value.trim()) && !selected;
  const selectedName =
    selected?.serverName ||
    (hasCustomUrl ? "Current server" : "Choose a server");

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Server for ${label}: ${selectedName}`}
        accessibilityHint="Choose a saved server or add a server mapping."
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={() => {
          if (!expanded && !loading) onRefresh();
          setExpanded((current) => !current);
        }}
        style={({ pressed }) => [
          styles.trigger,
          expanded && styles.triggerExpanded,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
      >
        <Ionicons name="server-outline" size={19} color="#1D3A30" />
        <View style={styles.copy}>
          <Text style={styles.serverName}>{selectedName}</Text>
          {selected || hasCustomUrl ? (
            <Text style={styles.address}>{selected?.ipAddress || value}</Text>
          ) : null}
        </View>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={17}
          color="#596861"
        />
      </Pressable>
      {expanded ? (
        <View style={styles.menu}>
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
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry loading servers"
                accessibilityState={{ disabled: loading || disabled }}
                disabled={loading || disabled}
                onPress={onRefresh}
                style={styles.retry}
              >
                <Ionicons name="refresh-outline" size={16} color="#874316" />
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={styles.options}
          >
            {hasCustomUrl ? (
              <View style={[styles.option, styles.selectedOption]}>
                <View style={styles.copy}>
                  <Text style={styles.serverName}>Current server</Text>
                  <Text style={styles.address} selectable>
                    {value}
                  </Text>
                  <Text style={styles.hint}>
                    Saved URL · kept until you choose a server
                  </Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color="#17633F" />
              </View>
            ) : null}
            {servers.map((server) => {
              const checked = selected?.id === server.id;
              return (
                <Pressable
                  key={server.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${server.serverName}, ${server.ipAddress}`}
                  accessibilityState={{ selected: checked, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(server);
                    setExpanded(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    checked && styles.selectedOption,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.copy}>
                    <Text style={styles.serverName}>{server.serverName}</Text>
                    <Text style={styles.address}>{server.ipAddress}</Text>
                  </View>
                  {checked ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={20}
                      color="#17633F"
                    />
                  ) : null}
                </Pressable>
              );
            })}
            {!loading && !error && servers.length === 0 ? (
              <Text style={styles.empty}>
                No server mappings yet. Add your computer below.
              </Text>
            ) : null}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add server mapping"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => {
              setExpanded(false);
              onManage();
            }}
            style={({ pressed }) => [styles.add, pressed && styles.pressed]}
          >
            <Ionicons name="add-circle-outline" size={19} color="#1D3A30" />
            <Text style={styles.addText}>Add server mapping</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 7 },
  trigger: {
    minHeight: 56,
    padding: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D3DDD1",
    backgroundColor: "#FFFEFB",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  triggerExpanded: { borderColor: "#8DA77C" },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  serverName: { color: "#152720", fontSize: 13, fontWeight: "700" },
  address: { color: "#596861", fontSize: 12, lineHeight: 17 },
  hint: { color: "#596861", fontSize: 11, lineHeight: 16 },
  menu: {
    marginTop: 6,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D3DDD1",
    backgroundColor: "#FFFEFB",
    overflow: "hidden",
  },
  options: { maxHeight: 240 },
  option: {
    minHeight: 52,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedOption: { backgroundColor: "#EDF8D9" },
  pressed: { backgroundColor: "#E8EEE4" },
  disabled: { opacity: 0.55 },
  notice: { padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  errorBox: { padding: 12, gap: 3, backgroundColor: "#FFF0E2" },
  error: { color: "#874316", fontSize: 12, lineHeight: 17 },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  retryText: { color: "#874316", fontSize: 12, fontWeight: "700" },
  empty: { padding: 12, color: "#596861", fontSize: 12, lineHeight: 18 },
  add: {
    minHeight: 48,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderTopWidth: 1,
    borderTopColor: "#DCE3DA",
  },
  addText: { color: "#1D3A30", fontSize: 12, fontWeight: "800" },
});
