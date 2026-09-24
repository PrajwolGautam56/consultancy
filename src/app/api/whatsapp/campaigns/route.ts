import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";
import { WhatsAppCampaign } from "@/models/WhatsAppCampaign";
import { normalizeWhatsAppPhone, whatsappConfigured } from "@/lib/whatsapp";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  templateName: z.string().trim().regex(/^[a-z0-9_]+$/).max(512),
  language: z.string().trim().min(2).max(20).default("en"),
  leadIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(1000),
  bodyParameters: z.array(z.string().trim().max(500)).max(10).default([]),
}).strict();

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  await connectMongo(); const campaigns = await WhatsAppCampaign.find().sort({ createdAt: -1 }).limit(30).select("-recipients").lean();
  return NextResponse.json({ campaigns, configured: whatsappConfigured() });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can send campaigns" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!whatsappConfigured()) return NextResponse.json({ error: "Add the WhatsApp Cloud API environment variables first" }, { status: 503 });
  const parsed = createSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid campaign details" }, { status: 400 });
  await connectMongo();
  const leads = await Lead.find({ _id: { $in: parsed.data.leadIds }, archivedAt: null, whatsappOptIn: true, whatsappOptOutAt: null }).select("name phone").lean();
  if (!leads.length) return NextResponse.json({ error: "None of the selected students has recorded WhatsApp consent" }, { status: 409 });
  const campaign = await WhatsAppCampaign.create({ ...parsed.data, recipients: leads.map((lead) => ({ leadId: lead._id, name: lead.name, phone: normalizeWhatsAppPhone(lead.phone), status: "pending" })), total: leads.length, createdBy: session.userId, createdByName: session.name });
  return NextResponse.json({ campaign: { _id: campaign._id, total: campaign.total, status: campaign.status } }, { status: 201 });
}
