import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { requireSameOrigin, requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";
import { normalizeWhatsAppPhone, sendWhatsApp, whatsappConfigured } from "@/lib/whatsapp";

const sendSchema = z.object({ leadId: z.string().regex(/^[a-f\d]{24}$/i), text: z.string().trim().min(1).max(4096) }).strict();

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  await connectMongo();
  const access = ["counsellor", "manager"].includes(session.role)
    ? { $or: [{ assignedTo: session.userId }, { followUpAssignedTo: session.userId }, { counsellor: session.name }, { followUpAssignee: session.name }] } : {};
  const allowed = await Lead.find({ ...access, archivedAt: null }).select("_id name phone whatsappOptIn").lean();
  const leadIds = allowed.map((lead) => lead._id);
  const messages = await WhatsAppMessage.find({ leadId: { $in: leadIds } }).sort({ occurredAt: -1 }).limit(300).lean();
  return NextResponse.json({ configured: whatsappConfigured(), leads: allowed, messages });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = sendSchema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  await connectMongo();
  const lead = await Lead.findById(parsed.data.leadId).select("name phone assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as unknown as null | { _id: unknown; name: string; phone: string; assignedTo?: unknown; followUpAssignedTo?: unknown; counsellor?: string; followUpAssignee?: string };
  if (!lead) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (["counsellor", "manager"].includes(session.role) && String(lead.assignedTo || "") !== session.userId && String(lead.followUpAssignedTo || "") !== session.userId && lead.counsellor !== session.name && lead.followUpAssignee !== session.name) return NextResponse.json({ error: "This student is not assigned to you" }, { status: 403 });
  const waId = normalizeWhatsAppPhone(lead.phone);
  const latestInbound = await WhatsAppMessage.findOne({ leadId: lead._id, direction: "inbound" }).sort({ occurredAt: -1 }).select("occurredAt").lean() as unknown as null | { occurredAt: Date };
  if (!latestInbound || Date.now() - new Date(latestInbound.occurredAt).getTime() > 24 * 60 * 60 * 1000) return NextResponse.json({ error: "The 24-hour reply window is closed. Send an approved template instead." }, { status: 409 });
  try {
    const waMessageId = await sendWhatsApp({ to: waId, type: "text", text: { body: parsed.data.text } });
    const message = await WhatsAppMessage.create({ waMessageId, leadId: lead._id, waId, direction: "outbound", type: "text", body: parsed.data.text, status: "sent", sentBy: session.userId, sentByName: session.name, occurredAt: new Date() });
    return NextResponse.json({ message });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Message could not be sent" }, { status: 502 }); }
}
