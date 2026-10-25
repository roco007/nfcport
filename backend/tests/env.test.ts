import { describe, expect, it } from "vitest";
import { ConfigurationError, loadConfig } from "../src/config/env.js";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  ADMIN_API_KEY: "a-secure-test-key-with-at-least-thirty-two-characters",
  MYSQL_HOST: "database.example.test",
  MYSQL_USER: "nfcport",
  MYSQL_PASSWORD: "secret",
  MYSQL_SSL_MODE: "disabled",
};

describe("loadConfig", () => {
  it("parses typed settings and exact CORS origins", () => {
    const config = loadConfig({
      ...validEnvironment,
      PORT: "4567",
      CORS_ORIGINS: "https://app.example.test,https://admin.example.test",
    });

    expect(config.port).toBe(4567);
    expect([...config.corsOrigins]).toEqual([
      "https://app.example.test",
      "https://admin.example.test",
    ]);
  });

  it("fails fast when required secrets are missing", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow(ConfigurationError);
  });

  it("requires explicit CORS and verified database TLS in production", () => {
    expect(() =>
      loadConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        MYSQL_SSL_MODE: "disabled",
      }),
    ).toThrow(/CORS_ORIGINS.*production|MYSQL_SSL_MODE/);
  });

  it("rejects example secrets and IP-literal database hosts in production", () => {
    const productionEnvironment = {
      ...validEnvironment,
      NODE_ENV: "production",
      CORS_ORIGINS: "https://app.example.test",
      MYSQL_SSL_MODE: "required",
    } as const;

    expect(() =>
      loadConfig({
        ...productionEnvironment,
        MYSQL_PASSWORD: "replace-this-password",
      }),
    ).toThrow(/MYSQL_PASSWORD/);
    expect(() =>
      loadConfig({ ...productionEnvironment, MYSQL_HOST: "203.0.113.10" }),
    ).toThrow(/DNS hostname/);
  });

  it("rejects wildcard origins", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, CORS_ORIGINS: "*" }),
    ).toThrow(/wildcard/);
  });
});
