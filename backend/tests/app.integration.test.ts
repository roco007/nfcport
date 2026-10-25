import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  InMemoryNfcConfigRepository,
  InMemoryServerMappingRepository,
  TEST_API_KEY,
  createTestConfig,
  silentLogger,
} from "./helpers.js";

const validConfig = {
  "1D:CF:1B:BA:1A:10:80": {
    name: "Portfolio",
    actions: [{ actionType: "open_url", val: "https://example.com" }],
  },
} as const;

describe("NFC Port HTTP API", () => {
  let repository: InMemoryNfcConfigRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryNfcConfigRepository();
    repository.records.set("rc007", validConfig);
    app = createApp({
      config: createTestConfig(),
      repository,
      serverMappingRepository: new InMemoryServerMappingRepository(),
      logger: silentLogger,
    });
  });

  it("serves liveness and compatibility health endpoints without touching MySQL", async () => {
    repository.ready = false;
    const [health, compatibilityHealth] = await Promise.all([
      request(app).get("/health"),
      request(app).get("/api/health"),
    ]);
    expect(health.status).toBe(200);
    expect(compatibilityHealth.status).toBe(200);
    expect(health.body.status).toBe("ok");
    expect(health.body.ok).toBe(true);
    expect(health.body.timestamp).toEqual(expect.any(Number));
  });

  it("reports dependency health from the readiness endpoint", async () => {
    expect((await request(app).get("/ready")).status).toBe(200);
    repository.ready = false;
    await new Promise((resolve) => setTimeout(resolve, 110));
    expect((await request(app).get("/ready")).status).toBe(503);
  });

  it("preserves the raw GET response and default rc007 user contract", async () => {
    const response = await request(app).get("/api/nfc-config");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(validConfig);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("validates all query parameters", async () => {
    const response = await request(app).get(
      "/api/nfc-config?userName=bad%20name&extra=1",
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a stable 404 when a user's mapping does not exist", async () => {
    const response = await request(app)
      .get("/api/nfc-config?userName=missing")
      .set("X-API-Key", TEST_API_KEY);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: "NFC_CONFIG_NOT_FOUND" });
  });

  it("does not let an anonymous caller enumerate non-default users", async () => {
    const response = await request(app).get(
      "/api/nfc-config?userName=another-user",
    );
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("requires a constant-time API key check before writes", async () => {
    const response = await request(app)
      .post("/api/nfc-config")
      .set("Content-Type", "application/json")
      .send(validConfig);
    expect(response.status).toBe(401);
    expect(repository.records.get("rc007")).toEqual(validConfig);
  });

  it("stores authenticated JSON payloads without shape validation or normalization", async () => {
    const payload = {
      "not-a-serial": {
        name: " Alice tag ",
        actions: [{ actionType: "custom_action", arbitrary: true }],
      },
      extraTopLevelField: ["is", "preserved"],
    };
    const response = await request(app)
      .post("/api/v1/nfc-config?userName=alice")
      .set("X-API-Key", TEST_API_KEY)
      .send(payload);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, userName: "alice" });
    expect(repository.records.get("alice")).toEqual(payload);
  });

  it("accepts top-level JSON array payloads", async () => {
    const payload = [{ arbitrary: "shape" }, ["nested", "values"]];
    const response = await request(app)
      .post("/api/nfc-config")
      .set("X-API-Key", TEST_API_KEY)
      .set("Content-Type", "application/json")
      .send(payload);
    expect(response.status).toBe(200);
    expect(repository.records.get("rc007")).toEqual(payload);
  });

  it("continues to validate POST query parameters", async () => {
    const response = await request(app)
      .post("/api/nfc-config?userName=bad%20name&extra=1")
      .set("X-API-Key", TEST_API_KEY)
      .send({ arbitrary: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(repository.records.has("bad name")).toBe(false);
  });

  it("continues to reject malformed JSON", async () => {
    const response = await request(app)
      .post("/api/nfc-config")
      .set("X-API-Key", TEST_API_KEY)
      .set("Content-Type", "application/json")
      .send("{");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });

  it("continues to enforce the configured body-size limit", async () => {
    const limitedRepository = new InMemoryNfcConfigRepository();
    const limitedApp = createApp({
      config: createTestConfig({ bodyLimitBytes: 32 }),
      repository: limitedRepository,
      serverMappingRepository: new InMemoryServerMappingRepository(),
      logger: silentLogger,
    });
    const response = await request(limitedApp)
      .post("/api/nfc-config")
      .set("X-API-Key", TEST_API_KEY)
      .send({ value: "x".repeat(64) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("normalizes unsupported JSON charsets into a safe 415 response", async () => {
    const response = await request(app)
      .post("/api/nfc-config")
      .set("X-API-Key", TEST_API_KEY)
      .set("Content-Type", "application/json; charset=iso-8859-1")
      .send("{}");
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });

  it("applies an exact-origin CORS policy while allowing native requests", async () => {
    const allowed = await request(app)
      .get("/api/nfc-config")
      .set("Origin", "https://app.example.test");
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "https://app.example.test",
    );

    const denied = await request(app)
      .get("/api/nfc-config")
      .set("Origin", "https://evil.example.test");
    expect(denied.status).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    expect((await request(app).get("/api/nfc-config")).status).toBe(200);
  });

  it("never leaks an unexpected error or stack trace", async () => {
    repository.findError = new Error("database password: extremely-secret");
    const response = await request(app).get("/api/nfc-config");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("extremely-secret");
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});
