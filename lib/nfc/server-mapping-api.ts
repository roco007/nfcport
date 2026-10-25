import { apiCall } from "../_core/api";
import { ApiError } from "../_core/api-error";
import {
  normalizeServerMappingInput,
  parseSavedServerMapping,
  parseServerMappingList,
  type ServerMappingInput,
} from "./server-mappings";

const ENDPOINT = "/api/server-mappings";

export async function fetchServerMappings(signal?: AbortSignal) {
  try {
    return parseServerMappingList(
      await apiCall<unknown>(ENDPOINT, {
        credentials: "omit",
        signal,
      }),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error(
        "Server mappings are not available on this backend. Start or deploy the updated NFC backend, then check the Backend Host URL in Connection settings.",
      );
    }
    throw error;
  }
}

export async function saveServerMapping(
  input: ServerMappingInput,
  apiKey: string,
) {
  const normalized = normalizeServerMappingInput(input);
  if (!apiKey.trim())
    throw new Error("Enter the backend Admin API key to save server data.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return parseSavedServerMapping(
      await apiCall<unknown>(ENDPOINT, {
        method: "POST",
        credentials: "omit",
        headers: { "X-API-Key": apiKey.trim() },
        body: JSON.stringify(normalized),
        signal: controller.signal,
      }),
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "The save timed out. Refresh the servers before retrying to check whether it was saved.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
