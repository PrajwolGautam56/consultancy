import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { isPrivileged, requireSession } from "@/lib/api-security";
import { metaConnectionConfigured, metaGraphVersion, metaRedirectUri } from "@/lib/meta";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Administrator or manager access is required" }, { status: 403 });
  if (!metaConnectionConfigured()) return NextResponse.redirect(new URL("/?channel=meta&metaError=setup", request.url));
  const state = crypto.randomBytes(24).toString("base64url");
  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    redirect_uri: metaRedirectUri(origin),
    state,
    response_type: "code",
    scope: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "instagram_basic", "instagram_manage_messages"].join(","),
  });
  const response = NextResponse.redirect(`https://www.facebook.com/${metaGraphVersion()}/dialog/oauth?${params}`);
  response.cookies.set("meta_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}
