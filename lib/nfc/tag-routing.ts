export type NfcActionType = "open_url" | "open_application";

export interface NfcAction {
  actionType: NfcActionType;
  val: string;
  displayName?: string;
}

export interface NfcTagConfig {
  name: string;
  actions: NfcAction[];
}

export type NfcConfig = Record<string, NfcTagConfig>;

export interface ConfiguredNfcTag extends NfcTagConfig {
  serial: string;
  normalizedSerial: string;
}

/** NFC APIs may return serials with different separators or letter casing. */
export function normalizeNfcSerial(serial: string | null | undefined): string {
  return (serial ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function parseActions(serial: string, input: unknown): NfcAction[] {
  if (!Array.isArray(input)) {
    throw new Error(`Actions for ${serial} must be an array`);
  }
  return input.map((rawAction) => {
    if (!rawAction || typeof rawAction !== "object") {
      throw new Error(`Invalid action for ${serial}`);
    }
    const action = rawAction as Record<string, unknown>;
    const type = action.actionType ?? action.ationType;
    if (
      (type !== "open_url" && type !== "open_application") ||
      typeof action.val !== "string" ||
      !action.val.trim()
    ) {
      throw new Error(`Invalid action for ${serial}`);
    }
    return {
      actionType: type,
      val: action.val,
      displayName:
        typeof action.displayName === "string" && action.displayName.trim()
          ? action.displayName.trim()
          : undefined,
    };
  });
}

/** Parse serial-keyed named tags, while tolerating the earlier serial-to-array format. */
export function parseNfcConfig(input: unknown): NfcConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("NFC configuration must be a serial-to-tag object");
  }

  const config: NfcConfig = {};
  for (const [serial, rawTag] of Object.entries(input)) {
    if (Array.isArray(rawTag)) {
      config[serial] = {
        name: `Tag ${Object.keys(config).length + 1}`,
        actions: parseActions(serial, rawTag),
      };
      continue;
    }
    if (!rawTag || typeof rawTag !== "object") {
      throw new Error(`Tag configuration for ${serial} must be an object`);
    }
    const tag = rawTag as Record<string, unknown>;
    if (typeof tag.name !== "string" || !tag.name.trim()) {
      throw new Error(`Tag name for ${serial} must be a non-empty string`);
    }
    config[serial] = {
      name: tag.name.trim(),
      actions: parseActions(serial, tag.actions),
    };
  }
  return config;
}

export function findTagForSerial(
  config: NfcConfig,
  serial: string | null | undefined,
): ConfiguredNfcTag | undefined {
  const normalizedSerial = normalizeNfcSerial(serial);
  if (!normalizedSerial) return undefined;
  const entry = Object.entries(config).find(
    ([configuredSerial]) =>
      normalizeNfcSerial(configuredSerial) === normalizedSerial,
  );
  if (!entry) return undefined;
  return {
    serial: entry[0],
    normalizedSerial: normalizeNfcSerial(entry[0]),
    ...entry[1],
  };
}

export function getConfiguredTags(config: NfcConfig): ConfiguredNfcTag[] {
  return Object.entries(config).map(([serial, tag]) => ({
    serial,
    normalizedSerial: normalizeNfcSerial(serial),
    ...tag,
  }));
}

export function formatNfcSerial(serial: string | null | undefined): string {
  const normalizedSerial = normalizeNfcSerial(serial);
  if (!normalizedSerial) return "Serial unavailable";
  return normalizedSerial.match(/.{1,2}/g)?.join(":") ?? normalizedSerial;
}
