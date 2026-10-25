export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

interface AppErrorOptions {
  readonly code: string;
  readonly statusCode: number;
  readonly expose?: boolean;
  readonly details?: readonly ValidationIssue[];
  readonly cause?: unknown;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly expose: boolean;
  public readonly details: readonly ValidationIssue[] | undefined;

  public constructor(message: string, options: AppErrorOptions) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.expose = options.expose ?? true;
    this.details = options.details;
  }
}

export class RequestValidationError extends AppError {
  public constructor(details: readonly ValidationIssue[]) {
    super("Request validation failed", {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      details,
    });
  }
}

export class UnauthorizedError extends AppError {
  public constructor() {
    super("A valid API key is required", {
      code: "UNAUTHORIZED",
      statusCode: 401,
    });
  }
}

export class ForbiddenError extends AppError {
  public constructor(message = "Request origin is not allowed") {
    super(message, { code: "FORBIDDEN", statusCode: 403 });
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string, code = "NOT_FOUND") {
    super(message, { code, statusCode: 404 });
  }
}

export class UnsupportedMediaTypeError extends AppError {
  public constructor() {
    super("Content-Type must be application/json", {
      code: "UNSUPPORTED_MEDIA_TYPE",
      statusCode: 415,
    });
  }
}

export class DependencyUnavailableError extends AppError {
  public constructor(cause?: unknown) {
    super("A required dependency is temporarily unavailable", {
      code: "DEPENDENCY_UNAVAILABLE",
      statusCode: 503,
      cause,
    });
  }
}

export class DataIntegrityError extends AppError {
  public constructor(cause?: unknown) {
    super("Stored NFC configuration is invalid", {
      code: "DATA_INTEGRITY_ERROR",
      statusCode: 500,
      expose: false,
      cause,
    });
  }
}
