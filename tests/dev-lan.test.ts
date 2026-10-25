import { afterEach, describe, expect, it, vi } from "vitest";
import {
  devCorsOrigins,
  existingDevServersReady,
} from "../scripts/dev-lan.mjs";

const webOrigin = "http://192.168.0.105:8081";
const apiOrigin = "http://192.168.0.105:3000";

function mockDevServers({
  health = {
    ok: true,
    status: "ok",
    service: "nfcport-backend",
    version: "2.0.0",
  } as unknown,
  servers = { servers: [] } as unknown,
  serverStatus = 200,
  serverCorsOrigin = webOrigin,
} = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      const origin = new Headers(options?.headers).get("Origin");
      if (url === webOrigin) return new Response("<html>PORTFOLIO PASS</html>");
      if (url === `${apiOrigin}/api/health`)
        return Response.json(health, {
          headers: { "Access-Control-Allow-Origin": origin || "" },
        });
      if (url === `${apiOrigin}/api/server-mappings`)
        return Response.json(servers, {
          status: serverStatus,
          headers: {
            "Access-Control-Allow-Origin": origin ? serverCorsOrigin : "",
          },
        });
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("LAN dev readiness", () => {
  it("accepts the real backend with an empty server catalog", async () => {
    mockDevServers();

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      true,
    );
  });

  it("rejects the old sample API even though its health endpoint succeeds", async () => {
    mockDevServers({
      health: { ok: true, timestamp: Date.now() },
      servers: { error: "Not found" },
      serverStatus: 404,
    });

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      false,
    );
  });

  it("requires the server-mapping route to succeed", async () => {
    mockDevServers({ servers: { error: "Not found" }, serverStatus: 404 });

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      false,
    );
  });

  it("rejects a mapping response without a servers array", async () => {
    mockDevServers({ servers: { servers: {} } });

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      false,
    );
  });

  it("requires real backend health metadata", async () => {
    mockDevServers({ health: { ok: true, timestamp: Date.now() } });

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      false,
    );
  });

  it("rejects a mapping route unreadable from the LAN web origin", async () => {
    mockDevServers({ serverCorsOrigin: "http://localhost:8081" });

    await expect(existingDevServersReady(webOrigin, apiOrigin)).resolves.toBe(
      false,
    );
  });
});

describe("LAN dev CORS configuration", () => {
  it("adds current LAN and loopback origins while preserving explicit origins", () => {
    const configured =
      " https://preview.example.test ,http://localhost:8081,https://preview.example.test ";

    expect(new Set(devCorsOrigins(webOrigin, configured).split(","))).toEqual(
      new Set([
        "https://preview.example.test",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        webOrigin,
      ]),
    );
  });

  it.each(["*", "https://preview.example.test/path"])(
    "rejects an unsafe or non-origin CORS entry: %s",
    (configured) => {
      expect(() => devCorsOrigins(webOrigin, configured)).toThrow(
        /exact HTTP.*origin/i,
      );
    },
  );
});
