import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { getSmsDeliveryReport, normalizeSmsPhone } from "@/lib/sms";
import { SmsCampaign } from "@/models/SmsCampaign";

const schema = z.object({ campaignId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: "Invalid campaign" }, { status: 400 });
  await connectMongo(); const campaign = await SmsCampaign.findById(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const submitted = campaign.recipients.filter((recipient: { shootId?: string; status: string }) => recipient.shootId && recipient.status === "submitted").slice(0, 25);
  await Promise.all(submitted.map(async (recipient: { phone: string; shootId: string; status: string; deliveryDescription?: string; error?: string }) => {
    try {
      const report = await getSmsDeliveryReport(campaign.providerId, recipient.shootId);
      const own = report.find((item) => normalizeSmsPhone(item.phone) === normalizeSmsPhone(recipient.phone)) || report[0];
      if (!own) return;
      const normalized = own.status.toLowerCase();
      if (normalized.includes("deliver")) recipient.status = "delivered";
      else if (normalized.includes("fail") || normalized.includes("reject") || normalized.includes("expire")) recipient.status = "failed";
      recipient.deliveryDescription = own.description || own.status;
    } catch (error) { recipient.error = error instanceof Error ? error.message.slice(0, 500) : "DLR unavailable"; }
  }));
  campaign.delivered = campaign.recipients.filter((recipient: { status: string }) => recipient.status === "delivered").length;
  campaign.failed = campaign.recipients.filter((recipient: { status: string }) => recipient.status === "failed").length;
  campaign.markModified("recipients"); await campaign.save();
  return NextResponse.json({ delivered: campaign.delivered, failed: campaign.failed, submitted: campaign.submitted, checked: submitted.length });
}
