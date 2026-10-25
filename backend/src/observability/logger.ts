import pino, { type Logger } from "pino";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config/env.js";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.logLevel,
    base: {
      service: config.serviceName,
      version: config.serviceVersion,
      environment: config.environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.x-api-key",
        "request.headers.authorization",
        "request.headers.cookie",
        "request.headers.x-api-key",
        "config.adminApiKey",
        "config.database.password",
      ],
      censor: "[REDACTED]",
    },
  });
}

export function createHttpLogger(logger: Logger) {
  return pinoHttp<IncomingMessage, ServerResponse>({
    logger,
    genReqId(request, response) {
      const suppliedId = request.headers["x-request-id"];
      const requestId =
        typeof suppliedId === "string" && REQUEST_ID_PATTERN.test(suppliedId)
          ? suppliedId
          : randomUUID();
      response.setHeader("x-request-id", requestId);
      return requestId;
    },
    customLogLevel(_request, response, error) {
      if (error || response.statusCode >= 500) return "error";
      if (response.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessMessage(request, response) {
      return `${request.method} ${request.url} completed with ${response.statusCode}`;
    },
    customErrorMessage(request, response) {
      return `${request.method} ${request.url} failed with ${response.statusCode}`;
    },
  });
}
