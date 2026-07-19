import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 401 });
  try { return NextResponse.json({ user: await verifySessionToken(token) }); }
  catch { return NextResponse.json({ user: null }, { status: 401 }); }
}
