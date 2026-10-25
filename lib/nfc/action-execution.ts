import { Linking, Platform } from "react-native";
import { openClientApplication } from "./background-routing";
import {
  isServerAction,
  serverActionUrl,
  triggerUrl,
  type NfcAction,
} from "./tag-routing";

function applicationUri(value: string): string {
  if (value.trim().toLowerCase() !== "youtube") return value;
  return Platform.OS === "android" ? "vnd.youtube://" : "youtube://";
}

export async function executeNfcAction(action: NfcAction): Promise<void> {
  const server = isServerAction(action);
  if (action.actionType === "command" && !server) {
    throw new Error("Commands require a server target.");
  }
  if (server || action.actionType === "trigger") {
    const url = server ? serverActionUrl(action) : triggerUrl(action.val);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        let detail = "";
        if (server) {
          try {
            const body: unknown = await response.json();
            if (body && typeof body === "object") {
              const error = body as { error?: unknown; message?: unknown };
              detail =
                typeof error.error === "string"
                  ? error.error
                  : typeof error.message === "string"
                    ? error.message
                    : "";
            }
          } catch {
            // A proxy or an older launcher may return a non-JSON error body.
          }
        } else {
          await response.body?.cancel();
        }
        throw new Error(
          `${server ? "Server" : "Trigger"} request failed (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`,
        );
      }
      // The response is never rendered or passed to Linking, including redirects.
      await response.body?.cancel();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `${server ? "Server" : "Trigger"} request timed out after 10 seconds.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    return;
  }

  if (action.actionType === "open_url") {
    await Linking.openURL(action.val);
    return;
  }

  if (await openClientApplication(action.val)) return;
  const value = action.val.trim();
  if (
    value.toLowerCase() !== "youtube" &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw new Error(
      "Opening apps by name requires an updated Android build. Install the latest NFC app build, then try again.",
    );
  }
  try {
    await Linking.openURL(applicationUri(value));
  } catch (error) {
    if (action.val.trim().toLowerCase() === "youtube") {
      await Linking.openURL("https://www.youtube.com/");
      return;
    }
    throw error;
  }
}
