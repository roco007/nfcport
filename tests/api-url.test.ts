import { describe, expect, it } from "vitest";
import { apiBaseUrlForWebLocation } from "../lib/api-url";

describe("web API address", () => {
  it("pairs a LAN or loopback Expo port with the starter API port", () => {
    expect(apiBaseUrlForWebLocation("http://192.168.0.105:8081/")).toBe(
      "http://192.168.0.105:3000",
    );
    expect(apiBaseUrlForWebLocation("http://localhost:8081/tags")).toBe(
      "http://localhost:3000",
    );
  });

  it("keeps the hosted Expo preview pairing", () => {
    expect(
      apiBaseUrlForWebLocation(
        "https://8081-sandbox.region.preview.example.test/",
      ),
    ).toBe("https://3000-sandbox.region.preview.example.test");
  });

  it("leaves unrelated origins without a guessed API", () => {
    expect(apiBaseUrlForWebLocation("https://example.com/")).toBe("");
    expect(apiBaseUrlForWebLocation("https://example.com:8081/")).toBe("");
  });
});
