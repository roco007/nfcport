import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { createReadinessRateLimiter } from "../middleware/rate-limit.js";
import type { NfcConfigRepository } from "../repositories/nfc-config.repository.js";

interface HealthRouterOptions {
  readonly config: AppConfig;
  readonly repository: NfcConfigRepository;
}

async function withTimeout(
  operation: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Readiness check timed out")),
          timeoutMs,
        );
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function createHealthRouter({
  config,
  repository,
}: HealthRouterOptions): Router {
  const router = Router();
  interface ReadinessResult {
    readonly ready: boolean;
    readonly error: unknown | undefined;
    readonly expiresAt: number;
  }

  let cachedResult: ReadinessResult | undefined;
  let inFlightCheck: Promise<ReadinessResult> | undefined;

  const checkReadiness = (): Promise<ReadinessResult> => {
    const now = Date.now();
    if (cachedResult !== undefined && cachedResult.expiresAt > now) {
      return Promise.resolve(cachedResult);
    }
    if (inFlightCheck !== undefined) return inFlightCheck;

    inFlightCheck = withTimeout(
      repository.ping(config.readinessTimeoutMs),
      config.readinessTimeoutMs,
    )
      .then<ReadinessResult>(() => ({
        ready: true,
        error: undefined,
        expiresAt: Date.now() + config.readinessCacheMs,
      }))
      .catch<ReadinessResult>((error: unknown) => ({
        ready: false,
        error,
        expiresAt: Date.now() + config.readinessCacheMs,
      }))
      .then((result) => {
        cachedResult = result;
        return result;
      })
      .finally(() => {
        inFlightCheck = undefined;
      });

    return inFlightCheck;
  };

  router.get("/health", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const now = new Date();
    response.status(200).json({
      ok: true,
      status: "ok",
      service: config.serviceName,
      version: config.serviceVersion,
      uptimeSeconds: Math.floor(process.uptime()),
      // Keep the previous numeric field while exposing a human-readable value.
      timestamp: now.getTime(),
      checkedAt: now.toISOString(),
    });
  });

  router.get(
    "/ready",
    createReadinessRateLimiter(config),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      const result = await checkReadiness();
      if (result.ready) {
        response
          .status(200)
          .json({ status: "ready", timestamp: new Date().toISOString() });
        return;
      }

      request.log.warn({ err: result.error }, "Readiness check failed");
      response
        .status(503)
        .json({ status: "not_ready", timestamp: new Date().toISOString() });
    },
  );

  return router;
}
