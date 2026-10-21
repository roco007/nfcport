export type NfcActionType = "open_url" | "open_application";

export interface NfcAction {
  actionType: NfcActionType;
  val: string;
}

export type NfcConfig = Record<string, NfcAction[]>;

export interface PortfolioDestination {
  serial: string;
  normalizedSerial: string;
  label: string;
  url: string;
}

/** NFC APIs may return serials with different separators or letter casing. */
export function normalizeNfcSerial(serial: string | null | undefined): string {
  return (serial ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

/** Accepts both `actionType` and the `ationType` spelling in the example payload. */
export function parseNfcConfig(input: unknown): NfcConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("NFC configuration must be a serial-to-actions object");
  }

  const config: NfcConfig = {};
  for (const [serial, rawActions] of Object.entries(input)) {
    if (!Array.isArray(rawActions)) {
      throw new Error(`Actions for ${serial} must be an array`);
    }
    config[serial] = rawActions.map((rawAction) => {
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
      return { actionType: type, val: action.val };
    });
  }
  return config;
}

export function findActionsForTag(
  config: NfcConfig,
  serial: string | null | undefined,
): NfcAction[] | undefined {
  const normalizedSerial = normalizeNfcSerial(serial);
  if (!normalizedSerial) return undefined;
  const entry = Object.entries(config).find(
    ([configuredSerial]) => normalizeNfcSerial(configuredSerial) === normalizedSerial,
  );
  return entry?.[1];
}

export function getConfiguredDestinations(config: NfcConfig): PortfolioDestination[] {
  return Object.entries(config).flatMap(([serial, actions]) => {
    const urlAction = actions.find((action) => action.actionType === "open_url");
    if (!urlAction) return [];
    return [{
      serial,
      normalizedSerial: normalizeNfcSerial(serial),
      label: new URL(urlAction.val).hostname,
      url: urlAction.val,
    }];
  });
}

export function formatNfcSerial(serial: string | null | undefined): string {
  const normalizedSerial = normalizeNfcSerial(serial);
  if (!normalizedSerial) return "Serial unavailable";
  return normalizedSerial.match(/.{1,2}/g)?.join(":") ?? normalizedSerial;
}
