import {
  DEFAULT_SERVER_BASE_URL,
  isServerAction,
  normalizeNfcSerial,
  parseNfcConfig,
  parseNfcConfigJson,
  serverActionUrl,
  triggerUrl,
  type NfcAction,
  type NfcActionType,
  type NfcActionTarget,
  type NfcConfig,
} from "./tag-routing";

export interface ActionDraft {
  id: string;
  actionType: NfcActionType;
  val: string;
  displayName: string;
  target: NfcActionTarget;
  serverBaseUrl: string;
  extra?: Record<string, unknown>;
}

export interface TagDraft {
  id: string;
  serial: string;
  name: string;
  actions: ActionDraft[];
  extra?: Record<string, unknown>;
}

/** Recognize only the launcher's exact old routes; custom triggers stay intact. */
function editableAction(action: NfcAction): NfcAction {
  if (action.actionType !== "trigger" || isServerAction(action)) return action;
  try {
    const url = new URL(action.val);
    if (url.username || url.password || action.val.includes("#")) return action;
    let replacement: NfcAction | undefined;
    const appPath = url.pathname.match(/^\/open\/([^/]+)$/);
    if (appPath && !action.val.includes("?")) {
      replacement = {
        ...action,
        actionType: "open_application",
        target: "server",
        serverBaseUrl: url.origin,
        val: decodeURIComponent(appPath[1]).trim(),
      };
    } else if (url.pathname === "/open-url" || url.pathname === "/play") {
      const params = Array.from(url.searchParams.entries());
      if (params.length === 1 && params[0][0] === "url") {
        replacement = {
          ...action,
          actionType: "open_url",
          target: "server",
          serverBaseUrl: url.origin,
          val: triggerUrl(params[0][1]),
        };
      }
    }
    if (replacement) {
      serverActionUrl(replacement);
      return replacement;
    }
  } catch {
    // Invalid escapes or unsupported destinations must not change old actions.
  }
  return action;
}

/** Give React stable row ids while keeping fields outside the card editor intact. */
export function draftFromConfig(
  config: NfcConfig,
  nextId: () => string,
): TagDraft[] {
  return Object.entries(config).map(([serial, tag]) => {
    const { name, actions, ...extra } = tag;
    return {
      id: nextId(),
      serial,
      name,
      actions: actions.map((action) => {
        const {
          actionType,
          val,
          displayName,
          target,
          serverBaseUrl,
          ...actionExtra
        } = editableAction(action);
        return {
          id: nextId(),
          actionType,
          val,
          displayName: displayName ?? "",
          target: target ?? "client",
          serverBaseUrl: serverBaseUrl ?? DEFAULT_SERVER_BASE_URL,
          ...(Object.keys(actionExtra).length ? { extra: actionExtra } : {}),
        };
      }),
      ...(Object.keys(extra).length ? { extra } : {}),
    };
  });
}

export function newTagDraft(id: string): TagDraft {
  return { id, serial: "", name: "", actions: [] };
}

export function newActionDraft(
  id: string,
  serverBaseUrl = DEFAULT_SERVER_BASE_URL,
): ActionDraft {
  return {
    id,
    actionType: "open_url",
    val: "",
    displayName: "",
    target: "client",
    serverBaseUrl,
  };
}

/** Accept a complete mapping file only when the card editor can save it. */
export function importDraftFromJson(
  input: string,
  nextId: () => string,
): TagDraft[] {
  const draft = draftFromConfig(parseNfcConfigJson(input), nextId);
  configFromDraft(draft);
  return draft;
}

/** Export the current editor contents, including edits not saved to the API. */
export function exportDraftAsJson(tags: readonly TagDraft[]): string {
  return `${JSON.stringify(configFromDraft(tags), null, 2)}\n`;
}

/** IDs belong to the editor, so recreating them does not make content dirty. */
export function draftFingerprint(tags: readonly TagDraft[]): string {
  return JSON.stringify(
    tags.map((tag) => ({
      serial: tag.serial,
      name: tag.name,
      extra: tag.extra,
      actions: tag.actions.map((action) => ({
        actionType: action.actionType,
        val: action.val,
        displayName: action.displayName,
        target: action.target,
        serverBaseUrl: action.serverBaseUrl,
        extra: action.extra,
      })),
    })),
  );
}

/** Build the full serial-keyed document, then reuse its existing action checks. */
export function configFromDraft(tags: readonly TagDraft[]): NfcConfig {
  const config: NfcConfig = {};
  const normalizedSerials = new Set<string>();

  for (const tag of tags) {
    const serial = tag.serial.trim();
    const normalizedSerial = normalizeNfcSerial(serial);
    if (
      !serial ||
      !/^[0-9a-fA-F: -]+$/.test(serial) ||
      !normalizedSerial ||
      normalizedSerial.length % 2 !== 0
    ) {
      throw new Error(
        `Tag serial "${serial}" must contain whole hexadecimal bytes; colons, hyphens, and spaces are allowed.`,
      );
    }
    if (normalizedSerials.has(normalizedSerial)) {
      throw new Error(`Tag serial "${serial}" duplicates another tag.`);
    }
    normalizedSerials.add(normalizedSerial);

    config[serial] = {
      ...tag.extra,
      name: tag.name,
      actions: tag.actions.map((action) => ({
        ...action.extra,
        actionType: action.actionType,
        val: action.val,
        displayName: action.displayName,
        target: action.target,
        serverBaseUrl: action.serverBaseUrl,
      })),
    };
  }

  return parseNfcConfig(config);
}
