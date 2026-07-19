import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { Lead } from "@/models/Lead";
import { rateLimit, requireSameOrigin, requireSession } from "@/lib/api-security";

const createLead = z.object({
  name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(24),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  address: z.string().trim().max(300).optional(), education: z.string().trim().max(300).optional(),
  country: z.string().trim().max(100).optional(), course: z.string().trim().max(200).optional(),
  university: z.string().trim().max(200).optional(),
  tags: z.string().trim().max(500).optional(),
  source: z.enum(["Facebook", "Instagram", "Phone call", "Walk-in", "Referral", "Website", "Other"]).default("Other"),
});

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  const limited = rateLimit(request, "lead-read", 120, 60_000); if (limited) return limited;
  try {
    await connectMongo(); const q = request.nextUrl.searchParams.get("q")?.trim().slice(0,100);
    const filter = q ? { $or: [{ name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), $options: "i" } }, { phone: { $regex: q.replace(/\D/g, ""), $options: "i" } }, { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"), $options: "i" } }] } : {};
    const leads = await Lead.find({ ...filter, archivedAt: null }).sort({ updatedAt: -1 }).limit(200).lean();
    return NextResponse.json({ leads });
  } catch { return NextResponse.json({ error: "Could not load leads" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const limited = rateLimit(request, "lead-create", 20, 60_000); if (limited) return limited;
  try {
    const parsed = createLead.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Invalid lead details", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    await connectMongo(); const phone = parsed.data.phone.replace(/[\s()-]/g, ""); const email = parsed.data.email?.toLowerCase() || undefined;
    const tags=Array.from(new Set((parsed.data.tags||"").split(",").map(tag=>tag.trim()).filter(Boolean))).slice(0,20);
    const duplicate = await Lead.exists({ $or: [{ phone }, ...(email ? [{ email }] : [])] });
    if (duplicate) return NextResponse.json({ error: "A contact with this phone or email already exists" }, { status: 409 });
    const lead = await Lead.create({ ...parsed.data, tags, phone, email, createdBy: session.userId, activities: [{ type: "note", text: "Lead profile created", authorId: session.userId, authorName: session.name }] });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    if ((error as {code?:number}).code === 11000) return NextResponse.json({ error: "A contact with this phone or email already exists" }, { status: 409 });
    return NextResponse.json({ error: "Could not create lead" }, { status: 500 });
  }
}
