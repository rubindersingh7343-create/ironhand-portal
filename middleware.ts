import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/users";

const DISPLAY_NAME_COOKIE = "ih_display_name";

const firstLastFromName = (value: string) => {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1] ?? "";
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    const json = globalThis.atob(padded);
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/public") ||
    pathname.endsWith(".ico") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".pdf")
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  const isAuthRoute = pathname.startsWith("/auth");
  const isSignupRoute = pathname.startsWith("/signup");

  let response: NextResponse;
  if (!sessionCookie && !isAuthRoute && !isSignupRoute) {
    const loginUrl = new URL("/auth/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("redirectTo", pathname);
    }
    response = NextResponse.redirect(loginUrl);
  } else if (sessionCookie && isAuthRoute) {
    response = NextResponse.redirect(new URL("/", request.url));
  } else {
    response = NextResponse.next();
  }

  if (sessionCookie) {
    const existing = request.cookies.get(DISPLAY_NAME_COOKIE)?.value ?? "";
    if (!existing) {
      const payload = decodeJwtPayload(sessionCookie);
      const nameRaw = typeof payload?.name === "string" ? payload.name : "";
      const displayName = firstLastFromName(nameRaw);
      if (displayName) {
        response.cookies.set({
          name: DISPLAY_NAME_COOKIE,
          value: displayName,
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        });
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
