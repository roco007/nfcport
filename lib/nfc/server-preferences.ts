import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SERVER_BASE_URL, normalizeServerBaseUrl } from "./tag-routing";

export { DEFAULT_SERVER_BASE_URL } from "./tag-routing";

const SERVER_BASE_URL_STORAGE_KEY = "nfcport_launcher_server_base_url";
let pendingSave: Promise<void> = Promise.resolve();

export async function loadServerBaseUrl(): Promise<string> {
  await pendingSave;
  const stored = await AsyncStorage.getItem(SERVER_BASE_URL_STORAGE_KEY);
  if (!stored) return DEFAULT_SERVER_BASE_URL;
  try {
    return normalizeServerBaseUrl(stored);
  } catch {
    return DEFAULT_SERVER_BASE_URL;
  }
}

export async function saveServerBaseUrl(value: string): Promise<string> {
  // Validate before writing so a mistyped address never erases the last server.
  const normalized = normalizeServerBaseUrl(value);
  const save = pendingSave.then(() =>
    AsyncStorage.setItem(SERVER_BASE_URL_STORAGE_KEY, normalized),
  );
  // Preserve input order even if storage is slow, and let later saves recover.
  pendingSave = save.catch(() => undefined);
  await save;
  return normalized;
}
