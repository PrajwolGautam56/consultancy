import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { requireSameOrigin, requireSession } from "@/lib/api-security";
import { Lead } from "@/models/Lead";
import { WhatsAppMessage } from "@/models/WhatsAppMessage";
import { getApprovedWhatsAppTemplates, normalizeWhatsAppPhone, renderWhatsAppTemplate, sendWhatsApp, whatsappConfigured, whatsappPhonePatterns, whatsappWebhookConfigured } from "@/lib/whatsapp";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const waIdSchema = z.string().regex(/^\d{8,15}$/);
const textSchema = z.string().trim().min(1).max(4096);
const sendSchema = z.union([
  z.object({ leadId: objectId, text: textSchema }).strict(),
  z.object({ waId: waIdSchema, text: textSchema }).strict(),
  z.object({
    leadId: objectId, templateName: z.string().trim().regex(/^[a-z0-9_]+$/).max(512),
    language: z.string().trim().min(2).max(20),
    bodyParameters: z.array(z.string().trim().max(500)).max(10).default([]),
  }).strict(),
]);

type LeadSummary = {
  _id: unknown; name: string; phone: string; whatsappOptIn?: boolean;
  whatsappOptOutAt?: Date | null;
  assignedTo?: unknown; followUpAssignedTo?: unknown;
  counsellor?: string; followUpAssignee?: string;
};
type MessageRecord = {
  _id: unknown; leadId?: unknown; waId: string; direction: "inbound" | "outbound";
  senderName?: string; occurredAt: Date; [key: string]: unknown;
};

function leadAccess(session: { role: string; userId: string; name: string }) {
  return ["counsellor", "manager"].includes(session.role)
    ? { $or: [{ assignedTo: session.userId }, { followUpAssignedTo: session.userId }, { counsellor: session.name }, { followUpAssignee: session.name }] }
    : {};
}

function canSeeUnlinked(role: string) {
  return role === "super_admin" || role === "admin" || role === "receptionist";
}

function canAccessLead(lead: LeadSummary, session: { role: string; userId: string; name: string }) {
  if (!["counsellor", "manager"].includes(session.role)) return true;
  return String(lead.assignedTo || "") === session.userId ||
    String(lead.followUpAssignedTo || "") === session.userId ||
    lead.counsellor === session.name || lead.followUpAssignee === session.name;
}

