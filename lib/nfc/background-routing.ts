import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";
import { isServerAction, serverActionUrl, type NfcConfig } from "./tag-routing";

interface NfcBackgroundModule {
  saveConfig(configJson: string): boolean;
  clearConfig(): boolean;
  openApplication?(name: string): boolean | Promise<boolean>;
}

function getBackgroundModule(): NfcBackgroundModule | null {
  if (Platform.OS !== "android") return null;
  return requireOptionalNativeModule<NfcBackgroundModule>("NfcBackground");
}

/** Persist only the last accepted backend mapping, never an editor draft. */
export function saveBackgroundNfcConfig(config: NfcConfig): boolean {
  const module = getBackgroundModule();
  if (!module) return false;
  // Existing native services already know how to execute HTTP-only triggers.
  // Lower a copy for that cache without rewriting the editable API mapping.
  const nativeConfig = Object.fromEntries(
    Object.entries(config).map(([serial, tag]) => [
      serial,
      {
        ...tag,
        actions: tag.actions.map((action) => {
          if (!isServerAction(action)) return action;
          const lowered = {
            ...action,
            actionType: "trigger" as const,
            val: serverActionUrl(action),
          };
          delete lowered.target;
          delete lowered.serverBaseUrl;
          return lowered;
        }),
      },
    ]),
  );
  return module.saveConfig(JSON.stringify(nativeConfig));
}

/** Older builds and Expo Go can still use URI fallbacks in the caller. */
export async function openClientApplication(name: string): Promise<boolean> {
  const module = getBackgroundModule();
  if (!module?.openApplication) return false;
  return await module.openApplication(name.trim());
}

/** Prevent a previous backend's actions from surviving a host switch. */
export function clearBackgroundNfcConfig(): void {
  const module = getBackgroundModule();
  if (module && !module.clearConfig()) {
    throw new Error(
      "Could not clear saved NFC actions. Try changing the host again.",
    );
  }
}
