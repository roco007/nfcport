#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "dotenv";

function isPrivateIpv4(address) {
  if (isIP(address) !== 4) return false;
  const [first, second] = address.split(".").map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function findLanIp() {
  const override = process.env.NFCPORT_LAN_IP?.trim();
  if (override) {
    if (!isPrivateIpv4(override)) {
      throw new Error("NFCPORT_LAN_IP must be a private IPv4 address.");
    }
    return override;
  }

  const candidates = Object.entries(networkInterfaces())
    .flatMap(([name, addresses]) =>
      (addresses ?? []).map((entry) => ({ name, ...entry })),
    )
    .filter((entry) => !entry.internal && isPrivateIpv4(entry.address));
  candidates.sort((a, b) => {
    const rank = (entry) =>
      (entry.address.startsWith("192.168.") ? 10 : 0) +
      (entry.name === "en0" ? 1 : 0);
    return rank(b) - rank(a);
  });
  if (!candidates.length) {
    throw new Error(
      "No private LAN address found. Connect to Wi-Fi or set NFCPORT_LAN_IP.",
    );
  }
  return candidates[0].address;
}

export async function existingDevServersReady(webOrigin, apiOrigin) {
  try {
    const [web, api, catalog] = await Promise.all([
      fetch(webOrigin, { signal: AbortSignal.timeout(2_000) }),
      fetch(`${apiOrigin}/api/health`, {
        headers: { Origin: webOrigin },
        signal: AbortSignal.timeout(2_000),
      }),
      fetch(`${apiOrigin}/api/server-mappings`, {
        headers: { Origin: webOrigin },
        signal: AbortSignal.timeout(2_000),
      }),
    ]);
    if (!web.ok || api.status !== 200 || catalog.status !== 200) return false;
    const [html, health, mappings] = await Promise.all([
      web.text(),
      api.json(),
      catalog.json(),
    ]);
    return (
      html.includes("PORTFOLIO PASS") &&
      health?.ok === true &&
      health.status === "ok" &&
      typeof health.service === "string" &&
      health.service.trim().length > 0 &&
      typeof health.version === "string" &&
      health.version.trim().length > 0 &&
      Array.isArray(mappings?.servers) &&
      api.headers.get("access-control-allow-origin") === webOrigin &&
      catalog.headers.get("access-control-allow-origin") === webOrigin
    );
  } catch {
    return false;
  }
}

export function devCorsOrigins(webOrigin, configuredOrigins = "") {
  const origins = new Set(
    [
      ...configuredOrigins.split(","),
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      webOrigin,
    ]
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
        throw new Error("Invalid origin");
    } catch {
      throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins.");
    }
  }
  return [...origins].join(",");
}

function backendCorsOrigins() {
  try {
    return parse(readFileSync(new URL("../backend/.env", import.meta.url)))
      .CORS_ORIGINS;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function main() {
  try {
    const lanIp = findLanIp();
    const webOrigin = `http://${lanIp}:8081`;
    const apiOrigin = `http://${lanIp}:3000`;
    const env = {
      ...process.env,
      HOST: "0.0.0.0",
      // Only forward the CORS setting, never the backend's credentials to Expo.
      CORS_ORIGINS: devCorsOrigins(
        webOrigin,
        process.env.CORS_ORIGINS ?? backendCorsOrigins(),
      ),
      EXPO_WEB_PREVIEW_URL: webOrigin,
      EXPO_PUBLIC_API_BASE_URL: apiOrigin,
    };

    console.log(`LAN web: ${webOrigin}`);
    console.log(`LAN API: ${apiOrigin}`);
    const alreadyRunning = await existingDevServersReady(webOrigin, apiOrigin);
    if (alreadyRunning) {
      console.log("LAN development servers are already running.");
    } else {
      const child = spawn(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["dev"],
        {
          env,
          stdio: "inherit",
        },
      );
      for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => child.kill(signal));
      }
      child.on("error", (error) => {
        console.error(
          `Could not start LAN development servers: ${error.message}`,
        );
        process.exitCode = 1;
      });
      child.on("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
