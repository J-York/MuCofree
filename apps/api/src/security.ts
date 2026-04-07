import type { NextFunction, Request, Response } from "express";

const AUTH_RATE_LIMIT_WINDOW_MS = 60_000;
const AUTH_RATE_LIMIT_MAX_REQUESTS = 5;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export function basicSecurityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Origin-Agent-Cluster", "?1");
  next();
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  if (Array.isArray(forwardedFor)) {
    const firstIp = forwardedFor[0]?.trim();
    if (firstIp) return firstIp;
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function buildAuthRateLimitKey(req: Request): string {
  const ip = getClientIp(req);
  const username = typeof req.body?.username === "string"
    ? req.body.username.trim().toLowerCase()
    : "";

  return username ? `${ip}:${username}` : ip;
}

export function createAuthRateLimiter() {
  const buckets = new Map<string, RateLimitBucket>();

  return function authRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = buildAuthRateLimitKey(req);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS
      });
      next();
      return;
    }

    current.count += 1;

    if (current.count > AUTH_RATE_LIMIT_MAX_REQUESTS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many authentication attempts" });
      return;
    }

    next();
  };
}
