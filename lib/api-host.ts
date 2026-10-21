import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL, getApiBaseUrl } from "@/constants/oauth";

const API_HOST_STORAGE_KEY = "nfcport_api_host";
let currentApiHost = getApiBaseUrl();

export function getConfiguredApiHost(): string {
  return currentApiHost;
}

export async function loadConfiguredApiHost(): Promise<string> {
  const saved = await AsyncStorage.getItem(API_HOST_STORAGE_KEY);
  currentApiHost = saved?.trim() || getApiBaseUrl();
  return currentApiHost;
}

export async function saveConfiguredApiHost(host: string): Promise<void> {
  const normalizedHost = host.trim().replace(/\/+$/, "");
  if (normalizedHost) {
    const parsed = new URL(normalizedHost);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Host URL must start with http:// or https://");
    }
    await AsyncStorage.setItem(API_HOST_STORAGE_KEY, normalizedHost);
    currentApiHost = normalizedHost;
  } else {
    await AsyncStorage.removeItem(API_HOST_STORAGE_KEY);
    currentApiHost = API_BASE_URL || getApiBaseUrl();
  }
}
