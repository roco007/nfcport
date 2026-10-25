import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, NotFoundError } from "../errors/app-error.js";

interface BodyParserError extends SyntaxError {
  readonly status?: number;
  readonly type?: string;
  readonly charset?: string;
  readonly encoding?: string;
}

function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const parserError = error as BodyParserError;
  if (
    parserError?.type === "entity.parse.failed" &&
    parserError.status === 400
  ) {
    return new AppError("Request body must contain valid JSON", {
      code: "INVALID_JSON",
      statusCode: 400,
    });
  }
  if (parserError?.type === "entity.too.large" && parserError.status === 413) {
    return new AppError("Request body is too large", {
      code: "PAYLOAD_TOO_LARGE",
      statusCode: 413,
    });
  }
  if (
    parserError?.status === 415 &&
    (parserError.type === "charset.unsupported" ||
      parserError.type === "encoding.unsupported")
  ) {
    return new AppError("Request body encoding is not supported", {
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415,
    });
  }

  return new AppError("Internal server error", {
    code: "INTERNAL_ERROR",
    statusCode: 500,
    expose: false,
    cause: error,
  });
}

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new NotFoundError(
      `Route ${request.method} ${request.path} was not found`,
      "ROUTE_NOT_FOUND",
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (
  error,
  request,
  response,
  _next,
) => {
  if (response.headersSent) return;

  const normalized = normalizeError(error);
  const requestId = String(request.id);
  if (normalized.statusCode >= 500) {
    request.log.error({ err: error, requestId }, "Request failed");
  }

  const message = normalized.expose
    ? normalized.message
    : "Internal server error";
  response.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      message,
      requestId,
      ...(normalized.details === undefined
        ? {}
        : { details: normalized.details }),
    },
  });
};
