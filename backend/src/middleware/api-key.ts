import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { UnauthorizedError } from "../errors/app-error.js";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function hasValidApiKey(
  suppliedApiKey: string | undefined,
  expectedDigest: Buffer,
): boolean {
  return (
    suppliedApiKey !== undefined &&
    timingSafeEqual(digest(suppliedApiKey), expectedDigest)
  );
}

export function requireApiKey(expectedApiKey: string): RequestHandler {
  const expectedDigest = digest(expectedApiKey);

  return (request, _response, next) => {
    if (!hasValidApiKey(request.header("x-api-key"), expectedDigest)) {
      next(new UnauthorizedError());
      return;
    }

    next();
  };
}

/**
 * The default mapping is intentionally public because the NFC client consumes
 * it before authentication. Reading any other user's mapping is an
 * administrative operation and must not be authorized by a caller-controlled
 * userName alone.
 */
export function requireApiKeyForNonDefaultUser(
  expectedApiKey: string,
  defaultUserName: string,
): RequestHandler {
  const expectedDigest = digest(expectedApiKey);

  return (request, response, next) => {
    const query = response.locals.validated.query as
      | { readonly userName?: unknown }
      | undefined;
    if (query?.userName === defaultUserName) {
      next();
      return;
    }

    if (!hasValidApiKey(request.header("x-api-key"), expectedDigest)) {
      next(new UnauthorizedError());
      return;
    }

    next();
  };
}
