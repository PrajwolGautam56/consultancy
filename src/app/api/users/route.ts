import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, rateLimit, requireSameOrigin, requireSession } from "@/lib/api-security";
import { User } from "@/models/User";
import { sendTeamWelcome } from "@/lib/email";

const newMember = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(24).optional(),
  role: z.enum(["admin", "manager", "counsellor", "receptionist"]),
  password: z.string().min(10).max(128),
});

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  try {
    await connectMongo();
    if (request.nextUrl.searchParams.get("directory") === "1") {
      const users = await User.find({ active: true }).select("name role active").sort({ name: 1 }).lean();
      return NextResponse.json({ users });
    }
    if (!isPrivileged(session.role)) return NextResponse.json({ error: "Team access requires manager permission" }, { status: 403 });
    const users = await User.find().select("name email phone role active lastLoginAt createdAt").sort({ active: -1, name: 1 }).lean();
    return NextResponse.json({ users });
  } catch { return NextResponse.json({ error: "Could not load team" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Team access requires manager permission" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const limited = rateLimit(request, "team-create", 10, 60_000); if (limited) return limited;
  const parsed = newMember.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid staff details", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  if (parsed.data.role === "admin" && session.role !== "super_admin") return NextResponse.json({ error: "Only a super administrator can create an administrator" }, { status: 403 });
  try {
    await connectMongo();
    const exists = await User.exists({ email: parsed.data.email.toLowerCase() });
    if (exists) return NextResponse.json({ error: "A staff account with this email already exists" }, { status: 409 });
    const { password, ...profile } = parsed.data;
    const user = await User.create({ ...profile, email: profile.email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), active: true });
    let invitationStatus:"sent"|"failed"="sent";
    try { await sendTeamWelcome({name:user.name,email:user.email,role:String(user.role).replace("_"," ")}); }
    catch(error) { invitationStatus="failed"; console.error("Team welcome email failed",error instanceof Error?error.message:"Unknown error"); }
    return NextResponse.json({ user: { _id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, active: user.active, createdAt: user.createdAt }, invitationStatus }, { status: 201 });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return NextResponse.json({ error: "A staff account with this email already exists" }, { status: 409 });
    return NextResponse.json({ error: "Could not create staff account" }, { status: 500 });
  }
}
