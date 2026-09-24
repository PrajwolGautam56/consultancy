import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { WhatsAppCampaign } from "@/models/WhatsAppCampaign";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";
import { sendWhatsApp } from "@/lib/whatsapp";

const schema = z.object({ campaignId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
  await connectMongo(); const campaign = await WhatsAppCampaign.findById(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status === "completed") return NextResponse.json({ done: true, sent: campaign.sent, failed: campaign.failed, total: campaign.total });
  campaign.status = "processing";
  const pending = campaign.recipients.filter((item: { status: string }) => item.status === "pending").slice(0, 10);
  await Promise.all(pending.map(async (recipient: { leadId: unknown; name: string; phone: string; status: string; messageId?: string; error?: string }) => {
    try {
      const parameters = campaign.bodyParameters.map((value: string) => ({ type: "text", text: value.replaceAll("{{name}}", recipient.name) }));
      const components = parameters.length ? [{ type: "body", parameters }] : undefined;
      const messageId = await sendWhatsApp({ to: recipient.phone, type: "template", template: { name: campaign.templateName, language: { code: campaign.language }, ...(components ? { components } : {}) } });
      recipient.status = "sent"; recipient.messageId = messageId; campaign.sent += 1;
      await WhatsAppMessage.create({ waMessageId: messageId, leadId: recipient.leadId, waId: recipient.phone, direction: "outbound", type: "template", body: campaign.name, status: "sent", sentBy: session.userId, sentByName: session.name, occurredAt: new Date() });
    } catch (error) { recipient.status = "failed"; recipient.error = error instanceof Error ? error.message.slice(0, 500) : "Send failed"; campaign.failed += 1; }
  }));
  const remaining = campaign.recipients.some((item: { status: string }) => item.status === "pending");
  if (!remaining) { campaign.status = "completed"; campaign.completedAt = new Date(); }
  await campaign.save();
  return NextResponse.json({ done: !remaining, sent: campaign.sent, failed: campaign.failed, total: campaign.total });
}
