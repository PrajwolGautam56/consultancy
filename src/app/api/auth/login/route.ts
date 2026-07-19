import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectMongo } from "@/lib/mongodb";
import { createSessionToken, SESSION_COOKIE, SessionPayload } from "@/lib/auth";
import { User } from "@/models/User";
import { rateLimit, requireSameOrigin } from "@/lib/api-security";
import { z } from "zod";

const credentials = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128) });

export async function POST(request: NextRequest) {
  try {
    if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    const limited = rateLimit(request, "login", 8, 15 * 60_000); if (limited) return limited;
    const parsed = credentials.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid email or password" }, { status: 400 });
    const { email, password } = parsed.data;
    await connectMongo();
    const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select("+passwordHash");
    if (!user || !user.active || !(await bcrypt.compare(String(password), user.passwordHash))) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const session: SessionPayload = { userId: user._id.toString(), email: user.email, name: user.name, role: user.role };
    const token = await createSessionToken(session);
    user.lastLoginAt = new Date();
    await user.save();
    const response = NextResponse.json({ user: session });
    response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 8 });
    return response;
  } catch (error) {
    console.error("Login service error", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json({ error: "Unable to sign in. Please try again." }, { status: 500 });
  }
}
