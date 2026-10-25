import { z } from "zod";
import { isIP } from "node:net";

const integerFromEnvironment = (
  defaultValue: number,
  minimum: number,
  maximum: number,
) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? defaultValue : value),
    z.coerce.number().int().min(minimum).max(maximum),
  );

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  SERVICE_NAME: z.string().trim().min(1).max(100).default("nfcport-backend"),
  SERVICE_VERSION: z.string().trim().min(1).max(50).default("2.0.0"),
  HOST: z.string().trim().min(1).default("0.0.0.0"),
  PORT: integerFromEnvironment(3002, 1, 65_535),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY_HOPS: integerFromEnvironment(0, 0, 5),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:8081,http://127.0.0.1:8081"),
  ADMIN_API_KEY: z.string().min(32).max(512),
  MYSQL_HOST: z.string().trim().min(1),
  MYSQL_PORT: integerFromEnvironment(18_082, 1, 65_535),
  MYSQL_USER: z.string().trim().min(1),
  MYSQL_PASSWORD: z.string().min(1),
  MYSQL_DATABASE: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9_]+$/,
      "must contain only letters, numbers, and underscores",
    )
    .default("nfcPort"),
  MYSQL_SSL_MODE: z.enum(["required", "disabled"]).default("required"),
  MYSQL_SSL_CA_BASE64: z.string().trim().min(1).optional(),
  MYSQL_CONNECTION_LIMIT: integerFromEnvironment(10, 1, 100),
  MYSQL_QUEUE_LIMIT: integerFromEnvironment(100, 1, 10_000),
  DATABASE_QUERY_TIMEOUT_MS: integerFromEnvironment(5_000, 100, 30_000),
  DEFAULT_USER_NAME: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.@-]*$/)
    .default("rc007"),
  NFC_CONFIG_BODY_LIMIT_BYTES: integerFromEnvironment(
    1_048_576,
    1_024,
    1_048_576,
  ),
  RATE_LIMIT_WINDOW_MS: integerFromEnvironment(60_000, 1_000, 3_600_000),
  RATE_LIMIT_MAX: integerFromEnvironment(120, 1, 100_000),
  WRITE_RATE_LIMIT_MAX: integerFromEnvironment(20, 1, 10_000),
  READINESS_TIMEOUT_MS: integerFromEnvironment(2_000, 100, 30_000),
  READINESS_CACHE_MS: integerFromEnvironment(1_000, 100, 60_000),
  SHUTDOWN_TIMEOUT_MS: integerFromEnvironment(10_000, 1_000, 60_000),
});

export interface AppConfig {
  readonly environment: "development" | "test" | "production";
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel:
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace"
    | "silent";
  readonly trustProxyHops: number;
  readonly corsOrigins: ReadonlySet<string>;
  readonly adminApiKey: string;
  readonly defaultUserName: string;
  readonly bodyLimitBytes: number;
  readonly rateLimit: {
    readonly windowMs: number;
    readonly maxRequests: number;
    readonly maxWriteRequests: number;
  };
  readonly readinessTimeoutMs: number;
  readonly readinessCacheMs: number;
  readonly shutdownTimeoutMs: number;
  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
    readonly connectionLimit: number;
    readonly queueLimit: number;
    readonly queryTimeoutMs: number;
    readonly sslMode: "required" | "disabled";
    readonly sslCa: string | undefined;
  };
}

export class ConfigurationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join("; ")}`);
    this.name = "ConfigurationError";
  }
}

function parseCorsOrigins(value: string): ReadonlySet<string> {
  const origins = new Set<string>();

  for (const candidate of value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)) {
    if (candidate === "*") {
      throw new ConfigurationError(["CORS_ORIGINS cannot contain a wildcard"]);
    }

    try {
      const url = new URL(candidate);
      if (
        !(["http:", "https:"] as const).includes(
          url.protocol as "http:" | "https:",
        )
      ) {
        throw new Error("unsupported protocol");
      }
      if (url.origin !== candidate) {
        throw new Error("origin contains a path, query, or fragment");
      }
      origins.add(url.origin);
    } catch {
      throw new ConfigurationError([
        `CORS_ORIGINS contains an invalid origin: ${candidate}`,
      ]);
    }
  }

  return origins;
}

function decodeCertificate(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const decoded = Buffer.from(value, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN CERTIFICATE-----")) {
    throw new ConfigurationError([
      "MYSQL_SSL_CA_BASE64 must be a base64-encoded PEM certificate",
    ]);
  }
  return decoded;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigurationError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    );
  }

  const env = parsed.data;
  const corsOrigins = parseCorsOrigins(env.CORS_ORIGINS);
  const productionIssues: string[] = [];

  if (env.NODE_ENV === "production") {
    if (source.CORS_ORIGINS === undefined || corsOrigins.size === 0) {
      productionIssues.push(
        "CORS_ORIGINS must be explicitly configured in production",
      );
    }
    if (env.MYSQL_SSL_MODE !== "required") {
      productionIssues.push("MYSQL_SSL_MODE must be required in production");
    }
    if (/^(?:change-me|replace-this)/i.test(env.ADMIN_API_KEY)) {
      productionIssues.push(
        "ADMIN_API_KEY must not use the example placeholder",
      );
    }
    if (/^(?:change-me|replace-this)/i.test(env.MYSQL_PASSWORD)) {
      productionIssues.push(
        "MYSQL_PASSWORD must not use the example placeholder",
      );
    }
    // mysql2 intentionally omits SNI and hostname checks for IP literals. A DNS
    // name is therefore required to keep certificate identity verification on.
    if (isIP(env.MYSQL_HOST) !== 0) {
      productionIssues.push(
        "MYSQL_HOST must be a DNS hostname in production so TLS identity can be verified",
      );
    }
  }

  if (productionIssues.length > 0)
    throw new ConfigurationError(productionIssues);

  return {
    environment: env.NODE_ENV,
    serviceName: env.SERVICE_NAME,
    serviceVersion: env.SERVICE_VERSION,
    host: env.HOST,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    corsOrigins,
    adminApiKey: env.ADMIN_API_KEY,
    defaultUserName: env.DEFAULT_USER_NAME,
    bodyLimitBytes: env.NFC_CONFIG_BODY_LIMIT_BYTES,
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX,
      maxWriteRequests: env.WRITE_RATE_LIMIT_MAX,
    },
    readinessTimeoutMs: env.READINESS_TIMEOUT_MS,
    readinessCacheMs: env.READINESS_CACHE_MS,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    database: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.MYSQL_USER,
      password: env.MYSQL_PASSWORD,
      database: env.MYSQL_DATABASE,
      connectionLimit: env.MYSQL_CONNECTION_LIMIT,
      queueLimit: env.MYSQL_QUEUE_LIMIT,
      queryTimeoutMs: env.DATABASE_QUERY_TIMEOUT_MS,
      sslMode: env.MYSQL_SSL_MODE,
      sslCa: decodeCertificate(env.MYSQL_SSL_CA_BASE64),
    },
  };
}
