import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import {
  RequestValidationError,
  type ValidationIssue,
} from "../errors/app-error.js";

interface RequestSchemas {
  readonly query?: ZodType;
  readonly body?: ZodType;
}

export function validateRequest(schemas: RequestSchemas): RequestHandler {
  return (request, response, next) => {
    const validated: Express.Locals["validated"] = {};
    const issues: ValidationIssue[] = [];

    for (const [location, schema, value] of [
      ["query", schemas.query, request.query],
      ["body", schemas.body, request.body],
    ] as const) {
      if (schema === undefined) continue;

      const result = schema.safeParse(value);
      if (result.success) {
        validated[location] = result.data;
        continue;
      }

      issues.push(
        ...result.error.issues.map((issue) => ({
          path: [location, ...issue.path.map(String)].join("."),
          code: issue.code,
          message: issue.message,
        })),
      );
    }

    if (issues.length > 0) {
      next(new RequestValidationError(issues));
      return;
    }

    response.locals.validated = validated;
    next();
  };
}
