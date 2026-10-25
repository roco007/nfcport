import { describe, expect, it } from "vitest";
import {
  normalizeServerMappingInput,
  parseServerMappingList,
  serverMappingBaseUrl,
} from "../lib/nfc/server-mappings";
import { serverActionUrl } from "../lib/nfc/tag-routing";

describe("server mappings", () => {
  it("turns a selected IPv4 server into a command endpoint on the LAN port", () => {
    expect(
      serverActionUrl({
        target: "server",
        actionType: "command",
        val: "unlock",
        serverBaseUrl: serverMappingBaseUrl("192.168.0.105"),
      }),
    ).toBe("http://192.168.0.105:3001/unlock");
  });

  it("brackets IPv6 addresses when constructing server requests", () => {
    expect(serverMappingBaseUrl(" 2001:db8::1 ")).toBe(
      "http://[2001:db8::1]:3001",
    );
  });

  it("trims names and addresses and retains the ID for updates", () => {
    expect(
      normalizeServerMappingInput({
        id: 7,
        serverName: " RC's Mac ",
        ipAddress: " 192.168.0.105 ",
      }),
    ).toEqual({ id: 7, serverName: "RC's Mac", ipAddress: "192.168.0.105" });
  });

  it.each([
    "http://192.168.0.105:3001",
    "192.168.0.999",
    "127.1",
    "nfc-lappy.local",
    "192.168.0.105/unlock",
    "2001:db8::x",
    "",
  ])(
    "rejects %s instead of treating a non-IP value as a server",
    (ipAddress) => {
      expect(() => serverMappingBaseUrl(ipAddress)).toThrow(/IP address/i);
    },
  );

  it.each([
    { serverName: " ", ipAddress: "192.168.0.105" },
    { serverName: "x".repeat(256), ipAddress: "192.168.0.105" },
    { id: 0, serverName: "Mac", ipAddress: "192.168.0.105" },
  ])("rejects incomplete or invalid mapping input", (input) => {
    expect(() => normalizeServerMappingInput(input)).toThrow();
  });

  it("reads DB rows without losing names containing punctuation", () => {
    expect(
      parseServerMappingList({
        servers: [
          { id: 1, serverName: "RC's Mac", ipAddress: "192.168.0.105" },
        ],
      }),
    ).toEqual([{ id: 1, serverName: "RC's Mac", ipAddress: "192.168.0.105" }]);
  });

  it("rejects malformed API responses instead of displaying a fake empty list", () => {
    for (const response of [
      {},
      { servers: null },
      { servers: [{ serverName: "Mac", ipAddress: "192.168.0.105" }] },
    ]) {
      expect(() => parseServerMappingList(response)).toThrow(/response/i);
    }
  });
});
