import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, randomToken, safeEqual } from "@/lib/crypto";
import { captureLogs, clearRecentProblems, logger, maskEmails, recentProblems, sanitize } from "@/lib/logger";
import { passwordProblems, passwordScore } from "@/lib/password-policy";
import { can, ROLE_PERMISSIONS } from "@/lib/permissions";
import { RateLimiter } from "@/lib/rate-limit";
import { restoreSchema } from "@/lib/validation";
import { buildCsp } from "@/proxy";
import { isValidBackupName } from "@/server/services/backup";

describe("password policy", () => {
  it("rejects short, letter-only, digit-only and common passwords", () => {
    expect(passwordProblems("Ab1")).not.toHaveLength(0);
    expect(passwordProblems("abcdefghij")).not.toHaveLength(0);
    expect(passwordProblems("1234567890")).not.toHaveLength(0);
    expect(passwordProblems("password1")).not.toHaveLength(0);
    expect(passwordProblems("Admin123")).not.toHaveLength(0);
  });

  it("rejects passwords containing the person's name or e-mail name", () => {
    expect(passwordProblems("PriyankaRao2024!", { name: "Priyanka Rao" })).not.toHaveLength(0);
    expect(passwordProblems("Xyzrao77fleet", { email: "xyzrao77@example.in" })).not.toHaveLength(0);
  });

  it("accepts a reasonable password and scores longer ones higher", () => {
    expect(passwordProblems("Tiffin-Route-42", { name: "Asha Verma", email: "asha@example.in" })).toEqual([]);
    expect(passwordScore("Tiffin-Route-42-Pune")).toBeGreaterThan(passwordScore("Ab12cd34"));
  });

  it("refuses passwords longer than bcrypt can hash", () => {
    expect(passwordProblems("A1" + "x".repeat(80))).not.toHaveLength(0);
  });
});

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("JBSWY3DPEHPK3PXP");
    const b = encrypt("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decrypt(a)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("detects tampering and wrong purposes", () => {
    const sealed = encrypt("secret-value");
    const raw = Buffer.from(sealed.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt(`v1:${raw.toString("base64")}`)).toThrow();
    expect(() => decrypt(sealed, "another-purpose")).toThrow();
  });

  it("produces hex tokens and compares in constant time", () => {
    expect(randomToken()).toMatch(/^[a-f0-9]{64}$/);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows up to the limit inside the window, then refuses with a retry time", () => {
    const l = new RateLimiter("t", 60_000, 3);
    expect(l.hit("k", 0).allowed).toBe(true);
    expect(l.hit("k", 1).allowed).toBe(true);
    expect(l.hit("k", 2).allowed).toBe(true);
    const blocked = l.hit("k", 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(59_000);
    expect(l.hit("other", 3).allowed).toBe(true);
    expect(l.hit("k", 60_001).allowed).toBe(true); // first hit left the window
  });

  it("bounds memory when many keys are sprayed", () => {
    const l = new RateLimiter("t", 60_000, 1, 100);
    for (let i = 0; i < 1000; i++) l.hit(`key-${i}`, 0);
    expect((l as unknown as { hits: Map<string, number[]> }).hits.size).toBeLessThanOrEqual(100);
  });
});

describe("logging", () => {
  afterEach(() => clearRecentProblems());

  it("redacts secret fields and masks e-mail addresses", () => {
    const out = sanitize({
      email: "asha.verma@example.in", password: "Hunter2!", token: "abc", nested: { recoveryCode: "abcd-efgh", apiKey: "k" },
      note: "contact ravi@fleet.in", count: 3,
    }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/Hunter2|abcd-efgh|asha\.verma|ravi@/);
    expect(out.password).toBe("[redacted]");
    expect(out.count).toBe(3);
    expect(maskEmails("x a.b@c.in y")).toBe("x a****@c.in y");
  });

  it("writes one JSON line per entry and keeps warnings for diagnostics", () => {
    const cap = captureLogs();
    const prevFormat = process.env.LOG_FORMAT;
    const prevLevel = process.env.LOG_LEVEL;
    process.env.LOG_FORMAT = "json";
    process.env.LOG_LEVEL = "info";
    try {
      logger("test").warn("something.odd", { password: "nope", userId: "u1" });
    } finally {
      process.env.LOG_FORMAT = prevFormat;
      process.env.LOG_LEVEL = prevLevel;
      cap.restore();
    }
    expect(cap.lines).toHaveLength(1);
    const entry = JSON.parse(cap.lines[0]);
    expect(entry).toMatchObject({ level: "warn", scope: "test", event: "something.odd", userId: "u1", password: "[redacted]" });
    expect(recentProblems(1)[0].event).toBe("something.odd");
  });
});

describe("content security policy", () => {
  it("allows only nonce-bearing scripts and blocks framing, plugins and foreign forms", () => {
    const csp = buildCsp("abc123", "fleet.example", { dev: false, secure: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("connect-src 'self' wss://fleet.example");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("only relaxes eval in development", () => {
    expect(buildCsp("n", "localhost:3000", { dev: true, secure: false })).toContain("'unsafe-eval'");
  });
});

describe("backup names", () => {
  it("accepts generated names and rejects anything that could escape the folder", () => {
    expect(isValidBackupName("logitrack-20261119-002650-manual.db")).toBe(true);
    expect(isValidBackupName("logitrack-20261119-002650-3-pre-restore.db")).toBe(true);
    for (const bad of ["../dev.db", "logitrack-20261119-002650-manual.db/../../x", "dev.db", "logitrack-2026-manual.db", "logitrack-20261119-002650-evil.db", "C:\\x.db"]) {
      expect(isValidBackupName(bad)).toBe(false);
    }
  });

  it("requires the literal word RESTORE to confirm a restore", () => {
    expect(restoreSchema.safeParse({ password: "x", confirm: "restore" }).success).toBe(false);
    expect(restoreSchema.safeParse({ password: "x", confirm: "RESTORE" }).success).toBe(true);
  });
});

describe("system permissions", () => {
  it("restricts backups and diagnostics to Super Admins", () => {
    expect(can("SUPER_ADMIN", "system:backup")).toBe(true);
    expect(can("SUPER_ADMIN", "system:diagnostics")).toBe(true);
    for (const role of ["FLEET_MANAGER", "DISPATCHER", "DRIVER"] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain("system:backup");
      expect(ROLE_PERMISSIONS[role]).not.toContain("system:diagnostics");
    }
  });
});
