import { createPool, type Pool, type PoolOptions } from "mysql2/promise";
import type { AppConfig } from "../config/env.js";

export function createMySqlPool(config: AppConfig): Pool {
  const options: PoolOptions = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    connectionLimit: config.database.connectionLimit,
    maxIdle: config.database.connectionLimit,
    idleTimeout: 60_000,
    connectTimeout: 10_000,
    waitForConnections: true,
    queueLimit: config.database.queueLimit,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    charset: "utf8mb4",
    timezone: "Z",
    multipleStatements: false,
  };

  if (config.database.sslMode === "required") {
    options.ssl = {
      rejectUnauthorized: true,
      verifyIdentity: true,
      ...(config.database.sslCa === undefined
        ? {}
        : { ca: config.database.sslCa }),
    };
  }

  return createPool(options);
}
