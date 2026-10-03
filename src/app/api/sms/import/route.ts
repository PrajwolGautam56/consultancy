import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongodb";
import { isPrivileged, requireSameOrigin, requireSession } from "@/lib/api-security";
import { normalizeSmsPhone } from "@/lib/sms";
import { Lead } from "@/models/Lead";
import { WhatsAppGroup } from "@/models/WhatsAppGroup";

const schema = z.object({
  contacts: z.array(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(24) }).strict()).min(1).max(1000),
  consentConfirmed: z.literal(true), consentSource: z.string().trim().min(3).max(120),
  groupId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const session = await requireSession(request); if (session instanceof NextResponse) return session;
  if (!isPrivileged(session.role)) return NextResponse.json({ error: "Only administrators and managers can import SMS contacts" }, { status: 403 });
  if (!requireSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check every name and phone number, then confirm SMS permission" }, { status: 400 });
  const unique = new Map<string, { name: string; phone: string }>();
  for (const contact of parsed.data.contacts) {
    const phone = normalizeSmsPhone(contact.phone); if (/^9\d{9}$/.test(phone)) unique.set(phone, { name: contact.name, phone });
  }
  if (!unique.size) return NextResponse.json({ error: "No valid Nepal mobile numbers were found" }, { status: 400 });
  await connectMongo();
  const group = parsed.data.groupId ? await WhatsAppGroup.findById(parsed.data.groupId).select("_id name") : null;
  if (parsed.data.groupId && !group) return NextResponse.json({ error: "The selected contact group no longer exists" }, { status: 404 });
  const now = new Date(); const imported: string[] = []; let created = 0; let matched = 0;
  for (const contact of unique.values()) {
    const variants = [contact.phone, `+977${contact.phone}`, `977${contact.phone}`, `0${contact.phone}`];
    let lead = await Lead.findOne({ phone: { $in: variants }, archivedAt: null }).select("_id");
    if (lead) {
      await Lead.updateOne({ _id: lead._id }, { $set: { smsOptIn: true, smsOptInAt: now, smsOptInSource: parsed.data.consentSource, smsOptOutAt: null } }); matched += 1;
    } else {
      try {
        lead = await Lead.create({
          name: contact.name, phone: contact.phone, source: "Other", smsOptIn: true, smsOptInAt: now,
          smsOptInSource: parsed.data.consentSource, createdBy: session.userId,
          activities: [{ type: "note", text: `Bulk imported for SMS; permission source: ${parsed.data.consentSource}`, authorId: session.userId, authorName: session.name }],
        }); created += 1;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        lead = await Lead.findOne({ phone: { $in: variants } }).select("_id"); if (lead) matched += 1;
      }
    }
    if (lead) imported.push(String(lead._id));
  }
  const leadIds = [...new Set(imported)];
  if (group && leadIds.length) await WhatsAppGroup.updateOne({ _id: group._id }, { $addToSet: { memberIds: { $each: leadIds } }, $set: { updatedBy: session.userId } });
  return NextResponse.json({ leadIds, total: leadIds.length, created, matched, skipped: unique.size - leadIds.length, group: group ? { id: String(group._id), name: group.name } : null });
}
