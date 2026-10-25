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

describe("server mappings HTTP API", () => {
  let serverMappingRepository: InMemoryServerMappingRepository;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    serverMappingRepository = new InMemoryServerMappingRepository();
    app = createApp({
      config: createTestConfig(),
      repository: new InMemoryNfcConfigRepository(),
      serverMappingRepository,
      logger: silentLogger,
    });
  });

  it.each(["/api/server-mappings", "/api/v1/server-mappings"])(
    "lists saved servers publicly at %s with a no-store response",
    async (path) => {
      serverMappingRepository.records.set(7, {
        id: 7,
        serverName: "Laptop",
        ipAddress: "192.168.1.20",
      });
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        servers: [{ id: 7, serverName: "Laptop", ipAddress: "192.168.1.20" }],
      });
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("returns an empty list when there are no saved servers", async () => {
    const response = await request(app).get("/api/server-mappings");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ servers: [] });
  });

  it.each(["/api/server-mappings", "/api/v1/server-mappings"])(
    "creates a server with trimmed values at %s",
    async (path) => {
      const response = await request(app)
        .post(path)
        .set("X-API-Key", TEST_API_KEY)
        .send({ serverName: "  Office Mac  ", ipAddress: "  192.168.1.20  " });
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        server: { id: 1, serverName: "Office Mac", ipAddress: "192.168.1.20" },
      });
      expect(serverMappingRepository.records.get(1)).toEqual(
        response.body.server,
      );
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("updates only the specified ID even when names are duplicated", async () => {
    serverMappingRepository.records.set(2, {
      id: 2,
      serverName: "Mac",
      ipAddress: "192.168.1.2",
    });
    serverMappingRepository.records.set(3, {
      id: 3,
      serverName: "Mac",
      ipAddress: "192.168.1.3",
    });
    const response = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .send({ id: 3, serverName: "  Mac  ", ipAddress: " 2001:db8::3 " });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      server: { id: 3, serverName: "Mac", ipAddress: "2001:db8::3" },
    });
    expect(serverMappingRepository.records.get(2)?.ipAddress).toBe(
      "192.168.1.2",
    );
    expect(serverMappingRepository.records.size).toBe(2);
  });

  it("allows creating distinct records with the same server name", async () => {
    for (const ipAddress of ["192.168.1.2", "192.168.1.3"]) {
      expect(
        (
          await request(app)
            .post("/api/server-mappings")
            .set("X-API-Key", TEST_API_KEY)
            .send({ serverName: "Mac", ipAddress })
        ).status,
      ).toBe(201);
    }
    expect([...serverMappingRepository.records.values()]).toEqual([
      { id: 1, serverName: "Mac", ipAddress: "192.168.1.2" },
      { id: 2, serverName: "Mac", ipAddress: "192.168.1.3" },
    ]);
  });

  it("returns 404 instead of creating a row when an update ID does not exist", async () => {
    const response = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .send({ id: 99, serverName: "Missing", ipAddress: "192.168.1.99" });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SERVER_MAPPING_NOT_FOUND");
    expect(serverMappingRepository.records.size).toBe(0);
  });

  it.each([undefined, "wrong-key"])(
    "rejects an unauthenticated write (%s) before storing",
    async (key) => {
      const pending = request(app).post("/api/server-mappings");
      if (key !== undefined) pending.set("X-API-Key", key);
      const response = await pending.send({
        serverName: "Mac",
        ipAddress: "192.168.1.2",
      });
      expect(response.status).toBe(401);
      expect(serverMappingRepository.records.size).toBe(0);
    },
  );

  it.each([
    { serverName: "   ", ipAddress: "192.168.1.2" },
    { serverName: "x".repeat(256), ipAddress: "192.168.1.2" },
    { serverName: 7, ipAddress: "192.168.1.2" },
    { serverName: "Mac", ipAddress: "" },
    { serverName: "Mac", ipAddress: "nfc-lappy.local" },
    { serverName: "Mac", ipAddress: "http://192.168.1.2:3001" },
    { serverName: "Mac", ipAddress: "192.168.1.2:3001" },
    { serverName: "Mac", ipAddress: "999.1.2.3" },
    { serverName: "Mac", ipAddress: "[2001:db8::1]" },
    { serverName: "Mac", ipAddress: "fe80::1%en0" },
    { serverName: "Mac", ipAddress: "1".repeat(46) },
    { serverName: "Mac", ipAddress: null },
    { id: 0, serverName: "Mac", ipAddress: "::1" },
    { id: -1, serverName: "Mac", ipAddress: "::1" },
    { id: 1.5, serverName: "Mac", ipAddress: "::1" },
    { id: "1", serverName: "Mac", ipAddress: "::1" },
    { id: null, serverName: "Mac", ipAddress: "::1" },
    { id: 2_147_483_648, serverName: "Mac", ipAddress: "::1" },
    {},
    [],
  ])(
    "rejects invalid mapping values without storing them: %j",
    async (body) => {
      const response = await request(app)
        .post("/api/server-mappings")
        .set("X-API-Key", TEST_API_KEY)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(serverMappingRepository.records.size).toBe(0);
    },
  );

  it("accepts the maximum name length and an IPv4-mapped IPv6 literal", async () => {
    const response = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .send({ serverName: "x".repeat(255), ipAddress: "::ffff:192.0.2.1" });
    expect(response.status).toBe(201);
    expect(response.body.server.ipAddress).toBe("::ffff:192.0.2.1");
  });

  it("preserves JSON content-type and syntax enforcement", async () => {
    const text = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .set("Content-Type", "text/plain")
      .send("{}");
    expect(text.status).toBe(415);
    const malformed = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .set("Content-Type", "application/json")
      .send("{");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_JSON");
    expect(serverMappingRepository.records.size).toBe(0);
  });

  it("enforces the configured body-size and write-rate limits across aliases", async () => {
    app = createApp({
      config: createTestConfig({
        bodyLimitBytes: 128,
        rateLimit: { windowMs: 60_000, maxRequests: 100, maxWriteRequests: 2 },
      }),
      repository: new InMemoryNfcConfigRepository(),
      serverMappingRepository,
      logger: silentLogger,
    });
    const tooLarge = await request(app)
      .post("/api/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .send({ serverName: "x".repeat(200), ipAddress: "::1" });
    expect(tooLarge.status).toBe(413);
    expect(
      (
        await request(app)
          .post("/api/server-mappings")
          .set("X-API-Key", TEST_API_KEY)
          .send({ serverName: "Mac", ipAddress: "::1" })
      ).status,
    ).toBe(201);
    const limited = await request(app)
      .post("/api/v1/server-mappings")
      .set("X-API-Key", TEST_API_KEY)
      .send({ serverName: "Other", ipAddress: "::2" });
    expect(limited.status).toBe(429);
    expect(serverMappingRepository.records.size).toBe(1);
  });

  it("does not expose unexpected database errors in responses", async () => {
    serverMappingRepository.error = new Error("private database details");
    const response = await request(app).get("/api/server-mappings");
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain(
      "private database details",
    );
    expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});
