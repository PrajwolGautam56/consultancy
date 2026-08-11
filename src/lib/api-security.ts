import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, SessionPayload } from "@/lib/auth";
import { connectMongo } from "@/lib/mongodb";
import { User } from "@/models/User";

const buckets = new Map<string, { count: number; reset: number }>();

export async function requireSession(request: NextRequest): Promise<SessionPayload | NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const session=await verifySessionToken(token);
    if(!session.sessionId)return NextResponse.json({error:"Session expired"},{status:401});
    await connectMongo(); const active=await User.exists({_id:session.userId,active:true,currentSessionId:session.sessionId});
    if(!active)return NextResponse.json({error:"This account was signed in on another device"},{status:401});
    return session;
  }
  catch { return NextResponse.json({ error: "Session expired" }, { status: 401 }); }
}

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function rateLimit(request: NextRequest, key: string, limit: number, windowMs: number) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const id = `${key}:${ip}`; const now = Date.now(); const current = buckets.get(id);
  if (!current || current.reset <= now) { buckets.set(id, { count: 1, reset: now + windowMs }); return null; }
  current.count += 1;
  if (current.count <= limit) return null;
  return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: { "Retry-After": String(Math.ceil((current.reset-now)/1000)) } });
}

export function isPrivileged(role: SessionPayload["role"]) { return role === "super_admin" || role === "admin" || role === "manager"; }
