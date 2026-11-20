import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataFile } from "./db-path";
import { logger } from "./logger";

/**
 * Server-side secret material.
 *
 * APP_SECRET (at least 32 characters) is used to derive the key that encrypts TOTP
 * secrets at rest. When it is not set, a random secret is generated once and stored
 * next to the database as `app-secret.key` (owner-only permissions), so a local or
 * Docker install works without configuration and the key persists with the data.
 *
 * Losing the key does not lock anyone out permanently: users with two-factor
 * authentication sign in with a recovery code (stored as a hash, not encrypted)
 * and enrol again, or an administrator resets their two-factor.
 */

const log = logger("crypto");
const g = globalThis as unknown as { __logitrackAppSecret?: string };

export function appSecret(): string {
  if (g.__logitrackAppSecret) return g.__logitrackAppSecret;
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("APP_SECRET must be at least 32 characters long.");
    return (g.__logitrackAppSecret = fromEnv);
  }
  const file = dataFile("app-secret.key");
  if (existsSync(file)) return (g.__logitrackAppSecret = readFileSync(file, "utf8").trim());
  const generated = randomBytes(32).toString("hex");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, generated, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on every platform */
  }
  log.warn("app_secret.generated", { message: "APP_SECRET is not set; generated one and stored it next to the database. Keep it with your backups." });
  return (g.__logitrackAppSecret = generated);
}

function key(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", appSecret(), "logitrack", purpose, 32));
}

/** AES-256-GCM. Output: "v1:" + base64(iv | tag | ciphertext). */
export function encrypt(plaintext: string, purpose = "mfa-secret"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decrypt(payload: string, purpose = "mfa-secret"): string {
  if (!payload.startsWith("v1:")) throw new Error("Unsupported ciphertext format.");
  const raw = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

/** Random opaque token for links and cookies (256 bits, hex). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** For tests: forget the cached secret. */
export function resetAppSecretCache() {
  delete g.__logitrackAppSecret;
}
