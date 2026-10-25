import express, { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { ServerMappingController } from "../controllers/server-mapping.controller.js";
import { requireApiKey } from "../middleware/api-key.js";
import { requireJsonContentType } from "../middleware/content-type.js";
import { createWriteRateLimiter } from "../middleware/rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import { serverMappingWriteSchema } from "../schemas/server-mapping.schemas.js";
import type { ServerMappingService } from "../services/server-mapping.service.js";

export function createServerMappingRouter(
  config: AppConfig,
  service: ServerMappingService,
): Router {
  const router = Router();
  const controller = new ServerMappingController(service);

  router.get("/server-mappings", controller.list);
  router.post(
    "/server-mappings",
    createWriteRateLimiter(config),
    requireApiKey(config.adminApiKey),
    requireJsonContentType,
    express.json({
      limit: config.bodyLimitBytes,
      strict: true,
      type: ["application/json", "application/*+json"],
    }),
    validateRequest({ body: serverMappingWriteSchema }),
    controller.save,
  );

  return router;
}
