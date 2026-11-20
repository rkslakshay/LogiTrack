import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { ApiError, forbidden, unauthorized } from "./errors";
import { logger } from "./logger";
import { LIMITS } from "./rate-limit";
import { getCurrentUser } from "./auth-server";
import type { SessionUser } from "./auth";
import { can, type Permission } from "./permissions";

interface RouteOptions<S extends z.ZodType | undefined> {
  /** Any one of these permissions grants access. Omit for "any signed-in user". */
  permission?: Permission | Permission[];
  /** Set to false for public endpoints (login). */
  auth?: boolean;
  /** Zod schema for the JSON body. */
  body?: S;
}

interface RouteContext<S extends z.ZodType | undefined, A extends boolean> {
  req: NextRequest;
  user: A extends false ? SessionUser | null : SessionUser;
  params: Record<string, string>;
  query: URLSearchParams;
  body: S extends z.ZodType ? z.infer<S> : undefined;
}

/** Turns Zod issues into a { field: message } map for form display. */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Blocks cross-site state-changing requests. Session cookies are SameSite=Lax,
 * and on top of that every mutating request must come from our own origin.
 */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* malformed origin */
    }
    if (originHost !== host) throw forbidden("Cross-origin request blocked.");
    return;
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("Cross-origin request blocked.");
}

const log = logger("api");

export function errorResponse(err: unknown, requestId?: string, context: { method?: string; path?: string; userId?: string | null } = {}): NextResponse {
  if (err instanceof ApiError) {
    if (err.status === 403 || err.status === 429) log.warn("request.refused", { requestId, status: err.status, code: err.code, ...context });
    return NextResponse.json(
      { error: { code: err.code, message: err.message, fieldErrors: err.fieldErrors } },
      { status: err.status, headers: err.headers },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Please correct the highlighted fields.", fieldErrors: zodFieldErrors(err) } },
      { status: 422 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "value";
      const field = (err.meta?.target as string[] | undefined)?.[0];
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: `A record with this ${target} already exists.`,
            fieldErrors: field ? { [field]: "Already in use." } : undefined,
          },
        },
        { status: 409 },
      );
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found." } }, { status: 404 });
    }
    if (err.code === "P2003") {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "This record is referenced by other records and cannot be removed." } },
        { status: 409 },
      );
    }
  }
  // Never leak internals (stack traces, SQL, secrets) to the client. The request ID links
  // the client's error to the server log entry.
  const database = err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientInitializationError;
  log.error(database ? "database.error" : "request.failed", { requestId, ...context, err });
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } },
    { status: 500 },
  );
}

/**
 * Wraps a route handler with authentication, permission checks, CSRF protection,
 * body validation and centralised error handling.
 *
 * Handlers return plain data (sent as `{ data }`) or a ready-made Response (CSV etc.).
 */
export function route<S extends z.ZodType | undefined = undefined, A extends boolean = true>(
  options: RouteOptions<S> & { auth?: A },
  handler: (ctx: RouteContext<S, A>) => Promise<unknown>,
) {
  return async (req: NextRequest, segment: { params: Promise<Record<string, string | string[] | undefined>> }) => {
    const requestId = randomUUID();
    let userId: string | null = null;
    const finish = (res: Response) => {
      res.headers.set("X-Request-Id", requestId);
      // API responses may contain personal or operational data: never cache them.
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      return res;
    };
    try {
      assertSameOrigin(req);
      const user = await getCurrentUser();
      userId = user?.id ?? null;
      // A generous ceiling on writes per user stops runaway scripts without affecting normal use.
      if (user && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const limit = LIMITS.writesPerUser().hit(user.id);
        if (!limit.allowed) {
          throw new ApiError(429, "Too many requests. Please slow down.", "RATE_LIMITED", undefined, { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) });
        }
      }
      if (options.auth !== false) {
        if (!user) throw unauthorized();
        if (options.permission) {
          const list = Array.isArray(options.permission) ? options.permission : [options.permission];
          if (!list.some((p) => can(user.role, p))) throw forbidden();
        }
      }
      let body: unknown = undefined;
      if (options.body) {
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw new ApiError(400, "Request body must be valid JSON.", "BAD_REQUEST");
        }
        body = options.body.parse(json);
      }
      const rawParams = (await segment.params) ?? {};
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawParams)) params[k] = Array.isArray(v) ? v.join("/") : (v ?? "");

      const result = await handler({
        req,
        user: user as RouteContext<S, A>["user"],
        params,
        query: req.nextUrl.searchParams,
        body: body as RouteContext<S, A>["body"],
      });
      if (result instanceof Response) return finish(result);
      return finish(NextResponse.json({ data: result ?? null }));
    } catch (err) {
      return finish(errorResponse(err, requestId, { method: req.method, path: req.nextUrl.pathname, userId }));
    }
  };
}

export * from "./list";

/**
 * Who is calling. The custom server stamps every request with the socket's remote
 * address (x-logitrack-client-ip) after removing any value a client tried to send,
 * so it cannot be spoofed. X-Forwarded-For is only honoured with TRUST_PROXY=true,
 * i.e. when LogiTrack runs behind a reverse proxy you control.
 */
export function requestMeta(req: NextRequest): { ip: string; userAgent: string | null } {
  const forwarded = process.env.TRUST_PROXY === "true" ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : null;
  const ip = forwarded || req.headers.get("x-logitrack-client-ip") || "unknown";
  return { ip, userAgent: req.headers.get("user-agent") };
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
