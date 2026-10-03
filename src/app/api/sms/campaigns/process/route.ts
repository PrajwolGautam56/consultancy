import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { sendSms } from "@/lib/sms";
import { SmsCampaign } from "@/models/SmsCampaign";

const schema = z.object({ campaignId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
  await connectMongo();
  const campaign = await SmsCampaign.findOneAndUpdate({
    _id: parsed.data.campaignId,
    $or: [{ processingLockUntil: null }, { processingLockUntil: { $exists: false } }, { processingLockUntil: { $lt: new Date() } }],
  }, { $set: { processingLockUntil: new Date(Date.now() + 45_000) } }, { new: true });
  if (!campaign) {
    const exists = await SmsCampaign.exists({ _id: parsed.data.campaignId });
    return exists ? NextResponse.json({ done: false, busy: true }, { status: 202 }) : NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status === "completed" || campaign.status === "cancelled") {
    campaign.processingLockUntil = undefined; await campaign.save();
    return NextResponse.json({ done: true, campaign });
  }
  campaign.status = "processing";
  const pending = campaign.recipients.filter((recipient: { status: string }) => recipient.status === "pending").slice(0, 10);
  for (const recipient of pending) recipient.status = "sending";
  campaign.markModified("recipients"); await campaign.save();
  for (let index = 0; index < pending.length; index += 3) {
    await Promise.all(pending.slice(index, index + 3).map(async (recipient: { phone: string; renderedMessage: string; status: string; shootId?: string; error?: string }) => {
      try {
        const sent = await sendSms(campaign.providerId, {
          phone: recipient.phone, message: recipient.renderedMessage, senderId: campaign.senderId,
          routeId: campaign.routeId, campaignId: campaign.providerCampaignId,
          scheduledAt: campaign.scheduledAt,
        });
        recipient.status = "submitted"; recipient.shootId = sent.shootId; campaign.submitted += 1;
      } catch (error) {
        recipient.status = "failed"; recipient.error = error instanceof Error ? error.message.slice(0, 500) : "Send failed"; campaign.failed += 1;
      }
    }));
  }
  const remaining = campaign.recipients.some((recipient: { status: string }) => recipient.status === "pending");
  const unresolved = campaign.recipients.some((recipient: { status: string }) => recipient.status === "sending");
  if (!remaining) { campaign.status = unresolved ? "needs_attention" : "completed"; campaign.completedAt = new Date(); }
  campaign.processingLockUntil = undefined;
  campaign.markModified("recipients"); await campaign.save();
  return NextResponse.json({ done: !remaining, status: campaign.status, total: campaign.total, submitted: campaign.submitted, failed: campaign.failed });
}
