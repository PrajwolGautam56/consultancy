import { NextRequest, NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";
import { WhatsAppGroup } from "@/models/WhatsAppGroup";

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can manage SMS" }, { status: 403 });
  await connectMongo();
  const [leads, groups] = await Promise.all([
    Lead.find({ archivedAt: null }).select("name phone country course university counsellor smsOptIn").sort({ name: 1 }).lean(),
    WhatsAppGroup.find().select("name description color memberIds").sort({ name: 1 }).lean(),
  ]);
  return NextResponse.json({ leads, groups: groups.map((group) => ({ ...group, memberIds: (group.memberIds || []).map(String) })) });
}
