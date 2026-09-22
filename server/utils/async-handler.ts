/**
 * server/utils/async-handler.ts
 * Wraps Express async route handlers to forward rejected promises
 * to Express's error middleware instead of letting them become
 * unhandled rejections that crash the process.
 *
 * Express 4 does NOT automatically catch promise rejections from
 * async (req, res, next) => {} handlers. Without this wrapper,
 * any unhandled rejection in an async route handler becomes a
 * process-level unhandled rejection → process termination.
 *
 * Usage:
 *   router.get('/path', asyncHandler(async (req, res) => { ... }));
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

/**
 * Wraps an async Express route handler to catch rejected promises
 * and forward them to next(err) for Express's error middleware.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
