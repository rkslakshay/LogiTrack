import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page request.
 *
 * 1. Content Security Policy with a fresh nonce per request. Next.js reads the
 *    nonce from the request header and adds it to its own scripts; any other
 *    script (an injected <script>, an inline handler, a third-party URL) is blocked.
 * 2. Optimistic sign-in gate: requests without a session cookie go to /login before
 *    any page work. The authoritative checks (valid session, role permissions) run
 *    in the layout, each page and every API route handler.
 */

const PUBLIC_PATHS = new Set(["/", "/login", "/reset-password"]);
const SESSION_COOKIES = ["lt_session", "__Host-lt_session"];

/** OpenStreetMap tile server used by the Leaflet maps. */
const TILE_ORIGIN = "https://tile.openstreetmap.org";

export function buildCsp(nonce: string, host: string, opts: { dev: boolean; secure: boolean }): string {
  const ws = opts.secure ? `wss://${host}` : `ws://${host}`;
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets Next.js's nonce-bearing loader pull in its chunks; nothing else runs.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are needed by Leaflet (marker positions) and Recharts (SVG),
    // and a nonce cannot cover style attributes. Styles cannot execute code.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${TILE_ORIGIN}`,
    "font-src 'self' data:",
    // The realtime channel and, in development, hot reloading use same-host websockets.
    `connect-src 'self' ${ws}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "report-uri /api/csp-report",
    ...(opts.secure ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));

  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, request.headers.get("host") ?? request.nextUrl.host, {
    dev: process.env.NODE_ENV === "development",
    secure: process.env.COOKIE_SECURE === "true",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Pages only: API routes answer with JSON, and static assets are public.
  matcher: [
    {
      source: "/((?!api|socket.io|_next/static|_next/image|favicon.ico|screenshots|templates|.*\\.(?:png|jpg|jpeg|svg|ico|webp|csv)$).*)",
      // Prefetches are not rendered as documents; they do not need a policy of their own.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
