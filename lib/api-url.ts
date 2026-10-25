function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Pair local Expo web with its starter API, while keeping hosted preview URLs. */
export function apiBaseUrlForWebLocation(location: string): string {
  try {
    const url = new URL(location);
    const pairedHostname = url.hostname.replace(/^8081-/, "3000-");
    if (pairedHostname !== url.hostname) {
      url.hostname = pairedHostname;
      url.port = "";
      return url.origin;
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const isLocalHost =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.startsWith("127.") ||
      hostname === "::1" ||
      isPrivateIpv4(hostname);
    if (url.protocol === "http:" && url.port === "8081" && isLocalHost) {
      url.port = "3000";
      return url.origin;
    }
  } catch {
    // An unrecognized location should keep the existing relative-URL behavior.
  }
  return "";
}
