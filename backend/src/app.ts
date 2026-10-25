import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { Logger } from "pino";
import type { AppConfig } from "./config/env.js";
import { ForbiddenError } from "./errors/app-error.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createGlobalRateLimiter } from "./middleware/rate-limit.js";
import { createHttpLogger } from "./observability/logger.js";
import type { NfcConfigRepository } from "./repositories/nfc-config.repository.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createNfcConfigRouter } from "./routes/nfc-config.routes.js";
import { NfcConfigService } from "./services/nfc-config.service.js";

interface CreateAppOptions {
  readonly config: AppConfig;
  readonly repository: NfcConfigRepository;
  readonly logger: Logger;
}

export function createApp({
  config,
  repository,
  logger,
}: CreateAppOptions): Express {
  const app = express();
  const nfcConfigService = new NfcConfigService(repository);

  app.disable("x-powered-by");
  app.set("json escape", true);
  app.set(
    "trust proxy",
    config.trustProxyHops === 0 ? false : config.trustProxyHops,
  );

  app.use(createHttpLogger(logger));
  app.use(
    helmet({
      // This service returns JSON rather than browser documents.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: false,
      ...(config.environment === "production" ? {} : { hsts: false }),
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        // Native clients, probes, and server-to-server callers do not send Origin.
        if (origin === undefined || config.corsOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new ForbiddenError());
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: [
        "Accept",
        "Authorization",
        "Content-Type",
        "X-API-Key",
        "X-Request-ID",
      ],
      exposedHeaders: ["RateLimit", "RateLimit-Policy", "X-Request-ID"],
      credentials: false,
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );

  const healthRouter = createHealthRouter({ config, repository });
  app.use(healthRouter);
  // Compatibility aliases for the mobile app and the prior deployment probe.
  app.use("/api", healthRouter);

  app.use(createGlobalRateLimiter(config));

  const apiRouter = createNfcConfigRouter(config, nfcConfigService);
  app.use("/api", apiRouter);
  app.use("/api/v1", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
