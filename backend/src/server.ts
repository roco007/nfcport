import { config as loadEnvironmentFile } from "dotenv";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import pino, { type Logger } from "pino";
import { createApp } from "./app.js";
import { loadConfig, type AppConfig } from "./config/env.js";
import { createMySqlPool } from "./db/mysql.js";
import { createLogger } from "./observability/logger.js";
import {
  MySqlNfcConfigRepository,
  type NfcConfigRepository,
} from "./repositories/nfc-config.repository.js";
import { MySqlServerMappingRepository } from "./repositories/server-mapping.repository.js";

const environmentPath = fileURLToPath(new URL("../.env", import.meta.url));
const environmentResult = loadEnvironmentFile({
  path: environmentPath,
  override: false,
});
if (
  environmentResult.error !== undefined &&
  (environmentResult.error as NodeJS.ErrnoException).code !== "ENOENT"
) {
  throw environmentResult.error;
}

async function listen(server: Server, config: AppConfig): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeHttpServer(server: Server): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function closeResources(
  server: Server,
  repository: NfcConfigRepository,
): Promise<void> {
  const errors: unknown[] = [];

  // Stop accepting work and let in-flight HTTP requests finish before closing
  // their database dependency. Still attempt both closes if either one fails.
  try {
    await closeHttpServer(server);
  } catch (error) {
    errors.push(error);
  }

  try {
    await repository.close();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "One or more service resources failed to close",
    );
  }
}

class ShutdownDeadlineError extends Error {
  public constructor(timeoutMs: number) {
    super(`Service shutdown exceeded its ${timeoutMs}ms deadline`);
    this.name = "ShutdownDeadlineError";
  }
}

async function closeResourcesBeforeDeadline(
  server: Server,
  repository: NfcConfigRepository,
  timeoutMs: number,
  onDeadline: () => void,
): Promise<void> {
  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      // server.close() waits for existing connections. At the hard deadline,
      // forcibly destroy them before terminating the process.
      server.closeAllConnections();
      onDeadline();
      reject(new ShutdownDeadlineError(timeoutMs));
    }, timeoutMs);
    deadlineTimer.unref();
  });

  try {
    await Promise.race([closeResources(server, repository), deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = createMySqlPool(config);
  const repository = new MySqlNfcConfigRepository(
    pool,
    config.database.queryTimeoutMs,
  );
  const serverMappingRepository = new MySqlServerMappingRepository(
    pool,
    config.database.queryTimeoutMs,
  );
  const app = createApp({
    config,
    repository,
    serverMappingRepository,
    logger,
  });
  const server = createServer(app);

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1_000;

  // Fail before accepting traffic when credentials, TLS, connectivity, or the
  // required schema are invalid. Always release the pool after a failed start.
  try {
    await repository.ping(config.readinessTimeoutMs);
    await listen(server, config);
  } catch (startupError) {
    try {
      await closeResourcesBeforeDeadline(
        server,
        repository,
        config.shutdownTimeoutMs,
        () => process.exit(1),
      );
    } catch (cleanupError) {
      logger.error(
        { err: cleanupError },
        "Resource cleanup after startup failure failed",
      );
    }
    throw startupError;
  }
  logger.info({ host: config.host, port: config.port }, "Service is listening");

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Graceful shutdown started");

    try {
      await closeResourcesBeforeDeadline(
        server,
        repository,
        config.shutdownTimeoutMs,
        () => {
          logger.error("Graceful shutdown timed out; forcing process exit");
          process.exit(1);
        },
      );
      logger.info("Graceful shutdown completed");
      process.exitCode = exitCode;
    } catch (error) {
      logger.error({ err: error }, "Graceful shutdown failed");
      process.exitCode = 1;
    }
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.once("SIGINT", () => void shutdown("SIGINT", 0));
  process.once("uncaughtException", (error) => {
    logger.fatal({ err: error }, "Uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", (error) => {
    logger.fatal({ err: error }, "Unhandled promise rejection");
    void shutdown("unhandledRejection", 1);
  });
}

const bootstrapLogger: Logger = pino({ level: "info" });
bootstrap().catch((error: unknown) => {
  bootstrapLogger.fatal({ err: error }, "Service failed to start");
  process.exitCode = 1;
});
