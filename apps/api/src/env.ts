import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function defaultDatabasePath(): string {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const normalizedPath = path.join(packageRoot, "data", "dev.sqlite");
  const legacyPath = path.join(packageRoot, "apps", "api", "data", "dev.sqlite");

  const normalizedExists = fs.existsSync(normalizedPath);
  const normalizedSize = normalizedExists ? fs.statSync(normalizedPath).size : 0;

  if (fs.existsSync(legacyPath) && (!normalizedExists || normalizedSize === 0)) {
    return legacyPath;
  }

  return normalizedPath;
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_PATH: z.string().default(defaultDatabasePath()),
  QQMUSIC_BASE_URL: z.string().url().default("https://api.ygking.top"),
  CORS_ORIGIN: z.string().default("http://127.0.0.1:5173"),
  SESSION_SECRET: z.string().min(1).default("dev-secret-change-me-in-production"),
  SECURE_COOKIE: z.coerce.boolean().default(false)
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment variables: ${msg}`);
  }
  return parsed.data;
}
