import type { NextFunction, Request, Response } from "express";
import type { NfcConfigService } from "../services/nfc-config.service.js";
import type { NfcConfigQuery } from "../schemas/nfc-config.schemas.js";

export class NfcConfigController {
  public constructor(private readonly service: NfcConfigService) {}

  public readonly get = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userName } = response.locals.validated.query as NfcConfigQuery;
      const config = await this.service.getForUser(userName);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(config);
    } catch (error) {
      next(error);
    }
  };

  public readonly replace = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { userName } = response.locals.validated.query as NfcConfigQuery;
      await this.service.replaceForUser(userName, request.body as unknown);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ ok: true, userName });
    } catch (error) {
      next(error);
    }
  };
}
