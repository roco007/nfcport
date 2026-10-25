import type { RequestHandler } from "express";
import { UnsupportedMediaTypeError } from "../errors/app-error.js";

export const requireJsonContentType: RequestHandler = (
  request,
  _response,
  next,
) => {
  if (!request.is(["application/json", "application/*+json"])) {
    next(new UnsupportedMediaTypeError());
    return;
  }
  next();
};
