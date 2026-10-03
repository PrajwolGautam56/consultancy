import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { estimateSmsCredits, normalizeSmsPhone, renderSmsTemplate, smsConfigured } from "@/lib/sms";
import { Lead } from "@/models/Lead";
import { SmsCampaign } from "@/models/SmsCampaign";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const schema = z.object({
  name: z.string().trim().min(2).max(120), providerId: z.enum(["samaya", "smspasal"]),
  senderId: z.string().trim().regex(/^[A-Za-z0-9_. -]{2,30}$/),
  routeId: z.string().trim().max(40).default(""), providerCampaignId: z.string().trim().max(40).default(""),
  messageTemplate: z.string().trim().min(1).max(720), leadIds: z.array(objectId).min(1).max(1000),
  scheduledAt: z.string().datetime().optional(), consentConfirmed: z.literal(true),
}).strict();

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  await connectMongo();
  const campaigns = await SmsCampaign.find().select("-recipients.renderedMessage").sort({ createdAt: -1 }).limit(40).lean();
  return NextResponse.json({ campaigns, configured: smsConfigured() });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can send SMS campaigns" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check the campaign, sender, message, recipients and consent confirmation" }, { status: 400 });
  if (!smsConfigured(parsed.data.providerId)) return NextResponse.json({ error: "The selected SMS provider is not configured on the server" }, { status: 503 });
  const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined;
  if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "Scheduled time must be in the future" }, { status: 400 });
  await connectMongo();
  const leads = await Lead.find({ _id: { $in: parsed.data.leadIds }, archivedAt: null, smsOptOutAt: null }).select("name phone country course university counsellor").lean();
  const recipients = leads.map((lead) => {
    const phone = normalizeSmsPhone(lead.phone);
    const renderedMessage = renderSmsTemplate(parsed.data.messageTemplate, {
      name: lead.name || "", phone, country: lead.country || "", course: lead.course || "",
      university: lead.university || "", counsellor: lead.counsellor || "",
    });
    const estimate = estimateSmsCredits(renderedMessage);
    return { leadId: lead._id, name: lead.name, phone, renderedMessage, encoding: estimate.encoding, segments: estimate.segments, status: "pending" };
  }).filter((recipient) => /^9\d{9}$/.test(recipient.phone) && recipient.renderedMessage.length <= 720);
  if (!recipients.length) return NextResponse.json({ error: "No selected contact has a valid Nepal mobile number" }, { status: 409 });
  await Lead.updateMany({ _id: { $in: recipients.map((recipient) => recipient.leadId) } }, {
    $set: { smsOptIn: true, smsOptInAt: new Date(), smsOptInSource: `Campaign confirmation by ${session.name}` },
  });
  const campaign = await SmsCampaign.create({
    ...parsed.data, scheduledAt, recipients, total: recipients.length,
    estimatedCredits: recipients.reduce((sum, recipient) => sum + recipient.segments, 0),
    createdBy: session.userId, createdByName: session.name,
  });
  return NextResponse.json({ campaign: { _id: campaign._id, total: campaign.total, estimatedCredits: campaign.estimatedCredits, status: campaign.status } }, { status: 201 });
}
