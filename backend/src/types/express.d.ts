export {};

declare global {
  namespace Express {
    interface Locals {
      validated: {
        query?: unknown;
        body?: unknown;
      };
    }
  }
}
