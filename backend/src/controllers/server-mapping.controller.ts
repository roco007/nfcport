import type { NextFunction, Request, Response } from "express";
import type { ServerMappingWrite } from "../schemas/server-mapping.schemas.js";
import type { ServerMappingService } from "../services/server-mapping.service.js";

export class ServerMappingController {
  public constructor(private readonly service: ServerMappingService) {}

  public readonly list = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const servers = await this.service.list();
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ servers });
    } catch (error) {
      next(error);
    }
  };

  public readonly save = async (
    _request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = response.locals.validated.body as ServerMappingWrite;
      const server = await this.service.save(input);
      response.setHeader("Cache-Control", "no-store");
      response.status(input.id === undefined ? 201 : 200).json({ server });
    } catch (error) {
      next(error);
    }
  };
}
