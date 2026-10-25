import pino from "pino";
import type { AppConfig } from "../src/config/env.js";
import type { NfcConfigRepository } from "../src/repositories/nfc-config.repository.js";

export const TEST_API_KEY =
  "test-api-key-that-is-longer-than-thirty-two-characters";

export function createTestConfig(
  overrides: Partial<AppConfig> = {},
): AppConfig {
  return {
    environment: "test",
    serviceName: "nfcport-backend-test",
    serviceVersion: "2.0.0-test",
    host: "127.0.0.1",
    port: 3002,
    logLevel: "silent",
    trustProxyHops: 0,
    corsOrigins: new Set(["https://app.example.test"]),
    adminApiKey: TEST_API_KEY,
    defaultUserName: "rc007",
    bodyLimitBytes: 1_048_576,
    rateLimit: {
      windowMs: 60_000,
      maxRequests: 1_000,
      maxWriteRequests: 1_000,
    },
    readinessTimeoutMs: 100,
    readinessCacheMs: 100,
    shutdownTimeoutMs: 1_000,
    database: {
      host: "127.0.0.1",
      port: 3306,
      user: "test",
      password: "test",
      database: "nfcPort",
      connectionLimit: 2,
      queueLimit: 10,
      queryTimeoutMs: 500,
      sslMode: "disabled",
      sslCa: undefined,
    },
    ...overrides,
  };
}

export const silentLogger = pino({ level: "silent" });

export class InMemoryNfcConfigRepository implements NfcConfigRepository {
  public readonly records = new Map<string, unknown>();
  public ready = true;
  public findError: Error | undefined;

  public async findByUserName(userName: string): Promise<unknown | null> {
    if (this.findError !== undefined) throw this.findError;
    return this.records.get(userName) ?? null;
  }

  public async upsert(userName: string, config: unknown): Promise<void> {
    this.records.set(userName, config);
  }

  public async ping(_timeoutMs?: number): Promise<void> {
    if (!this.ready) throw new Error("database unavailable");
  }

  public async close(): Promise<void> {}
}
