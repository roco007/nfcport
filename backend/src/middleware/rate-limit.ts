import { rateLimit } from "express-rate-limit";
import type { Request } from "express";
import type { AppConfig } from "../config/env.js";

function rateLimitResponse(request: Request) {
  return {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests; try again later",
      requestId: String(request.id),
    },
  };
}

export function createGlobalRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json(rateLimitResponse(request));
    },
  });
}

export function createWriteRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxWriteRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json(rateLimitResponse(request));
    },
  });
}

export function createReadinessRateLimiter(config: AppConfig) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.maxRequests,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(request, response) {
      response.status(429).json(rateLimitResponse(request));
    },
  });
}
