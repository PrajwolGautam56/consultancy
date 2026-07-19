import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;
  if (token) { try { await verifySessionToken(token); authenticated = true; } catch { authenticated = false; } }
  if (isLogin && authenticated) return NextResponse.redirect(new URL("/", request.url));
  if (!isLogin && !authenticated) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const response = NextResponse.next();
  if (token && !authenticated) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth/login).*)"] };
