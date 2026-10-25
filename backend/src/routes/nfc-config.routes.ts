import express, { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { NfcConfigController } from "../controllers/nfc-config.controller.js";
import {
  requireApiKey,
  requireApiKeyForNonDefaultUser,
} from "../middleware/api-key.js";
import { requireJsonContentType } from "../middleware/content-type.js";
import { createWriteRateLimiter } from "../middleware/rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import { createNfcConfigQuerySchema } from "../schemas/nfc-config.schemas.js";
import type { NfcConfigService } from "../services/nfc-config.service.js";

export function createNfcConfigRouter(
  config: AppConfig,
  service: NfcConfigService,
): Router {
  const router = Router();
  const controller = new NfcConfigController(service);
  const querySchema = createNfcConfigQuerySchema(config.defaultUserName);

  router.get(
    "/nfc-config",
    validateRequest({ query: querySchema }),
    requireApiKeyForNonDefaultUser(config.adminApiKey, config.defaultUserName),
    controller.get,
  );

  router.post(
    "/nfc-config",
    createWriteRateLimiter(config),
    requireApiKey(config.adminApiKey),
    requireJsonContentType,
    express.json({
      limit: config.bodyLimitBytes,
      // Mapping payloads are intentionally opaque JSON. Syntax and size are
      // still enforced here, but their application-specific shape is not.
      // Keeping Express' object/array requirement avoids ambiguous MySQL JSON
      // scalar decoding and preserves null as the repository's not-found value.
      strict: true,
      type: ["application/json", "application/*+json"],
    }),
    validateRequest({ query: querySchema }),
    controller.replace,
  );

  return router;
}
