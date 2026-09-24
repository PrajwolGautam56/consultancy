import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { Lead } from "@/models/Lead";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";

const schema = z.object({ leadIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(1000), optedIn: z.boolean(), source: z.string().trim().min(2).max(120) }).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can record consent" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid consent details" }, { status: 400 });
  await connectMongo(); const now = new Date();
  const set = parsed.data.optedIn
    ? { whatsappOptIn: true, whatsappOptInAt: now, whatsappOptInSource: parsed.data.source, whatsappOptOutAt: null }
    : { whatsappOptIn: false, whatsappOptOutAt: now, whatsappOptInSource: parsed.data.source };
  const result = await Lead.updateMany({ _id: { $in: parsed.data.leadIds }, archivedAt: null }, { $set: set });
  return NextResponse.json({ updated: result.modifiedCount });
}
