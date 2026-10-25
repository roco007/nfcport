import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openURL, platform, native } = vi.hoisted(() => ({
  openURL: vi.fn<(...args: string[]) => Promise<void>>(),
  platform: { OS: "android" },
  native: {
    openApplication: undefined as undefined | ((value: string) => boolean),
  },
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("react-native", () => ({
  Linking: { openURL },
  Platform: platform,
}));

import { executeNfcAction } from "../lib/nfc/action-execution";

beforeEach(() => {
  openURL.mockReset().mockResolvedValue(undefined);
  platform.OS = "android";
  native.openApplication = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("trigger HTTP requests", () => {
  let server: Server;
  let baseUrl: string;
  let requests: { method: string | undefined; url: string | undefined }[];

  beforeEach(async () => {
    requests = [];
    server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url });
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/open/Whatsapp" }).end();
      } else if (request.url === "/fail") {
        response.writeHead(503).end("Unavailable");
      } else if (request.url === "/open/Missing") {
        response
          .writeHead(404, { "Content-Type": "application/json" })
          .end(
            JSON.stringify({
              error:
                "No application named Missing is installed on this server.",
            }),
          );
      } else {
        response.writeHead(204).end();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("sends GET to the configured URL without launching a browser", async () => {
    await executeNfcAction({
      actionType: "trigger",
      val: ` ${baseUrl}/open/Whatsapp?source=nfc `,
      displayName: "Whatsapp",
    });
    expect(requests).toEqual([
      { method: "GET", url: "/open/Whatsapp?source=nfc" },
    ]);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("executes a server command as a direct GET without launching a browser", async () => {
    await executeNfcAction({
      target: "server",
      serverBaseUrl: `${baseUrl}/`,
      actionType: "command",
      val: " /unlock/ ",
    });
    expect(requests).toEqual([{ method: "GET", url: "/unlock" }]);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("rejects an invalid command before any request or browser launch", async () => {
    await expect(
      executeNfcAction({
        target: "server",
        serverBaseUrl: baseUrl,
        actionType: "command",
        val: "../unlock",
      }),
    ).rejects.toThrow(/command/i);
    expect(requests).toEqual([]);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("opens a server app and URL using HTTP only with correctly encoded arguments", async () => {
    await executeNfcAction({
      target: "server",
      serverBaseUrl: baseUrl,
      actionType: "open_application",
      val: "Visual Studio Code",
    });
    await executeNfcAction({
      target: "server",
      serverBaseUrl: baseUrl,
      actionType: "open_url",
      val: "https://example.com/?a=1&b=2",
    });
    expect(requests).toEqual([
      { method: "GET", url: "/open/Visual%20Studio%20Code" },
      {
        method: "GET",
        url: "/open-url?url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%26b%3D2",
      },
    ]);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("surfaces a server JSON error without retrying or opening a browser", async () => {
    await expect(
      executeNfcAction({
        target: "server",
        serverBaseUrl: baseUrl,
        actionType: "open_application",
        val: "Missing",
      }),
    ).rejects.toThrow(/No application named Missing/);
    expect(requests).toHaveLength(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("handles HTTP redirects within the request without opening a browser", async () => {
    await executeNfcAction({
      actionType: "trigger",
      val: `${baseUrl}/redirect`,
    });
    expect(requests.map((request) => request.url)).toEqual([
      "/redirect",
      "/open/Whatsapp",
    ]);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("reports failed HTTP responses without a browser fallback or retry", async () => {
    await expect(
      executeNfcAction({ actionType: "trigger", val: `${baseUrl}/fail` }),
    ).rejects.toThrow(/503/);
    expect(requests).toHaveLength(1);
    expect(openURL).not.toHaveBeenCalled();
  });
});

describe("action dispatch boundaries", () => {
  it.each([undefined, "client"] as const)(
    "rejects a command with target %s without launching a client application",
    async (target) => {
      let launched = "";
      native.openApplication = (name) => {
        launched = name;
        return true;
      };
      await expect(
        executeNfcAction({ actionType: "command", val: "unlock", target }),
      ).rejects.toThrow(/server/i);
      expect(launched).toBe("");
      expect(openURL).not.toHaveBeenCalled();
    },
  );

  it("opens named client apps through native code", async () => {
    let launched = "";
    native.openApplication = (name) => {
      launched = name;
      return true;
    };
    await executeNfcAction({
      actionType: "open_application",
      val: " WhatsApp ",
    });
    expect(launched).toBe("WhatsApp");
    expect(openURL).not.toHaveBeenCalled();
  });

  it("reports native app errors without attempting a different launch", async () => {
    native.openApplication = () => {
      throw new Error("No installed app named Missing.");
    };
    await expect(
      executeNfcAction({ actionType: "open_application", val: "Missing" }),
    ).rejects.toThrow(/No installed app/);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("explains the native build requirement for arbitrary app names when unavailable", async () => {
    await expect(
      executeNfcAction({ actionType: "open_application", val: "WhatsApp" }),
    ).rejects.toThrow(/Android build/i);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("preserves explicit client deep links when native app launching is unavailable", async () => {
    await executeNfcAction({
      actionType: "open_application",
      val: "whatsapp://send?text=hi",
    });
    expect(openURL).toHaveBeenCalledWith("whatsapp://send?text=hi");
  });

  it("rejects application schemes for trigger without launching them", async () => {
    await expect(
      executeNfcAction({ actionType: "trigger", val: "whatsapp://send" }),
    ).rejects.toThrow(/HTTP/i);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("reports network failure without a browser fallback", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("Network request failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      executeNfcAction({
        actionType: "trigger",
        val: "https://example.com/run",
      }),
    ).rejects.toThrow("Network request failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
  });

  it("aborts an unresponsive trigger and never opens its URL", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new Error("Request aborted")),
        );
      });
    });
    const pending = executeNfcAction({
      actionType: "trigger",
      val: "https://example.com/run",
    });
    const rejected = expect(pending).rejects.toThrow();
    await Promise.all([rejected, vi.advanceTimersByTimeAsync(10_000)]);
    expect(signal?.aborted).toBe(true);
    expect(openURL).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still opens open_url actions", async () => {
    await executeNfcAction({
      actionType: "open_url",
      val: "https://example.com/",
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith("https://example.com/");
  });

  it("keeps the Android Youtube URI and existing website fallback", async () => {
    openURL.mockRejectedValueOnce(new Error("App unavailable"));
    await executeNfcAction({
      actionType: "open_application",
      val: " Youtube ",
    });
    expect(openURL.mock.calls).toEqual([
      ["vnd.youtube://"],
      ["https://www.youtube.com/"],
    ]);
  });
});
