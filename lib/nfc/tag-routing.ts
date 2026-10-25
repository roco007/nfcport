export type NfcActionType =
  | "open_url"
  | "open_application"
  | "trigger"
  | "command";
export type NfcActionTarget = "client" | "server";
export const DEFAULT_SERVER_BASE_URL = "http://nfc-lappy.local:3001";

export interface NfcAction {
  actionType: NfcActionType;
  val: string;
  displayName?: string;
  target?: NfcActionTarget;
  serverBaseUrl?: string;
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

/** Trigger values are network endpoints, never application or browser intents. */
export function triggerUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (/^https?:\/\//i.test(trimmed) && url.hostname) return url.toString();
  } catch {
    // Use one actionable error for malformed URLs and unsupported schemes.
  }
  throw new Error("Trigger actions require an HTTP or HTTPS URL.");
}

/** The launcher address is independent of the backend that stores mappings. */
export function normalizeServerBaseUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (
      /^https?:\/\//i.test(trimmed) &&
      url.hostname &&
      !url.username &&
      !url.password &&
      !trimmed.includes("?") &&
      !trimmed.includes("#")
    ) {
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // Keep invalid input from replacing a working launcher address.
  }
  throw new Error(
    "Server URL must be an HTTP or HTTPS address without credentials, query parameters, or a fragment.",
  );
}

function serverDestinationUrl(value: string): string {
  try {
    return triggerUrl(value);
  } catch {
    throw new Error("Server Open URL actions require an HTTP or HTTPS URL.");
  }
}

/** Keep command paths editable; encode their segments only when making a URL. */
function normalizeCommandPath(value: string): string {
  const path = value
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (
    !path ||
    /[\p{Cc}\\%?#:]/u.test(path) ||
    path
      .split("/")
      .some((segment) => !segment.trim() || segment === "." || segment === "..")
  ) {
    throw new Error(
      "Commands require a relative path such as unlock, without URLs, query parameters, fragments, encoded escapes, or dot segments.",
    );
  }
  return path;
}

export function isServerAction(action: NfcAction): boolean {
  return action.target === "server";
}

/** Derive the HTTP endpoint only at execution time; val remains human-editable. */
export function serverActionUrl(action: NfcAction): string {
  if (!isServerAction(action)) {
    throw new Error("This action does not target a server.");
  }
  const base = normalizeServerBaseUrl(action.serverBaseUrl ?? "");
  if (action.actionType === "open_url") {
    return `${base}/open-url?url=${encodeURIComponent(serverDestinationUrl(action.val))}`;
  }
  if (action.actionType === "open_application" && action.val.trim()) {
    return `${base}/open/${encodeURIComponent(action.val.trim())}`;
  }
  if (action.actionType === "command") {
    const path = normalizeCommandPath(action.val)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    return `${base}/${path}`;
  }
  throw new Error(
    "Server actions must be Open App, Open URL, or Commands with a value.",
  );
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
      (type !== "open_url" &&
        type !== "open_application" &&
        type !== "trigger" &&
        type !== "command") ||
      typeof action.val !== "string" ||
      !action.val.trim()
    ) {
      throw new Error(`Invalid action for ${serial}`);
    }
    const extra = { ...action };
    delete extra.actionType;
    delete extra.ationType;
    delete extra.val;
    delete extra.displayName;
    delete extra.target;
    delete extra.serverBaseUrl;
    if (
      action.target !== undefined &&
      action.target !== "client" &&
      action.target !== "server"
    ) {
      throw new Error(`Invalid action target for ${serial}`);
    }
    const server = action.target === "server";
    if (type === "command" && !server) {
      throw new Error("Commands require a server target.");
    }
    if (server && type === "trigger") {
      throw new Error(
        "Server actions must be Open App, Open URL, or Commands.",
      );
    }
    const serverBaseUrl = server
      ? normalizeServerBaseUrl(
          typeof action.serverBaseUrl === "string" ? action.serverBaseUrl : "",
        )
      : undefined;
    return {
      ...extra,
      actionType: type,
      val:
        type === "trigger"
          ? triggerUrl(action.val)
          : type === "command"
            ? normalizeCommandPath(action.val)
            : server
              ? type === "open_url"
                ? serverDestinationUrl(action.val)
                : action.val.trim()
              : action.val,
      ...(server ? { target: "server" as const, serverBaseUrl } : {}),
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

  // Preserve every raw key so invalid serials cannot disappear during import.
  const config: NfcConfig = Object.create(null);
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
    const extra = { ...tag };
    delete extra.name;
    delete extra.actions;
    config[serial] = {
      ...extra,
      name: tag.name.trim(),
      actions: parseActions(serial, tag.actions),
    };
  }
  return config;
}

/** Parse editable mapping JSON and provide a clear message for syntax errors. */
export function parseNfcConfigJson(input: string): NfcConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(
      "Mapping JSON is invalid. Check the commas, quotes, and brackets.",
    );
  }

  return parseNfcConfig(parsed);
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
    ...entry[1],
    serial: entry[0],
    normalizedSerial: normalizeNfcSerial(entry[0]),
  };
}

export function getConfiguredTags(config: NfcConfig): ConfiguredNfcTag[] {
  return Object.entries(config).map(([serial, tag]) => ({
    ...tag,
    serial,
    normalizedSerial: normalizeNfcSerial(serial),
  }));
}

export function formatNfcSerial(serial: string | null | undefined): string {
  const normalizedSerial = normalizeNfcSerial(serial);
  if (!normalizedSerial) return "Serial unavailable";
  return normalizedSerial.match(/.{1,2}/g)?.join(":") ?? normalizedSerial;
}