export async function GET(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  await connectMongo();

  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (conversationId) {
    let waId: string;
    let leadId: unknown;
    if (conversationId.startsWith("wa:")) {
      const parsed = waIdSchema.safeParse(conversationId.slice(3));
      if (!parsed.success) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
      if (!canSeeUnlinked(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      waId = parsed.data;
      const activeLead = await Lead.exists({ phone: { $in: whatsappPhonePatterns(waId) }, archivedAt: null });
      if (activeLead) return NextResponse.json({ error: "This number is linked to a student. Open the student conversation." }, { status: 409 });
    } else {
      const parsed = objectId.safeParse(conversationId);
      if (!parsed.success) return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
      const lead = await Lead.findOne({ _id: parsed.data, ...leadAccess(session), archivedAt: null }).select("phone").lean() as LeadSummary | null;
      if (!lead) return NextResponse.json({ error: "Student not found or not assigned to you" }, { status: 404 });
      leadId = lead._id;
      waId = normalizeWhatsAppPhone(lead.phone);
    }

    const before = request.nextUrl.searchParams.get("before");
    const beforeDate = before ? new Date(before) : null;
    if (before && (!beforeDate || Number.isNaN(beforeDate.getTime()))) return NextResponse.json({ error: "Invalid page cursor" }, { status: 400 });
    const ownership = leadId ? { $or: [{ leadId }, { leadId: null, waId }] } : { leadId: null, waId };
    const filter = beforeDate ? { $and: [ownership, { occurredAt: { $lt: beforeDate } }] } : ownership;
    const [foundRaw, latestInbound] = await Promise.all([
      WhatsAppMessage.find(filter).sort({ occurredAt: -1, _id: -1 }).limit(51).lean(),
      WhatsAppMessage.findOne({ $and: [ownership, { direction: "inbound" }] }).sort({ occurredAt: -1 }).select("occurredAt").lean(),
    ]);
    const found = foundRaw as unknown as MessageRecord[];
    const inbound = latestInbound as unknown as { occurredAt: Date } | null;
    return NextResponse.json({ messages: found.slice(0, 50).reverse(), hasMore: found.length > 50, lastInboundAt: inbound?.occurredAt || null });
  }

  const allowed = await Lead.find({ ...leadAccess(session), archivedAt: null }).select("_id name phone whatsappOptIn").lean() as unknown as LeadSummary[];
  const leadById = new Map(allowed.map((lead) => [String(lead._id), lead]));
  const leadByWaId = new Map(allowed.map((lead) => [normalizeWhatsAppPhone(lead.phone), lead]));
  const leadIds = allowed.map((lead) => lead._id);
  const waIds = [...leadByWaId.keys()];
  const unrestricted = canSeeUnlinked(session.role);
  const access = unrestricted ? {} : { $or: [{ leadId: { $in: leadIds } }, { leadId: null, waId: { $in: waIds } }] };

  const [recentRaw, groupedRaw] = await Promise.all([
    WhatsAppMessage.find(access).sort({ occurredAt: -1, _id: -1 }).limit(300).lean(),
    WhatsAppMessage.aggregate([
      { $match: access }, { $sort: { occurredAt: -1, _id: -1 } },
      { $group: { _id: "$waId", lastMessage: { $first: "$$ROOT" } } },
      { $sort: { "lastMessage.occurredAt": -1 } }, { $limit: 300 },
    ]),
  ]);
  const recent = recentRaw as unknown as MessageRecord[];
  const grouped = groupedRaw as Array<{ _id: string; lastMessage: MessageRecord }>;

  const unmatched = new Map<string, { _id: string; name: string; phone: string; whatsappOptIn: boolean; unlinked: true }>();
  const conversations = new Map<string, { conversationId: string; lastMessage: MessageRecord }>();
  for (const item of grouped) {
    const waId = normalizeWhatsAppPhone(item._id);
    const lead = leadByWaId.get(waId) || leadById.get(String(item.lastMessage.leadId || ""));
    if (!lead && !unrestricted) continue;
    const id = lead ? String(lead._id) : `wa:${waId}`;
    if (!lead && !unmatched.has(id)) unmatched.set(id, {
      _id: id, name: item.lastMessage.senderName || `+${waId}`,
      phone: `+${waId}`, whatsappOptIn: false, unlinked: true,
    });
    if (!conversations.has(id)) conversations.set(id, {
      conversationId: id,
      lastMessage: { ...item.lastMessage, ...(lead ? { leadId: lead._id } : {}) },
    });
  }

  const messages = recent.map((message) => {
    const lead = leadByWaId.get(normalizeWhatsAppPhone(message.waId)) || leadById.get(String(message.leadId || ""));
    return lead ? { ...message, leadId: lead._id } : message;
  });
  return NextResponse.json({
    configured: whatsappConfigured(), webhookConfigured: whatsappWebhookConfigured(),
    leads: [...allowed, ...unmatched.values()], messages, conversations: [...conversations.values()],
  });
}

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = sendSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid message" }, { status: 400 });
  await connectMongo();

  const input = parsed.data;
  let lead: LeadSummary | null = null;
  let waId: string;
  if ("leadId" in input) {
    lead = await Lead.findOne({ _id: input.leadId, archivedAt: null }).select("name phone whatsappOptIn whatsappOptOutAt assignedTo followUpAssignedTo counsellor followUpAssignee").lean() as LeadSummary | null;
    if (!lead) return NextResponse.json({ error: "Student not found" }, { status: 404 });
    if (!canAccessLead(lead, session)) return NextResponse.json({ error: "This student is not assigned to you" }, { status: 403 });
    waId = normalizeWhatsAppPhone(lead.phone);
  } else {
    if (!canSeeUnlinked(session.role)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    waId = input.waId;
    const activeLead = await Lead.exists({ phone: { $in: whatsappPhonePatterns(waId) }, archivedAt: null });
    if (activeLead) return NextResponse.json({ error: "This number is linked to a student. Open the student conversation." }, { status: 409 });
  }

  const isTemplate = "templateName" in input;
  if (isTemplate && (!lead?.whatsappOptIn || lead.whatsappOptOutAt)) {
    return NextResponse.json({ error: "Record this student's WhatsApp opt-in before sending an approved template." }, { status: 409 });
  }
  let templateBody = "";
  let resolvedParameters: string[] = [];
  if (isTemplate) {
    let template;
    try {
      template = (await getApprovedWhatsAppTemplates()).find((item) => item.name === input.templateName && item.language === input.language);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not verify the Meta template" }, { status: 502 });
    }
    if (!template) return NextResponse.json({ error: "This template is not approved in the configured Meta WABA" }, { status: 409 });
    if (input.bodyParameters.length !== template.parameterCount) return NextResponse.json({ error: `This template needs ${template.parameterCount} body value(s)` }, { status: 400 });
    resolvedParameters = input.bodyParameters.map((value) => value.replaceAll("{{name}}", lead?.name || ""));
    templateBody = template.body ? renderWhatsAppTemplate(template.body, resolvedParameters) : `Template: ${input.templateName}`;
  }
  if (!isTemplate) {
    const latestInbound = await WhatsAppMessage.findOne({
      waId, direction: "inbound", ...(lead ? { $or: [{ leadId: lead._id }, { leadId: null }] } : { leadId: null }),
    }).sort({ occurredAt: -1 }).select("occurredAt").lean() as { occurredAt: Date } | null;
    if (!latestInbound || Date.now() - new Date(latestInbound.occurredAt).getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "The 24-hour reply window is closed. Send an approved template instead." }, { status: 409 });
    }
  }

  const payload = isTemplate
    ? { to: waId, type: "template", template: {
      name: input.templateName, language: { code: input.language },
      ...(resolvedParameters.length ? { components: [{ type: "body", parameters: resolvedParameters.map((text) => ({ type: "text", text })) }] } : {}),
    } }
    : { to: waId, type: "text", text: { body: input.text } };
  let waMessageId: string;
  try {
    waMessageId = await sendWhatsApp(payload);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Message could not be sent" }, { status: 502 });
  }
  try {
    await WhatsAppMessage.updateOne(
      { waMessageId },
      {
        $set: {
          ...(lead ? { leadId: lead._id } : {}), waId, direction: "outbound",
          type: isTemplate ? "template" : "text",
          body: isTemplate ? templateBody : input.text,
          ...(isTemplate ? { templateName: input.templateName, templateLanguage: input.language } : {}),
          sentBy: session.userId, sentByName: session.name,
        },
        $setOnInsert: { status: "sent", occurredAt: new Date() },
      },
      { upsert: true },
    );
    const message = await WhatsAppMessage.findOne({ waMessageId }).lean();
    return NextResponse.json({ message });
  } catch (error) {
    console.error("WhatsApp accepted a message but CRM could not store it", error);
    return NextResponse.json({ accepted: true, waMessageId, error: "WhatsApp accepted the message, but the CRM could not save its history. Do not resend it yet." }, { status: 202 });
  }
}
